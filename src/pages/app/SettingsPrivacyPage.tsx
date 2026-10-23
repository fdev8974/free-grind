import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
	CheckCheck,
	ImageOff,
	ToggleRight,
} from "lucide-react";
import { CalculatorFilled, CloudSunFilled, EyeFilled, EyeOffFilled, GhostFilled, StickyNoteFilled, TriangleAlertFilled } from "../../components/icons/FilledIcons";
import { PageHeader } from "../../components/PageHeader";
import { ToggleRow } from "../../components/ui/toggle-row";
import { Chip } from "../../components/ui/chip";
import { usePreferences } from "../../contexts/PreferencesContext";
import { useSettingsHighlight } from "../../hooks/useSettingsHighlight";
import {
	type AppDisguiseId,
	getCurrentAppDisguise,
	isAppDisguiseSupported,
	setAppDisguise,
} from "../../utils/appDisguise";
import {
	getHideReadReceiptsGlobal,
	getIncognitoMode,
	getShowReadReceiptToggle,
	isRecordProfileViewsEnabled,
	setHideReadReceiptsGlobal,
	setIncognitoMode,
	setRecordProfileViewsEnabled,
	setShowReadReceiptToggle as persistShowReadReceiptToggle,
} from "../../utils/privacy";

const DISGUISE_OPTIONS: { id: AppDisguiseId; icon: typeof GhostFilled; labelKey: string }[] = [
	{ id: "default", icon: GhostFilled, labelKey: "privacy.app_disguise_off" },
	{ id: "calculator", icon: CalculatorFilled, labelKey: "privacy.app_disguise_calculator" },
	{ id: "notes", icon: StickyNoteFilled, labelKey: "privacy.app_disguise_notes" },
	{ id: "weather", icon: CloudSunFilled, labelKey: "privacy.app_disguise_weather" },
];

