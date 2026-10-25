import type { ReactNode, Ref } from "react";
import { Loader2, Search, X } from "lucide-react";
import { MapPinFilled } from "../../../../components/icons/FilledIcons";
import { SHEET_BOTTOM_PADDING } from "../../../../components/ui/bottom-sheet";

// Shared layout of the map sheets (browse location picker, chat's share
// location): the map runs full width down to the sheet's bottom edge, an
// optional search floats on top of it, and the quick picks plus footer float
// over a dark fade at the bottom.

/** Panel class for a map sheet: a fixed, nearly full-screen height so the map
 * gets all the room left under the header. +48px is the panel's offscreen bleed. */
export function mapSheetPanelClass(isDesktop: boolean): string {
	return isDesktop ? "h-[min(86vh,calc(92dvh+48px))] px-4" : "h-[calc(92dvh+48px)] px-4";
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

/** Search pill floating at the top of the map, like in a maps app. */
export function MapSheetSearch({
	inputRef,
	value,
	onChange,
	onClear,
	placeholder,
	isLoading,
	focusColor,
}: {
	inputRef?: Ref<HTMLInputElement>;
	value: string;
	onChange: (value: string) => void;
	onClear: () => void;
	placeholder: string;
	isLoading?: boolean;
	focusColor: string;
}) {
	return (
		<div
			className="relative rounded-full bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] shadow-[0_2px_6px_rgba(0,0,0,0.18),0_8px_28px_rgba(0,0,0,0.32)] ring-1 ring-[var(--border)]/50 backdrop-blur-xl transition focus-within:ring-2 focus-within:ring-[var(--focus-color)]"
			style={{ "--focus-color": focusColor } as React.CSSProperties}
		>
			<Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
			<input
				ref={inputRef}
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				className="h-12 w-full rounded-full bg-transparent pl-11 pr-11 text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
			/>
			{isLoading ? (
				<Loader2 className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[var(--text-muted)]" />
			) : value ? (
				<button
					type="button"
					onClick={onClear}
					className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-[var(--text-muted)] transition hover:text-[var(--text)]"
				>
					<X className="h-3.5 w-3.5" />
				</button>
			) : null}
		</div>
	);
}

export function MapSheetLayout({
	map,
	search,
	pinLabel,
	overlay,
	picks,
	footer,
}: {
	/** The map itself (or an error in its place); fills the whole area. */
	map: ReactNode;
	/** Usually a MapSheetSearch; floats at the top of the map. */
	search?: ReactNode;
	/** Text of the floating pill naming the pinned spot; omitted → no pill. */
	pinLabel?: ReactNode;
	/** Laid over the map below the search (e.g. search results); scrolls on its own. */
	overlay?: ReactNode;
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

			{pinLabel != null ? (
				<div className={`pointer-events-none absolute inset-x-16 flex justify-center ${hasSearch ? "top-[4.25rem]" : "top-3"}`}>
					<div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur-md">
						<MapPinFilled className="h-3.5 w-3.5 shrink-0" />
						<span className="truncate">{pinLabel}</span>
					</div>
				</div>
			) : null}

			{overlay != null ? (
				// z-10: MapLibre's controls carry their own z-index and would poke through.
				<div
					className={`absolute inset-0 z-10 overflow-y-auto bg-[var(--surface-2)] ${hasSearch ? "pt-[4.25rem]" : ""}`}
					style={{ paddingBottom: `calc(${SHEET_BOTTOM_PADDING} + 72px)` }}
					data-lenis-prevent
				>
					{overlay}
				</div>
			) : null}

			{/* z-20: above the overlay it opens. */}
			{hasSearch ? <div className="absolute inset-x-3 top-3 z-20">{search}</div> : null}

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
