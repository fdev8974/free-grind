import { useEffect, useState } from "react";
import { platform } from "@tauri-apps/plugin-os";
import { isTauri } from "@tauri-apps/api/core";

const DESKTOP_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

/** Android/iOS builds are always "mobile", even when driven by a mouse — e.g.
 * on Windows Subsystem for Android, where the WebView reports a fine, hovering
 * pointer and would otherwise get the desktop UI. */
const isMobilePlatform: boolean = (() => {
	if (!isTauri()) return false;
	try {
		const p = platform();
		return p === "android" || p === "ios";
	} catch {
		return false;
	}
})();

/** Snapshot of {@link useDesktopBreakpoint} for non-React code. */
export function isDesktopDevice(): boolean {
	if (isMobilePlatform || typeof window === "undefined") return false;
	return window.matchMedia(DESKTOP_POINTER_QUERY).matches;
}

/**
 * Hook to detect if the current device is a desktop (has a mouse/pointer and hover).
 * This is more reliable for scrolling behavior than screen width.
 */
export function useDesktopBreakpoint() {
	const [isDesktop, setIsDesktop] = useState(isDesktopDevice);

	useEffect(() => {
		if (isMobilePlatform || typeof window === "undefined") return;

		const query = window.matchMedia(DESKTOP_POINTER_QUERY);
		const update = () => setIsDesktop(query.matches);

		update();
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);

	return isDesktop;
}

/** Keeps `html.touch-ui` in sync with {@link isDesktopDevice} so CSS can style
 * for mobile without relying on pointer media queries alone. */
export function installTouchUiClass() {
	if (typeof window === "undefined") return;
	const update = () => document.documentElement.classList.toggle("touch-ui", !isDesktopDevice());
	update();
	if (!isMobilePlatform) {
		window.matchMedia(DESKTOP_POINTER_QUERY).addEventListener("change", update);
	}
}
