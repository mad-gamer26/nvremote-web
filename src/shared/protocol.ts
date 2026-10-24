// Messages exchanged between the browser and the gateway over WebSocket.
// NVDA Remote messages themselves are passed through unchanged inside `msg`.

export const NVDA_PROTOCOL_VERSION = 2;
export const DEFAULT_RELAY_PORT = 6837;

/** Largest single message (in bytes) accepted in either direction. */
export const MAX_MESSAGE_BYTES = 1024 * 1024;

/** NVDA Remote message types a controlling (leader) client may send through the gateway. */
export const BROWSER_SENDABLE_TYPES = [
	"key",
	"send_SAS",
	"set_clipboard_text",
	"set_braille_info",
	"braille_input",
] as const;

export type RemoteMessage = { type: string; [field: string]: unknown };

export type ClientToGateway =
	| { op: "connect"; host: string; port: number; key: string; fingerprint?: string }
	| { op: "generateKey"; host: string; port: number; fingerprint?: string }
	| { op: "send"; msg: RemoteMessage }
	| { op: "disconnect" };

export type GatewayErrorCode =
	| "bad_request"
	| "invalid_host"
	| "forbidden_host"
	| "dns_failed"
	| "connect_failed"
	| "timeout"
	| "rate_limited"
	| "server_busy"
	| "not_connected"
	| "protocol_error";

export type GatewayToClient =
	| { op: "status"; state: "connecting" | "connected" | "disconnected"; reason?: string }
	| { op: "certRequired"; host: string; port: number; fingerprint: string; reason: string }
	| { op: "msg"; msg: RemoteMessage }
	| { op: "key"; key: string }
	| { op: "error"; code: GatewayErrorCode; message: string };
