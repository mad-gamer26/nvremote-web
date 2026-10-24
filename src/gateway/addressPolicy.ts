// Decides which relay addresses the gateway may connect to.
// Only public internet addresses are allowed, so the gateway cannot be used to
// reach this machine's own services or anything on a private network.
// The one exception is the configured local relay, reached over loopback.

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { networkInterfaces } from "node:os";

import type { GatewayConfig } from "./config.js";

export interface ResolvedTarget {
	/** Hostname the user asked for, used for TLS verification. */
	host: string;
	/** Address actually connected to (already vetted, so DNS cannot change it afterwards). */
	address: string;
	port: number;
	isLocalRelay: boolean;
}

export class PolicyError extends Error {
	constructor(
		readonly code: "invalid_host" | "forbidden_host" | "dns_failed",
		message: string,
	) {
		super(message);
	}
}

const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.?$/i;

// Separate lists, because a BlockList also matches IPv4 addresses against IPv4-mapped IPv6 rules.
const blockedV4 = new BlockList();
const blockedV6 = new BlockList();
for (const [network, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.88.99.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const) {
	blockedV4.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
	["::", 128],
	["::1", 128],
	["64:ff9b::", 96],
	["64:ff9b:1::", 48],
	["100::", 64],
	["2001::", 32],
	["2001:db8::", 32],
	["2002::", 16],
	["fc00::", 7],
	["fe80::", 10],
	["fec0::", 10],
	["ff00::", 8],
] as const) {
	blockedV6.addSubnet(network, prefix, "ipv6");
}

/** Addresses assigned to this machine, including its public ones. */
function ownAddresses(): Set<string> {
	const own = new Set<string>();
	for (const entries of Object.values(networkInterfaces())) {
		for (const entry of entries ?? []) {
			own.add(entry.address.toLowerCase());
		}
	}
	return own;
}

export function isPublicAddress(address: string, own: Set<string> = ownAddresses()): boolean {
	const family = isIP(address);
	if (family === 0) {
		return false;
	}
	if (own.has(address.toLowerCase())) {
		return false;
	}
	if (family === 4) {
		return !blockedV4.check(address, "ipv4");
	}
	// IPv4-mapped IPv6 (::ffff:a.b.c.d) is judged by the IPv4 address inside it.
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
	if (mapped) {
		return isPublicAddress(mapped[1]!, own);
	}
	if (/^::ffff:/i.test(address)) {
		return false;
	}
	return !blockedV6.check(address, "ipv6");
}

export function normalizeHost(rawHost: string): string {
	let host = rawHost.trim().toLowerCase();
	if (host.startsWith("[") && host.endsWith("]")) {
		host = host.slice(1, -1);
	}
	if (host.endsWith(".")) {
		host = host.slice(0, -1);
	}
	return host;
}

export async function resolveTarget(
	rawHost: string,
	port: number,
	config: GatewayConfig,
): Promise<ResolvedTarget> {
	const host = normalizeHost(rawHost);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new PolicyError("invalid_host", "The port must be a number from 1 to 65535.");
	}
	if (!host || (isIP(host) === 0 && !HOSTNAME_PATTERN.test(host))) {
		throw new PolicyError("invalid_host", "That is not a valid server name or address.");
	}
	if (host.endsWith(".onion")) {
		throw new PolicyError("forbidden_host", "Onion addresses are not supported.");
	}

	if (config.localRelayHosts.includes(host)) {
		if (port !== config.localRelayPort) {
			throw new PolicyError(
				"forbidden_host",
				`The relay on ${host} only accepts connections on port ${config.localRelayPort}.`,
			);
		}
		return { host, address: config.localRelayAddress, port, isLocalRelay: true };
	}

	let addresses: string[];
	if (isIP(host) !== 0) {
		addresses = [host];
	} else {
		try {
			addresses = (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
		} catch {
			throw new PolicyError("dns_failed", `Could not find a server named ${host}.`);
		}
	}
	if (addresses.length === 0) {
		throw new PolicyError("dns_failed", `Could not find a server named ${host}.`);
	}
	const own = ownAddresses();
	// Refuse the whole name if any of its addresses is private, rather than picking a public one.
	if (!addresses.every((address) => isPublicAddress(address, own))) {
		throw new PolicyError(
			"forbidden_host",
			"That server is on a private or reserved network, which this gateway cannot reach.",
		);
	}
	// Prefer IPv4 when available; it is what most community relays listen on.
	const address = addresses.find((a) => isIP(a) === 4) ?? addresses[0]!;
	return { host, address, port, isLocalRelay: false };
}
