// Beeps and sound files from the remote computer, plus NVDA Remote's own cue sounds.
// Sound files are named by a path on the remote computer; only NVDA's standard sounds,
// which ship with this app, can be played.

/** Original capitalisation of the bundled files, keyed by lower case name. */
const WAVE_FILE_NAMES: Record<string, string> = Object.fromEntries(
	[
		"browseMode",
		"clipboardPush",
		"clipboardReceive",
		"connected",
		"controlled",
		"controlling",
		"disconnected",
		"error",
		"exit",
		"focusMode",
		"screenCurtainOff",
		"screenCurtainOn",
		"start",
		"suggestionsClosed",
		"suggestionsOpened",
		"textError",
	].map((name) => [name.toLowerCase(), name]),
);

/** Extracts a bundled sound name from a Windows or POSIX path, or null if it is not one of ours. */
export function waveNameFromPath(path: unknown): string | null {
	if (typeof path !== "string") {
		return null;
	}
	const base = path.split(/[\\/]/).pop() ?? "";
	const name = base.replace(/\.wav$/i, "").toLowerCase();
	return WAVE_FILE_NAMES[name] ?? null;
}

export class AudioOutput {
	private context: AudioContext | null = null;
	private buffers = new Map<string, Promise<AudioBuffer | null>>();
	muted = false;
	/** 0 to 100. */
	volume = 80;

	/** Must be called from a user action (such as pressing Connect) so browsers allow sound. */
	unlock(): void {
		const context = this.getContext();
		if (context && context.state === "suspended") {
			void context.resume();
		}
	}

	/** Plays a tone, like NVDA's tones.beep. Volumes are 0 to 100 per channel. */
	beep(hz: number, lengthMs: number, left = 50, right = 50): void {
		const context = this.getContext();
		if (!context || this.muted || !(hz > 0) || !(lengthMs > 0)) {
			return;
		}
		const start = context.currentTime;
		const end = start + Math.min(lengthMs, 10_000) / 1000;
		const oscillator = context.createOscillator();
		oscillator.type = "sine";
		oscillator.frequency.value = Math.min(Math.max(hz, 20), 20_000);
		const merger = context.createChannelMerger(2);
		const scale = (this.volume / 100) * 0.5;
		for (const [channel, level] of [
			[0, left],
			[1, right],
		] as const) {
			const gain = context.createGain();
			const peak = (Math.min(Math.max(level, 0), 100) / 100) * scale;
			// Short ramps avoid clicks at the start and end of the tone.
			gain.gain.setValueAtTime(0, start);
			gain.gain.linearRampToValueAtTime(peak, start + 0.005);
			gain.gain.setValueAtTime(peak, Math.max(start + 0.005, end - 0.005));
			gain.gain.linearRampToValueAtTime(0, end);
			oscillator.connect(gain);
			gain.connect(merger, 0, channel);
		}
		merger.connect(context.destination);
		oscillator.start(start);
		oscillator.stop(end);
		oscillator.onended = () => merger.disconnect();
	}

	/** Plays a sound file sent by the remote computer, if it is one of NVDA's standard sounds. */
	playRemoteWave(fileName: unknown): void {
		const name = waveNameFromPath(fileName);
		if (name) {
			void this.playWave(name);
		}
	}

	/** Plays one of the bundled sounds by name, such as "connected". */
	async playWave(name: string): Promise<void> {
		const context = this.getContext();
		if (!context || this.muted) {
			return;
		}
		let pending = this.buffers.get(name);
		if (!pending) {
			pending = fetch(`${import.meta.env.BASE_URL}waves/${name}.wav`)
				.then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(response.statusText))))
				.then((data) => context.decodeAudioData(data))
				.catch(() => null);
			this.buffers.set(name, pending);
		}
		const buffer = await pending;
		if (!buffer || this.muted) {
			return;
		}
		const source = context.createBufferSource();
		source.buffer = buffer;
		const gain = context.createGain();
		gain.gain.value = this.volume / 100;
		source.connect(gain).connect(context.destination);
		source.start();
	}

	private getContext(): AudioContext | null {
		if (!this.context) {
			const AudioContextClass =
				window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			if (!AudioContextClass) {
				return null;
			}
			this.context = new AudioContextClass();
		}
		return this.context;
	}
}
