// Talks to the gateway over WebSocket and keeps one NVDA Remote session alive,
// reconnecting automatically the way NVDA does when a connection drops.

import type { ClientToGateway, GatewayToClient, RemoteMessage } from "../shared/protocol.js";
import { formatAddress, type ConnectionDetails } from "./links.js";
import { trustedFingerprints, trustFingerprint } from "./settings.js";

export type ConnectionState = "idle" | "connecting" | "connected" | "reconnecting";

export interface CertificateRequest {
	host: string;
	port: number;
	fingerprint: string;
	reason: string;
	/** The fingerprint previously trusted for this server, if the certificate has changed. */
	previousFingerprint: string | null;
}

export interface ConnectionEvents {
	onState(state: ConnectionState, detail?: string): void;
	onMessage(message: RemoteMessage): void;
	onError(message: string): void;
	/** Ask the user whether to trust a certificate that could not be verified. */
	confirmCertificate(request: CertificateRequest): Promise<boolean>;
	/** Called after a newly trusted certificate has been saved. */
	onCertificateTrusted(): void;
}

const RECONNECT_DELAYS_MS = [5000, 5000, 10000, 15000, 30000];

function gatewayUrl(): string {
	const scheme = location.protocol === "https:" ? "wss:" : "ws:";
	return `${scheme}//${location.host}/ws`;
}

export class RemoteConnection {
	private socket: WebSocket | null = null;
	private socketReady: Promise<WebSocket> | null = null;
	private target: ConnectionDetails | null = null;
	private wanted = false;
	private everConnected = false;
	private reconnectAttempt = 0;
	private reconnectTimer: number | undefined;
	private keyRequest: { resolve(key: string): void; reject(error: Error): void; host: string; port: number } | null =
		null;
	state: ConnectionState = "idle";
	autoReconnect = true;

	constructor(private readonly events: ConnectionEvents) {}

	get details(): ConnectionDetails | null {
		return this.target;
	}

	async connect(details: ConnectionDetails): Promise<void> {
		window.clearTimeout(this.reconnectTimer);
		this.target = details;
		this.wanted = true;
		this.everConnected = false;
		this.reconnectAttempt = 0;
		this.setState("connecting");
		await this.sendConnect();
	}

	disconnect(): void {
		this.wanted = false;
		window.clearTimeout(this.reconnectTimer);
		if (this.state !== "idle") {
			this.post({ op: "disconnect" });
		}
		this.setState("idle", "Disconnected.");
	}

	send(message: RemoteMessage): void {
		if (this.state === "connected") {
			this.post({ op: "send", msg: message });
		}
	}

	/** Asks a relay server for a new random key. */
	async generateKey(host: string, port: number): Promise<string> {
		this.keyRequest?.reject(new Error("Cancelled."));
		await this.ensureSocket();
		return new Promise((resolve, reject) => {
			this.keyRequest = { resolve, reject, host, port };
			this.post({ op: "generateKey", host, port, fingerprint: this.fingerprintFor(host, port) });
		});
	}

	private fingerprintFor(host: string, port: number): string | undefined {
		return trustedFingerprints()[formatAddress(host, port)];
	}

	private async sendConnect(): Promise<void> {
		const target = this.target;
		if (!target) {
			return;
		}
		try {
			await this.ensureSocket();
		} catch {
			this.connectionLost("Could not reach the NVDA Remote Web gateway. Check your internet connection.");
			return;
		}
		if (!this.wanted || this.target !== target) {
			return;
		}
		this.post({
			op: "connect",
			host: target.host,
			port: target.port,
			key: target.key,
			fingerprint: this.fingerprintFor(target.host, target.port),
		});
	}

	private ensureSocket(): Promise<WebSocket> {
		if (this.socket && this.socket.readyState === WebSocket.OPEN) {
			return Promise.resolve(this.socket);
		}
		if (this.socketReady) {
			return this.socketReady;
		}
		this.socketReady = new Promise((resolve, reject) => {
			const socket = new WebSocket(gatewayUrl());
			socket.onopen = () => {
				this.socket = socket;
				this.socketReady = null;
				resolve(socket);
			};
			socket.onerror = () => {
				// onclose follows and does the cleanup.
			};
			socket.onclose = () => {
				const wasOpen = this.socket === socket;
				this.socketReady = null;
				if (wasOpen) {
					this.socket = null;
				} else {
					reject(new Error("Could not open the gateway connection."));
					return;
				}
				this.keyRequest?.reject(new Error("Lost contact with the gateway."));
				this.keyRequest = null;
				if (this.state !== "idle") {
					this.connectionLost("Lost contact with the NVDA Remote Web gateway.");
				}
			};
			socket.onmessage = (event) => {
				if (typeof event.data !== "string") {
					return;
				}
				let message: GatewayToClient;
				try {
					message = JSON.parse(event.data) as GatewayToClient;
				} catch {
					return;
				}
				void this.handle(message);
			};
		});
		return this.socketReady;
	}

	private post(message: ClientToGateway): void {
		if (this.socket?.readyState === WebSocket.OPEN) {
			this.socket.send(JSON.stringify(message));
		}
	}

	private async handle(message: GatewayToClient): Promise<void> {
		switch (message.op) {
			case "msg":
				this.events.onMessage(message.msg);
				return;
			case "key":
				this.keyRequest?.resolve(message.key);
				this.keyRequest = null;
				return;
			case "status":
				if (message.state === "connected") {
					this.everConnected = true;
					this.reconnectAttempt = 0;
					this.setState("connected");
				} else if (message.state === "disconnected" && this.wanted && this.state !== "idle") {
					this.connectionLost(message.reason);
				}
				return;
			case "certRequired":
				await this.handleCertificate(message);
				return;
			case "error":
				if (this.keyRequest) {
					this.keyRequest.reject(new Error(message.message));
					this.keyRequest = null;
				} else {
					this.events.onError(message.message);
				}
				return;
		}
	}

	private async handleCertificate(message: Extract<GatewayToClient, { op: "certRequired" }>): Promise<void> {
		const address = formatAddress(message.host, message.port);
		const previous = trustedFingerprints()[address] ?? null;
		const keyRequest = this.keyRequest;
		const trusted = await this.events.confirmCertificate({
			host: message.host,
			port: message.port,
			fingerprint: message.fingerprint,
			reason: message.reason,
			previousFingerprint: previous,
		});
		if (!trusted) {
			if (keyRequest) {
				keyRequest.reject(new Error("The server's certificate was not trusted."));
				this.keyRequest = null;
			} else {
				this.wanted = false;
				this.setState("idle", "Not connected, because the server's certificate was not trusted.");
			}
			return;
		}
		trustFingerprint(address, message.fingerprint);
		this.events.onCertificateTrusted();
		if (keyRequest) {
			this.post({ op: "generateKey", host: keyRequest.host, port: keyRequest.port, fingerprint: message.fingerprint });
		} else if (this.wanted) {
			await this.sendConnect();
		}
	}

	private connectionLost(reason?: string): void {
		if (!this.wanted) {
			return;
		}
		if (!this.everConnected || !this.autoReconnect) {
			this.wanted = false;
			this.setState("idle", reason);
			return;
		}
		const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]!;
		this.reconnectAttempt++;
		this.setState("reconnecting", reason);
		window.clearTimeout(this.reconnectTimer);
		this.reconnectTimer = window.setTimeout(() => void this.sendConnect(), delay);
	}

	private setState(state: ConnectionState, detail?: string): void {
		const changed = state !== this.state;
		this.state = state;
		if (changed || detail) {
			this.events.onState(state, detail);
		}
	}
}
