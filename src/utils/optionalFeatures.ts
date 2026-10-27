/**
 * Optional features the user can switch on/off under Customizability →
 * Optional Features. Consumers read these once at mount — fine because none of
 * them stay mounted while the Optional Features page is open, so they pick up
 * the new value on the next mount. A component that stays mounted across
 * routes would need a change event instead.
 */

export const SHOW_VIDEO_GALLERY_KEY = "fg-show-video-gallery";
export const SHOW_SEXUAL_HEALTH_KEY = "fg-show-sexual-health";
export const SHOW_LOCATE_KEY = "fg-show-locate";

function readFlag(key: string): string | null {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

/** Video gallery button in the inbox header — off unless explicitly enabled. */
export function isVideoGalleryEnabled(): boolean {
	return readFlag(SHOW_VIDEO_GALLERY_KEY) === "true";
}

/** Sexual health section and its entry points — on unless explicitly disabled. */
export function isSexualHealthEnabled(): boolean {
	return readFlag(SHOW_SEXUAL_HEALTH_KEY) !== "false";
}

/** "Locate" (position triangulation) in the profile menu — off unless explicitly enabled. */
export function isLocateEnabled(): boolean {
	return readFlag(SHOW_LOCATE_KEY) === "true";
}

export function setOptionalFeatureEnabled(key: string, enabled: boolean): void {
	try {
		window.localStorage.setItem(key, String(enabled));
	} catch {
		// Storage unavailable — the toggle just won't persist.
	}
}
