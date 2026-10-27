import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, MapPin, Search, X } from "lucide-react";
import { MapPinFilled } from "../../../../components/icons/FilledIcons";
import { SHEET_BOTTOM_PADDING } from "../../../../components/ui/bottom-sheet";
import type { GeocodeResult } from "../../../../types/grid";
import { formatNominatimAddress } from "../geocoding";
import type { useLocationSearch } from "../hooks/useLocationSearch";

// Shared layout of the map sheets (browse location picker, chat's share
// location): the map runs full width down to the sheet's bottom edge, an
// optional search floats on top of it, and the quick picks plus footer float
// over a dark fade at the bottom.

/** BottomSheet props for a map sheet. On mobile it opens at a medium detent
 * and can be dragged up to almost full screen (the map itself keeps its own
 * pan gestures, so the header and the fade's controls drag the sheet). On
 * desktop it's a fixed height; +48px is the panel's offscreen bleed. In both
 * cases the map takes all the room left under the header. */
export function mapSheetProps(isDesktop: boolean) {
	return {
		expandable: true,
		mediumDetent: 0.7,
		panelClassName: isDesktop ? "h-[min(72vh,calc(92dvh+48px))] px-4" : "px-4",
	};
}

// Footer icon buttons sit on the dark fade, so they're white glass instead of
// the usual --text tint (which would vanish there in light mode).
export const MAP_SHEET_ICON_BUTTON_CLASS =
	"inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition-[transform,background-color,color] duration-150 hover:bg-white/25 active:scale-[0.94] disabled:pointer-events-none disabled:opacity-40";

/** Small hint line under the quick picks, readable on the fade. */
export const MAP_SHEET_HINT_CLASS = "mt-2 px-5 text-[11px] text-white/75";

/** Horizontally scrolling chip row for the quick picks. */
export function MapSheetQuickPicks({ children }: { children: ReactNode }) {
	return (
		<div className="flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
			{children}
		</div>
	);
}

/** Search pill floating at the top of the map, like in a maps app. While
 * there's a query, the results hang off it as one frosted card (the pill's
 * lower corners square off into the list) so the map stays visible around
 * and behind them. */
