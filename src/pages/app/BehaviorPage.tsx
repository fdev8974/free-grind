import { useState } from "react";
import { ArrowDownWideNarrow, Ban, ExternalLink, MoveHorizontal, Sun, Timer, Trash2 } from "lucide-react";
import { FlameFilled, ImagesFilled, LayoutGridFilled, MapPinFilled } from "../../components/icons/FilledIcons";
import { PageHeader } from "../../components/PageHeader";
import { ToggleRow } from "../../components/ui/toggle-row";
import { RightNowIcon } from "../../components/icons/RightNowIcon";
import { SelectRow } from "../../components/ui/select-row";
import { useTranslation } from "react-i18next";
import { usePreferences } from "../../contexts/PreferencesContext";
import { useSettingsHighlight } from "../../hooks/useSettingsHighlight";
import { getTapEmoji, tapLabel } from "./interest/interestUtils";
import {
	SKIP_BLOCK_CONFIRM_KEY,
	SKIP_DELETE_CONVERSATION_CONFIRM_KEY,
	SKIP_LINK_OPEN_CONFIRM_KEY,
	isBlockConfirmSkipped,
	isDeleteConversationConfirmSkipped,
	isLinkOpenConfirmSkipped,
} from "../../utils/blockConfirm";

const ALBUM_EXPIRATION_OPTIONS = ["INDEFINITE", "ONCE", "TEN_MINUTES", "ONE_HOUR", "ONE_DAY"] as const;
const DOUBLE_TAP_TAP_TYPES = [0, 1, 2] as const;
type DoubleTapTapType = (typeof DOUBLE_TAP_TAP_TYPES)[number];
type DoubleTapChoice = "off" | "chat" | `tap-${DoubleTapTapType}`;

// Wake Lock support varies by webview, not by platform: WebView2 (Windows)
// and the Android/iOS system webviews support it, WebKitGTK (Linux desktop)
// doesn't — so gate on the actual API instead of assuming desktop vs. mobile.
const isKeepScreenOnSupported = typeof navigator !== "undefined" && "wakeLock" in navigator;

