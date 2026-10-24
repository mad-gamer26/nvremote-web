// WebSocket gateway between browsers and NVDA Remote relay servers.
// Each WebSocket carries at most one relay session, always as the controlling ("master") side.
// No keystrokes, speech, clipboard text or channel keys are ever logged.

import { createServer, type IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import {
	BROWSER_SENDABLE_TYPES,
	MAX_MESSAGE_BYTES,
	NVDA_PROTOCOL_VERSION,
	type ClientToGateway,
	type GatewayErrorCode,
	type GatewayToClient,
	type RemoteMessage,
} from "../shared/protocol.js";
import { PolicyError, resolveTarget, type ResolvedTarget } from "./addressPolicy.js";
import { loadConfig, type GatewayConfig } from "./config.js";
import { connectRelay, type RelayLink } from "./relayLink.js";

const SENDABLE = new Set<string>(BROWSER_SENDABLE_TYPES);
const HEARTBEAT_MS = 30_000;
const MAX_KEY_LENGTH = 256;

function log(event: string, details: Record<string, unknown> = {}): void {
	console.log(JSON.stringify({ time: new Date().toISOString(), event, ...details }));
}

/** Counts connection attempts per client address over a sliding one-minute window. */
class AttemptLimiter {
	private attempts = new Map<string, number[]>();

	constructor(private readonly perMinute: number) {
		setInterval(() => this.prune(), 60_000).unref();
	}

	allow(ip: string): boolean {
		const now = Date.now();
		const recent = (this.attempts.get(ip) ?? []).filter((t) => now - t < 60_000);
		if (recent.length >= this.perMinute) {
			this.attempts.set(ip, recent);
			return false;
		}
		recent.push(now);
		this.attempts.set(ip, recent);
		return true;
	}

	private prune(): void {
		const now = Date.now();
		for (const [ip, times] of this.attempts) {
			if (times.every((t) => now - t >= 60_000)) {
				this.attempts.delete(ip);
			}
		}
	}
}

function clientAddress(request: IncomingMessage, config: GatewayConfig): string {
	const remote = request.socket.remoteAddress ?? "unknown";
	const fromLoopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
	const realIp = request.headers["x-real-ip"];
	if (config.trustProxy && fromLoopback && typeof realIp === "string" && realIp) {
		return realIp;
	}
	return remote;
}

function isValidFingerprint(value: unknown): value is string {
	return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function parseClientMessage(raw: string): ClientToGateway | null {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const message = value as Record<string, unknown>;
	switch (message.op) {
		case "connect":
		case "generateKey": {
			if (typeof message.host !== "string" || typeof message.port !== "number") {
				return null;
			}
			if (message.fingerprint !== undefined && !isValidFingerprint(message.fingerprint)) {
				return null;
			}
			if (message.op === "generateKey") {
				return message as ClientToGateway;
			}
			if (typeof message.key !== "string" || !message.key.trim() || message.key.length > MAX_KEY_LENGTH) {
				return null;
			}
			return message as ClientToGateway;
		}
		case "send": {
			const msg = message.msg as RemoteMessage | undefined;
			if (!msg || typeof msg !== "object" || Array.isArray(msg) || typeof msg.type !== "string") {
				return null;
			}
			return message as ClientToGateway;
		}
		case "disconnect":
			return message as ClientToGateway;
		default:
			return null;
	}
}

class Session {
	private relay: RelayLink | null = null;
	/** Incremented on every connect or disconnect so stale async results are ignored. */
	private generation = 0;
	alive = true;

	constructor(
		private readonly socket: WebSocket,
		readonly ip: string,
		private readonly config: GatewayConfig,
		private readonly limiter: AttemptLimiter,
	) {}

	reply(message: GatewayToClient): void {
		if (this.socket.readyState === WebSocket.OPEN) {
			this.socket.send(JSON.stringify(message));
		}
	}

	error(code: GatewayErrorCode, message: string): void {
		this.reply({ op: "error", code, message });
	}

	async handle(message: ClientToGateway): Promise<void> {
		switch (message.op) {
			case "connect":
				await this.connect(message.host, message.port, message.key.trim(), message.fingerprint);
				return;
			case "generateKey":
				await this.generateKey(message.host, message.port, message.fingerprint);
				return;
			case "send":
				if (!SENDABLE.has(message.msg.type)) {
					this.error("bad_request", `Messages of type ${message.msg.type} cannot be sent.`);
				} else if (!this.relay) {
					this.error("not_connected", "Not connected to a server.");
				} else {
					this.relay.send(message.msg);
				}
				return;
			case "disconnect":
				this.dropRelay("You disconnected.");
				return;
		}
	}

	close(): void {
		this.generation++;
		this.relay?.close();
		this.relay = null;
	}

	private dropRelay(reason: string): void {
		this.generation++;
		const relay = this.relay;
		this.relay = null;
		relay?.close();
		this.reply({ op: "status", state: "disconnected", reason });
	}

	/** Shared first half of connect and generateKey: rate limiting, address policy and TLS. */
	private async openRelay(
		host: string,
		port: number,
		fingerprint: string | undefined,
	): Promise<{ link: RelayLink; target: ResolvedTarget; generation: number } | "failed" | "superseded"> {
		const generation = ++this.generation;
		if (!this.limiter.allow(this.ip)) {
			this.error("rate_limited", "Too many connection attempts. Wait a minute and try again.");
			return "failed";
		}
		let target: ResolvedTarget;
		try {
			target = await resolveTarget(host, port, this.config);
		} catch (error) {
			if (error instanceof PolicyError) {
				this.error(error.code, error.message);
				return "failed";
			}
			throw error;
		}
		if (generation !== this.generation) {
			return "superseded";
		}
		const result = await connectRelay(target, fingerprint, this.config.connectTimeoutMs);
		if (generation !== this.generation) {
			if (result.kind === "connected") {
				result.link.close();
			}
			return "superseded";
		}
		switch (result.kind) {
			case "certRequired":
				log("cert_required", { ip: this.ip, host: target.host, port });
				this.reply({
					op: "certRequired",
					host: target.host,
					port,
					fingerprint: result.fingerprint,
					reason: result.reason,
				});
				return "failed";
			case "failed":
				log("relay_failed", { ip: this.ip, host: target.host, port, code: result.code });
				this.error(result.code, result.message);
				return "failed";
			case "connected":
				return { link: result.link, target, generation };
		}
	}

	private async connect(host: string, port: number, key: string, fingerprint?: string): Promise<void> {
		this.relay?.close();
		this.relay = null;
		this.reply({ op: "status", state: "connecting" });
		const opened = await this.openRelay(host, port, fingerprint);
		if (opened === "failed") {
			this.reply({ op: "status", state: "disconnected" });
			return;
		}
		if (opened === "superseded") {
			return;
		}
		const { link, target, generation } = opened;
		this.relay = link;
		link.attach({
			onMessage: (msg) => {
				if (msg.type !== "ping") {
					this.reply({ op: "msg", msg });
				}
			},
			onClose: (reason) => {
				if (generation === this.generation) {
					this.relay = null;
					log("relay_closed", { ip: this.ip, host: target.host });
					this.reply({ op: "status", state: "disconnected", reason });
				}
			},
		});
		link.send({ type: "protocol_version", version: NVDA_PROTOCOL_VERSION });
		link.send({ type: "join", channel: key, connection_type: "master" });
		log("relay_connected", { ip: this.ip, host: target.host, port, local: target.isLocalRelay });
		this.reply({ op: "status", state: "connected" });
	}

	private async generateKey(host: string, port: number, fingerprint?: string): Promise<void> {
		this.relay?.close();
		this.relay = null;
		const opened = await this.openRelay(host, port, fingerprint);
		if (typeof opened === "string") {
			return;
		}
		const { link, generation } = opened;
		const timer = setTimeout(() => {
			link.close();
			if (generation === this.generation) {
				this.error("timeout", "The server did not send a key. It may not support generating keys.");
			}
		}, this.config.connectTimeoutMs);
		link.attach({
			onMessage: (msg) => {
				if (msg.type === "generate_key" && typeof msg.key === "string") {
					clearTimeout(timer);
					link.close();
					if (generation === this.generation) {
						this.reply({ op: "key", key: msg.key });
					}
				}
			},
			onClose: () => clearTimeout(timer),
		});
		link.send({ type: "protocol_version", version: NVDA_PROTOCOL_VERSION });
		link.send({ type: "generate_key" });
	}
}

export function startGateway(config: GatewayConfig = loadConfig()) {
	const limiter = new AttemptLimiter(config.maxConnectAttemptsPerMinute);
	const sessionsPerIp = new Map<string, number>();
	const sessions = new Set<Session>();
	const heartbeatTargets = new Map<Session, WebSocket>();

	const httpServer = createServer((request, response) => {
		if (request.url === "/healthz") {
			response.writeHead(200, { "content-type": "text/plain" });
			response.end("ok\n");
			return;
		}
		response.writeHead(404, { "content-type": "text/plain" });
		response.end("Not found\n");
	});

	const wss = new WebSocketServer({
		noServer: true,
		maxPayload: MAX_MESSAGE_BYTES,
		perMessageDeflate: false,
	});

	httpServer.on("upgrade", (request, socket, head) => {
		const path = new URL(request.url ?? "/", "http://localhost").pathname;
		const origin = (request.headers.origin ?? "").toLowerCase();
		const ip = clientAddress(request, config);
		const reject = (status: string) => {
			socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
		};
		if (path !== "/ws") {
			reject("404 Not Found");
			return;
		}
		if (config.allowedOrigins.length > 0 && !config.allowedOrigins.includes(origin)) {
			log("origin_rejected", { ip, origin });
			reject("403 Forbidden");
			return;
		}
		if (sessions.size >= config.maxTotalSessions || (sessionsPerIp.get(ip) ?? 0) >= config.maxSessionsPerIp) {
			log("session_limit", { ip });
			reject("429 Too Many Requests");
			return;
		}
		wss.handleUpgrade(request, socket, head, (ws) => {
			const session = new Session(ws, ip, config, limiter);
			sessions.add(session);
			sessionsPerIp.set(ip, (sessionsPerIp.get(ip) ?? 0) + 1);
			log("session_open", { ip, sessions: sessions.size });

			ws.on("pong", () => {
				session.alive = true;
			});
			ws.on("message", (data, isBinary) => {
				const message = isBinary ? null : parseClientMessage(data.toString());
				if (!message) {
					session.error("bad_request", "The gateway did not understand that request.");
					return;
				}
				session.handle(message).catch((error: unknown) => {
					log("session_error", { ip, error: String(error) });
					session.error("protocol_error", "Something went wrong in the gateway.");
				});
			});
			ws.on("close", () => {
				session.close();
				sessions.delete(session);
				const remaining = (sessionsPerIp.get(ip) ?? 1) - 1;
				if (remaining > 0) {
					sessionsPerIp.set(ip, remaining);
				} else {
					sessionsPerIp.delete(ip);
				}
				log("session_close", { ip, sessions: sessions.size });
			});
			ws.on("error", () => ws.terminate());
			heartbeatTargets.set(session, ws);
			ws.once("close", () => heartbeatTargets.delete(session));
		});
	});

	const heartbeat = setInterval(() => {
		for (const [session, ws] of heartbeatTargets) {
			if (!session.alive) {
				ws.terminate();
				continue;
			}
			session.alive = false;
			ws.ping();
		}
	}, HEARTBEAT_MS);

	httpServer.listen(config.listenPort, config.listenHost, () => {
		log("listening", { host: config.listenHost, port: config.listenPort });
	});

	const shutdown = () => {
		clearInterval(heartbeat);
		for (const ws of heartbeatTargets.values()) {
			ws.close(1001, "Server shutting down");
		}
		httpServer.close();
	};
	return { httpServer, shutdown };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const { shutdown } = startGateway();
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, () => {
			shutdown();
			setTimeout(() => process.exit(0), 500).unref();
		});
	}
}
