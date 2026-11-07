/**
 * Keeps the profile's details (name, about me, tags, looking for, stats, ...)
 * restorable from a backup, like ownProfilePhotos.ts does for the photos:
 * every profile load records them in own_profile_details — the
 * "profile_details" backup category. Import (src-tauri/src/commands/backup.rs)
 * writes them to restored_profile_details, also when restoring into the same
 * profile, and RestoredProfilePrompt lets the user apply them.
 *
 * The favourite Spotify songs aren't part of /v4/me/profile: their track ids
 * ride along in the same record under SPOTIFY_SONG_IDS_FIELD and are restored
 * through their own endpoint.
 */

import type { createApiFunctions } from "./apiFunctions";
import * as chatDb from "./chatDb";
import { reportRestoreTask } from "./restoreStatus";
import { unwrapOwnProfile } from "../pages/app/profile-editor/profileEditorUtils";

type ApiFunctions = ReturnType<typeof createApiFunctions>;

/**
 * The raw /v4/me/profile fields the profile editor saves (useProfileEditor's
 * handleSaveProfile), read and written in the server's own format.
 */
const RESTORABLE_PROFILE_FIELDS = [
	"displayName",
	"aboutMe",
	"age",
	"showAge",
	"height",
	"weight",
	"ethnicity",
	"bodyType",
	"showPosition",
	"sexualPosition",
	"showTribes",
	"grindrTribes",
	"tribesImInto",
	"relationshipStatus",
	"lookingFor",
	"meetAt",
	"nsfw",
	"genders",
	"pronouns",
	"hivStatus",
	"lastTestedDate",
	"sexualHealth",
	"vaccines",
	"profileTags",
	"socialNetworks",
] as const;

/** Key of the favourite Spotify track ids in the recorded details (not a /v4/me/profile field). */
const SPOTIFY_SONG_IDS_FIELD = "spotifySongIds";
const MAX_SPOTIFY_SONGS = 5;

function restoredSpotifySongIds(details: Record<string, unknown>): string[] | null {
	const ids = details[SPOTIFY_SONG_IDS_FIELD];
	if (!Array.isArray(ids)) return null;
	return ids.filter((id): id is string => typeof id === "string").slice(0, MAX_SPOTIFY_SONGS);
}

/** The restorable fields of a profile (/v4/me/profile, or a /v7/profiles snapshot: same field names). */
export function pickRestorableProfileFields(profile: Record<string, unknown>): Record<string, unknown> {
	const details: Record<string, unknown> = {};
	for (const field of RESTORABLE_PROFILE_FIELDS) {
		if (field in profile) details[field] = profile[field];
	}
	return details;
}

/**
 * Records the restorable fields of the profile as just read from /v4/me/profile,
 * plus its favourite Spotify track ids. `spotifySongIds` null (loading them
 * failed) keeps the ids recorded before.
 */
export async function recordOwnProfileDetails(profile: Record<string, unknown>, spotifySongIds: string[] | null): Promise<void> {
	const details = pickRestorableProfileFields(profile);
	if (spotifySongIds) {
		details[SPOTIFY_SONG_IDS_FIELD] = spotifySongIds;
	} else {
		const previous = await chatDb.getOwnProfileDetails();
		if (previous && SPOTIFY_SONG_IDS_FIELD in previous) details[SPOTIFY_SONG_IDS_FIELD] = previous[SPOTIFY_SONG_IDS_FIELD];
	}
	await chatDb.setOwnProfileDetails(details);
}

export async function hasRestoredProfileDetails(): Promise<boolean> {
	return (await chatDb.getRestoredProfileDetails()) != null;
}

/**
 * Discards restored details that already match `current` (the profile as just
 * read from the server) and `currentSpotifySongIds` (null: unknown, counts as
 * differing), e.g. a backup of this same profile that hasn't been changed
 * since. Resolves to whether any differing details are left to apply.
 */
export async function keepRestoredProfileDetailsIfChanged(
	current: Record<string, unknown>,
	currentSpotifySongIds: string[] | null,
): Promise<boolean> {
	const restored = await chatDb.getRestoredProfileDetails();
	if (!restored) return false;
	const restoredSongIds = restoredSpotifySongIds(restored);
	const changed =
		RESTORABLE_PROFILE_FIELDS.some(
			(field) => field in restored && JSON.stringify(restored[field] ?? null) !== JSON.stringify(current[field] ?? null),
		) ||
		(restoredSongIds != null && JSON.stringify(restoredSongIds) !== JSON.stringify(currentSpotifySongIds));
	if (!changed) await chatDb.clearRestoredProfileDetails();
	return changed;
}

export async function dismissRestoredProfileDetails(): Promise<void> {
	await chatDb.clearRestoredProfileDetails();
	reportRestoreTask("profile_details", null);
}

/**
 * Lays the restored fields over this profile's current one and saves it with
 * a full replace, like the profile editor (fields not restored stay as they
 * are), then sets the restored favourite Spotify songs. Throws if saving
 * failed, e.g. banned terms; the details are kept then.
 */
export async function applyRestoredProfileDetails(api: ApiFunctions, isCurrent: () => boolean): Promise<void> {
	const restored = await chatDb.getRestoredProfileDetails();
	if (!restored) return;
	reportRestoreTask("profile_details", { state: "running", done: 0, total: 1 });
	try {
		const current = unwrapOwnProfile(await api.getMyOwnProfile());
		if (!current) throw new Error("own profile unavailable");
		const merged: Record<string, unknown> = { ...current };
		for (const field of RESTORABLE_PROFILE_FIELDS) {
			if (field in restored) merged[field] = restored[field];
		}
		// The api always talks to the active profile: never write into another one.
		if (!isCurrent()) throw new Error("profile changed");
		await api.replaceMyProfile(merged);
		const songIds = restoredSpotifySongIds(restored);
		if (songIds) {
			if (!isCurrent()) throw new Error("profile changed");
			await api.setSpotifyFavoriteSongIds(songIds);
		}
		await chatDb.clearRestoredProfileDetails();
		reportRestoreTask("profile_details", { state: "done", done: 1, total: 1 });
	} catch (error) {
		reportRestoreTask("profile_details", isCurrent() ? { state: "failed", done: 0, total: 1 } : null);
		throw error;
	}
}
