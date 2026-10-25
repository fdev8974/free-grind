import type { ReactNode } from "react";
import { ArrowDown, Hand, MessageCircle, MousePointerClick, Pointer, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FullscreenPrompt, fullscreenPrimaryButtonClass, fullscreenCardClass } from "../../../../components/FullscreenPrompt";
import { usePreferences } from "../../../../contexts/PreferencesContext";
import { Chip } from "../../../../components/ui/chip";
import { getTapEmoji } from "../../interest/interestUtils";

export const GRID_GESTURES_INTRO_SEEN_KEY = "fg-grid-gestures-intro-seen";

export function hasSeenGridGesturesIntro(): boolean {
	try {
		return window.localStorage.getItem(GRID_GESTURES_INTRO_SEEN_KEY) === "true";
	} catch {
		return true;
	}
}

export function markGridGesturesIntroSeen(): void {
	try {
		window.localStorage.setItem(GRID_GESTURES_INTRO_SEEN_KEY, "true");
	} catch {
		// Ignore storage write failures.
	}
}

function GestureRow({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children?: ReactNode }) {
	return (
		<div className="flex items-start gap-3 px-4 py-3.5">
			<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ink-tint-8 text-[var(--accent)]">
				{icon}
			</div>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-semibold leading-snug text-[var(--text)]">{title}</p>
				<p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">{description}</p>
				{children}
			</div>
		</div>
	);
}

// One-time intro to the grid's tile gestures, shown once the grid first has
// profiles to try them on.
export function GridGesturesIntro({ isDesktop, onConfirm }: { isDesktop: boolean; onConfirm: () => void }) {
	const { t } = useTranslation();
	const { doubleTapTapType, doubleTapAction, setPreferences } = usePreferences();
	const isDoubleTapOff = doubleTapTapType === null;
	// Off is stored as a null tap type, so picking an action restores the last/default one.
	const tapTypeForAction = doubleTapTapType ?? 1;

	return (
		<FullscreenPrompt
			overlay
			icon={Pointer}
			title={t("browse_page.gestures_intro.title", { defaultValue: "Grid Gestures" })}
			description={t("browse_page.gestures_intro.description", {
				defaultValue: "A few shortcuts to get around the grid faster.",
			})}
			footer={
				<button type="button" onClick={onConfirm} className={fullscreenPrimaryButtonClass}>
					{t("browse_page.gestures_intro.button", { defaultValue: "Got it!" })}
				</button>
			}
		>
			<div className={`${fullscreenCardClass} overflow-hidden divide-y divide-[var(--border)] text-left`}>
				<GestureRow
					icon={<Pointer className="h-5 w-5" />}
					title={isDesktop
						? t("browse_page.gestures_intro.open_title_desktop", { defaultValue: "Click" })
						: t("browse_page.gestures_intro.open_title", { defaultValue: "Tap" })}
					description={t("browse_page.gestures_intro.open_desc", { defaultValue: "Open the profile." })}
				/>
				<GestureRow
					icon={isDoubleTapOff
						? <Pointer className="h-5 w-5 opacity-50" />
						: doubleTapAction === "chat"
							? <MessageCircle className="h-5 w-5" />
							: <span className="text-xl leading-none">{getTapEmoji(tapTypeForAction)}</span>}
					title={isDesktop
						? t("browse_page.gestures_intro.double_tap_title_desktop", { defaultValue: "Double-click" })
						: t("browse_page.gestures_intro.double_tap_title", { defaultValue: "Double tap" })}
					description={isDoubleTapOff
						? t("browse_page.gestures_intro.double_tap_off_desc", {
							defaultValue: "Off. Profiles open instantly on a single tap.",
						})
						: doubleTapAction === "chat"
							? t("browse_page.gestures_intro.double_tap_chat_desc", {
								defaultValue: "Open the chat without opening the profile.",
							})
							: t("browse_page.gestures_intro.double_tap_desc", {
								defaultValue: "Send a tap without opening the profile.",
							})}
				>
					<div className="mt-2.5 flex flex-wrap gap-2">
						<Chip
							size="sm"
							selected={!isDoubleTapOff && doubleTapAction === "tap"}
							onClick={() => void setPreferences({ doubleTapTapType: tapTypeForAction, doubleTapAction: "tap" })}
						>
							{getTapEmoji(tapTypeForAction)} {t("browse_page.gestures_intro.double_tap_send_tap", { defaultValue: "Send Tap" })}
						</Chip>
						<Chip
							size="sm"
							selected={!isDoubleTapOff && doubleTapAction === "chat"}
							onClick={() => void setPreferences({ doubleTapTapType: tapTypeForAction, doubleTapAction: "chat" })}
						>
							<MessageCircle className="inline h-3.5 w-3.5 -mt-0.5" /> {t("behavior.double_tap_open_chat", { defaultValue: "Open Chat" })}
						</Chip>
						<Chip
							size="sm"
							selected={isDoubleTapOff}
							onClick={() => void setPreferences({ doubleTapTapType: null })}
						>
							{t("behavior.double_tap_off", { defaultValue: "Off" })}
						</Chip>
					</div>
				</GestureRow>
				<GestureRow
					icon={isDesktop ? <MousePointerClick className="h-5 w-5" /> : <Hand className="h-5 w-5" />}
					title={isDesktop
						? t("browse_page.gestures_intro.long_press_title_desktop", { defaultValue: "Right-click" })
						: t("browse_page.gestures_intro.long_press_title", { defaultValue: "Long press" })}
					description={t("browse_page.gestures_intro.long_press_desc", {
						defaultValue: "Quick actions: message, favorite, set a nickname, hide or block.",
					})}
				/>
				{!isDesktop && (
					<GestureRow
						icon={<ArrowDown className="h-5 w-5" />}
						title={t("browse_page.gestures_intro.pull_title", { defaultValue: "Pull down" })}
						description={t("browse_page.gestures_intro.pull_desc", { defaultValue: "Refresh the grid." })}
					/>
				)}
			</div>
			<p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-[var(--text-muted)]">
				<Settings2 className="h-3.5 w-3.5 shrink-0" />
				{t("browse_page.gestures_intro.settings_hint_change", {
					defaultValue: "You can change this and the tap type later in Settings → Behavior.",
				})}
			</p>
		</FullscreenPrompt>
	);
}
