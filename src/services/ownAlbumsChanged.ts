/**
 * What the api layer learns about the profile's own albums, for ownAlbums.ts
 * to record them for the backup:
 *
 * - notifyOwnAlbumsChanged: they changed on the server (content uploaded or
 *   deleted, album created, renamed, reordered or deleted).
 * - rememberOwnAlbumList / rememberOwnAlbumDetail: the album list or an
 *   album's details the app just read anyway (album editor, drawer), so a
 *   recording soon after reuses them instead of reading them again.
 *
 * Kept apart from ownAlbums.ts so the api layer can call it without importing
 * that module.
 */

import type { Album, AlbumDetail } from "../types/albums";

/** How long something read stays good enough to record without reading it again. */
const SEEN_FRESH_MS = 5 * 60 * 1000;

type Listener = () => void;

const listeners = new Set<Listener>();
let seenList: { at: number; albums: Album[] } | null = null;
const seenDetails = new Map<string, { at: number; detail: AlbumDetail }>();

export function notifyOwnAlbumsChanged(): void {
	// Whatever was read before the change may no longer be what's there.
	seenList = null;
	seenDetails.clear();
	for (const listener of listeners) {
		try {
			listener();
		} catch {
			// A listener's failure must never fail the album call that succeeded.
		}
	}
}

/** Returns an unsubscribe function. */
export function onOwnAlbumsChanged(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function rememberOwnAlbumList(albums: Album[]): void {
	seenList = { at: Date.now(), albums };
}

export function rememberOwnAlbumDetail(albumId: string | number, detail: AlbumDetail): void {
	seenDetails.set(String(albumId), { at: Date.now(), detail });
}

export function freshOwnAlbumList(): Album[] | null {
	return seenList && Date.now() - seenList.at < SEEN_FRESH_MS ? seenList.albums : null;
}

export function freshOwnAlbumDetail(albumId: string | number): AlbumDetail | null {
	const seen = seenDetails.get(String(albumId));
	return seen && Date.now() - seen.at < SEEN_FRESH_MS ? seen.detail : null;
}

/** On a profile switch: nothing read for the previous profile may be recorded for the next. */
export function forgetSeenOwnAlbums(): void {
	seenList = null;
	seenDetails.clear();
}
