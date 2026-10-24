/**
 * Demo mode for screenshots: every profile photo (grid, chats, profiles,
 * interest, ...) is replaced by one of the bundled pictures in
 * src/images/demo-profiles/, so screenshots for the docs or stores don't show
 * real people. The same media hash always maps to the same picture.
 *
 * Read synchronously by the URL helpers in media.ts, mediaProxy.ts and
 * avatarStore.ts, which run outside React; toggling reloads the app so
 * nothing rendered or cached under the other mode lingers.
 */

const STORAGE_KEY = "fg-demo-profile-images";

const pictures = Object.entries(
	import.meta.glob<string>("../images/demo-profiles/*.{jpg,jpeg,png,webp,avif}", {
		eager: true,
		query: "?url",
		import: "default",
	}),
)
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([, url]) => url);

const enabled = (() => {
	try {
		return pictures.length > 0 && window.localStorage.getItem(STORAGE_KEY) === "1";
	} catch {
		return false;
	}
})();

/** Whether demo pictures replace profile photos in this session. */
export function isDemoProfileImagesEnabled(): boolean {
	return enabled;
}

/** Whether there are any bundled demo pictures to switch to. */
export function hasDemoProfileImages(): boolean {
	return pictures.length > 0;
}

export function setDemoProfileImagesEnabled(value: boolean): void {
	try {
		if (value) window.localStorage.setItem(STORAGE_KEY, "1");
		else window.localStorage.removeItem(STORAGE_KEY);
	} catch {
		return;
	}
	window.location.reload();
}

/** The demo picture standing in for `mediaHash` (FNV-1a, so it's stable). */
export function demoProfileImageFor(mediaHash: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < mediaHash.length; i++) {
		hash ^= mediaHash.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return pictures[(hash >>> 0) % pictures.length];
}

const PROFILE_PHOTO_PATH = /^https:\/\/cdns\.grindr\.com\/images\/(?:profile|thumb)\/[^/]+\/([a-f0-9]+)(?:[?#].*)?$/i;

/** A demo picture for a Grindr profile-photo URL, or null for anything else. */
export function demoProfileImageForUrl(url: string): string | null {
	if (!enabled) return null;
	const match = PROFILE_PHOTO_PATH.exec(url);
	return match ? demoProfileImageFor(match[1].toLowerCase()) : null;
}
