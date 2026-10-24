// Connection details from NVDA Remote links (nvdaremote://host:port?key=...) and
// this site's share links (#host=...&port=...&key=...).

import { DEFAULT_RELAY_PORT } from "../shared/protocol.js";

export interface ConnectionDetails {
	host: string;
	port: number;
	key: string;
}

export const DEFAULT_HOST = "nvremote.mad-gamer.com";

/** Parses "host", "host:port" or "[ipv6]:port". */
export function parseAddress(address: string): { host: string; port: number } | null {
	const trimmed = address.trim();
	if (!trimmed) {
		return null;
	}
	const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(trimmed);
	if (bracketed) {
		return { host: bracketed[1]!, port: bracketed[2] ? Number(bracketed[2]) : DEFAULT_RELAY_PORT };
	}
	const colons = trimmed.split(":").length - 1;
	if (colons === 1) {
		const [host, port] = trimmed.split(":");
		if (!/^\d+$/.test(port!)) {
			return null;
		}
		return { host: host!, port: Number(port) };
	}
	// No port, or a bare IPv6 address.
	return { host: trimmed, port: DEFAULT_RELAY_PORT };
}

export function formatAddress(host: string, port: number): string {
	const shownHost = host.includes(":") ? `[${host}]` : host;
	return port === DEFAULT_RELAY_PORT ? shownHost : `${shownHost}:${port}`;
}

/** Parses an nvdaremote:// link. */
export function parseNvdaRemoteUrl(text: string): ConnectionDetails | null {
	const trimmed = text.trim();
	if (!/^nvdaremote:\/\//i.test(trimmed)) {
		return null;
	}
	let url: URL;
	try {
		url = new URL(trimmed.replace(/^nvdaremote:/i, "https:"));
	} catch {
		return null;
	}
	const key = url.searchParams.get("key") ?? "";
	const host = url.hostname.replace(/^\[|\]$/g, "");
	if (!host) {
		return null;
	}
	return { host, port: url.port ? Number(url.port) : DEFAULT_RELAY_PORT, key };
}

/** Parses this site's share link fragment, such as "#host=example.com&port=6837&key=abc". */
export function parseShareFragment(hash: string): Partial<ConnectionDetails> | null {
	const params = new URLSearchParams(hash.replace(/^#/, ""));
	if (!params.has("key") && !params.has("host")) {
		return null;
	}
	const details: Partial<ConnectionDetails> = {};
	const host = params.get("host");
	const port = params.get("port");
	const key = params.get("key");
	if (host) details.host = host;
	if (port && /^\d+$/.test(port)) details.port = Number(port);
	if (key) details.key = key;
	return details;
}

export function shareLink(base: string, details: ConnectionDetails): string {
	const params = new URLSearchParams();
	if (details.host !== DEFAULT_HOST) {
		params.set("host", details.host);
	}
	if (details.port !== DEFAULT_RELAY_PORT) {
		params.set("port", String(details.port));
	}
	params.set("key", details.key);
	return `${base}#${params.toString()}`;
}

/**
 * An nvdaremote:// link the other computer can open in NVDA to join as the controlled computer.
 * In NVDA's links, "mode" is the role of whoever opens the link.
 */
export function nvdaRemoteLink(details: ConnectionDetails): string {
	const params = new URLSearchParams({ key: details.key, mode: "slave" });
	return `nvdaremote://${formatAddress(details.host, details.port)}?${params}`;
}
