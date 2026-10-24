import { describe, expect, it } from "vitest";

import { applyProsody, characterModeText, nvdaLangToBcp47, parseSequence, splitForUtterances } from "../src/web/speech";

describe("parseSequence", () => {
	it("joins plain strings", () => {
		expect(parseSequence(["Hello", "world"]).map((c) => c.text)).toEqual(["Hello world"]);
	});

	it("splits on language changes and keeps the language", () => {
		const chunks = parseSequence([
			"Hi",
			["LangChangeCommand", { lang: "fr_FR", isDefault: false }],
			"Bonjour",
			["LangChangeCommand", { lang: null, isDefault: true }],
			"bye",
		]);
		expect(chunks.map((c) => [c.text, c.lang])).toEqual([
			["Hi", null],
			["Bonjour", "fr-FR"],
			["bye", null],
		]);
	});

	it("tracks character mode, pitch and breaks", () => {
		const chunks = parseSequence([
			["CharacterModeCommand", { state: true }],
			"a",
			["CharacterModeCommand", { state: false }],
			["PitchCommand", { offset: 30, multiplier: 1 }],
			"cap B",
			["BreakCommand", { time: 100 }],
			"next",
			["IndexCommand", { index: 3 }],
			["EndUtteranceCommand", {}],
		]);
		expect(chunks.map((c) => c.text)).toEqual(["a", "cap B", "next"]);
		expect(chunks[0]!.characterMode).toBe(true);
		expect(chunks[1]!.pitch).toEqual({ offset: 30, multiplier: 1 });
	});

	it("uses phoneme fallback text and ignores junk", () => {
		expect(parseSequence([["PhonemeCommand", { ipa: "x", text: "word" }], 42, null, ["Bogus"]]).map((c) => c.text)).toEqual([
			"word",
		]);
		expect(parseSequence("not a list")).toEqual([]);
	});
});

describe("helpers", () => {
	it("converts NVDA language codes", () => {
		expect(nvdaLangToBcp47("pt_BR")).toBe("pt-BR");
		expect(nvdaLangToBcp47(null)).toBeNull();
	});

	it("applies prosody within 0 to 100", () => {
		expect(applyProsody(50, { offset: 30, multiplier: 1 })).toBe(80);
		expect(applyProsody(90, { offset: 30, multiplier: 1 })).toBe(100);
		expect(applyProsody(50, { offset: 0, multiplier: 0.5 })).toBe(25);
	});

	it("speaks single characters as capitals in character mode", () => {
		expect(characterModeText("a")).toBe("A");
		expect(characterModeText("dot")).toBe("dot");
	});

	it("splits long text at sentence or word boundaries", () => {
		const long = "One sentence here. ".repeat(30);
		const parts = splitForUtterances(long, 100);
		expect(parts.every((p) => p.length <= 100)).toBe(true);
		expect(parts.join(" ").replace(/\s+/g, " ").trim()).toBe(long.trim());
	});
});
