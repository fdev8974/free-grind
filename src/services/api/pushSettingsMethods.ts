import type { RestFetcher } from "../../types/chat-service";
import { assertSuccess } from "../apiHelpers";

// Server-side per-type push toggles (26.21 "Manage Notifications",
// PushSettingsRestService). Each is a boolean, or null/absent when the
// server doesn't offer that type to this account.
export type PushSettings = Partial<{
	favoritePushNotification: boolean | null;
	tapPushNotification: boolean | null;
	tappedPushNotification: boolean | null;
	mediaRecipientPushNotification: boolean | null;
	recommendedPushNotification: boolean | null;
	unreadChatsPushNotification: boolean | null;
	viewedProfilePushNotification: boolean | null;
}>;

export type PushSettingKey = keyof PushSettings;

export function createPushSettingsMethods(fetchRest: RestFetcher, t: (key: string) => string) {
	return {
		async getPushSettings(): Promise<PushSettings> {
			const response = await fetchRest("/v5/push-settings", { method: "GET" });
			await assertSuccess(response, t("notifications_page.push_settings_load_failed"));
			return response.json() as Promise<PushSettings>;
		},

		// Only the fields present in the body are updated.
		async updatePushSettings(changes: PushSettings): Promise<void> {
			const response = await fetchRest("/v5/push-settings", {
				method: "PUT",
				body: changes,
			});
			await assertSuccess(response, t("notifications_page.push_settings_save_failed"));
		},
	};
}
