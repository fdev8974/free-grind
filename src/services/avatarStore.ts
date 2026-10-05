/**
 * avatarStore.ts — eager fetch-and-store of chat-visible avatars into chatDb.
 *
 * Originally scoped to chat only (inbox list, thread, search, shared albums)
 * — not the Grid/Browse/Profile pages, per instruction, to avoid caching
 * every photo of every profile a user casually swipes past. The profile page
 * now opts in too, but only for a profile you've actually chatted with (see
 * `cache` option below) — so archived/blocked chat partners' photos are
 * still viewable once their live profile is unreachable, without paying that
 * storage cost for ordinary Grid/Browse viewing.
 *
 * Mirrors mediaStore.ts's pattern: a synchronous in-memory cache (so render
 * code, including inside list-item loops, can resolve a cached avatar
 * without awaiting a DB read) backed by chatDb's avatars table, keyed by
 * content-addressed media hash.
 *
 * Two variants per hash, stored under separate keys: the square-cropped
 * thumb (plain `<hash>` key — chat lists, legacy rows) and the uncropped
 * full-size profile photo (`full:<hash>` key — profile page). Keying both
 * by the bare hash let whichever got cached first win, so a profile page
 * opened after the chat list showed the cropped low-res thumb.
 */

import * as chatDb from "./chatDb";
import { fetchAndEncode, toDataUri } from "./mediaStore";
import { getProfileImageUrl, getThumbImageUrl, validateMediaHash } from "../utils/media";
import { appLog } from "../utils/logger";
import { limitChatDbBlobRead } from "../utils/chatDbBlobLimiter";

const inFlight = new Map<string, Promise<void>>();
const memoryCache = new Map<string, string>();
const cacheListeners = new Set<() => void>();

function setCachedAvatarUri(mediaHash: string, uri: string): void {
	memoryCache.set(mediaHash, uri);
	for (const listener of cacheListeners) {
		listener();
	}
}

const FULL_KEY_PREFIX = "full:";

/**
 * A profile-image source URL (as opposed to a thumb URL) selects the
 * full-size variant. Full-size is always fetched at 1024x1024 regardless of
 * the requested size, so one cached copy serves every profile-page size
 * instead of a smaller one shadowing the larger.
 */
function resolveVariant(
	mediaHash: string,
	sourceUrl: string | undefined,
): { key: string; url: string; isFull: boolean } {
	if (sourceUrl?.includes("/images/profile/")) {
		return {
			key: `${FULL_KEY_PREFIX}${mediaHash}`,
			url: getProfileImageUrl(mediaHash, "1024x1024"),
			isFull: true,
		};
	}
	return { key: mediaHash, url: sourceUrl ?? getThumbImageUrl(mediaHash, "320x320"), isFull: false };
}

/** Subscribe to avatar cache updates; returns an unsubscribe function. */
export function subscribeToAvatarCache(listener: () => void): () => void {
	cacheListeners.add(listener);
	return () => {
		cacheListeners.delete(listener);
	};
}

/**
 * Fetch and store the avatar for `mediaHash` if not already cached. Safe to
 * call repeatedly (fire-and-forget, e.g. on every render) — de-duped
 * in-flight and skipped once cached. Never throws. `sourceUrl` overrides the
 * default 320x320 thumb; a profile-image URL (`/images/profile/...`) caches
 * the uncropped full-size photo under its own key instead (see file header).
 */
export async function fetchAndStoreAvatar(
	mediaHash: string | null | undefined,
	sourceUrl?: string,
): Promise<void> {
	if (!mediaHash || !validateMediaHash(mediaHash)) {
		return;
	}
	const { key, url, isFull } = resolveVariant(mediaHash, sourceUrl);
	if (memoryCache.has(key) || inFlight.has(key)) {
		return inFlight.get(key);
	}

	const run = (async () => {
		try {
			const cached = await limitChatDbBlobRead(() => chatDb.getAvatar(key));
			if (cached) {
				setCachedAvatarUri(key, toDataUri(cached.mimeType, cached.dataBase64));
				return;
			}

			const fetched = await fetchAndEncode(url);
			if (fetched) {
				await chatDb.upsertAvatar(key, fetched.base64, fetched.mimeType);
				setCachedAvatarUri(key, toDataUri(fetched.mimeType, fetched.base64));
				return;
			}

			// Full-size unreachable (e.g. blocked/offline profile): fall back
			// in memory only to whatever older copy sits under the bare hash,
			// so the photo still shows — not persisted, so a later session
			// can still pick up the real full-size version.
			if (isFull) {
				const legacy = await limitChatDbBlobRead(() => chatDb.getAvatar(mediaHash));
				if (legacy) {
					setCachedAvatarUri(key, toDataUri(legacy.mimeType, legacy.dataBase64));
				}
			}
		} catch (error) {
			appLog.warn(`[avatar-store] failed to fetch/store avatar ${key}`, error);
		} finally {
			inFlight.delete(key);
		}
	})();

	inFlight.set(key, run);
	return run;
}

/**
 * Resolves the best available avatar src: the cached local copy if present
 * (kicking off a background fetch-and-store as a side effect when it isn't,
 * unless `cache: false`), else `fallbackUrl`. Plain function, not a hook —
 * safe to call from inside list-item render loops; pair with
 * useAvatarCache() once per component so the component re-renders as
 * avatars get cached.
 *
 * Pass `cache: false` to read whatever's already cached without triggering a
 * new fetch-and-store — e.g. Grid/Browse profile photos, which stay
 * uncached by design (see file header) unless the profile happens to
 * already be cached via a chat. Pass `sourceUrl` to control what gets
 * fetched when caching is enabled (defaults to a 320x320 thumb).
 */
export function resolveAvatarSrc(
	mediaHash: string | null | undefined,
	fallbackUrl: string | null,
	options?: { cache?: boolean; sourceUrl?: string },
): string | null {
	if (!mediaHash || !validateMediaHash(mediaHash)) {
		return fallbackUrl;
	}
	if (options?.cache ?? true) {
		void fetchAndStoreAvatar(mediaHash, options?.sourceUrl);
	}
	return memoryCache.get(resolveVariant(mediaHash, options?.sourceUrl).key) ?? fallbackUrl;
}
