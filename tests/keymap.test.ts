import { describe, expect, it } from "vitest";

import { describeVk, keyForCharacter, mapKey, VK } from "../src/web/keymap";

const defaults = { metaKey: "windows" as const, topRowAsFunctionKeys: false };

describe("mapKey", () => {
	it("maps letters, digits and function keys", () => {
		expect(mapKey("KeyA", "a", defaults)).toEqual({ vk: 0x41, extended: false });
		expect(mapKey("Digit7", "7", defaults)).toEqual({ vk: 0x37, extended: false });
		expect(mapKey("F12", "F12", defaults)).toEqual({ vk: 0x7b, extended: false });
	});

	it("marks navigation-cluster keys as extended", () => {
		expect(mapKey("ArrowUp", "ArrowUp", defaults)).toEqual({ vk: VK.UP, extended: true });
		expect(mapKey("Insert", "Insert", defaults)).toEqual({ vk: VK.INSERT, extended: true });
		expect(mapKey("ControlRight", "Control", defaults)).toEqual({ vk: VK.RCONTROL, extended: true });
		expect(mapKey("NumpadEnter", "Enter", defaults)).toEqual({ vk: VK.RETURN, extended: true });
	});

	it("distinguishes the numpad with Num Lock on and off", () => {
		expect(mapKey("Numpad8", "8", defaults)).toEqual({ vk: 0x68, extended: false });
		expect(mapKey("Numpad8", "ArrowUp", defaults)).toEqual({ vk: VK.UP, extended: false });
		expect(mapKey("Numpad0", "Insert", defaults)).toEqual({ vk: VK.INSERT, extended: false });
		expect(mapKey("Numpad5", "Clear", defaults)).toEqual({ vk: VK.CLEAR, extended: false });
		expect(mapKey("NumpadDecimal", "Delete", defaults)).toEqual({ vk: VK.DELETE, extended: false });
		expect(mapKey("NumpadDecimal", ".", defaults)).toEqual({ vk: VK.DECIMAL, extended: false });
	});

	it("sends the Meta key as the chosen role", () => {
		expect(mapKey("MetaLeft", "Meta", { ...defaults, metaKey: "nvda" })).toEqual({ vk: VK.INSERT, extended: true });
		expect(mapKey("MetaLeft", "Meta", defaults)).toEqual({ vk: VK.LWIN, extended: true });
		expect(mapKey("MetaRight", "Meta", defaults)).toEqual({ vk: VK.RWIN, extended: true });
		expect(mapKey("MetaLeft", "Meta", { ...defaults, metaKey: "capslock" })).toEqual({ vk: VK.CAPITAL, extended: false });
	});

	it("optionally treats the Chromebook top row as function keys", () => {
		expect(mapKey("BrowserBack", "BrowserBack", defaults)).toEqual({ vk: 0xa6, extended: true });
		expect(mapKey("BrowserBack", "BrowserBack", { ...defaults, topRowAsFunctionKeys: true })).toEqual({
			vk: VK.F1,
			extended: false,
		});
		expect(mapKey("BrightnessUp", "", { ...defaults, topRowAsFunctionKeys: true })).toEqual({
			vk: VK.F1 + 6,
			extended: false,
		});
	});

	it("returns null for keys it cannot send", () => {
		expect(mapKey("Fn", "Fn", defaults)).toBeNull();
		expect(mapKey("", "Unidentified", defaults)).toBeNull();
	});
});

describe("keyForCharacter", () => {
	it("handles letters, shifted symbols and whitespace", () => {
		expect(keyForCharacter("a")).toEqual({ vk: 0x41, shift: false });
		expect(keyForCharacter("A")).toEqual({ vk: 0x41, shift: true });
		expect(keyForCharacter("?")).toEqual({ vk: 0xbf, shift: true });
		expect(keyForCharacter("\n")).toEqual({ vk: VK.RETURN, shift: false });
		expect(keyForCharacter("é")).toBeNull();
	});
});

describe("describeVk", () => {
	it("names keys for people", () => {
		expect(describeVk({ vk: VK.INSERT, extended: true })).toBe("Insert (NVDA key)");
		expect(describeVk({ vk: VK.UP, extended: false })).toBe("Numpad 8 (Up)");
		expect(describeVk({ vk: 0x70, extended: false })).toBe("F1");
	});
});
