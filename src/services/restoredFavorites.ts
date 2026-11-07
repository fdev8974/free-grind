/**
 * Sets favorites from a backup again, each with its note. Import
 * (src-tauri/src/commands/backup.rs) queues them in restored_favorite_profiles,
 * and runRestoredFavorites favorites those profiles in the background, saving
 * the note right after (a note can only be saved on a favorite). Deliberately
 * slow and sequential, like ownBlocklist.ts: one at a time with a pause in
 * between, each done one removed from the table so an interrupted run resumes.
 * Profiles that already are favorites are dropped up front, without a request
 * each: only the difference is restored.
 */

import type { createApiFunctions } from "./apiFunctions";
import { isGoneProfileError } from "./apiHelpers";
import { fetchFavoriteProfiles } from "./backupRestore";
import * as chatDb from "./chatDb";
import { advanceRestoreTask, reportRestoreTask, stoppableRestoreTask } from "./restoreStatus";
import { LOCATION_SETTINGS_KEY } from "../contexts/PreferencesContext";
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

type CurrentFavorite = { notes: string; phoneNumber: string } | null;

/**
 * The profile's current favorites, with their note if they have one. There's
 * no endpoint listing them, so like the backup export it combines the inbox's
 * favorites (everyone favorited with a chat), cascade's favorites filter at
 * the profile's saved location (everyone else) and every profile with a note
 * (a note means a favorite). Without a saved location cascade is skipped and
 * favorites without chat or note get favorited again, which is harmless.
 * Null if loading failed.
 */
async function loadCurrentFavorites(api: ApiFunctions): Promise<Map<string, CurrentFavorite> | null> {
	try {
		const location = await chatDb.getSetting<{ geohash?: string | null }>(LOCATION_SETTINGS_KEY).catch(() => null);
		const geohash = location?.geohash ?? null;
		const [profiles, notes] = await Promise.all([fetchFavoriteProfiles(api, geohash), api.getFavoriteNotes()]);
		const current = new Map<string, CurrentFavorite>(profiles.map((profile) => [profile.profileId, null]));
		for (const { counterpartyId, notes: text, phoneNumber } of notes) {
			current.set(String(counterpartyId), { notes: text ?? "", phoneNumber: phoneNumber ?? "" });
		}
		appLog.info("[restoredFavorites] current favorites", { count: current.size, withCascade: geohash != null });
		return current;
	} catch (error) {
		appLog.warn("[restoredFavorites] loading current favorites failed, restoring all", error);
		return null;
	}
}

/** What's left to do for a restored favorite, given the current ones. */
function pendingStep(favorite: chatDb.RestoredFavoriteProfile, current: Map<string, CurrentFavorite> | null): "favorite" | "note" | null {
	if (!current?.has(favorite.profileId)) return "favorite";
	const hasRestoredNote = Boolean(favorite.notes || favorite.phoneNumber);
	const existing = current.get(favorite.profileId);
	// A note already there is newer than the backup's: kept as it is.
	const hasNote = Boolean(existing && (existing.notes || existing.phoneNumber));
	return hasRestoredNote && !hasNote ? "note" : null;
}

/** Favorites the profiles a backup had favorited that aren't favorites yet. */
export async function runRestoredFavorites(api: ApiFunctions, ownProfileId: number, isCurrentProfile: () => boolean): Promise<void> {
	if (running) return;
	running = true;
	const isCurrent = stoppableRestoreTask("favorites", isCurrentProfile);
	try {
		const restored = await chatDb.listRestoredFavoriteProfiles();
		if (restored.length === 0) return;

		const current = await loadCurrentFavorites(api);
		if (!isCurrent()) return;
		const remaining: (chatDb.RestoredFavoriteProfile & { step: "favorite" | "note" })[] = [];
		let skipped = 0;
		for (const favorite of restored) {
			// Import rewrote the old profile's id to this one; this profile can't favorite itself.
			const step = favorite.profileId === String(ownProfileId) ? null : pendingStep(favorite, current);
			if (step) {
				remaining.push({ ...favorite, step });
			} else {
				await chatDb.deleteRestoredFavoriteProfile(favorite.profileId);
				skipped++;
			}
		}
		appLog.info("[restoredFavorites] restoring favorites", { count: remaining.length, alreadyThere: skipped });
		const total = remaining.length;
		let done = 0;
		reportRestoreTask("favorites", { state: total > 0 ? "running" : "done", done, total });

		let consecutiveFailures = 0;
		while (remaining.length > 0) {
			await sleep(FAVORITE_DELAY_MS + Math.random() * FAVORITE_DELAY_JITTER_MS);
			// The api always talks to the active profile: never favorite from another one.
			if (!isCurrent()) return reportRestoreTask("favorites", null);
			const favorite = remaining.shift() as (typeof remaining)[number];
			const { profileId } = favorite;
			try {
				if (favorite.step === "favorite") await api.addFavorite(profileId);
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
