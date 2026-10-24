// Announces this app's own messages (not the remote computer's speech) to screen readers.

export class Announcer {
	private polite: HTMLElement;
	private assertive: HTMLElement;
	private clearTimer: number | undefined;

	constructor(
		container: HTMLElement,
		private readonly speakAlso: (text: string) => void = () => {},
	) {
		const make = (politeness: "polite" | "assertive") => {
			const region = document.createElement("div");
			region.setAttribute("aria-live", politeness);
			region.setAttribute("aria-atomic", "true");
			region.className = "visually-hidden";
			container.append(region);
			return region;
		};
		this.polite = make("polite");
		this.assertive = make("assertive");
	}

	/** Announce a status message. Use urgent for errors that need attention now. */
	say(text: string, urgent = false): void {
		const region = urgent ? this.assertive : this.polite;
		// Clearing first makes screen readers announce the same text again if it repeats.
		region.textContent = "";
		window.setTimeout(() => {
			region.textContent = text;
		}, 50);
		window.clearTimeout(this.clearTimer);
		this.clearTimer = window.setTimeout(() => {
			this.polite.textContent = "";
			this.assertive.textContent = "";
		}, 10_000);
		this.speakAlso(text);
	}
}
