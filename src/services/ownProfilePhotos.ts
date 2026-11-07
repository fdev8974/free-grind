/**
 * Keeps the profile's own photos restorable from a backup. The server serves
 * them only while the account works, and a banned account can't read its own
 * profile anymore, so every profile load records the photos (primary first,
 * full-size bytes included) in the own_profile_photos table — the
 * "profile_photos" backup category.
 *
 * Import (src-tauri/src/commands/backup.rs) writes them to
 * restored_profile_photos instead, also when restoring into the same profile. Uploading those is the
 * user's call (RestoredProfilePrompt): Grindr may recognize a banned
 * account's photos. Uploads go one at a time with a pause in between, record
 * their progress so an interrupted run resumes, and only once all are up is
 * the profile pointed at them, in the old order.
 */

import type { createApiFunctions } from "./apiFunctions";
import * as chatDb from "./chatDb";
import { fetchAndEncode } from "./mediaStore";
import { recordOwnProfileDetails } from "./ownProfileDetails";
import { advanceRestoreTask, reportRestoreTask, stoppableRestoreTask } from "./restoreStatus";
import { setSavedAccountDisplayName, setSavedAccountPhotoHash } from "./savedAccountProfiles";
import { sanitizeUploadFile } from "./uploadSanitize";
import {
	buildSquareThumbCoords,
	getProfilePhotoHash,
	MAX_PROFILE_PHOTOS,
	profileSchema,
	unwrapOwnProfile,
} from "../pages/app/profile-editor/profileEditorUtils";
import { getProfileImageUrl, validateMediaHash } from "../utils/media";
import { appLog } from "../utils/logger";

type ApiFunctions = ReturnType<typeof createApiFunctions>;

const UPLOAD_DELAY_MS = 6_000;
const UPLOAD_DELAY_JITTER_MS = 4_000;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Records the profile's current details (ownProfileDetails.ts) and photos,
 * downloading the photos not stored yet. The same read also refreshes the
 * account switcher's name and avatar for this profile, which GridPage only
 * does while it's open. Never throws.
 */
export async function syncOwnProfile(api: ApiFunctions, profileId: number, isCurrent: () => boolean): Promise<void> {
	try {
		const raw = unwrapOwnProfile(await api.getMyOwnProfile());
		const parsed = profileSchema.safeParse(raw);
		if (!raw || !parsed.success || !isCurrent()) return;
		const spotifySongIds = await api.getSpotifyFavoriteSongIds(String(profileId)).catch((error: unknown) => {
			appLog.warn("[ownProfilePhotos] loading own Spotify songs failed", error);
			return null;
		});
		const travelPlans = await api.getTravelPlans(profileId).catch((error: unknown) => {
			appLog.warn("[ownProfilePhotos] loading own trips failed", error);
			return null;
		});
		if (!isCurrent()) return;
		await recordOwnProfileDetails(raw, spotifySongIds, travelPlans);
		setSavedAccountDisplayName(String(profileId), parsed.data.displayName ?? null);
		setSavedAccountPhotoHash(String(profileId), getProfilePhotoHash(parsed.data));
		const hashes = (parsed.data.medias ?? [])
			.map((item) => item.mediaHash ?? "")
			.filter((hash) => validateMediaHash(hash));
		await chatDb.replaceOwnProfilePhotos(hashes);
		for (const hash of await chatDb.listOwnProfilePhotosWithoutData()) {
			const fetched = await fetchAndEncode(getProfileImageUrl(hash, "1024x1024"));
			if (!isCurrent()) return;
			if (fetched) await chatDb.setOwnProfilePhotoData(hash, fetched.mimeType, fetched.base64);
		}
	} catch (error) {
		appLog.warn("[ownProfilePhotos] recording own profile failed", error);
	}
}

/** How many restored photos wait for the user's decision or the rest of an interrupted upload. */
export async function countPendingRestoredProfilePhotos(): Promise<number> {
	return Math.min(await chatDb.countRestoredProfilePhotos(), MAX_PROFILE_PHOTOS);
}

/** Hashes of the photos on `profile` (raw /v4/me/profile), primary first. */
export function profilePhotoHashes(profile: Record<string, unknown>): string[] {
	const parsed = profileSchema.safeParse(profile);
	if (!parsed.success) return [];
	return (parsed.data.medias ?? []).map((item) => item.mediaHash ?? "").filter((hash) => validateMediaHash(hash));
}

/**
 * Discards the restored photos if the profile already shows exactly those, in
 * that order (a backup of this same profile, unchanged since). Resolves to how
 * many are left pending.
 */
