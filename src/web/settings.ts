import type { MetaKeyRole } from "./keymap.js";
import { readJson, writeJson } from "./storage.js";

export type SpeechMode = "voice" | "screenReader" | "off";
export type ExitKey = "shift+escape" | "control+shift+escape" | "alt+shift+q" | "control+alt+shift+f12";

export interface Settings {
	speechMode: SpeechMode;
	voiceURI: string;
	/** NVDA-style 0 to 100. */
	rate: number;
	pitch: number;
	volume: number;
	soundsEnabled: boolean;
	soundVolume: number;
	/** Play NVDA Remote's own cue sounds for connecting, disconnecting and clipboard. */
	cueSounds: boolean;
	/** Also speak this app's own messages with the built-in voice. */
	speakAppMessages: boolean;
	metaKey: MetaKeyRole;
	topRowAsFunctionKeys: boolean;
	exitKey: ExitKey;
	fullscreenWhileControlling: boolean;
	autoReconnect: boolean;
	brailleEnabled: boolean;
	brailleCells: number;
	historyLimit: number;
}

export const isChromeOS = typeof navigator !== "undefined" && /\bCrOS\b/.test(navigator.userAgent);

export const DEFAULT_SETTINGS: Settings = {
	speechMode: "voice",
	voiceURI: "",
	rate: 50,
	pitch: 50,
	volume: 100,
	soundsEnabled: true,
	soundVolume: 80,
	cueSounds: true,
	speakAppMessages: false,
	metaKey: isChromeOS ? "nvda" : "windows",
	topRowAsFunctionKeys: isChromeOS,
	exitKey: "shift+escape",
	fullscreenWhileControlling: true,
	autoReconnect: true,
	brailleEnabled: false,
	brailleCells: 40,
	historyLimit: 500,
};

export const EXIT_KEY_LABELS: Record<ExitKey, string> = {
	"shift+escape": "Shift+Escape",
	"control+shift+escape": "Control+Shift+Escape",
	"alt+shift+q": "Alt+Shift+Q",
	"control+alt+shift+f12": "Control+Alt+Shift+F12",
};

const SETTINGS_KEY = "nvremote.settings";

type Listener = (settings: Settings) => void;

export class SettingsStore {
	private value: Settings = readJson(SETTINGS_KEY, DEFAULT_SETTINGS);
	private listeners: Listener[] = [];

	get current(): Settings {
		return this.value;
	}

	update(changes: Partial<Settings>): void {
		this.value = { ...this.value, ...changes };
		writeJson(SETTINGS_KEY, this.value);
		for (const listener of this.listeners) {
			listener(this.value);
		}
	}

	reset(): void {
		this.update(DEFAULT_SETTINGS);
	}

	subscribe(listener: Listener): void {
		this.listeners.push(listener);
	}
}

/** Whether a keydown event is the configured "stop controlling" combination. */
export function isExitKey(event: KeyboardEvent, exitKey: ExitKey): boolean {
	const mods = { control: event.ctrlKey, alt: event.altKey, shift: event.shiftKey };
	switch (exitKey) {
		case "shift+escape":
			return event.code === "Escape" && mods.shift && !mods.control && !mods.alt && !event.metaKey;
		case "control+shift+escape":
			return event.code === "Escape" && mods.shift && mods.control && !mods.alt;
		case "alt+shift+q":
			return event.code === "KeyQ" && mods.shift && mods.alt && !mods.control;
		case "control+alt+shift+f12":
			return event.code === "F12" && mods.shift && mods.alt && mods.control;
	}
}

// Certificates the user has chosen to trust, by "host:port", as NVDA does.
const TRUSTED_KEY = "nvremote.trustedCertificates";

export function trustedFingerprints(): Record<string, string> {
	return readJson<Record<string, string>>(TRUSTED_KEY, {});
}

export function trustFingerprint(address: string, fingerprint: string): void {
	writeJson(TRUSTED_KEY, { ...trustedFingerprints(), [address]: fingerprint });
}

export function forgetFingerprint(address: string): void {
	const all = trustedFingerprints();
	delete all[address];
	writeJson(TRUSTED_KEY, all);
}
