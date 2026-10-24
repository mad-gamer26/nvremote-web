// Speaks NVDA Remote speech sequences, either with the browser's own voice (Web Speech API)
// or by handing the text to the user's screen reader through a live region.
//
// A sequence is a list of strings and speech commands. Commands arrive as
// [className, attributes], for example ["LangChangeCommand", {"lang": "fr_FR"}].
// NVDA has already processed punctuation and symbols before sending, so text is spoken as is.

export interface SpeechChunk {
	text: string;
	/** BCP 47 language tag, or null for the default voice. */
	lang: string | null;
	/** Relative prosody, in NVDA's 0 to 100 scale offsets and multipliers. */
	pitch: Prosody;
	rate: Prosody;
	volume: Prosody;
	characterMode: boolean;
}

export interface Prosody {
	offset: number;
	multiplier: number;
}

const NEUTRAL: Prosody = { offset: 0, multiplier: 1 };

/** Speech priorities, as numbers, matching NVDA's speech.priorities.Spri. */
export const Priority = {
	Normal: 0,
	Next: 1,
	Now: 2,
} as const;

export function nvdaLangToBcp47(lang: unknown): string | null {
	if (typeof lang !== "string" || !lang) {
		return null;
	}
	return lang.replace(/_/g, "-");
}

function prosodyFrom(attributes: Record<string, unknown>): Prosody {
	const offset = typeof attributes.offset === "number" ? attributes.offset : 0;
	const multiplier = typeof attributes.multiplier === "number" ? attributes.multiplier : 1;
	return { offset, multiplier };
}

/**
 * Splits a speech sequence into chunks that each have one set of voice settings.
 * Breaks and utterance ends become chunk boundaries.
 */
export function parseSequence(sequence: unknown): SpeechChunk[] {
	if (!Array.isArray(sequence)) {
		return [];
	}
	const chunks: SpeechChunk[] = [];
	let state = {
		lang: null as string | null,
		pitch: NEUTRAL,
		rate: NEUTRAL,
		volume: NEUTRAL,
		characterMode: false,
	};
	let text = "";
	const flush = () => {
		if (text.trim()) {
			chunks.push({ text: text.trim(), ...state });
		}
		text = "";
	};
	for (const item of sequence) {
		if (typeof item === "string") {
			text += (text && !/\s$/.test(text) ? " " : "") + item;
			continue;
		}
		if (!Array.isArray(item) || typeof item[0] !== "string") {
			continue;
		}
		const name = item[0];
		const attributes = (item[1] && typeof item[1] === "object" ? item[1] : {}) as Record<string, unknown>;
		switch (name) {
			case "LangChangeCommand":
				flush();
				state = { ...state, lang: nvdaLangToBcp47(attributes.lang) };
				break;
			case "CharacterModeCommand":
				flush();
				state = { ...state, characterMode: Boolean(attributes.state) };
				break;
			case "PitchCommand":
				flush();
				state = { ...state, pitch: prosodyFrom(attributes) };
				break;
			case "RateCommand":
				flush();
				state = { ...state, rate: prosodyFrom(attributes) };
				break;
			case "VolumeCommand":
				flush();
				state = { ...state, volume: prosodyFrom(attributes) };
				break;
			case "PhonemeCommand":
				if (typeof attributes.text === "string") {
					text += attributes.text;
				}
				break;
			case "BreakCommand":
			case "EndUtteranceCommand":
				flush();
				break;
			default:
				// IndexCommand and anything unknown have no effect on what is heard.
				break;
		}
	}
	flush();
	return chunks;
}

/** Applies an NVDA prosody command to a base value on NVDA's 0 to 100 scale. */
export function applyProsody(base: number, prosody: Prosody): number {
	return Math.min(100, Math.max(0, base * prosody.multiplier + prosody.offset));
}

/**
 * Splits long text so no single utterance runs long enough to trip Chrome's
 * habit of silently stopping long utterances.
 */
export function splitForUtterances(text: string, maxLength = 200): string[] {
	if (text.length <= maxLength) {
		return [text];
	}
	const parts: string[] = [];
	let rest = text;
	while (rest.length > maxLength) {
		const window = rest.slice(0, maxLength);
		let cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
		if (cut < maxLength / 3) {
			cut = window.lastIndexOf(" ");
		}
		if (cut < maxLength / 3) {
			cut = maxLength - 1;
		}
		parts.push(rest.slice(0, cut + 1).trim());
		rest = rest.slice(cut + 1);
	}
	if (rest.trim()) {
		parts.push(rest.trim());
	}
	return parts;
}

/** Text for character mode: single letters are spoken as capitals so voices say the letter name. */
export function characterModeText(text: string): string {
	return text.length === 1 ? text.toUpperCase() : text;
}

export interface VoiceSettings {
	voiceURI: string;
	/** NVDA-style 0 to 100 scales. */
	rate: number;
	pitch: number;
	volume: number;
}

export interface SpeechOutput {
	speak(sequence: unknown, priority: number): void;
	cancel(): void;
	pause(paused: boolean): void;
}

