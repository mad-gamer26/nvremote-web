// Maps browser keyboard events to the Windows virtual-key codes NVDA Remote sends.
// Keys are mapped by physical position (KeyboardEvent.code), so the remote computer's
// own keyboard layout decides which character is typed, as with NVDA Remote itself.

export interface RemoteKey {
	vk: number;
	extended: boolean;
}

/** What the Search / Windows / Command key (Meta) is sent as. */
export type MetaKeyRole = "nvda" | "windows" | "control" | "capslock";

export interface KeymapOptions {
	metaKey: MetaKeyRole;
	/** Treat Chromebook top-row action keys (Back, Refresh, ...) as F1 to F10. */
	topRowAsFunctionKeys: boolean;
}

export const VK = {
	BACK: 0x08,
	TAB: 0x09,
	CLEAR: 0x0c,
	RETURN: 0x0d,
	PAUSE: 0x13,
	CAPITAL: 0x14,
	ESCAPE: 0x1b,
	SPACE: 0x20,
	PRIOR: 0x21,
	NEXT: 0x22,
	END: 0x23,
	HOME: 0x24,
	LEFT: 0x25,
	UP: 0x26,
	RIGHT: 0x27,
	DOWN: 0x28,
	SNAPSHOT: 0x2c,
	INSERT: 0x2d,
	DELETE: 0x2e,
	LWIN: 0x5b,
	RWIN: 0x5c,
	APPS: 0x5d,
	NUMPAD0: 0x60,
	MULTIPLY: 0x6a,
	ADD: 0x6b,
	SUBTRACT: 0x6d,
	DECIMAL: 0x6e,
	DIVIDE: 0x6f,
	F1: 0x70,
	NUMLOCK: 0x90,
	SCROLL: 0x91,
	LSHIFT: 0xa0,
	RSHIFT: 0xa1,
	LCONTROL: 0xa2,
	RCONTROL: 0xa3,
	LMENU: 0xa4,
	RMENU: 0xa5,
} as const;

const key = (vk: number, extended = false): RemoteKey => ({ vk, extended });

const FIXED_CODES: Record<string, RemoteKey> = {
	Escape: key(VK.ESCAPE),
	Tab: key(VK.TAB),
	Enter: key(VK.RETURN),
	Space: key(VK.SPACE),
	Backspace: key(VK.BACK),
	CapsLock: key(VK.CAPITAL),
	ShiftLeft: key(VK.LSHIFT),
	ShiftRight: key(VK.RSHIFT),
	ControlLeft: key(VK.LCONTROL),
	ControlRight: key(VK.RCONTROL, true),
	AltLeft: key(VK.LMENU),
	AltRight: key(VK.RMENU, true),
	ContextMenu: key(VK.APPS, true),
	Insert: key(VK.INSERT, true),
	Delete: key(VK.DELETE, true),
	Home: key(VK.HOME, true),
	End: key(VK.END, true),
	PageUp: key(VK.PRIOR, true),
	PageDown: key(VK.NEXT, true),
	ArrowLeft: key(VK.LEFT, true),
	ArrowUp: key(VK.UP, true),
	ArrowRight: key(VK.RIGHT, true),
	ArrowDown: key(VK.DOWN, true),
	PrintScreen: key(VK.SNAPSHOT, true),
	ScrollLock: key(VK.SCROLL),
	Pause: key(VK.PAUSE),
	NumLock: key(VK.NUMLOCK, true),
	NumpadMultiply: key(VK.MULTIPLY),
	NumpadAdd: key(VK.ADD),
	NumpadSubtract: key(VK.SUBTRACT),
	NumpadDivide: key(VK.DIVIDE, true),
	NumpadEnter: key(VK.RETURN, true),
	Minus: key(0xbd),
	Equal: key(0xbb),
	BracketLeft: key(0xdb),
	BracketRight: key(0xdd),
	Backslash: key(0xdc),
	Semicolon: key(0xba),
	Quote: key(0xde),
	Backquote: key(0xc0),
	Comma: key(0xbc),
	Period: key(0xbe),
	Slash: key(0xbf),
	IntlBackslash: key(0xe2),
	IntlRo: key(0xc1),
	IntlYen: key(0xdc),
	AudioVolumeMute: key(0xad, true),
	AudioVolumeDown: key(0xae, true),
	AudioVolumeUp: key(0xaf, true),
	MediaTrackNext: key(0xb0, true),
	MediaTrackPrevious: key(0xb1, true),
	MediaStop: key(0xb2, true),
	MediaPlayPause: key(0xb3, true),
	BrowserBack: key(0xa6, true),
	BrowserForward: key(0xa7, true),
	BrowserRefresh: key(0xa8, true),
	BrowserStop: key(0xa9, true),
	BrowserSearch: key(0xaa, true),
	BrowserFavorites: key(0xab, true),
	BrowserHome: key(0xac, true),
};

