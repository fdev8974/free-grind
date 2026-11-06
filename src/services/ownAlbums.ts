/**
 * Keeps the profile's own albums restorable from a backup, like
 * ownProfilePhotos.ts does for the photos. They live only on the server, and
 * nothing else caches them locally (albumStore.ts skips own albums on
 * purpose), so every start records them in own_albums / own_album_media,
 * content bytes included: the "own_albums" backup category, still there
 * once a ban locks the account out of its albums.
 *
 * Import (src-tauri/src/commands/backup.rs) writes them to the restored_*
 * pair instead, also when restoring into the same profile, and
 * runRestoredOwnAlbums creates the albums again and uploads their content in
 * the background. Deliberately slow and sequential like
 * restoredDrawerMedia.ts: one upload at a time with a pause in between.
 */

import type { createApiFunctions } from "./apiFunctions";
import { ApiFunctionError } from "./apiHelpers";
import * as chatDb from "./chatDb";
import { fetchAndEncode } from "./mediaStore";
import { advanceRestoreTask, reportRestoreTask } from "./restoreStatus";
import { MAX_CHAT_MEDIA_BYTES } from "./stagedVideoUpload";
import { buildMultipartBody } from "../pages/app/settings-albums/settingsAlbumsUtils";
import type { AlbumMedia } from "../types/albums";
import { appLog } from "../utils/logger";

type ApiFunctions = ReturnType<typeof createApiFunctions>;

const UPLOAD_DELAY_MS = 8_000;
const UPLOAD_DELAY_JITTER_MS = 4_000;
/** Between the album detail reads of a sync, so a profile with many albums doesn't fire them all at once. */
const SYNC_DETAIL_DELAY_MS = 500;
/** Likely rate limiting or no connection: stop and pick up again on the next app start. */
const MAX_CONSECUTIVE_FAILURES = 3;

let syncing = false;
let restoring = false;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Content worth keeping: rejected items would only be rejected again on upload. */
function isRecordable(item: AlbumMedia): boolean {
	return item.rejectionId == null;
}

/**
 * Records the profile's albums and downloads the content not stored yet.
 * Content still processing has no url yet and is picked up on a later start.
 * Never throws; a failed read leaves what was recorded before untouched.
 */
export async function syncOwnAlbums(api: ApiFunctions, isCurrent: () => boolean): Promise<void> {
	if (syncing) return;
	syncing = true;
	try {
		const albums = await api.getOwnAlbums();
		const records: chatDb.OwnAlbumRecord[] = [];
		const urls = new Map<string, string>();
		for (const [index, album] of albums.entries()) {
			if (index > 0) await sleep(SYNC_DETAIL_DELAY_MS);
			if (!isCurrent()) return;
			const detail = await api.getOwnAlbumDetails(album.albumId);
			const content = detail.content.filter(isRecordable);
			for (const item of content) {
				const url = item.url || item.coverUrl;
				if (url && !item.processing) urls.set(item.contentId, url);
			}
			records.push({
				albumId: album.albumId,
				albumName: detail.albumName ?? album.albumName ?? null,
				content: content.map((item) => ({ contentId: item.contentId, contentType: item.contentType ?? null })),
			});
		}
		if (!isCurrent()) return;
		await chatDb.replaceOwnAlbums(records);

		for (const contentId of await chatDb.listOwnAlbumMediaWithoutData()) {
			const url = urls.get(contentId);
			if (!url) continue;
			const fetched = await fetchAndEncode(url);
			if (!isCurrent()) return;
			if (fetched) await chatDb.setOwnAlbumMediaData(contentId, fetched.mimeType, fetched.base64);
		}
	} catch (error) {
		appLog.warn("[ownAlbums] recording own albums failed", error);
	} finally {
		syncing = false;
	}
}

