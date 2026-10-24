// Per-browser preferences. Storage can be unavailable (private windows, blocked site data),
// so every access is guarded and the app works without it.

export function readJson<T>(key: string, fallback: T): T {
	try {
		const raw = window.localStorage.getItem(key);
		return raw === null ? fallback : { ...fallback, ...(JSON.parse(raw) as T) };
	} catch {
		return fallback;
	}
}

export function readRaw(key: string): string | null {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

export function writeJson(key: string, value: unknown): void {
	try {
		window.localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Not saved; the setting still applies for this visit.
	}
}

export function writeRaw(key: string, value: string | null): void {
	try {
		if (value === null) {
			window.localStorage.removeItem(key);
		} else {
			window.localStorage.setItem(key, value);
		}
	} catch {
		// Not saved.
	}
}