/** Chromebook top-row action keys, left to right, which are F1 to F10 on other keyboards. */
const TOP_ROW_CODES = [
	"BrowserBack",
	"BrowserForward",
	"BrowserRefresh",
	"ZoomToggle",
	"LaunchApp1",
	"BrightnessDown",
	"BrightnessUp",
	"AudioVolumeMute",
	"AudioVolumeDown",
	"AudioVolumeUp",
];

/** Numpad keys with Num Lock off produce navigation keys, which Windows reports as non-extended. */
const NUMPAD_NAVIGATION: Record<string, number> = {
	Insert: VK.INSERT,
	End: VK.END,
	ArrowDown: VK.DOWN,
	PageDown: VK.NEXT,
	ArrowLeft: VK.LEFT,
	Clear: VK.CLEAR,
	ArrowRight: VK.RIGHT,
	Home: VK.HOME,
	ArrowUp: VK.UP,
	PageUp: VK.PRIOR,
	Delete: VK.DELETE,
};

const META_ROLES: Record<MetaKeyRole, { left: RemoteKey; right: RemoteKey }> = {
	nvda: { left: key(VK.INSERT, true), right: key(VK.INSERT, true) },
	windows: { left: key(VK.LWIN, true), right: key(VK.RWIN, true) },
	control: { left: key(VK.LCONTROL), right: key(VK.RCONTROL, true) },
	capslock: { left: key(VK.CAPITAL), right: key(VK.CAPITAL) },
};

export function mapKey(code: string, keyValue: string, options: KeymapOptions): RemoteKey | null {
	if (code === "MetaLeft" || code === "OSLeft") {
		return META_ROLES[options.metaKey].left;
	}
	if (code === "MetaRight" || code === "OSRight") {
		return META_ROLES[options.metaKey].right;
	}
	if (options.topRowAsFunctionKeys) {
		const index = TOP_ROW_CODES.indexOf(code);
		if (index !== -1) {
			return key(VK.F1 + index);
		}
	}
	let match: RegExpExecArray | null;
	if ((match = /^Key([A-Z])$/.exec(code))) {
		return key(match[1]!.charCodeAt(0));
	}
	if ((match = /^Digit([0-9])$/.exec(code))) {
		return key(0x30 + Number(match[1]));
	}
	if ((match = /^F([0-9]{1,2})$/.exec(code))) {
		const n = Number(match[1]);
		return n >= 1 && n <= 24 ? key(VK.F1 + n - 1) : null;
	}
	if ((match = /^Numpad([0-9])$/.exec(code)) || code === "NumpadDecimal") {
		const navigation = NUMPAD_NAVIGATION[keyValue];
		if (navigation !== undefined) {
			return key(navigation);
		}
		return code === "NumpadDecimal" ? key(VK.DECIMAL) : key(VK.NUMPAD0 + Number(match![1]));
	}
	return FIXED_CODES[code] ?? null;
}

export function isModifierVk(vk: number): boolean {
	return (
		(vk >= VK.LSHIFT && vk <= VK.RMENU) ||
		vk === VK.LWIN ||
		vk === VK.RWIN ||
		vk === VK.INSERT ||
		vk === VK.CAPITAL ||
		(vk >= 0x10 && vk <= 0x12)
	);
}

