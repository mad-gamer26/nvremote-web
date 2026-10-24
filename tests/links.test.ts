import { describe, expect, it } from "vitest";

import { cellsToUnicode } from "../src/web/braille";
import { waveNameFromPath } from "../src/web/audio";
import {
	formatAddress,
	nvdaRemoteLink,
	parseAddress,
	parseNvdaRemoteUrl,
	parseShareFragment,
	shareLink,
} from "../src/web/links";

describe("links", () => {
	it("parses NVDA Remote links", () => {
		expect(parseNvdaRemoteUrl("nvdaremote://example.com:1234?key=abc&mode=master")).toEqual({
			host: "example.com",
			port: 1234,
			key: "abc",
		});
		expect(parseNvdaRemoteUrl("nvdaremote://example.com?key=abc")?.port).toBe(6837);
		expect(parseNvdaRemoteUrl("nvdaremote://[2001:db8::1]:99?key=k")).toEqual({ host: "2001:db8::1", port: 99, key: "k" });
		expect(parseNvdaRemoteUrl("https://example.com")).toBeNull();
	});

	it("parses addresses with optional ports", () => {
		expect(parseAddress("example.com")).toEqual({ host: "example.com", port: 6837 });
		expect(parseAddress("example.com:99")).toEqual({ host: "example.com", port: 99 });
		expect(parseAddress("[::1]:99")).toEqual({ host: "::1", port: 99 });
		expect(formatAddress("::1", 99)).toBe("[::1]:99");
		expect(formatAddress("example.com", 6837)).toBe("example.com");
	});

	it("round-trips share links", () => {
		const link = shareLink("https://nvremote.mad-gamer.com/", { host: "other.org", port: 7000, key: "secret key" });
		expect(parseShareFragment(new URL(link).hash)).toEqual({ host: "other.org", port: 7000, key: "secret key" });
		expect(shareLink("https://x/", { host: "mad-gamer.com", port: 6837, key: "k" })).toBe("https://x/#key=k");
	});

	it("builds NVDA links for the controlled computer", () => {
		expect(nvdaRemoteLink({ host: "mad-gamer.com", port: 6837, key: "123" })).toBe(
			"nvdaremote://mad-gamer.com?key=123&mode=slave",
		);
	});
});

describe("braille and sounds", () => {
	it("renders cells as Unicode braille", () => {
		expect(cellsToUnicode([1, 3, 0, 0])).toBe("\u2801\u2803");
		expect(cellsToUnicode("nope")).toBe("");
	});

	it("recognises NVDA's standard sounds from remote paths", () => {
		expect(waveNameFromPath("C:\\Program Files\\NVDA\\waves\\browseMode.wav")).toBe("browseMode");
		expect(waveNameFromPath("C:\\addons\\custom\\beep.wav")).toBeNull();
		expect(waveNameFromPath(5)).toBeNull();
	});
});
