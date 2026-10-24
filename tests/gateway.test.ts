import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isPublicAddress, resolveTarget } from "../src/gateway/addressPolicy";
import type { GatewayConfig } from "../src/gateway/config";
import { connectRelay } from "../src/gateway/relayLink";

const config: GatewayConfig = {
	listenHost: "127.0.0.1",
	listenPort: 0,
	allowedOrigins: [],
	localRelayHosts: ["relay.example.test"],
	localRelayAddress: "127.0.0.1",
	localRelayPort: 6837,
	trustProxy: true,
	maxSessionsPerIp: 6,
	maxConnectAttemptsPerMinute: 30,
	maxTotalSessions: 300,
	connectTimeoutMs: 3000,
};

describe("address policy", () => {
	it("allows only public addresses", () => {
		const own = new Set<string>();
		expect(isPublicAddress("8.8.8.8", own)).toBe(true);
		expect(isPublicAddress("2606:4700:4700::1111", own)).toBe(true);
		for (const address of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.20.0.1", "100.64.1.1", "169.254.1.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "0.0.0.0"]) {
			expect(isPublicAddress(address, own), address).toBe(false);
		}
		expect(isPublicAddress("8.8.8.8", new Set(["8.8.8.8"]))).toBe(false);
		expect(isPublicAddress("::ffff:8.8.8.8", own)).toBe(true);
	});

	it("routes the local relay name over loopback, on its port only", async () => {
		await expect(resolveTarget("Relay.Example.Test.", 6837, config)).resolves.toMatchObject({
			address: "127.0.0.1",
			isLocalRelay: true,
		});
		await expect(resolveTarget("relay.example.test", 22, config)).rejects.toMatchObject({ code: "forbidden_host" });
	});

	it("rejects invalid and private targets", async () => {
		await expect(resolveTarget("bad host!", 6837, config)).rejects.toMatchObject({ code: "invalid_host" });
		await expect(resolveTarget("example.com", 70000, config)).rejects.toMatchObject({ code: "invalid_host" });
		await expect(resolveTarget("10.0.0.1", 6837, config)).rejects.toMatchObject({ code: "forbidden_host" });
		await expect(resolveTarget("localhost", 6837, config)).rejects.toMatchObject({ code: "forbidden_host" });
		await expect(resolveTarget("[::1]", 6837, config)).rejects.toMatchObject({ code: "forbidden_host" });
	});
});

describe("relay connection", () => {
	let server: tls.Server;
	let port = 0;
	let received: string[] = [];

	beforeAll(async () => {
		const dir = mkdtempSync(join(tmpdir(), "nvremote-test-"));
		execFileSync("openssl", [
			"req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=selfsigned.test",
			"-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
		], { stdio: "ignore" });
		server = tls.createServer({ key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) }, (socket) => {
			socket.on("data", (data) => {
				received.push(...data.toString().split("\n").filter(Boolean));
				// Reply with two messages split across writes, as a real relay might.
				socket.write('{"type":"channel_jo');
				setTimeout(() => socket.write('ined","channel":"k"}\n{"type":"ping"}\n'), 10);
			});
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
		port = (server.address() as { port: number }).port;
	});

	afterAll(() => server.close());

	const target = () => ({ host: "selfsigned.test", address: "127.0.0.1", port, isLocalRelay: false });

	it("asks for trust when the certificate cannot be verified", async () => {
		const result = await connectRelay(target(), undefined, 3000);
		expect(result.kind).toBe("certRequired");
		if (result.kind === "certRequired") {
			expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
			expect(result.reason).toMatch(/SELF_SIGNED/);
		}
	});

	it("rejects a different trusted fingerprint", async () => {
		const result = await connectRelay(target(), "0".repeat(64), 3000);
		expect(result.kind).toBe("certRequired");
	});

	it("connects with the trusted fingerprint and frames messages", async () => {
		const first = await connectRelay(target(), undefined, 3000);
		if (first.kind !== "certRequired") throw new Error("expected certRequired");
		const result = await connectRelay(target(), first.fingerprint, 3000);
		expect(result.kind).toBe("connected");
		if (result.kind !== "connected") return;
		const messages: unknown[] = [];
		result.link.send({ type: "protocol_version", version: 2 });
		await new Promise((resolve) => setTimeout(resolve, 100));
		result.link.attach({ onMessage: (m) => messages.push(m), onClose: () => {} });
		expect(messages).toEqual([{ type: "channel_joined", channel: "k" }, { type: "ping" }]);
		expect(received).toContain('{"type":"protocol_version","version":2}');
		result.link.close();
	});

	it("reports refused connections", async () => {
		const result = await connectRelay({ ...target(), port: 1 }, undefined, 3000);
		expect(result).toMatchObject({ kind: "failed", code: "connect_failed" });
	});
});
