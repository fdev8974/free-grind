import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
	BellFilled,
	EyeFilled,
	FlameFilled,
	HeartFilled,
	ImagesFilled,
	MailFilled,
	MessageCircleFilled,
	SparklesFilled,
} from "../../components/icons/FilledIcons";
import { PageHeader } from "../../components/PageHeader";
import { ToggleRow } from "../../components/ui/toggle-row";
import { useTranslation } from "react-i18next";
import { useSettingsHighlight } from "../../hooks/useSettingsHighlight";
import { useApiFunctions } from "../../hooks/useApiFunctions";
import type { PushSettingKey, PushSettings } from "../../services/api/pushSettingsMethods";
import { appLog } from "../../utils/logger";
import {
	CHAT_NOTIFICATIONS_ENABLED_KEY,
	FOREGROUND_NOTIFICATIONS_ENABLED_KEY,
	TAP_NOTIFICATIONS_ENABLED_KEY,
	isChatNotificationsEnabled,
	isForegroundNotificationsEnabled,
	isTapNotificationsEnabled,
	syncNotificationSettingsToNative,
} from "../../utils/notificationSettings";

// Server-side toggles, in the 26.21 app's order. tapPushNotification isn't in
// 26.21's model (only opengrind's docs), so it's shown only when the server
// actually returns it.
const PUSH_SETTING_ROWS: Array<{
	key: PushSettingKey;
	id: string;
	icon: React.ReactNode;
	iconClass: string;
	optional?: boolean;
}> = [
	{ key: "favoritePushNotification", id: "notif-favorite-online", icon: <HeartFilled className="h-5 w-5" />, iconClass: "bg-yellow-500/15 text-yellow-400" },
	{ key: "mediaRecipientPushNotification", id: "notif-media-recipient-online", icon: <ImagesFilled className="h-5 w-5" />, iconClass: "bg-purple-500/15 text-purple-400" },
	{ key: "tappedPushNotification", id: "notif-tapped-online", icon: <FlameFilled className="h-5 w-5" />, iconClass: "bg-orange-500/15 text-orange-400" },
	{ key: "recommendedPushNotification", id: "notif-recommended-online", icon: <SparklesFilled className="h-5 w-5" />, iconClass: "bg-pink-500/15 text-pink-400" },
	{ key: "unreadChatsPushNotification", id: "notif-unread-chats", icon: <MailFilled className="h-5 w-5" />, iconClass: "bg-blue-500/15 text-blue-400" },
	{ key: "viewedProfilePushNotification", id: "notif-viewed-profile", icon: <EyeFilled className="h-5 w-5" />, iconClass: "bg-emerald-500/15 text-emerald-400" },
	{ key: "tapPushNotification", id: "notif-server-taps", icon: <FlameFilled className="h-5 w-5" />, iconClass: "bg-red-500/15 text-red-400", optional: true },
];

export function NotificationsPage() {
	const { t } = useTranslation();
	const highlightId = useSettingsHighlight();
	const [chatEnabled, setChatEnabled] = useState(() => isChatNotificationsEnabled());
	const [tapsEnabled, setTapsEnabled] = useState(() => isTapNotificationsEnabled());
	const [foregroundEnabled, setForegroundEnabled] = useState(() => isForegroundNotificationsEnabled());

	const apiFunctions = useApiFunctions();
	// null = still loading (or failed — the section then stays hidden).
	const [pushSettings, setPushSettings] = useState<PushSettings | null>(null);
	const [pushSettingsFailed, setPushSettingsFailed] = useState(false);

	useEffect(() => {
		let cancelled = false;
		apiFunctions
			.getPushSettings()
			.then((settings) => {
				if (!cancelled) setPushSettings(settings);
			})
			.catch((error) => {
				appLog.warn("[notifications] loading push settings failed", error);
				if (!cancelled) setPushSettingsFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, [apiFunctions]);

	const setPushSetting = (key: PushSettingKey, value: boolean) => {
		const previous = pushSettings?.[key] ?? null;
		setPushSettings((current) => ({ ...current, [key]: value }));
		apiFunctions.updatePushSettings({ [key]: value }).catch((error) => {
			appLog.warn("[notifications] updating push setting failed", key, error);
			setPushSettings((current) => ({ ...current, [key]: previous }));
			toast.error(t("notifications_page.push_settings_save_failed"));
		});
	};

	const setFlag = (key: string, value: boolean) => {
		window.localStorage.setItem(key, String(value));
		syncNotificationSettingsToNative();
	};

	return (
		<section className="app-screen">
			<PageHeader
				backTo="/settings"
				title={t("settings.notifications")}
				subtitle={t("notifications_page.subtitle")}
			/>

			<div className="grid gap-6">
				<div className="native-group">
					<ToggleRow
						id="notif-chat-enabled"
						highlighted={highlightId === "notif-chat-enabled"}
						icon={<MessageCircleFilled className="h-5 w-5" />}
						iconClass="bg-blue-500/15 text-blue-400"
						label={t("notifications_page.chat_enabled")}
						description={t("notifications_page.chat_enabled_desc")}
						checked={chatEnabled}
						onChange={(checked) => {
							setChatEnabled(checked);
							setFlag(CHAT_NOTIFICATIONS_ENABLED_KEY, checked);
						}}
					/>
					<ToggleRow
						id="notif-taps-enabled"
						highlighted={highlightId === "notif-taps-enabled"}
						icon={<FlameFilled className="h-5 w-5" />}
						iconClass="bg-orange-500/15 text-orange-400"
						label={t("notifications_page.taps_enabled")}
						description={t("notifications_page.taps_enabled_desc")}
						checked={tapsEnabled}
						onChange={(checked) => {
							setTapsEnabled(checked);
							setFlag(TAP_NOTIFICATIONS_ENABLED_KEY, checked);
						}}
					/>
					<ToggleRow
						id="notif-foreground"
						highlighted={highlightId === "notif-foreground"}
						icon={<BellFilled className="h-5 w-5" />}
						iconClass="bg-slate-500/15 text-slate-400"
						label={t("notifications_page.foreground")}
						description={t("notifications_page.foreground_desc")}
						checked={foregroundEnabled}
						onChange={(checked) => {
							setForegroundEnabled(checked);
							setFlag(FOREGROUND_NOTIFICATIONS_ENABLED_KEY, checked);
						}}
					/>
				</div>

				{!pushSettingsFailed && (
					<div>
						<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
							{t("notifications_page.activity_section")}
						</p>
						<div className="native-group">
							{pushSettings === null ? (
								<p className="px-4 py-3.5 text-sm text-[var(--text-muted)]">
									{t("notifications_page.push_settings_loading")}
								</p>
							) : (
								PUSH_SETTING_ROWS.filter(
									(row) => !row.optional || typeof pushSettings[row.key] === "boolean",
								).map((row) => (
									<ToggleRow
										key={row.key}
										id={row.id}
										highlighted={highlightId === row.id}
										icon={row.icon}
										iconClass={row.iconClass}
										label={t(`notifications_page.push_settings.${row.key}`)}
										description={t(`notifications_page.push_settings.${row.key}_desc`)}
										checked={pushSettings[row.key] === true}
										onChange={(checked) => setPushSetting(row.key, checked)}
									/>
								))
							)}
						</div>
					</div>
				)}
			</div>
		</section>
	);
}
