import type { i18n as I18n } from "i18next";

// Shared by NotificationsPage (the settings toggles) and ChatRealtimeBridge
// (which gates the instant foreground notifications it fires from the chat
// WebSocket) — lets the user control chat and tap notifications separately,
// plus one general switch for whether either shows while the app is open
// (foreground) or only via FCM once it's backgrounded/closed.
export const CHAT_NOTIFICATIONS_ENABLED_KEY = "notif_chat_enabled";
export const TAP_NOTIFICATIONS_ENABLED_KEY = "notif_taps_enabled";
export const FOREGROUND_NOTIFICATIONS_ENABLED_KEY = "notif_foreground_enabled";

// All three default to enabled (true) — absence of a stored value, or any
// value other than the literal "false", means "on", so existing installs
// that never touched these keys keep today's always-on behavior.
function readSetting(key: string): boolean {
	return typeof window === "undefined" || localStorage.getItem(key) !== "false";
}

export function isChatNotificationsEnabled(): boolean {
	return readSetting(CHAT_NOTIFICATIONS_ENABLED_KEY);
}
export function isTapNotificationsEnabled(): boolean {
	return readSetting(TAP_NOTIFICATIONS_ENABLED_KEY);
}
export function isForegroundNotificationsEnabled(): boolean {
	return readSetting(FOREGROUND_NOTIFICATIONS_ENABLED_KEY);
}

// Android's FCM push is posted natively (FreeGrindFirebaseMessagingService /
// NotificationPoster), entirely outside this WebView's JS — so these
// preferences need mirroring into MainActivity for the background/foreground
// FCM path to honor them too, not just the instant WS-triggered path here.
// No-op outside the Android WebView.
export function syncNotificationSettingsToNative(): void {
	try {
		const payload = JSON.stringify({
			chatEnabled: isChatNotificationsEnabled(),
			tapsEnabled: isTapNotificationsEnabled(),
			foregroundEnabled: isForegroundNotificationsEnabled(),
		});
		(
			window as unknown as {
				FreeGrindBridge?: { setNotificationPreferences?: (json: string) => void };
			}
		).FreeGrindBridge?.setNotificationPreferences?.(payload);
	} catch {
		// no-op outside the Android WebView
	}
}

// Native pushes can't reach i18next either (FCM runs without the WebView), so
// the current language's push_notifications.* texts are mirrored down as
// String.format templates ({{arg1}} → %1$s) for NotificationStrings.kt to
// persist. Keys this language leaves empty are omitted, and native falls back
// to the English original. No-op outside the Android WebView.
export function syncNotificationStringsToNative(i18n: I18n): void {
	const bridge = (
		window as unknown as {
			FreeGrindBridge?: { setNotificationStrings?: (json: string) => void };
		}
	).FreeGrindBridge;
	if (!bridge?.setNotificationStrings) return;

	const language = i18n.resolvedLanguage ?? i18n.language;
	const english = i18n.getResource("en", "translation", "push_notifications") as
		| Record<string, string>
		| undefined;
	const strings: Record<string, string> = {};
	for (const key of Object.keys(english ?? {})) {
		const template = i18n.getResource(language, "translation", `push_notifications.${key}`);
		if (typeof template !== "string" || !template.trim()) continue;
		strings[key.toUpperCase()] = template
			.replace(/%/g, "%%")
			.replace(/\{\{\s*arg(\d+)\s*\}\}/g, "%$1$$s");
	}
	try {
		bridge.setNotificationStrings(JSON.stringify(strings));
	} catch {
		// no-op outside the Android WebView
	}
}