export async function keepRestoredProfilePhotosIfChanged(currentHashes: string[]): Promise<number> {
	const restored = (await chatDb.listRestoredProfilePhotos()).slice(0, MAX_PROFILE_PHOTOS);
	if (restored.length === 0) return 0;
	const unchanged =
		restored.length === currentHashes.length && restored.every((photo, i) => (photo.uploadedHash ?? photo.mediaHash) === currentHashes[i]);
	if (unchanged) {
		await chatDb.clearRestoredProfilePhotos();
		return 0;
	}
	return restored.length;
}

export async function dismissRestoredProfilePhotos(): Promise<void> {
	await chatDb.clearRestoredProfilePhotos();
	reportRestoreTask("profile_photos", null);
}

async function toFile(photo: chatDb.RestoredProfilePhoto): Promise<File | null> {
	if (!photo.dataBase64) return null;
	const mimeType = photo.mimeType ?? "image/jpeg";
	// Decoded directly: the CSP's connect-src has no data:, so fetch() on a data URL fails.
	const binary = atob(photo.dataBase64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	const blob = new Blob([bytes], { type: mimeType });
	return new File([blob], `${photo.mediaHash}.${mimeType.split("/")[1] ?? "jpg"}`, { type: mimeType });
}

/**
 * Uploads the restored photos and makes them the profile's photos, primary
 * first. Resolves to the number now on the profile; throws if an upload
 * failed (the photos uploaded so far are kept for the next attempt).
 */
export async function uploadRestoredProfilePhotos(api: ApiFunctions, isCurrentProfile: () => boolean): Promise<number> {
	const isCurrent = stoppableRestoreTask("profile_photos", isCurrentProfile);
	const photos = (await chatDb.listRestoredProfilePhotos()).slice(0, MAX_PROFILE_PHOTOS);
	// +1 for pointing the profile at them once all are up.
	const total = photos.length + 1;
	reportRestoreTask("profile_photos", { state: "running", done: 0, total });
	try {
		const count = await uploadPhotos(api, isCurrent, photos);
		reportRestoreTask("profile_photos", { state: "done", done: total, total });
		return count;
	} catch (error) {
		reportRestoreTask("profile_photos", isCurrent() ? { state: "failed", done: 0, total } : null);
		throw error;
	}
}

async function uploadPhotos(api: ApiFunctions, isCurrent: () => boolean, photos: chatDb.RestoredProfilePhoto[]): Promise<number> {
	const current = unwrapOwnProfile(await api.getMyOwnProfile());
	// Restoring into the same profile: photos still on it are reused, not uploaded twice.
	const onProfile = new Set(current ? profilePhotoHashes(current) : []);
	const uploaded: string[] = [];

	for (const photo of photos) {
		if (photo.uploadedHash) {
			uploaded.push(photo.uploadedHash);
			advanceRestoreTask("profile_photos");
			continue;
		}
		if (onProfile.has(photo.mediaHash)) {
			uploaded.push(photo.mediaHash);
			advanceRestoreTask("profile_photos");
			continue;
		}
		const file = await toFile(photo);
		if (!file) {
			appLog.warn("[ownProfilePhotos] restored photo has no data, skipping", { hash: photo.mediaHash });
			advanceRestoreTask("profile_photos");
			continue;
		}
		if (uploaded.length > 0) await sleep(UPLOAD_DELAY_MS + Math.random() * UPLOAD_DELAY_JITTER_MS);
		// The api always talks to the active profile: never upload into another one.
		if (!isCurrent()) throw new Error("profile changed");
		const upload = await sanitizeUploadFile(file);
		const result = await api.uploadProfilePhoto({
			body: new Uint8Array(await upload.arrayBuffer()),
			contentType: upload.type,
			thumbCoords: await buildSquareThumbCoords(upload),
			takenOnGrindr: false,
		});
		const newHash = result.hash ?? result.mediaHash ?? result.imageSizes?.find((item) => item.mediaHash)?.mediaHash;
		if (!newHash) throw new Error("upload returned no media hash");
		await chatDb.markRestoredProfilePhotoUploaded(photo.mediaHash, newHash);
		uploaded.push(newHash);
		advanceRestoreTask("profile_photos");
	}

	if (uploaded.length > 0) {
		if (!isCurrent()) throw new Error("profile changed");
		const [primaryImageHash, ...secondaryImageHashes] = uploaded;
		await api.updateMyProfileImages({ primaryImageHash, secondaryImageHashes });
	}
	await chatDb.clearRestoredProfilePhotos();
	return uploaded.length;
}
