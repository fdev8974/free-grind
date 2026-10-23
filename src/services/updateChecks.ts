// Master switch for the automatic startup update checks (frontend OTA bundle and
// app release on GitHub). Off means no update request goes out unless the user
// checks manually in Settings. On by default.
const UPDATE_CHECKS_STORAGE_KEY = "update-checks-enabled";

function readUpdateChecksEnabled(): boolean {
	try {
		return window.localStorage.getItem(UPDATE_CHECKS_STORAGE_KEY) !== "false";
	} catch {
		return true;
	}
}

let updateChecksEnabled = typeof window === "undefined" || readUpdateChecksEnabled();
const listeners = new Set<() => void>();

export function areUpdateChecksEnabled(): boolean {
	return updateChecksEnabled;
}

export function subscribeUpdateChecks(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function setUpdateChecksEnabled(enabled: boolean): void {
	updateChecksEnabled = enabled;
	try {
		window.localStorage.setItem(UPDATE_CHECKS_STORAGE_KEY, String(enabled));
	} catch {
		// Storage unavailable — the choice only lasts for this session.
	}
	for (const listener of listeners) listener();
}