/** Describes a key for people, for the key tester and announcements. */
export function describeVk(remote: RemoteKey): string {
	const { vk } = remote;
	const names: Record<number, string> = {
		[VK.BACK]: "Backspace",
		[VK.TAB]: "Tab",
		[VK.CLEAR]: "Numpad 5 (Clear)",
		[VK.RETURN]: remote.extended ? "Numpad Enter" : "Enter",
		[VK.PAUSE]: "Pause",
		[VK.CAPITAL]: "Caps Lock",
		[VK.ESCAPE]: "Escape",
		[VK.SPACE]: "Space",
		[VK.PRIOR]: remote.extended ? "Page Up" : "Numpad 9 (Page Up)",
		[VK.NEXT]: remote.extended ? "Page Down" : "Numpad 3 (Page Down)",
		[VK.END]: remote.extended ? "End" : "Numpad 1 (End)",
		[VK.HOME]: remote.extended ? "Home" : "Numpad 7 (Home)",
		[VK.LEFT]: remote.extended ? "Left Arrow" : "Numpad 4 (Left)",
		[VK.UP]: remote.extended ? "Up Arrow" : "Numpad 8 (Up)",
		[VK.RIGHT]: remote.extended ? "Right Arrow" : "Numpad 6 (Right)",
		[VK.DOWN]: remote.extended ? "Down Arrow" : "Numpad 2 (Down)",
		[VK.SNAPSHOT]: "Print Screen",
		[VK.INSERT]: remote.extended ? "Insert (NVDA key)" : "Numpad Insert (NVDA key)",
		[VK.DELETE]: remote.extended ? "Delete" : "Numpad Delete",
		[VK.LWIN]: "Windows",
		[VK.RWIN]: "Right Windows",
		[VK.APPS]: "Applications",
		[VK.MULTIPLY]: "Numpad Multiply",
		[VK.ADD]: "Numpad Plus",
		[VK.SUBTRACT]: "Numpad Minus",
		[VK.DECIMAL]: "Numpad Decimal",
		[VK.DIVIDE]: "Numpad Divide",
		[VK.NUMLOCK]: "Num Lock",
		[VK.SCROLL]: "Scroll Lock",
		[VK.LSHIFT]: "Left Shift",
		[VK.RSHIFT]: "Right Shift",
		[VK.LCONTROL]: "Left Control",
		[VK.RCONTROL]: "Right Control",
		[VK.LMENU]: "Left Alt",
		[VK.RMENU]: "Right Alt",
		0xbd: "Minus",
		0xbb: "Equals",
		0xdb: "Left Bracket",
		0xdd: "Right Bracket",
		0xdc: "Backslash",
		0xba: "Semicolon",
		0xde: "Apostrophe",
		0xc0: "Grave",
		0xbc: "Comma",
		0xbe: "Period",
		0xbf: "Slash",
		0xe2: "Extra Backslash",
		0xad: "Volume Mute",
		0xae: "Volume Down",
		0xaf: "Volume Up",
		0xb0: "Next Track",
		0xb1: "Previous Track",
		0xb2: "Stop Media",
		0xb3: "Play/Pause",
		0xa6: "Browser Back",
		0xa7: "Browser Forward",
		0xa8: "Browser Refresh",
	};
	if (names[vk]) {
		return names[vk]!;
	}
	if (vk >= 0x41 && vk <= 0x5a) {
		return String.fromCharCode(vk);
	}
	if (vk >= 0x30 && vk <= 0x39) {
		return String.fromCharCode(vk);
	}
	if (vk >= VK.NUMPAD0 && vk <= VK.NUMPAD0 + 9) {
		return `Numpad ${vk - VK.NUMPAD0}`;
	}
	if (vk >= VK.F1 && vk <= VK.F1 + 23) {
		return `F${vk - VK.F1 + 1}`;
	}
	return `Key code ${vk}`;
}

// Characters that can be typed with a US keyboard layout, for the "type text" feature.
const SHIFTED_SYMBOLS: Record<string, [number, boolean]> = {};
const US_SYMBOLS: Array<[number, string, string]> = [
	[0xc0, "`", "~"],
	[0x31, "1", "!"],
	[0x32, "2", "@"],
	[0x33, "3", "#"],
	[0x34, "4", "$"],
	[0x35, "5", "%"],
	[0x36, "6", "^"],
	[0x37, "7", "&"],
	[0x38, "8", "*"],
	[0x39, "9", "("],
	[0x30, "0", ")"],
	[0xbd, "-", "_"],
	[0xbb, "=", "+"],
	[0xdb, "[", "{"],
	[0xdd, "]", "}"],
	[0xdc, "\\", "|"],
	[0xba, ";", ":"],
	[0xde, "'", '"'],
	[0xbc, ",", "<"],
	[0xbe, ".", ">"],
	[0xbf, "/", "?"],
];
for (const [vk, plain, shifted] of US_SYMBOLS) {
	SHIFTED_SYMBOLS[plain] = [vk, false];
	SHIFTED_SYMBOLS[shifted] = [vk, true];
}

/** Returns the key and whether Shift is needed to type a character, or null if it cannot be typed. */
export function keyForCharacter(char: string): { vk: number; shift: boolean } | null {
	if (/^[a-z]$/.test(char)) {
		return { vk: char.toUpperCase().charCodeAt(0), shift: false };
	}
	if (/^[A-Z]$/.test(char)) {
		return { vk: char.charCodeAt(0), shift: true };
	}
	if (char === " ") {
		return { vk: VK.SPACE, shift: false };
	}
	if (char === "\n") {
		return { vk: VK.RETURN, shift: false };
	}
	if (char === "\t") {
		return { vk: VK.TAB, shift: false };
	}
	const symbol = SHIFTED_SYMBOLS[char];
	return symbol ? { vk: symbol[0], shift: symbol[1] } : null;
}
