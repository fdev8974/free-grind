import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
	CheckCheck,
	ImageOff,
	ToggleRight,
} from "lucide-react";
import { CalculatorFilled, CloudSunFilled, EyeFilled, EyeOffFilled, GhostFilled, ImagesFilled, ShieldCheckFilled, StickyNoteFilled, TriangleAlertFilled, UserFilled } from "../../components/icons/FilledIcons";
import { RightNowIcon } from "../../components/icons/RightNowIcon";
import { PageHeader } from "../../components/PageHeader";
import { ToggleRow } from "../../components/ui/toggle-row";
import { SelectRow } from "../../components/ui/select-row";
import { usePreferences } from "../../contexts/PreferencesContext";
import { useSettingsHighlight } from "../../hooks/useSettingsHighlight";
import { MapVisibilitySection, RightNowExplicitImagesRow } from "./MapPrivacySettings";
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

const DISGUISE_OPTIONS: { id: AppDisguiseId; icon: typeof GhostFilled; iconClass: string; labelKey: string }[] = [
	{ id: "default", icon: GhostFilled, iconClass: "bg-[var(--accent)]/15 text-[var(--accent)]", labelKey: "privacy.app_disguise_off" },
	{ id: "calculator", icon: CalculatorFilled, iconClass: "bg-orange-500/15 text-orange-400", labelKey: "privacy.app_disguise_calculator" },
	{ id: "notes", icon: StickyNoteFilled, iconClass: "bg-amber-500/15 text-amber-400", labelKey: "privacy.app_disguise_notes" },
	{ id: "weather", icon: CloudSunFilled, iconClass: "bg-sky-500/15 text-sky-400", labelKey: "privacy.app_disguise_weather" },
];

/** Explanation under a settings group, outside its tiles so it doesn't read as a row. */
function Footnote({ children }: { children: React.ReactNode }) {
	return <p className="mt-2 px-4 text-xs leading-relaxed text-[var(--text-muted)]">{children}</p>;
}

export function SettingsPrivacyPage() {
	const { t } = useTranslation();
	const highlightId = useSettingsHighlight();
	const {
		blurIncomingMedia,
		blurGridProfilePictures,
		blurProfilePictures,
		hideProfilePictures,
		blurAlbumMedia,
		blurRightNowMedia,
		showAlbumSensitiveContentWarning,
		setPreferences,
	} = usePreferences();

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
				{/* Activity: incognito mode switches off everything below it at once,
				    the other rows control read receipts and profile views on their own. */}
				<div>
					<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">{t("privacy.activity", { defaultValue: "Activity" })}</p>
					<div className="native-group">
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
						<ToggleRow
							id="privacy-send-read-receipts"
							highlighted={highlightId === "privacy-send-read-receipts"}
							icon={<CheckCheck className="h-5 w-5" />}
							iconClass="bg-indigo-500/15 text-indigo-400"
							label={t("privacy.send_read_receipts")}
							// The Grid-unread caveat belongs to this switch, so it's part of its description.
							description={`${t("privacy.send_read_receipts_desc")} ${t("privacy.read_receipts_grid_unread_note", {
								defaultValue:
									"With read receipts off, there's no way to tell the server you've read a message — so a chat can still show up as unread on the Grid even after you've read or deleted it.",
							})}`}
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

				{/* Map visibility (account setting) */}
				<MapVisibilitySection highlightId={highlightId} />

				{/* Blur & Hide: safe-for-work mode overrides the individual blur
				    options (photos hidden, all media blurred), so they're hidden then. */}
				<div>
					<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">{t("privacy.blur_hide", { defaultValue: "Blur & Hide" })}</p>
					<div className="native-group">
						<ToggleRow
							id="privacy-safe-for-work"
							highlighted={highlightId === "privacy-safe-for-work"}
							icon={<ShieldCheckFilled className="h-5 w-5" />}
							iconClass="bg-emerald-500/15 text-emerald-400"
							label={t("privacy.safe_for_work_mode")}
							description={t("privacy.safe_for_work_mode_desc")}
							checked={hideProfilePictures}
							onChange={(checked) => void setPreferences({ hideProfilePictures: checked })}
						/>
						{!hideProfilePictures && (
							<>
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
									id="privacy-blur-profile-pictures"
									highlighted={highlightId === "privacy-blur-profile-pictures"}
									icon={<UserFilled className="h-5 w-5" />}
									iconClass="bg-sky-500/15 text-sky-400"
									label={t("privacy.blur_profile_pictures")}
									description={t("privacy.blur_profile_pictures_desc")}
									checked={blurProfilePictures}
									onChange={(checked) => void setPreferences({ blurProfilePictures: checked })}
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
									id="privacy-blur-album-media"
									highlighted={highlightId === "privacy-blur-album-media"}
									icon={<ImagesFilled className="h-5 w-5" />}
									iconClass="bg-sky-500/15 text-sky-400"
									label={t("privacy.blur_album_media")}
									description={t("privacy.blur_album_media_desc")}
									checked={blurAlbumMedia}
									onChange={(checked) => void setPreferences({ blurAlbumMedia: checked })}
								/>
								<ToggleRow
									id="privacy-blur-right-now-media"
									highlighted={highlightId === "privacy-blur-right-now-media"}
									icon={<RightNowIcon className="h-5 w-5" />}
									iconClass="bg-sky-500/15 text-sky-400"
									label={t("privacy.blur_right_now_media")}
									description={t("privacy.blur_right_now_media_desc")}
									checked={blurRightNowMedia}
									onChange={(checked) => void setPreferences({ blurRightNowMedia: checked })}
								/>
							</>
						)}
					</div>
				</div>

				{/* NSFW Content */}
				<div>
					<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">{t("privacy.nsfw_content")}</p>
					<div className="native-group">
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
						<RightNowExplicitImagesRow highlightId={highlightId} />
					</div>
				</div>

				{/* App Disguise (Android only) */}
				{disguiseSupported && (
					<div>
						<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">{t("privacy.app_disguise")}</p>
						<div className="native-group">
							{(() => {
								const current = DISGUISE_OPTIONS.find((option) => option.id === disguise) ?? DISGUISE_OPTIONS[0];
								const CurrentIcon = current.icon;
								return (
									<SelectRow<AppDisguiseId>
										id="privacy-app-disguise"
										highlighted={highlightId === "privacy-app-disguise"}
										icon={<CurrentIcon className="h-5 w-5" />}
										iconClass={current.iconClass}
										label={t("privacy.app_disguise")}
										description={t("privacy.app_disguise_desc")}
										value={disguise}
										onChange={handleSelectDisguise}
										options={DISGUISE_OPTIONS.map((option) => ({
											value: option.id,
											label: t(option.labelKey),
											icon: option.icon,
											iconClassName: option.iconClass,
										}))}
									/>
								);
							})()}
						</div>
						<Footnote>{t("privacy.app_disguise_note")}</Footnote>
					</div>
				)}
			</div>
		</section>
	);
}
