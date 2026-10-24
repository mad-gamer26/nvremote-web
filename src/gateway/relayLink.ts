// A TLS connection to an NVDA Remote relay server, carrying newline-delimited JSON.
// Certificate handling mirrors NVDA's own client: a certificate that verifies normally
// is accepted, otherwise the connection is only allowed if its SHA-256 fingerprint
// matches one the user has explicitly chosen to trust.

import { createHash } from "node:crypto";
import { isIP } from "node:net";
import tls from "node:tls";

import { MAX_MESSAGE_BYTES, type RemoteMessage } from "../shared/protocol.js";
import type { ResolvedTarget } from "./addressPolicy.js";

export type ConnectResult =
	| { kind: "connected"; link: RelayLink }
	| { kind: "certRequired"; fingerprint: string; reason: string }
	| { kind: "failed"; code: "connect_failed" | "timeout"; message: string };

export interface RelayLinkHandlers {
	onMessage(message: RemoteMessage): void;
	onClose(reason: string): void;
}

/** Same format NVDA uses: lowercase hex SHA-256 of the DER certificate. */
export function certificateFingerprint(der: Buffer): string {
	return createHash("sha256").update(der).digest("hex").toLowerCase();
}

export function connectRelay(
	target: ResolvedTarget,
	trustedFingerprint: string | undefined,
	timeoutMs: number,
): Promise<ConnectResult> {
	return new Promise((resolve) => {
		let settled = false;
		const settle = (result: ConnectResult) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				resolve(result);
			}
		};
		const socket = tls.connect({
			host: target.address,
			port: target.port,
			// SNI and hostname verification use the name the user typed, not the vetted address.
			servername: isIP(target.host) === 0 ? target.host : undefined,
			checkServerIdentity: (_hostname, cert) => tls.checkServerIdentity(target.host, cert),
			rejectUnauthorized: false,
			minVersion: "TLSv1.2",
		});
		const timer = setTimeout(() => {
			socket.destroy();
			settle({ kind: "failed", code: "timeout", message: "The server did not respond in time." });
		}, timeoutMs);

		socket.once("secureConnect", () => {
			const der = socket.getPeerCertificate(false)?.raw;
			if (!der) {
				socket.destroy();
				settle({ kind: "failed", code: "connect_failed", message: "The server sent no certificate." });
				return;
			}
			const fingerprint = certificateFingerprint(der);
			if (!socket.authorized && fingerprint !== trustedFingerprint?.toLowerCase()) {
				socket.destroy();
				settle({
					kind: "certRequired",
					fingerprint,
					reason: String(socket.authorizationError ?? "The certificate could not be verified."),
				});
				return;
			}
			socket.setNoDelay(true);
			socket.setKeepAlive(true, 60_000);
			settle({ kind: "connected", link: new RelayLink(socket) });
		});
		socket.once("error", (error: NodeJS.ErrnoException) => {
			socket.destroy();
			settle({ kind: "failed", code: "connect_failed", message: describeSocketError(error) });
		});
	});
}

function describeSocketError(error: NodeJS.ErrnoException): string {
	switch (error.code) {
		case "ECONNREFUSED":
			return "The server refused the connection. Check the server name and port.";
		case "EHOSTUNREACH":
		case "ENETUNREACH":
			return "The server could not be reached.";
		case "ECONNRESET":
			return "The server closed the connection. It may not be an NVDA Remote server.";
		default:
			return "Could not connect to the server. It may not be an NVDA Remote server.";
	}
}

export class RelayLink {
	private buffer: Buffer = Buffer.alloc(0);
	private handlers: RelayLinkHandlers | null = null;
	private pending: RemoteMessage[] = [];
	private closeReason: string | null = null;
	private closed = false;

	constructor(private readonly socket: tls.TLSSocket) {
		socket.on("data", (chunk: Buffer) => this.receive(chunk));
		socket.on("error", () => this.close("The connection to the server failed."));
		socket.on("close", () => this.close("The server closed the connection."));
	}

	/** Start delivering messages, including any that arrived before attaching. */
	attach(handlers: RelayLinkHandlers): void {
		this.handlers = handlers;
		for (const message of this.pending.splice(0)) {
			handlers.onMessage(message);
		}
		if (this.closeReason !== null) {
			handlers.onClose(this.closeReason);
		}
	}

	send(message: RemoteMessage): void {
		if (!this.closed) {
			this.socket.write(JSON.stringify(message) + "\n");
		}
	}

	close(reason = "Disconnected."): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.socket.destroy();
		if (this.handlers) {
			this.handlers.onClose(reason);
		} else {
			this.closeReason = reason;
		}
	}

	private receive(chunk: Buffer): void {
		let data = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
		let newline: number;
		while ((newline = data.indexOf(0x0a)) !== -1) {
			const line = data.subarray(0, newline);
			data = data.subarray(newline + 1);
			this.parse(line);
			if (this.closed) {
				return;
			}
		}
		if (data.length > MAX_MESSAGE_BYTES) {
			this.close("The server sent a message that was too large.");
			return;
		}
		this.buffer = Buffer.from(data);
	}

	private parse(line: Buffer): void {
		if (line.length === 0) {
			return;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(line.toString("utf8"));
		} catch {
			return;
		}
		if (
			parsed === null ||
			typeof parsed !== "object" ||
			Array.isArray(parsed) ||
			typeof (parsed as RemoteMessage).type !== "string"
		) {
			return;
		}
		if (this.handlers) {
			this.handlers.onMessage(parsed as RemoteMessage);
		} else {
			this.pending.push(parsed as RemoteMessage);
		}
	}
}