export function SettingsPrivacyPage() {
	const { t } = useTranslation();
	const highlightId = useSettingsHighlight();
	const { blurIncomingMedia, blurGridProfilePictures, showAlbumSensitiveContentWarning, setPreferences } = usePreferences();

	const [readReceiptsEnabled, setReadReceiptsEnabled] = useState(() => !getHideReadReceiptsGlobal());
	const [showReadReceiptToggle, setShowReadReceiptToggle] = useState(() => getShowReadReceiptToggle());
	const [recordProfileViews, setRecordProfileViews] = useState(() => isRecordProfileViewsEnabled());
	const [incognitoMode, setIncognitoModeState] = useState(() => getIncognitoMode());
	const [disguiseSupported] = useState(() => isAppDisguiseSupported());
	const [disguise, setDisguiseState] = useState<AppDisguiseId>(() => getCurrentAppDisguise());

	function handleSelectDisguise(id: AppDisguiseId) {
		const previous = disguise;
		setDisguiseState(id);
		if (!setAppDisguise(id)) {
			setDisguiseState(previous);
		}
	}

	return (
		<section className="app-screen">
			<PageHeader
				backTo="/settings"
				title={t("settings.privacy")}
				subtitle={t("settings.privacy_desc")}
			/>

			<div className="grid gap-6">

				{/* Incognito Mode */}
				<div>
					<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">{t("privacy.grid_visibility")}</p>
					<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
						<ToggleRow
							id="privacy-incognito-mode"
							highlighted={highlightId === "privacy-incognito-mode"}
							icon={<GhostFilled className="h-5 w-5" />}
							iconClass="bg-fuchsia-500/15 text-fuchsia-400"
							label={t("privacy.incognito_mode")}
							description={t("privacy.incognito_mode_desc")}
							checked={incognitoMode}
							onChange={(checked) => {
								setIncognitoModeState(checked);
								void setIncognitoMode(checked);
							}}
						/>
						<div className="px-4 py-3">
							<p className="text-xs text-[var(--text-muted)] leading-relaxed">
								{t("privacy.incognito_mode_note")}
							</p>
						</div>
					</div>
				</div>

				{/* Read Receipts */}
				<div>
					<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">{t("privacy.read_receipts")}</p>
					<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
						<ToggleRow
							id="privacy-send-read-receipts"
							highlighted={highlightId === "privacy-send-read-receipts"}
							icon={<CheckCheck className="h-5 w-5" />}
							iconClass="bg-indigo-500/15 text-indigo-400"
							label={t("privacy.send_read_receipts")}
							description={t("privacy.send_read_receipts_desc")}
							checked={readReceiptsEnabled}
							onChange={(checked) => {
								setReadReceiptsEnabled(checked);
								void setHideReadReceiptsGlobal(!checked);
							}}
						/>
						<ToggleRow
							id="privacy-per-chat-overrides"
							highlighted={highlightId === "privacy-per-chat-overrides"}
							icon={<ToggleRight className="h-5 w-5" />}
							iconClass="bg-blue-500/15 text-blue-400"
							label={t("privacy.per_chat_overrides")}
							description={t("privacy.per_chat_overrides_desc")}
							checked={showReadReceiptToggle}
							onChange={(checked) => {
								setShowReadReceiptToggle(checked);
								void persistShowReadReceiptToggle(checked);
							}}
						/>
						<div className="px-4 py-3">
							<p className="text-xs text-[var(--text-muted)] leading-relaxed">
								{t("privacy.read_receipts_grid_unread_note", {
									defaultValue:
										"With read receipts off, there's no way to tell the server you've read a message — so a chat can still show up as unread on the Grid even after you've read or deleted it.",
								})}
							</p>
						</div>
					</div>
				</div>

				{/* Profile Views */}
				<div>
					<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">{t("privacy.profile_views")}</p>
					<div className="surface-card overflow-hidden">
						<ToggleRow
							id="privacy-record-profile-views"
							highlighted={highlightId === "privacy-record-profile-views"}
							icon={<EyeFilled className="h-5 w-5" />}
							iconClass="bg-amber-500/15 text-amber-400"
							label={t("privacy.record_profile_views")}
							description={t("privacy.record_profile_views_desc")}
							checked={recordProfileViews}
							onChange={(checked) => {
								setRecordProfileViews(checked);
								void setRecordProfileViewsEnabled(checked);
							}}
						/>
					</div>
				</div>

				{/* NSFW Content */}
				<div>
					<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">{t("privacy.nsfw_content")}</p>
					<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
						<ToggleRow
							id="privacy-blur-incoming-media"
							highlighted={highlightId === "privacy-blur-incoming-media"}
							icon={<ImageOff className="h-5 w-5" />}
							iconClass="bg-sky-500/15 text-sky-400"
							label={t("customizability.blur_incoming_media")}
							description={t("customizability.blur_incoming_media_description")}
							checked={blurIncomingMedia}
							onChange={(checked) => void setPreferences({ blurIncomingMedia: checked })}
						/>
						<ToggleRow
							id="privacy-blur-grid-profile-pictures"
							highlighted={highlightId === "privacy-blur-grid-profile-pictures"}
							icon={<EyeOffFilled className="h-5 w-5" />}
							iconClass="bg-sky-500/15 text-sky-400"
							label={t("privacy.blur_grid_profile_pictures")}
							description={t("privacy.blur_grid_profile_pictures_desc")}
							checked={blurGridProfilePictures}
							onChange={(checked) => void setPreferences({ blurGridProfilePictures: checked })}
						/>
						<ToggleRow
							id="privacy-sensitive-warning"
							highlighted={highlightId === "privacy-sensitive-warning"}
							icon={<TriangleAlertFilled className="h-5 w-5" />}
							iconClass="bg-orange-500/15 text-orange-400"
							label={t("privacy.show_sensitive_content_warning")}
							description={t("privacy.show_sensitive_content_warning_desc")}
							checked={showAlbumSensitiveContentWarning}
							onChange={(checked) => void setPreferences({ showAlbumSensitiveContentWarning: checked })}
						/>
					</div>
				</div>

				{/* App Disguise (Android only) */}
				{disguiseSupported && (
					<div>
						<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">{t("privacy.app_disguise")}</p>
						<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
							<div className="p-4">
								<p className="text-sm font-semibold leading-snug">{t("privacy.app_disguise")}</p>
								<p className="mt-0.5 text-xs text-[var(--text-muted)] leading-relaxed">{t("privacy.app_disguise_desc")}</p>
								<div className="mt-3 flex flex-wrap gap-2">
									{DISGUISE_OPTIONS.map(({ id, icon: Icon, labelKey }) => (
										<Chip
											key={id}
											size="sm"
											selected={disguise === id}
											onClick={() => handleSelectDisguise(id)}
											className="inline-flex items-center gap-1.5"
										>
											<Icon className="h-3.5 w-3.5" />
											{t(labelKey)}
										</Chip>
									))}
								</div>
							</div>
							<div className="px-4 py-3">
								<p className="text-xs text-[var(--text-muted)] leading-relaxed">
									{t("privacy.app_disguise_note")}
								</p>
							</div>
						</div>
					</div>
				)}
			</div>
		</section>
	);
}
