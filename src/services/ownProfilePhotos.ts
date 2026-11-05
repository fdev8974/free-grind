/**
 * Keeps the profile's own photos restorable from a backup. The server serves
 * them only while the account works, and a banned account can't read its own
 * profile anymore, so every profile load records the photos (primary first,
 * full-size bytes included) in the own_profile_photos table — the
 * "profile_photos" backup category.
 *
 * Restored into a different profile, import (src-tauri/src/commands/backup.rs)
 * writes them to restored_profile_photos instead. Uploading those is the
 * user's call (RestoredProfilePhotosPrompt): Grindr may recognize a banned
 * account's photos. Uploads go one at a time with a pause in between, record
 * their progress so an interrupted run resumes, and only once all are up is
 * the profile pointed at them, in the old order.
 */

import type { createApiFunctions } from "./apiFunctions";
import * as chatDb from "./chatDb";
import { fetchAndEncode } from "./mediaStore";
import { sanitizeUploadFile } from "./uploadSanitize";
import {
	buildSquareThumbCoords,
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

/** Records the profile's current photos, downloading the ones not stored yet. Never throws. */
export async function syncOwnProfilePhotos(api: ApiFunctions, isCurrent: () => boolean): Promise<void> {
	try {
		const parsed = profileSchema.safeParse(unwrapOwnProfile(await api.getMyOwnProfile()));
		if (!parsed.success || !isCurrent()) return;
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
		appLog.warn("[ownProfilePhotos] recording own profile photos failed", error);
	}
}

/** How many restored photos wait for the user's decision or the rest of an interrupted upload. */
export async function countPendingRestoredProfilePhotos(): Promise<number> {
	return Math.min(await chatDb.countRestoredProfilePhotos(), MAX_PROFILE_PHOTOS);
}

export async function dismissRestoredProfilePhotos(): Promise<void> {
	await chatDb.clearRestoredProfilePhotos();
}

async function toFile(photo: chatDb.RestoredProfilePhoto): Promise<File | null> {
	if (!photo.dataBase64) return null;
	const mimeType = photo.mimeType ?? "image/jpeg";
	const blob = await (await fetch(`data:${mimeType};base64,${photo.dataBase64}`)).blob();
	return new File([blob], `${photo.mediaHash}.${mimeType.split("/")[1] ?? "jpg"}`, { type: mimeType });
}

/**
 * Uploads the restored photos and makes them the profile's photos, primary
 * first. Resolves to the number now on the profile; throws if an upload
 * failed (the photos uploaded so far are kept for the next attempt).
 */
export async function uploadRestoredProfilePhotos(api: ApiFunctions, isCurrent: () => boolean): Promise<number> {
	const photos = (await chatDb.listRestoredProfilePhotos()).slice(0, MAX_PROFILE_PHOTOS);
	const uploaded: string[] = [];

	for (const photo of photos) {
		if (photo.uploadedHash) {
			uploaded.push(photo.uploadedHash);
			continue;
		}
		const file = await toFile(photo);
		if (!file) {
			appLog.warn("[ownProfilePhotos] restored photo has no data, skipping", { hash: photo.mediaHash });
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
	}

	if (uploaded.length > 0) {
		if (!isCurrent()) throw new Error("profile changed");
		const [primaryImageHash, ...secondaryImageHashes] = uploaded;
		await api.updateMyProfileImages({ primaryImageHash, secondaryImageHashes });
	}
	await chatDb.clearRestoredProfilePhotos();
	return uploaded.length;
}
