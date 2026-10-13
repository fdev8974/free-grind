import type { ReactNode } from "react";
import { ArrowDown, Hand, MousePointerClick, Pointer, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FullscreenPrompt, fullscreenPrimaryButtonClass } from "../../../../components/FullscreenPrompt";
import { usePreferences } from "../../../../contexts/PreferencesContext";
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

function GestureRow({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
	return (
		<div className="flex items-start gap-3 px-4 py-3.5">
			<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--surface-2)] text-[var(--accent)]">
				{icon}
			</div>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-semibold leading-snug text-[var(--text)]">{title}</p>
				<p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">{description}</p>
			</div>
		</div>
	);
}

// One-time intro to the grid's tile gestures, shown once the grid first has
// profiles to try them on.
export function GridGesturesIntro({ isDesktop, onConfirm }: { isDesktop: boolean; onConfirm: () => void }) {
	const { t } = useTranslation();
	const { doubleTapTapType } = usePreferences();

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
			<div className="surface-card overflow-hidden divide-y divide-[var(--border)] text-left">
				<GestureRow
					icon={<Pointer className="h-5 w-5" />}
					title={isDesktop
						? t("browse_page.gestures_intro.open_title_desktop", { defaultValue: "Click" })
						: t("browse_page.gestures_intro.open_title", { defaultValue: "Tap" })}
					description={t("browse_page.gestures_intro.open_desc", { defaultValue: "Open the profile." })}
				/>
				{doubleTapTapType !== null && (
					<GestureRow
						icon={<span className="text-xl leading-none">{getTapEmoji(doubleTapTapType)}</span>}
						title={isDesktop
							? t("browse_page.gestures_intro.double_tap_title_desktop", { defaultValue: "Double-click" })
							: t("browse_page.gestures_intro.double_tap_title", { defaultValue: "Double tap" })}
						description={t("browse_page.gestures_intro.double_tap_desc", {
							defaultValue: "Send a tap without opening the profile.",
						})}
					/>
				)}
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
				{t("browse_page.gestures_intro.settings_hint", {
					defaultValue: "Choose the double tap type in Settings → Behavior.",
				})}
			</p>
		</FullscreenPrompt>
	);
}
