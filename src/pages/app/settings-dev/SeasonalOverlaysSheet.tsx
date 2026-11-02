import { ChristmasTreeFilled, EyeOffFilled, HeartFilled, PumpkinFilled } from "../../../components/icons/FilledIcons";
import { BottomSheet } from "../../../components/ui/bottom-sheet";
import { NATIVE_SHEET_BG } from "../../../components/ui/action-sheet";
import { SHEET_GROUP_CLASS, SheetSegmented } from "../../../components/ui/sheet-section";
import { ToggleRow } from "../../../components/ui/toggle-row";
import { useDesktopBreakpoint } from "../../../hooks/useDesktopBreakpoint";
import { setHalloweenOverlayHidden, useIsHalloweenOverlayHidden } from "../../../hooks/useIsHalloween";
import {
	SEASONAL_OVERLAYS,
	setSeasonalOverlayMode,
	useIsSeasonalOverlayActive,
	useSeasonalOverlayMode,
	type SeasonalOverlayId,
	type SeasonalOverlayMode,
} from "../../../hooks/useSeasonalOverlay";
import { cn } from "../../../utils/cn";
import { DrawerHeader } from "../chat/drawerUi";

const MODE_OPTIONS: { value: SeasonalOverlayMode; label: string }[] = [
	{ value: "auto", label: "Auto" },
	{ value: "on", label: "On" },
	{ value: "off", label: "Off" },
];

const SEASON_ICONS: Record<SeasonalOverlayId, { icon: typeof PumpkinFilled; className: string }> = {
	halloween: { icon: PumpkinFilled, className: "bg-orange-500/15 text-orange-400" },
	christmas: { icon: ChristmasTreeFilled, className: "bg-emerald-500/15 text-emerald-400" },
	valentines: { icon: HeartFilled, className: "bg-rose-500/15 text-rose-400" },
};

const WINDOW_FORMAT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

function formatWindow(start: number, end: number): string {
	return `${new Date(start).toLocaleString(undefined, WINDOW_FORMAT)} – ${new Date(end).toLocaleString(undefined, WINDOW_FORMAT)}`;
}

/** A season's row: name, window and live status, plus the Auto/On/Off switch. */
function SeasonRow({ id }: { id: SeasonalOverlayId }) {
	const season = SEASONAL_OVERLAYS[id];
	const mode = useSeasonalOverlayMode(id);
	const isActive = useIsSeasonalOverlayActive(id);
	const { icon: Icon, className: iconClassName } = SEASON_ICONS[id];

	return (
		<div className="flex items-center gap-3 px-4 py-3.5">
			<div className={cn("shrink-0 rounded-2xl p-2.5", iconClassName)}>
				<Icon className="h-5 w-5" />
			</div>
			<div className="min-w-0 flex-1">
				<p className="flex items-center gap-1.5 text-sm font-semibold leading-snug">
					{season.label}
					{isActive && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-label="Active" />}
				</p>
				<p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">{formatWindow(season.start, season.end)}</p>
			</div>
			<SheetSegmented value={mode} options={MODE_OPTIONS} onChange={(next) => setSeasonalOverlayMode(id, next)} />
		</div>
	);
}

/** Dev options for seasonal themes: per season follow its window (Auto), force it On outside it, or suppress it (Off). */
export function SeasonalOverlaysSheet({ onClose }: { onClose: () => void }) {
	const isDesktop = useDesktopBreakpoint();
	const isHalloweenOverlayHidden = useIsHalloweenOverlayHidden();
	const halloweenMode = useSeasonalOverlayMode("halloween");

	return (
		<BottomSheet onClose={onClose} isDesktop={isDesktop} bg={NATIVE_SHEET_BG} panelClassName={isDesktop ? "max-h-[82dvh] px-4" : "px-4"}>
			<DrawerHeader title="Seasonal Overlays" description="Auto follows each window, On forces the theme outside it, Off suppresses it." className="mb-3" />
			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-4" data-lenis-prevent>
				{/* One native group per season, its extra options as further rows in it. */}
				<div className="space-y-4">
					<div className={SHEET_GROUP_CLASS}>
						<SeasonRow id="halloween" />
						{halloweenMode !== "off" && (
							<ToggleRow
								checked={isHalloweenOverlayHidden}
								onChange={setHalloweenOverlayHidden}
								icon={<EyeOffFilled className="h-5 w-5" />}
								iconClass="bg-slate-500/15 text-slate-400"
								label="Hide Vignette"
								description="Removes only the blood-drip vignette. Nav icons stay."
							/>
						)}
					</div>
					<div className={SHEET_GROUP_CLASS}>
						<SeasonRow id="christmas" />
					</div>
					<div className={SHEET_GROUP_CLASS}>
						<SeasonRow id="valentines" />
					</div>
				</div>
			</div>
		</BottomSheet>
	);
}
