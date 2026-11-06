/**
 * Sets favorites from a backup again, each with its note. Import
 * (src-tauri/src/commands/backup.rs) queues them in restored_favorite_profiles,
 * and runRestoredFavorites favorites those profiles in the background, saving
 * the note right after (a note can only be saved on a favorite). Deliberately
 * slow and sequential, like ownBlocklist.ts: one at a time with a pause in
 * between, each done one removed from the table so an interrupted run resumes.
 */

import type { createApiFunctions } from "./apiFunctions";
import { isGoneProfileError } from "./apiHelpers";
import * as chatDb from "./chatDb";
import { advanceRestoreTask, reportRestoreTask } from "./restoreStatus";
import { appLog } from "../utils/logger";

type ApiFunctions = ReturnType<typeof createApiFunctions>;

const FAVORITE_DELAY_MS = 3_000;
const FAVORITE_DELAY_JITTER_MS = 2_000;
/** Likely rate limiting or no connection: stop and pick up again on the next app start. */
const MAX_CONSECUTIVE_FAILURES = 3;

let running = false;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Favorites the profiles a backup had favorited. There's no cheap list of current favorites to skip against; favoriting one twice is harmless. */
export async function runRestoredFavorites(api: ApiFunctions, ownProfileId: number, isCurrent: () => boolean): Promise<void> {
	if (running) return;
	running = true;
	try {
		const restored = await chatDb.listRestoredFavoriteProfiles();
		if (restored.length === 0) return;

		const remaining: chatDb.RestoredFavoriteProfile[] = [];
		for (const favorite of restored) {
			// Import rewrote the old profile's id to this one; this profile can't favorite itself.
			if (favorite.profileId === String(ownProfileId)) {
				await chatDb.deleteRestoredFavoriteProfile(favorite.profileId);
			} else {
				remaining.push(favorite);
			}
		}
		appLog.info("[restoredFavorites] restoring favorites", { count: remaining.length });
		const total = remaining.length;
		let done = 0;
		reportRestoreTask("favorites", { state: total > 0 ? "running" : "done", done, total });

		let consecutiveFailures = 0;
		while (remaining.length > 0) {
			await sleep(FAVORITE_DELAY_MS + Math.random() * FAVORITE_DELAY_JITTER_MS);
			// The api always talks to the active profile: never favorite from another one.
			if (!isCurrent()) return reportRestoreTask("favorites", null);
			const favorite = remaining.shift() as chatDb.RestoredFavoriteProfile;
			const { profileId } = favorite;
			try {
				await api.addFavorite(profileId);
				if (favorite.notes || favorite.phoneNumber) {
					await api.saveProfileNote(profileId, { notes: favorite.notes ?? "", phoneNumber: favorite.phoneNumber ?? "" });
				}
				consecutiveFailures = 0;
			} catch (error) {
				if (!isCurrent()) return reportRestoreTask("favorites", null);
				// A deleted profile can't be favorited (or noted) ever again: drop it
				// instead of retrying until the whole restore pauses over it.
				if (isGoneProfileError(error)) {
					appLog.info("[restoredFavorites] profile gone, skipping", { profileId });
					await chatDb.deleteRestoredFavoriteProfile(profileId);
					done++;
					advanceRestoreTask("favorites");
					continue;
				}
				appLog.warn("[restoredFavorites] favoriting failed", { profileId, error });
				if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
					appLog.warn("[restoredFavorites] stopping after repeated failures, resuming on next start");
					reportRestoreTask("favorites", { state: "paused", done, total });
					return;
				}
				// Possibly just a hiccup: to the back, not in the way.
				remaining.push(favorite);
				continue;
			}
			await chatDb.deleteRestoredFavoriteProfile(profileId);
			done++;
			advanceRestoreTask("favorites");
		}
		reportRestoreTask("favorites", { state: "done", done, total });
	} catch (error) {
		appLog.warn("[restoredFavorites] restoring favorites failed", error);
	} finally {
		running = false;
	}
}
