/**
 * Drawer media from a backup of another profile: the drawer lives on the
 * server, so the old profile's media isn't in this profile's drawer. Import
 * (src-tauri/src/commands/backup.rs) parks its cached files under
 * RESTORED_DRAWER_KEY_PREFIX instead of "drawer:", where the stale-drawer
 * purge leaves them alone, and runRestoredDrawerUpload then re-uploads them
 * to this profile's drawer in the background. Until then the drawer shows
 * them as restoring, not selectable.
 *
 * Deliberately slow and sequential, like inboxSync.ts: one upload at a time
 * with a pause in between, so a few hundred files don't hit Grindr at once.
 */

import type { createApiFunctions } from "./apiFunctions";
import * as chatDb from "./chatDb";
import { uploadChatVideo } from "./chatMediaSend";
import { getDrawerMediaKey, moveCachedMediaUri } from "./mediaStore";
import { advanceRestoreTask, reportRestoreTask, stoppableRestoreTask } from "./restoreStatus";
import { MAX_CHAT_MEDIA_BYTES } from "./stagedVideoUpload";
import { buildBinaryUpload } from "../pages/app/chat/chatUtils";
import { appLog } from "../utils/logger";

type ApiFunctions = ReturnType<typeof createApiFunctions>;

export const RESTORED_DRAWER_KEY_PREFIX = "restored-drawer:";
const UPLOAD_DELAY_MS = 8_000;
const UPLOAD_DELAY_JITTER_MS = 4_000;
/** Likely rate limiting or no connection: stop and pick up again on the next app start. */
const MAX_CONSECUTIVE_FAILURES = 3;

export type RestoredDrawerMedia = { mediaKey: string; isVideo: boolean };

/** One restored item done: uploaded under its new drawer id, or dropped (`uploaded` null). */
export type RestoredDrawerMediaUpdate = {
	mediaKey: string;
	uploaded: { mediaId: number; contentType: string } | null;
};

const listeners = new Set<(update: RestoredDrawerMediaUpdate) => void>();
let running = false;

/** Fires whenever a restored item got uploaded (or dropped), so the drawer can swap its tile in place. */
export function subscribeToRestoredDrawerMedia(listener: (update: RestoredDrawerMediaUpdate) => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function notify(update: RestoredDrawerMediaUpdate): void {
	for (const listener of listeners) listener(update);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function oldMediaId(mediaKey: string): number {
	return Number(mediaKey.slice(RESTORED_DRAWER_KEY_PREFIX.length));
}

/** The restored drawer media still waiting for upload, oldest drawer id first. */
export async function listRestoredDrawerMedia(): Promise<RestoredDrawerMedia[]> {
	const files = await chatDb.listMediaFilesWithPrefix(RESTORED_DRAWER_KEY_PREFIX);
	return files
		.map(({ mediaKey, kind }) => ({ mediaKey, isVideo: kind === "video" }))
		.sort((a, b) => oldMediaId(a.mediaKey) - oldMediaId(b.mediaKey));
}

/** Drops every restored drawer file still waiting for upload; the drawer removes their tiles. */
export async function discardRestoredDrawerMedia(): Promise<void> {
	for (const { mediaKey } of await listRestoredDrawerMedia()) {
		await chatDb.deleteMediaFile(mediaKey);
		notify({ mediaKey, uploaded: null });
	}
}

/** A file with nothing usable to upload is dropped instead (resolves to null). */
async function uploadOne(api: ApiFunctions, mediaKey: string, isCurrent: () => boolean): Promise<RestoredDrawerMediaUpdate["uploaded"]> {
	const stored = await chatDb.getMediaFile(mediaKey);
	if (!stored?.dataBase64 || stored.fetchStatus !== "ok") {
		await chatDb.deleteMediaFile(mediaKey);
		return null;
	}
	const isVideo = stored.kind === "video";
	const mimeType = stored.mimeType ?? (isVideo ? "video/mp4" : "image/jpeg");
	// Decoded directly: the CSP's connect-src has no data:, so fetch() on a data URL fails.
	const binary = atob(stored.dataBase64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	const blob = new Blob([bytes], { type: mimeType });
	const oldId = oldMediaId(mediaKey);
	const file = new File([blob], `drawer-${oldId}.${mimeType.split("/")[1] ?? "bin"}`, { type: mimeType });
	// Videos are checked Rust-side, after the cut that may shrink them.
	if (!isVideo && file.size > MAX_CHAT_MEDIA_BYTES) {
		await chatDb.deleteMediaFile(mediaKey);
		return null;
	}
	// The api always talks to the active profile: never upload into another one.
	if (!isCurrent()) throw new Error("profile changed");

	const uploaded = isVideo
		? await uploadChatVideo(api, file, false)
		: await api.uploadChatMedia({
				multipart: await buildBinaryUpload(file),
				options: { looping: false, takenOnGrindr: false },
			});
	await api.addMediaToDrawer(uploaded.mediaId);
	// Both per file, so an interrupted run leaves nothing pointing at a stale id.
	await chatDb.renameMediaFile(mediaKey, getDrawerMediaKey(uploaded.mediaId));
	await chatDb.remapDrawerCollectionMediaIds(new Map([[oldId, uploaded.mediaId]]));
	// The tile keeps showing the local copy under its new key, no reload needed.
	moveCachedMediaUri(mediaKey, getDrawerMediaKey(uploaded.mediaId));
	return { mediaId: uploaded.mediaId, contentType: mimeType };
}

/**
 * Uploads the restored drawer media to this profile's drawer, oldest first so
 * the drawer keeps its order. Each uploaded file moves to its new "drawer:" key
 * and collections are pointed at its new id, so a run that's interrupted (app
 * closed, profile switched, too many failures) resumes on the next start.
 */
export async function runRestoredDrawerUpload(api: ApiFunctions, isCurrentProfile: () => boolean): Promise<void> {
	if (running) return;
	running = true;
	const isCurrent = stoppableRestoreTask("drawer_media", isCurrentProfile);
	try {
		const pending = await listRestoredDrawerMedia();
		if (pending.length === 0) return;
		appLog.info("[restoredDrawerMedia] uploading restored drawer media", { count: pending.length });
		reportRestoreTask("drawer_media", { state: "running", done: 0, total: pending.length });

		let consecutiveFailures = 0;
		let done = 0;
		for (const { mediaKey } of pending) {
			await sleep(UPLOAD_DELAY_MS + Math.random() * UPLOAD_DELAY_JITTER_MS);
			if (!isCurrent()) return reportRestoreTask("drawer_media", null);
			let uploaded: RestoredDrawerMediaUpdate["uploaded"];
			try {
				uploaded = await uploadOne(api, mediaKey, isCurrent);
				consecutiveFailures = 0;
			} catch (error) {
				if (!isCurrent()) return reportRestoreTask("drawer_media", null);
				appLog.warn("[restoredDrawerMedia] upload failed", { mediaKey, error });
				if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
					appLog.warn("[restoredDrawerMedia] stopping after repeated failures, resuming on next start");
					reportRestoreTask("drawer_media", { state: "paused", done, total: pending.length });
					return;
				}
				continue;
			}
			done++;
			advanceRestoreTask("drawer_media");
			notify({ mediaKey, uploaded });
		}
		// A file that failed once (without three failures in a row) waits for the next start.
		const left = (await listRestoredDrawerMedia()).length;
		reportRestoreTask("drawer_media", left > 0 ? { state: "paused", done, total: pending.length } : { state: "done", done, total: done });
	} finally {
		running = false;
	}
}
