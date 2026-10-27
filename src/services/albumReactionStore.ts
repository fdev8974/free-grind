/**
 * albumReactionStore — which album content items the user has already
 * 🔥-reacted to, so the album viewer's reaction button can show that state
 * (like a profile's sent tap) instead of inviting a duplicate reaction.
 *
 * Seeded from the account's own persisted AlbumContentReaction messages in
 * chatDb (so reactions synced from other devices count too), plus whatever
 * gets sent this session — the album viewers outside the chat thread send
 * through the API directly, without the message landing in chatDb right away.
 */

import { useEffect, useSyncExternalStore } from "react";
import { listSentAlbumContentReactionKeys } from "./chatDb";
import { appLog } from "../utils/logger";

let loadedForUserId: number | null = null;
let reactedKeys = new Set<string>();
const listeners = new Set<() => void>();

function albumContentKey(albumId: number, contentId: number): string {
	return `${albumId}:${contentId}`;
}

function notify(): void {
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function getSnapshot(): Set<string> {
	return reactedKeys;
}

/** Re-reads the sent reactions from chatDb, keeping any sent this session. */
async function refreshSentAlbumContentReactions(userId: number): Promise<void> {
	try {
		const keys = await listSentAlbumContentReactionKeys(userId);
		// Switched accounts: drop the previous account's reactions.
		const isSameAccount = loadedForUserId === null || loadedForUserId === userId;
		loadedForUserId = userId;
		const next = new Set(isSameAccount ? reactedKeys : []);
		for (const key of keys) next.add(key);
		reactedKeys = next;
		notify();
	} catch (error) {
		appLog.warn("[album-reactions] failed to load sent reactions", error);
	}
}

export function markAlbumContentReacted(albumId: number, contentId: number): void {
	const key = albumContentKey(albumId, contentId);
	if (reactedKeys.has(key)) return;
	reactedKeys = new Set(reactedKeys).add(key);
	notify();
}

/**
 * Returns a lookup for whether an album content item was already reacted to.
 * Refreshes from chatDb whenever `active` turns on (i.e. a viewer opens).
 */
export function useAlbumContentReactions(
	userId: number | string | null | undefined,
	active = true,
): (albumId: number, contentId: number) => boolean {
	const keys = useSyncExternalStore(subscribe, getSnapshot);
	const numericUserId = userId != null ? Number(userId) : null;

	useEffect(() => {
		if (!active || numericUserId == null || !Number.isFinite(numericUserId)) return;
		void refreshSentAlbumContentReactions(numericUserId);
	}, [active, numericUserId]);

	return (albumId, contentId) => keys.has(albumContentKey(albumId, contentId));
}