/** Speaks using the browser's built-in text to speech. */
export class BrowserVoiceOutput implements SpeechOutput {
	private queue: SpeechSynthesisUtterance[] = [];
	private current: SpeechSynthesisUtterance | null = null;

	constructor(private readonly getSettings: () => VoiceSettings) {}

	static isSupported(): boolean {
		return typeof window !== "undefined" && "speechSynthesis" in window;
	}

	speak(sequence: unknown, priority: number): void {
		const utterances = parseSequence(sequence).flatMap((chunk) => this.utterancesFor(chunk));
		if (utterances.length === 0) {
			return;
		}
		if (priority === Priority.Now) {
			// Speak straight away, then carry on with what was queued.
			this.queue.unshift(...utterances);
			if (this.current) {
				const interrupted = this.current;
				this.current = null;
				interrupted.onend = null;
				interrupted.onerror = null;
				speechSynthesis.cancel();
			}
		} else {
			this.queue.push(...utterances);
		}
		this.pump();
	}

	cancel(): void {
		this.queue = [];
		if (this.current) {
			this.current.onend = null;
			this.current.onerror = null;
			this.current = null;
		}
		speechSynthesis.cancel();
	}

	pause(paused: boolean): void {
		if (paused) {
			speechSynthesis.pause();
		} else {
			speechSynthesis.resume();
		}
	}

	/** Speaks a message from this app (not the remote computer), such as "Connected". */
	speakText(text: string): void {
		this.speak([text], Priority.Normal);
	}

	private utterancesFor(chunk: SpeechChunk): SpeechSynthesisUtterance[] {
		const settings = this.getSettings();
		const voices = speechSynthesis.getVoices();
		const chosen = voices.find((v) => v.voiceURI === settings.voiceURI) ?? null;
		const voiceForLanguage = (lang: string) => {
			const lower = lang.toLowerCase();
			if (chosen && chosen.lang.toLowerCase().startsWith(lower.split("-")[0]!)) {
				return chosen;
			}
			return (
				voices.find((v) => v.lang.toLowerCase() === lower) ??
				voices.find((v) => v.lang.toLowerCase().startsWith(lower.split("-")[0]!)) ??
				chosen
			);
		};
		const voice = chunk.lang ? voiceForLanguage(chunk.lang) : chosen;
		const text = chunk.characterMode ? characterModeText(chunk.text) : chunk.text;
		return splitForUtterances(text).map((part) => {
			const utterance = new SpeechSynthesisUtterance(part);
			if (voice) {
				utterance.voice = voice;
				utterance.lang = voice.lang;
			} else if (chunk.lang) {
				utterance.lang = chunk.lang;
			}
			// Web Speech: rate 0.1 to 10 (1 normal), pitch 0 to 2 (1 normal), volume 0 to 1.
			// NVDA's 0 to 100 rate maps to roughly 0.5x to 3.5x, with 30 as normal speed.
			const rate = applyProsody(settings.rate, chunk.rate);
			utterance.rate = rate <= 30 ? 0.5 + (rate / 30) * 0.5 : 1 + ((rate - 30) / 70) * 2.5;
			utterance.pitch = applyProsody(settings.pitch, chunk.pitch) / 50;
			utterance.volume = applyProsody(settings.volume, chunk.volume) / 100;
			return utterance;
		});
	}

	private pump(): void {
		if (this.current) {
			return;
		}
		const next = this.queue.shift();
		if (!next) {
			return;
		}
		this.current = next;
		const done = () => {
			if (this.current === next) {
				this.current = null;
				this.pump();
			}
		};
		next.onend = done;
		next.onerror = done;
		speechSynthesis.speak(next);
	}
}

/**
 * Sends speech to the user's own screen reader through live regions.
 * Two regions are used alternately so repeated identical text is still announced.
 */
export class LiveRegionOutput implements SpeechOutput {
	private regions: [HTMLElement, HTMLElement];
	private active = 0;
	private pending: string[] = [];
	private timer: number | undefined;

	constructor(container: HTMLElement) {
		const make = () => {
			const region = document.createElement("div");
			region.setAttribute("aria-live", "assertive");
			region.setAttribute("aria-atomic", "true");
			region.className = "visually-hidden";
			container.append(region);
			return region;
		};
		this.regions = [make(), make()];
	}

	speak(sequence: unknown): void {
		const text = parseSequence(sequence)
			.map((chunk) => (chunk.characterMode ? characterModeText(chunk.text) : chunk.text))
			.join(" ");
		if (!text) {
			return;
		}
		// Speech often arrives in several messages in quick succession; announce them together.
		this.pending.push(text);
		window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => this.flush(), 40);
	}

	cancel(): void {
		this.pending = [];
		window.clearTimeout(this.timer);
	}

	pause(): void {
		// Screen readers do not offer a way for a page to pause their speech.
	}

	private flush(): void {
		const text = this.pending.join(" ");
		this.pending = [];
		const previous = this.regions[this.active]!;
		this.active = 1 - this.active;
		const next = this.regions[this.active]!;
		previous.textContent = "";
		next.textContent = text;
	}
}

/** Silent output, for people who only want the speech history. */
export class NoSpeechOutput implements SpeechOutput {
	speak(): void {}
	cancel(): void {}
	pause(): void {}
}
