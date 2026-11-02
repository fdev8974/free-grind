/**
 * videoPosterStore.ts — first-frame stills of videos shown as previews
 * (chat bubbles, reply quotes, drawer tiles, ...).
 *
 * A preview without a still has to load and decode the whole video (usually
 * a base64 data: URI out of media_files) just to seek to its first frame.
 * The preview captures that frame once, it's stored in chatDb's
 * media_posters under a stable key (the same keys media_files uses:
 * msg:<messageId>, drawer:<mediaId>, ...), and every later render shows the
 * small JPEG instead.
 *
 * Lookups requested in the same tick go to chatDb as one query; until a
 * key's lookup has finished, getVideoPoster returns undefined so the preview
 * can hold off on mounting a <video> it may not need.
 */

import * as chatDb from "./chatDb";
import { getMessageFallbackMediaKey } from "./mediaStore";
import { appLog } from "../utils/logger";

// Longest edge of a stored still — previews are far smaller than this, but
// it's also the hero image while the full-screen viewer opens.
const POSTER_MAX_EDGE = 640;
const POSTER_JPEG_QUALITY = 0.8;

// null: looked up, nothing stored (yet).
const posters = new Map<string, string | null>();
const pendingKeys = new Set<string>();
const requestedKeys = new Set<string>();
const capturedKeys = new Set<string>();
// Captures that failed this session (cross-origin source, no picture) — a
// preview waiting on someone else's capture stops waiting for these.
const uncapturableKeys = new Set<string>();
const listeners = new Set<() => void>();
let flushScheduled = false;
let version = 0;

/** Poster key of a chat message's video — shared by its bubble and every reply quoting it. */
export function getMessagePosterKey(messageId: string): string {
	return getMessageFallbackMediaKey(messageId);
}

/** Bumped whenever stills land (looked up or captured) — for renders that read several keys at once. */
export function getVideoPostersVersion(): number {
	return version;
}

export function subscribeVideoPosters(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * The stored still for `posterKey`: its data: URI, null when there is none
 * (yet), or undefined while its lookup hasn't finished (see requestVideoPoster).
 */
export function getVideoPoster(posterKey: string): string | null | undefined {
	return posters.get(posterKey);
}

function flush(): void {
	flushScheduled = false;
	const keys = [...pendingKeys];
	pendingKeys.clear();
	void chatDb
		.getMediaPosters(keys)
		.then((stored) => {
			for (const key of keys) {
				// A capture may have landed while the lookup was in flight.
				if (!posters.get(key)) posters.set(key, stored.get(key) ?? null);
			}
		})
		.catch((error) => {
			appLog.warn("[video-poster] failed to load posters", error);
			for (const key of keys) if (!posters.has(key)) posters.set(key, null);
		})
		.finally(notify);
}

function notify(): void {
	version++;
	for (const listener of listeners) listener();
}

export function isVideoPosterUncapturable(posterKey: string): boolean {
	return uncapturableKeys.has(posterKey);
}

/** Starts looking up `posterKey` in chatDb, batched with the other keys requested this tick. */
export function requestVideoPoster(posterKey: string): void {
	if (requestedKeys.has(posterKey)) return;
	requestedKeys.add(posterKey);
	pendingKeys.add(posterKey);
	if (!flushScheduled) {
		flushScheduled = true;
		queueMicrotask(flush);
	}
}

/**
 * Captures the frame `video` currently shows (call once it has seeked to the
 * first frame) and stores it under `posterKey`. Skipped once captured, and
 * silently when the frame can't be read back (cross-origin source).
 */
export function captureVideoPoster(posterKey: string, conversationId: string | null, video: HTMLVideoElement): void {
	if (posters.get(posterKey) || capturedKeys.has(posterKey)) return;
	const { videoWidth, videoHeight } = video;
	capturedKeys.add(posterKey);
	const fail = () => {
		uncapturableKeys.add(posterKey);
		notify();
	};
	if (!videoWidth || !videoHeight) {
		fail();
		return;
	}
	let dataUri: string;
	try {
		const scale = Math.min(1, POSTER_MAX_EDGE / Math.max(videoWidth, videoHeight));
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(videoWidth * scale);
		canvas.height = Math.round(videoHeight * scale);
		const context = canvas.getContext("2d");
		if (!context) {
			fail();
			return;
		}
		context.drawImage(video, 0, 0, canvas.width, canvas.height);
		dataUri = canvas.toDataURL("image/jpeg", POSTER_JPEG_QUALITY);
	} catch {
		// Tainted canvas — this source can't be read back.
		fail();
		return;
	}
	if (!dataUri.startsWith("data:image/jpeg")) {
		fail();
		return;
	}
	// The preview that captured it keeps showing its <video> (see
	// VideoFirstFrame); others of the same key waiting on it switch to the still.
	posters.set(posterKey, dataUri);
	notify();
	void chatDb.upsertMediaPoster(posterKey, conversationId, dataUri).catch((error) => {
		appLog.warn("[video-poster] failed to store poster", error);
	});
}
