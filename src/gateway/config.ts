// Gateway settings, read from environment variables (see deploy/nvremote-web.env).

function envString(name: string, fallback: string): string {
	const value = process.env[name];
	return value === undefined || value === "" ? fallback : value;
}

function envInt(name: string, fallback: number): number {
	const value = Number.parseInt(envString(name, String(fallback)), 10);
	return Number.isFinite(value) ? value : fallback;
}

function envList(name: string, fallback: string): string[] {
	return envString(name, fallback)
		.split(",")
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean);
}

export interface GatewayConfig {
	listenHost: string;
	listenPort: number;
	/** Allowed values of the WebSocket Origin header. "*" in the variable allows any (development only). */
	allowedOrigins: string[];
	/** Hostnames that refer to the relay on this machine; reached via localRelayAddress. */
	localRelayHosts: string[];
	localRelayAddress: string;
	localRelayPort: number;
	/** Use the X-Real-IP header for client addresses when the request comes from loopback. */
	trustProxy: boolean;
	maxSessionsPerIp: number;
	maxConnectAttemptsPerMinute: number;
	maxTotalSessions: number;
	connectTimeoutMs: number;
}

export function loadConfig(): GatewayConfig {
	return {
		listenHost: envString("NVR_LISTEN_HOST", "127.0.0.1"),
		listenPort: envInt("NVR_LISTEN_PORT", 39870),
		allowedOrigins: envList("NVR_ALLOWED_ORIGINS", "https://nvremote.mad-gamer.com").filter((o) => o !== "*"),
		localRelayHosts: envList("NVR_LOCAL_RELAY_HOSTS", "mad-gamer.com,nvremote.mad-gamer.com"),
		localRelayAddress: envString("NVR_LOCAL_RELAY_ADDRESS", "127.0.0.1"),
		localRelayPort: envInt("NVR_LOCAL_RELAY_PORT", 6837),
		trustProxy: envString("NVR_TRUST_PROXY", "true") === "true",
		maxSessionsPerIp: envInt("NVR_MAX_SESSIONS_PER_IP", 6),
		maxConnectAttemptsPerMinute: envInt("NVR_MAX_CONNECTS_PER_MINUTE", 30),
		maxTotalSessions: envInt("NVR_MAX_TOTAL_SESSIONS", 300),
		connectTimeoutMs: envInt("NVR_CONNECT_TIMEOUT_MS", 10000),
	};
}