function toFile(dataBase64: string, mimeType: string, name: string): File {
	// Decoded directly: the CSP's connect-src has no data:, so fetch() on a data URL fails.
	const binary = atob(dataBase64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return new File([bytes], `${name}.${mimeType.split("/")[1] ?? "bin"}`, { type: mimeType });
}

/** Uploads one restored item into `albumId`; one with nothing usable to upload is just dropped. */
async function uploadOne(
	api: ApiFunctions,
	albumId: string,
	item: chatDb.RestoredOwnAlbumMedia,
	isCurrent: () => boolean,
): Promise<void> {
	const dataBase64 = await chatDb.getRestoredOwnAlbumMediaData(item.contentId);
	if (dataBase64) {
		const isVideo = (item.contentType ?? "").startsWith("video/");
		const mimeType = item.contentType ?? (isVideo ? "video/mp4" : "image/jpeg");
		const file = toFile(dataBase64, mimeType, `album-${item.contentId}`);
		// Videos are checked Rust-side, after the cut that may shrink them.
		if (isVideo || file.size <= MAX_CHAT_MEDIA_BYTES) {
			// The api always talks to the active profile: never upload into another one.
			if (!isCurrent()) throw new Error("profile changed");
			if (isVideo) {
				await api.uploadOwnAlbumVideo({ albumId, file, isFresh: false });
			} else {
				await api.uploadOwnAlbumContent({ albumId, multipart: await buildMultipartBody(file), isFresh: false });
			}
		}
	}
	await chatDb.deleteRestoredOwnAlbumMedia(item.contentId);
}

/**
 * Creates the restored albums on this profile again, in their old order, and
 * uploads their content oldest first so each album keeps its order. Progress
 * is recorded per item (album created, item uploaded), so a run that's
 * interrupted (app closed, profile switched, too many failures) resumes on
 * the next start. Albums still on this profile (a backup of this same
 * profile) are left as they are.
 */
export async function runRestoredOwnAlbums(api: ApiFunctions, isCurrent: () => boolean): Promise<void> {
	if (restoring) return;
	restoring = true;
	try {
		let albums = await chatDb.listRestoredOwnAlbums();
		if (albums.length === 0) return;

		const existing = new Set((await api.getOwnAlbums()).map((album) => album.albumId));
		for (const album of albums) {
			if (album.uploadedAlbumId == null && existing.has(album.albumId)) await chatDb.deleteRestoredOwnAlbum(album.albumId);
			// Created by an earlier run but deleted since: nothing left to put the content in.
			if (album.uploadedAlbumId != null && !existing.has(album.uploadedAlbumId)) await chatDb.deleteRestoredOwnAlbum(album.albumId);
		}
		albums = await chatDb.listRestoredOwnAlbums();
		const total = await chatDb.countRestoredOwnAlbumItems();
		if (total === 0) {
			for (const album of albums) await chatDb.deleteRestoredOwnAlbum(album.albumId);
			return;
		}
		appLog.info("[ownAlbums] restoring own albums", { albums: albums.length, items: total });
		reportRestoreTask("own_albums", { state: "running", done: 0, total });

		let consecutiveFailures = 0;
		let done = 0;
		let first = true;
		const pause = async () => {
			if (!first) await sleep(UPLOAD_DELAY_MS + Math.random() * UPLOAD_DELAY_JITTER_MS);
			first = false;
		};
		const failed = (error: unknown, context: Record<string, unknown>): boolean => {
			appLog.warn("[ownAlbums] restore step failed", { ...context, error });
			return ++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
		};

		for (const album of albums) {
			let albumId = album.uploadedAlbumId;
			if (albumId == null) {
				await pause();
				if (!isCurrent()) return reportRestoreTask("own_albums", null);
				try {
					albumId = String((await api.createOwnAlbum({ albumName: album.albumName || "Album" })).albumId);
					await chatDb.markRestoredOwnAlbumCreated(album.albumId, albumId);
					consecutiveFailures = 0;
					done++;
					advanceRestoreTask("own_albums");
				} catch (error) {
					if (!isCurrent()) return reportRestoreTask("own_albums", null);
					// The plan's album limit: no retry gets past it, so wait for the next start.
					const limitReached = error instanceof ApiFunctionError && error.status === 402;
					if (limitReached || failed(error, { albumId: album.albumId })) {
						reportRestoreTask("own_albums", { state: "paused", done, total });
						return;
					}
					continue;
				}
			}

			for (const item of await chatDb.listRestoredOwnAlbumMedia(album.albumId)) {
				await pause();
				if (!isCurrent()) return reportRestoreTask("own_albums", null);
				try {
					await uploadOne(api, albumId, item, isCurrent);
					consecutiveFailures = 0;
					done++;
					advanceRestoreTask("own_albums");
				} catch (error) {
					if (!isCurrent()) return reportRestoreTask("own_albums", null);
					if (failed(error, { contentId: item.contentId })) {
						appLog.warn("[ownAlbums] stopping after repeated failures, resuming on next start");
						reportRestoreTask("own_albums", { state: "paused", done, total });
						return;
					}
				}
			}
			if ((await chatDb.listRestoredOwnAlbumMedia(album.albumId)).length === 0) await chatDb.deleteRestoredOwnAlbum(album.albumId);
		}

		// An item that failed once (without three failures in a row) waits for the next start.
		const left = await chatDb.countRestoredOwnAlbumItems();
		reportRestoreTask("own_albums", left > 0 ? { state: "paused", done, total } : { state: "done", done, total: done });
	} catch (error) {
		appLog.warn("[ownAlbums] restoring own albums failed", error);
		if (isCurrent()) reportRestoreTask("own_albums", null);
	} finally {
		restoring = false;
	}
}
