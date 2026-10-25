/**
 * ActiveRouteBridge — pushes the current React route to the native Android
 * side via `window.FreeGrindBridge.setActiveRoute(...)` so the FCM service
 * can suppress system notifications while the user is already viewing the
 * matching screen (taps tab, or the conversation that the message belongs
 * to).
 *
 * The bridge is only present in the Tauri Android WebView; on web/desktop
 * `window.FreeGrindBridge` is undefined and these calls are no-ops.
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { appLog } from "../utils/logger";
import {
	syncNotificationSettingsToNative,
	syncNotificationStringsToNative,
} from "../utils/notificationSettings";

declare global {
	interface Window {
		FreeGrindBridge?: {
			setActiveRoute?: (route: string) => void;
			postLocalNotification?: (payloadJson: string) => void;
		};
	}
}

function pushRoute(route: string | null): void {
	try {
		window.FreeGrindBridge?.setActiveRoute?.(route ?? "");
	} catch (error) {
		appLog.warn("[ActiveRouteBridge] push failed", error);
	}
}

export function ActiveRouteBridge() {
	const location = useLocation();
	const { i18n } = useTranslation();

	useEffect(() => {
		syncNotificationSettingsToNative();
	}, []);

	// Re-sync on language switch, and once a lazily loaded locale arrives.
	useEffect(() => {
		const sync = () => syncNotificationStringsToNative(i18n);
		sync();
		i18n.on("languageChanged", sync);
		i18n.on("loaded", sync);
		return () => {
			i18n.off("languageChanged", sync);
			i18n.off("loaded", sync);
		};
	}, [i18n]);

	useEffect(() => {
		const focused =
			typeof document === "undefined" ||
			(!document.hidden &&
				(typeof document.hasFocus !== "function" || document.hasFocus()));
		const route = focused ? `${location.pathname}${location.search}` : null;
		pushRoute(route);

		const onVisibility = () => {
			const f =
				!document.hidden &&
				(typeof document.hasFocus !== "function" || document.hasFocus());
			pushRoute(f ? `${location.pathname}${location.search}` : null);
		};
		document.addEventListener("visibilitychange", onVisibility);
		window.addEventListener("focus", onVisibility);
		window.addEventListener("blur", onVisibility);
		return () => {
			document.removeEventListener("visibilitychange", onVisibility);
			window.removeEventListener("focus", onVisibility);
			window.removeEventListener("blur", onVisibility);
		};
	}, [location.pathname, location.search]);

	return null;
}