export function BehaviorPage() {
	const { t } = useTranslation();
	const highlightId = useSettingsHighlight();
	const {
		defaultExpiringPhotos,
		defaultAlbumExpirationType,
		openAlbumAsBottomSheet,
		sortDrawerMediaByFrequency,
		keepScreenOn,
		autoFocusLocationSearch,
		autoFocusRightNowText,
		doubleTapTapType,
		doubleTapAction,
		chatRowSwipeActions,
		setPreferences,
	} = usePreferences();
	const doubleTapChoice: DoubleTapChoice =
		doubleTapTapType === null ? "off" : doubleTapAction === "chat" ? "chat" : `tap-${doubleTapTapType as DoubleTapTapType}`;
	const albumExpirationLabels: Record<(typeof ALBUM_EXPIRATION_OPTIONS)[number], string> = {
		INDEFINITE: t("chat_drawer.expiry.unlimited", { defaultValue: "Unlimited" }),
		ONCE: t("chat_drawer.expiry.once", { defaultValue: "Once" }),
		TEN_MINUTES: t("chat_drawer.expiry.ten_minutes", { defaultValue: "10 minutes" }),
		ONE_HOUR: t("chat_drawer.expiry.one_hour", { defaultValue: "1 hour" }),
		ONE_DAY: t("chat_drawer.expiry.one_day", { defaultValue: "1 day" }),
	};
	const [confirmBeforeBlock, setConfirmBeforeBlock] = useState(() => !isBlockConfirmSkipped());
	const [confirmBeforeDeleteConversation, setConfirmBeforeDeleteConversation] = useState(
		() => !isDeleteConversationConfirmSkipped(),
	);
	const [confirmBeforeOpenLink, setConfirmBeforeOpenLink] = useState(() => !isLinkOpenConfirmSkipped());

	return (
		<section className="app-screen">
			<PageHeader
				backTo="/settings"
				title={t("settings.behavior")}
				subtitle={t("behavior.subtitle")}
			/>

			<div className="grid gap-6">
				<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
					<ToggleRow
						id="behavior-confirm-block"
						highlighted={highlightId === "behavior-confirm-block"}
						icon={<Ban className="h-5 w-5" />}
						iconClass="bg-red-500/15 text-red-400"
						label={t("customizability.confirm_before_block")}
						description={t("customizability.confirm_before_block_desc")}
						checked={confirmBeforeBlock}
						onChange={(checked) => {
							setConfirmBeforeBlock(checked);
							window.localStorage.setItem(SKIP_BLOCK_CONFIRM_KEY, String(!checked));
						}}
					/>
					<ToggleRow
						id="behavior-confirm-delete-conversation"
						highlighted={highlightId === "behavior-confirm-delete-conversation"}
						icon={<Trash2 className="h-5 w-5" />}
						iconClass="bg-red-500/15 text-red-400"
						label={t("customizability.confirm_before_delete_conversation")}
						description={t("customizability.confirm_before_delete_conversation_desc")}
						checked={confirmBeforeDeleteConversation}
						onChange={(checked) => {
							setConfirmBeforeDeleteConversation(checked);
							window.localStorage.setItem(SKIP_DELETE_CONVERSATION_CONFIRM_KEY, String(!checked));
						}}
					/>
					<ToggleRow
						id="behavior-confirm-open-link"
						highlighted={highlightId === "behavior-confirm-open-link"}
						icon={<ExternalLink className="h-5 w-5" />}
						iconClass="bg-red-500/15 text-red-400"
						label={t("customizability.confirm_before_open_link", { defaultValue: "Ask before opening links" })}
						description={t("customizability.confirm_before_open_link_desc", {
							defaultValue: "Show a confirmation before opening a link tapped inside a chat message.",
						})}
						checked={confirmBeforeOpenLink}
						onChange={(checked) => {
							setConfirmBeforeOpenLink(checked);
							window.localStorage.setItem(SKIP_LINK_OPEN_CONFIRM_KEY, String(!checked));
						}}
					/>
				</div>

				<div>
					<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">{t("behavior.chats")}</p>
					<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
						<ToggleRow
							id="behavior-chat-row-swipe-actions"
							highlighted={highlightId === "behavior-chat-row-swipe-actions"}
							icon={<MoveHorizontal className="h-5 w-5" />}
							iconClass="bg-sky-500/15 text-sky-400"
							label={t("behavior.chat_row_swipe_actions")}
							description={t("behavior.chat_row_swipe_actions_desc")}
							checked={chatRowSwipeActions}
							onChange={(checked) => void setPreferences({ chatRowSwipeActions: checked })}
						/>
					</div>
				</div>

				<div>
					<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">{t("behavior.disappearing_media")}</p>
					<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
						<ToggleRow
							id="behavior-default-expiring-photos"
							highlighted={highlightId === "behavior-default-expiring-photos"}
							icon={<Timer className="h-5 w-5" />}
							iconClass="bg-violet-500/15 text-violet-400"
							label={t("behavior.default_expiring_photos")}
							description={t("behavior.default_expiring_photos_desc")}
							checked={defaultExpiringPhotos}
							onChange={(checked) => void setPreferences({ defaultExpiringPhotos: checked })}
						/>
						<SelectRow
							id="behavior-default-album-expiration"
							highlighted={highlightId === "behavior-default-album-expiration"}
							icon={<ImagesFilled className="h-5 w-5" />}
							iconClass="bg-violet-500/15 text-violet-400"
							label={t("behavior.default_album_expiration")}
							description={t("behavior.default_album_expiration_desc")}
							value={defaultAlbumExpirationType}
							onChange={(option) => void setPreferences({ defaultAlbumExpirationType: option })}
							options={ALBUM_EXPIRATION_OPTIONS.map((option) => ({ value: option, label: albumExpirationLabels[option] }))}
						/>
					</div>
				</div>

				<div>
					<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">{t("behavior.album_viewing")}</p>
					<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
						<ToggleRow
							id="behavior-open-album-as-bottom-sheet"
							highlighted={highlightId === "behavior-open-album-as-bottom-sheet"}
							icon={<LayoutGridFilled className="h-5 w-5" />}
							iconClass="bg-violet-500/15 text-violet-400"
							label={t("behavior.open_album_as_bottom_sheet")}
							description={t("behavior.open_album_as_bottom_sheet_desc")}
							checked={openAlbumAsBottomSheet}
							onChange={(checked) => void setPreferences({ openAlbumAsBottomSheet: checked })}
						/>
					</div>
				</div>

				<div>
					<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">{t("behavior.media_drawer")}</p>
					<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
						<ToggleRow
							id="behavior-sort-drawer-media-by-frequency"
							highlighted={highlightId === "behavior-sort-drawer-media-by-frequency"}
							icon={<ArrowDownWideNarrow className="h-5 w-5" />}
							iconClass="bg-violet-500/15 text-violet-400"
							label={t("behavior.sort_drawer_media_by_frequency")}
							description={t("behavior.sort_drawer_media_by_frequency_desc")}
							checked={sortDrawerMediaByFrequency}
							onChange={(checked) => void setPreferences({ sortDrawerMediaByFrequency: checked })}
						/>
					</div>
				</div>

				<div>
					<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">{t("behavior.grid", { defaultValue: "Grid" })}</p>
					<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
						<SelectRow
							id="behavior-double-tap-tap-type"
							highlighted={highlightId === "behavior-double-tap-tap-type"}
							icon={<FlameFilled className="h-5 w-5" />}
							iconClass="bg-orange-500/15 text-orange-400"
							label={t("behavior.double_tap_action", { defaultValue: "Double Tap Action" })}
							description={t("behavior.double_tap_action_desc", {
								defaultValue: "Double tap a profile in the grid to send a tap or open the chat directly. Turn off to open profiles instantly on a single tap.",
							})}
							value={doubleTapChoice}
							onChange={(choice) => {
								if (choice === "off") void setPreferences({ doubleTapTapType: null });
								// Off is stored as a null tap type, so keep a tap type around while chat is picked.
								else if (choice === "chat") void setPreferences({ doubleTapTapType: doubleTapTapType ?? 1, doubleTapAction: "chat" });
								else void setPreferences({ doubleTapTapType: Number(choice.slice("tap-".length)) as DoubleTapTapType, doubleTapAction: "tap" });
							}}
							options={[
								{ value: "off", label: t("behavior.double_tap_off", { defaultValue: "Off" }) },
								...DOUBLE_TAP_TAP_TYPES.map((tapType) => ({
									value: `tap-${tapType}` as const,
									label: `${getTapEmoji(tapType)} ${tapLabel(tapType, t)}`,
								})),
								{ value: "chat", label: `💬 ${t("behavior.double_tap_open_chat", { defaultValue: "Open Chat" })}` },
							]}
						/>
					</div>
				</div>

				<div>
					<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">{t("behavior.location")}</p>
					<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
						<ToggleRow
							id="behavior-auto-focus-location-search"
							highlighted={highlightId === "behavior-auto-focus-location-search"}
							icon={<MapPinFilled className="h-5 w-5" />}
							iconClass="bg-rose-500/15 text-rose-400"
							label={t("behavior.auto_focus_location_search")}
							description={t("behavior.auto_focus_location_search_desc")}
							checked={autoFocusLocationSearch}
							onChange={(checked) => void setPreferences({ autoFocusLocationSearch: checked })}
						/>
					</div>
				</div>

				<div>
					<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">{t("right_now.title")}</p>
					<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
						<ToggleRow
							id="behavior-auto-focus-right-now-text"
							highlighted={highlightId === "behavior-auto-focus-right-now-text"}
							icon={<RightNowIcon className="h-5 w-5" />}
							iconClass="bg-[var(--right-now)]/15 text-[var(--right-now)]"
							label={t("behavior.auto_focus_right_now_text", { defaultValue: "Auto-Focus Session Text" })}
							description={t("behavior.auto_focus_right_now_text_desc", {
								defaultValue: "Automatically focus the text field and open the keyboard when starting or editing a Right Now session.",
							})}
							checked={autoFocusRightNowText}
							onChange={(checked) => void setPreferences({ autoFocusRightNowText: checked })}
						/>
					</div>
				</div>

				{isKeepScreenOnSupported && (
					<div>
						<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">{t("behavior.display")}</p>
						<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
							<ToggleRow
								id="behavior-keep-screen-on"
								highlighted={highlightId === "behavior-keep-screen-on"}
								icon={<Sun className="h-5 w-5" />}
								iconClass="bg-amber-500/15 text-amber-400"
								label={t("behavior.keep_screen_on")}
								description={t("behavior.keep_screen_on_desc")}
								checked={keepScreenOn}
								onChange={(checked) => void setPreferences({ keepScreenOn: checked })}
							/>
						</div>
					</div>
				)}
			</div>
		</section>
	);
}
