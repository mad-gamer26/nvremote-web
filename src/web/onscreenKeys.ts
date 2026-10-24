// Buttons for keys that are missing or hard to press on this device, and common NVDA commands.

import { VK, type RemoteKey } from "./keymap.js";

const k = (vk: number, extended = false): RemoteKey => ({ vk, extended });

interface Modifier {
	id: string;
	label: string;
	key: RemoteKey;
}

const MODIFIERS: Modifier[] = [
	{ id: "nvda", label: "NVDA", key: k(VK.INSERT, true) },
	{ id: "control", label: "Control", key: k(VK.LCONTROL) },
	{ id: "alt", label: "Alt", key: k(VK.LMENU) },
	{ id: "shift", label: "Shift", key: k(VK.LSHIFT) },
	{ id: "windows", label: "Windows", key: k(VK.LWIN, true) },
];

const KEYS: Array<[string, RemoteKey]> = [
	["Escape", k(VK.ESCAPE)],
	["Tab", k(VK.TAB)],
	["Enter", k(VK.RETURN)],
	["Space", k(VK.SPACE)],
	["Backspace", k(VK.BACK)],
	["Delete", k(VK.DELETE, true)],
	["Insert", k(VK.INSERT, true)],
	["Home", k(VK.HOME, true)],
	["End", k(VK.END, true)],
	["Page Up", k(VK.PRIOR, true)],
	["Page Down", k(VK.NEXT, true)],
	["Up Arrow", k(VK.UP, true)],
	["Down Arrow", k(VK.DOWN, true)],
	["Left Arrow", k(VK.LEFT, true)],
	["Right Arrow", k(VK.RIGHT, true)],
	["Applications", k(VK.APPS, true)],
	["Caps Lock", k(VK.CAPITAL)],
	...Array.from({ length: 12 }, (_, i): [string, RemoteKey] => [`F${i + 1}`, k(VK.F1 + i)]),
];

const letter = (char: string) => k(char.charCodeAt(0));

const SHORTCUTS: Array<[string, RemoteKey[]]> = [
	["Stop speech (Control)", [k(VK.LCONTROL)]],
	["Read title (NVDA+T)", [k(VK.INSERT, true), letter("T")]],
	["Read current line (NVDA+Up Arrow)", [k(VK.INSERT, true), k(VK.UP, true)]],
	["Say all (NVDA+Down Arrow)", [k(VK.INSERT, true), k(VK.DOWN, true)]],
	["Read window (NVDA+B)", [k(VK.INSERT, true), letter("B")]],
	["Read focus (NVDA+Tab)", [k(VK.INSERT, true), k(VK.TAB)]],
	["Time and date (NVDA+F12)", [k(VK.INSERT, true), k(VK.F1 + 11)]],
	["NVDA menu (NVDA+N)", [k(VK.INSERT, true), letter("N")]],
	["Toggle browse mode (NVDA+Space)", [k(VK.INSERT, true), k(VK.SPACE)]],
	["Show desktop (Windows+D)", [k(VK.LWIN, true), letter("D")]],
	["Start menu (Windows)", [k(VK.LWIN, true)]],
	["Switch window (Alt+Tab)", [k(VK.LMENU), k(VK.TAB)]],
	["Close window (Alt+F4)", [k(VK.LMENU), k(VK.F1 + 3)]],
	["Task Manager (Control+Shift+Escape)", [k(VK.LCONTROL), k(VK.LSHIFT), k(VK.ESCAPE)]],
];

/** Presses keys together: each goes down in order, then all come up in reverse. */
export function pressCombination(keys: RemoteKey[], sendKey: (key: RemoteKey, pressed: boolean) => void): void {
	for (const key of keys) {
		sendKey(key, true);
	}
	for (const key of [...keys].reverse()) {
		sendKey(key, false);
	}
}

export function buildOnscreenKeys(
	container: HTMLElement,
	sendKey: (key: RemoteKey, pressed: boolean) => void,
	announce: (text: string) => void,
): void {
	const latched = new Set<Modifier>();
	const modifierButtons = new Map<Modifier, HTMLButtonElement>();

	const group = (label: string) => {
		const heading = document.createElement("h3");
		heading.textContent = label;
		const wrapper = document.createElement("div");
		wrapper.className = "key-grid";
		wrapper.setAttribute("role", "group");
		const id = `keys-${label.toLowerCase().replace(/\W+/g, "-")}`;
		heading.id = id;
		wrapper.setAttribute("aria-labelledby", id);
		container.append(heading, wrapper);
		return wrapper;
	};
	const button = (label: string, parent: HTMLElement) => {
		const element = document.createElement("button");
		element.type = "button";
		element.className = "key-button";
		element.textContent = label;
		parent.append(element);
		return element;
	};

	const modifierGroup = group("Modifiers");
	for (const modifier of MODIFIERS) {
		const element = button(modifier.label, modifierGroup);
		element.setAttribute("aria-pressed", "false");
		element.addEventListener("click", () => {
			if (latched.has(modifier)) {
				latched.delete(modifier);
				element.setAttribute("aria-pressed", "false");
			} else {
				latched.add(modifier);
				element.setAttribute("aria-pressed", "true");
			}
		});
		modifierButtons.set(modifier, element);
	}

	const pressWithModifiers = (keys: RemoteKey[], label: string) => {
		const modifiers = MODIFIERS.filter((m) => latched.has(m));
		pressCombination([...modifiers.map((m) => m.key), ...keys], sendKey);
		if (modifiers.length) {
			announce(`Sent ${[...modifiers.map((m) => m.label), label].join("+")}`);
		}
		latched.clear();
		for (const element of modifierButtons.values()) {
			element.setAttribute("aria-pressed", "false");
		}
	};

	const keyGroup = group("Keys");
	for (const [label, key] of KEYS) {
		button(label, keyGroup).addEventListener("click", () => pressWithModifiers([key], label));
	}

	const shortcutGroup = group("Common commands");
	for (const [label, keys] of SHORTCUTS) {
		button(label, shortcutGroup).addEventListener("click", () => pressCombination(keys, sendKey));
	}
}
