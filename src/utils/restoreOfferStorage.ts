const RESTORE_OFFER_KEY_PREFIX = "fg-restore-offered-";

export function hasOfferedRestore(userId: number): boolean {
	if (typeof window === "undefined") {
		return true;
	}

	try {
		return window.localStorage.getItem(`${RESTORE_OFFER_KEY_PREFIX}${userId}`) === "true";
	} catch {
		return true;
	}
}

export function markRestoreOffered(userId: number): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		window.localStorage.setItem(`${RESTORE_OFFER_KEY_PREFIX}${userId}`, "true");
	} catch {
		// Ignore storage write failures.
	}
}

export const REPLAY_RESTORE_OFFER_EVENT = "fg:replay-restore-offer";

/** Re-shows the restore-backup offer regardless of the offered flag (dev tool). */
export function replayRestoreOffer(): void {
	if (typeof window === "undefined") {
		return;
	}

	window.dispatchEvent(new Event(REPLAY_RESTORE_OFFER_EVENT));
}
