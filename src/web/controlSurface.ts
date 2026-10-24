// Control mode: while active, keys pressed on this device are sent to the remote computer.
// Full screen plus the Keyboard Lock API lets system keys (Alt+Tab, Escape, Search) through
// in Chromium browsers; elsewhere the browser keeps a few keys for itself.

import { mapKey, type KeymapOptions, type RemoteKey } from "./keymap.js";
import { isExitKey, type ExitKey } from "./settings.js";

interface KeyboardLock {
	lock(keyCodes?: string[]): Promise<void>;
	unlock(): void;
}

export interface ControlSurfaceOptions {
	surface: HTMLElement;
	sendKey(key: RemoteKey, pressed: boolean): void;
	getKeymap(): KeymapOptions;
	getExitKey(): ExitKey;
	useFullscreen(): boolean;
	onChange(controlling: boolean, reason?: string): void;
}

export class ControlSurface {
	controlling = false;
	/** Keys currently held down on the remote computer, by browser key code. */
	private held = new Map<string, RemoteKey>();
	private enteredFullscreen = false;
	private stopping = false;

	constructor(private readonly options: ControlSurfaceOptions) {
		const { surface } = options;
		surface.addEventListener("keydown", (event) => this.onKeyDown(event));
		surface.addEventListener("keyup", (event) => this.onKeyUp(event));
		surface.addEventListener("blur", () => {
			if (this.controlling && !this.stopping) {
				this.stop("Focus left the remote control area.");
			}
		});
		window.addEventListener("blur", () => this.releaseAll());
		document.addEventListener("visibilitychange", () => {
			if (document.hidden) {
				this.releaseAll();
			}
		});
		document.addEventListener("fullscreenchange", () => {
			if (this.controlling && this.enteredFullscreen && !document.fullscreenElement) {
				this.enteredFullscreen = false;
				this.stop("Left full screen.");
			}
		});
	}

	/** Must be called from a user action, such as a button press or key press. */
	async start(): Promise<void> {
		if (this.controlling) {
			return;
		}
		const { surface } = this.options;
		surface.hidden = false;
		this.controlling = true;
		if (this.options.useFullscreen() && document.fullscreenEnabled && !document.fullscreenElement) {
			try {
				await surface.requestFullscreen({ navigationUI: "hide" });
				this.enteredFullscreen = true;
				await this.keyboardLock()?.lock();
			} catch {
				// Carry on without full screen; most keys still work.
			}
		}
		surface.focus();
		this.options.onChange(true);
	}

	stop(reason?: string): void {
		if (!this.controlling) {
			return;
		}
		this.stopping = true;
		this.releaseAll();
		this.controlling = false;
		this.keyboardLock()?.unlock();
		if (this.enteredFullscreen && document.fullscreenElement) {
			void document.exitFullscreen().catch(() => {});
		}
		this.enteredFullscreen = false;
		this.options.surface.hidden = true;
		this.stopping = false;
		this.options.onChange(false, reason);
	}

	/** Lets go of every key still held on the remote computer, so none get stuck down. */
	releaseAll(): void {
		for (const key of [...this.held.values()].reverse()) {
			this.options.sendKey(key, false);
		}
		this.held.clear();
	}

	private keyboardLock(): KeyboardLock | null {
		return (navigator as unknown as { keyboard?: KeyboardLock }).keyboard ?? null;
	}

	private onKeyDown(event: KeyboardEvent): void {
		if (!this.controlling || event.isComposing) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (isExitKey(event, this.options.getExitKey())) {
			this.stop();
			return;
		}
		const key = mapKey(event.code, event.key, this.options.getKeymap());
		if (!key) {
			return;
		}
		this.held.set(event.code, key);
		this.options.sendKey(key, true);
		// Browsers never report Print Screen being released.
		if (event.code === "PrintScreen") {
			this.held.delete(event.code);
			this.options.sendKey(key, false);
		}
	}

	private onKeyUp(event: KeyboardEvent): void {
		if (!this.controlling) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const key = this.held.get(event.code);
		if (key) {
			this.held.delete(event.code);
			this.options.sendKey(key, false);
		}
	}
}
