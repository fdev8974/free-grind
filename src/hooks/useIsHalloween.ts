import { useEffect, useState } from "react";
import { getActiveSeason, useIsSeasonalOverlayActive } from "./useSeasonalOverlay";

// Halloween theme: blood drips and spooky nav icons. Window and the dev
// on/off override live in useSeasonalOverlay.

// Set to "true" in localStorage (dev options) to hide the blood-drip overlay.
export const HIDE_HALLOWEEN_OVERLAY_KEY = "fg-hide-halloween-overlay";
export const HALLOWEEN_OVERLAY_EVENT = "fg-halloween-overlay-changed";

export function isHalloweenOverlayHidden(): boolean {
	try {
		return window.localStorage.getItem(HIDE_HALLOWEEN_OVERLAY_KEY) === "true";
	} catch {
		return false;
	}
}

export function setHalloweenOverlayHidden(hidden: boolean): void {
	try {
		if (hidden) window.localStorage.setItem(HIDE_HALLOWEEN_OVERLAY_KEY, "true");
		else window.localStorage.removeItem(HIDE_HALLOWEEN_OVERLAY_KEY);
	} catch {
		// Storage unavailable: the toggle just doesn't stick.
	}
	window.dispatchEvent(new Event(HALLOWEEN_OVERLAY_EVENT));
}

/** Whether the dev option hiding the Halloween overlay is on; follows the toggle live. */
export function useIsHalloweenOverlayHidden(): boolean {
	const [hidden, setHidden] = useState(isHalloweenOverlayHidden);
	useEffect(() => {
		const onChange = () => setHidden(isHalloweenOverlayHidden());
		window.addEventListener(HALLOWEEN_OVERLAY_EVENT, onChange);
		return () => window.removeEventListener(HALLOWEEN_OVERLAY_EVENT, onChange);
	}, []);
	return hidden;
}

export function isHalloween(now = Date.now()): boolean {
	return getActiveSeason(now) === "halloween";
}

/** Whether the Halloween theme is active. Re-renders when the window opens or closes. */
export function useIsHalloween(): boolean {
	return useIsSeasonalOverlayActive("halloween");
}
