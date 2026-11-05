/**
 * Keeps the profile's details (name, about me, tags, looking for, stats, ...)
 * restorable from a backup, like ownProfilePhotos.ts does for the photos:
 * every profile load records them in own_profile_details — the
 * "profile_details" backup category. Restored into a different profile, import
 * (src-tauri/src/commands/backup.rs) writes them to restored_profile_details,
 * and RestoredProfilePrompt lets the user apply them.
 */

import type { createApiFunctions } from "./apiFunctions";
import * as chatDb from "./chatDb";
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

/** Records the restorable fields of the profile as just read from /v4/me/profile. */
export async function recordOwnProfileDetails(profile: Record<string, unknown>): Promise<void> {
	const details: Record<string, unknown> = {};
	for (const field of RESTORABLE_PROFILE_FIELDS) {
		if (field in profile) details[field] = profile[field];
	}
	await chatDb.setOwnProfileDetails(details);
}

export async function hasRestoredProfileDetails(): Promise<boolean> {
	return (await chatDb.getRestoredProfileDetails()) != null;
}

export async function dismissRestoredProfileDetails(): Promise<void> {
	await chatDb.clearRestoredProfileDetails();
}

/**
 * Lays the restored fields over this profile's current one and saves it with
 * a full replace, like the profile editor (fields not restored stay as they
 * are). Throws if saving failed, e.g. banned terms; the details are kept then.
 */
export async function applyRestoredProfileDetails(api: ApiFunctions, isCurrent: () => boolean): Promise<void> {
	const restored = await chatDb.getRestoredProfileDetails();
	if (!restored) return;
	const current = unwrapOwnProfile(await api.getMyOwnProfile());
	if (!current) throw new Error("own profile unavailable");
	const merged: Record<string, unknown> = { ...current };
	for (const field of RESTORABLE_PROFILE_FIELDS) {
		if (field in restored) merged[field] = restored[field];
	}
	// The api always talks to the active profile: never write into another one.
	if (!isCurrent()) throw new Error("profile changed");
	await api.replaceMyProfile(merged);
	await chatDb.clearRestoredProfileDetails();
}