export function MapSheetSearch({
	search,
	onSelect,
	placeholder,
	focusColor,
}: {
	search: ReturnType<typeof useLocationSearch>;
	onSelect: (result: GeocodeResult, label: string) => void;
	placeholder: string;
	focusColor: string;
}) {
	const { t } = useTranslation();
	const { query, setQuery, results, isLoading, error, isActive, clear, inputRef } = search;
	const showList = isActive && (results.length > 0 || error != null || (!isLoading && query.trim().length >= 2));

	return (
		<div
			// 24px radius = a full pill at the 48px input height, and a rounded
			// card once the list opens below it.
			className="pointer-events-auto flex max-h-full min-h-0 flex-col overflow-hidden rounded-[24px] bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] shadow-[0_2px_6px_rgba(0,0,0,0.18),0_8px_28px_rgba(0,0,0,0.32)] ring-1 ring-[var(--border)]/50 backdrop-blur-xl focus-within:ring-2 focus-within:ring-[var(--focus-color)]"
			style={{ "--focus-color": focusColor } as React.CSSProperties}
		>
			<div className="relative shrink-0">
				<Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
				<input
					ref={inputRef}
					type="text"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder={placeholder}
					className="h-12 w-full bg-transparent pl-11 pr-11 text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
				/>
				{isLoading ? (
					<Loader2 className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[var(--text-muted)]" />
				) : query ? (
					<button
						type="button"
						onClick={() => clear(true)}
						aria-label={t("common.clear", { defaultValue: "Clear" })}
						className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-[var(--text-muted)] transition hover:text-[var(--text)]"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				) : null}
			</div>

			{showList ? (
				// data-sheet-no-drag: scrolling the list must not drag the sheet.
				<div className="min-h-0 overflow-y-auto overscroll-contain border-t border-[var(--border)]/60 py-1" data-lenis-prevent data-sheet-no-drag>
					{error ? (
						<p className="px-4 py-3 text-sm text-red-400">{error}</p>
					) : results.length > 0 ? (
						results.map((result) => {
							const label = (result.address && formatNominatimAddress(result.address, result.display_name)) ?? result.display_name;
							return (
								<button
									key={`${result.lat}:${result.lon}`}
									type="button"
									onClick={() => {
										clear(false);
										onSelect(result, label);
									}}
									className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-[var(--text)]/5 active:bg-[var(--text)]/10"
								>
									<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full ink-tint-8 text-[var(--text-muted)]">
										<MapPin className="h-3.5 w-3.5" />
									</span>
									<span className="line-clamp-2 text-sm text-[var(--text)]">{label}</span>
								</button>
							);
						})
					) : (
						<p className="px-4 py-3 text-sm text-[var(--text-muted)]">{t("browse_location.error_search_failed_general")}</p>
					)}
				</div>
			) : null}
		</div>
	);
}

export function MapSheetLayout({
	map,
	search,
	pinLabel,
	picks,
	footer,
}: {
	/** The map itself (or an error in its place); fills the whole area. */
	map: ReactNode;
	/** Usually a MapSheetSearch; floats at the top of the map. */
	search?: ReactNode;
	/** Text of the floating pill naming the pinned spot; omitted → no pill. */
	pinLabel?: ReactNode;
	/** Quick picks and hints above the footer, on the fade. */
	picks?: ReactNode;
	footer: ReactNode;
}) {
	const hasSearch = search != null;
	return (
		// The negative margin cancels the panel's bottom padding so the map
		// reaches the sheet's bottom edge; the fade re-adds it for its content.
		<div
			className="relative -mx-4 flex min-h-[280px] flex-1 flex-col justify-end overflow-hidden"
			style={{ marginBottom: `calc(-1 * ${SHEET_BOTTOM_PADDING})` }}
		>
			{/* With a search on top, MapLibre's zoom control moves below it. */}
			<div className={`absolute inset-0 ${hasSearch ? "[&_.maplibregl-ctrl-top-right]:top-[3.75rem]" : ""}`}>{map}</div>

			{/* Short fade from the sheet's own background (--sheet-bg) so the
			    header flows into the map instead of meeting it at a hard edge.
			    No z-index: MapLibre's controls (z-index 2) stay above it. */}
			<div
				className={`pointer-events-none absolute inset-x-0 top-0 bg-[linear-gradient(to_bottom,var(--sheet-bg),color-mix(in_srgb,var(--sheet-bg)_60%,transparent)_45%,transparent)] ${hasSearch ? "h-28" : "h-20"}`}
			/>

			{pinLabel != null ? (
				<div className={`pointer-events-none absolute inset-x-16 flex justify-center ${hasSearch ? "top-[4.25rem]" : "top-3"}`}>
					<div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur-md">
						<MapPinFilled className="h-3.5 w-3.5 shrink-0" />
						<span className="truncate">{pinLabel}</span>
					</div>
				</div>
			) : null}

			{/* z-30: its results dropdown opens over the bottom fade (z-20). The
			    box only bounds the dropdown's height (it stops above the footer);
			    it lets taps through to the map around the search card. */}
			{hasSearch ? (
				<div
					className="pointer-events-none absolute inset-x-3 top-3 z-30 flex flex-col"
					style={{ bottom: `calc(${SHEET_BOTTOM_PADDING} + 4rem)` }}
				>
					{search}
				</div>
			) : null}

			{/* The fade itself lets map gestures through, only the controls on it catch taps. */}
			<div
				className="pointer-events-none relative z-20 bg-gradient-to-t from-black/85 via-black/60 to-transparent pt-16"
				style={{ paddingBottom: SHEET_BOTTOM_PADDING }}
			>
				{picks != null ? <div className="pointer-events-auto mb-3">{picks}</div> : null}
				<div className="pointer-events-auto flex gap-2.5 px-4">{footer}</div>
			</div>
		</div>
	);
}
