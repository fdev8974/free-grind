import type { BrowseCard } from "../../GridPage.types";
import { BrowseCardTile } from "./BrowseCardTile";
import type { GridTapStatus } from "../hooks/useGridTapStatus";
import { usePreferences } from "../../../../contexts/PreferencesContext";
import { cn } from "../../../../utils/cn";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useDesktopBreakpoint } from "../../../../hooks/useDesktopBreakpoint";
import { useTranslation } from "react-i18next";
import { Ghost, MapPin } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	EmptyState,
	ErrorState,
} from "../../../../components/ui/states";
import { Button } from "../../../../components/ui/button";
import { getAsyncState } from "../../../../hooks/useAsyncViewState";
import type { ChatContactIndexRecord } from "../../../../types/chat-contact-index";

// Min track width per mobile column setting; auto-fill then yields exactly
// that many columns until the 250px cap kicks in on wide screens.
const MOBILE_MIN_TRACK: Record<"2" | "3" | "4", string> = {
	"2": "33.4%",
	"3": "25.1%",
	"4": "20.1%",
};

function mobileGridTemplate(columns: "2" | "3" | "4") {
	return `repeat(auto-fill, minmax(clamp(${MOBILE_MIN_TRACK[columns]}, 15vw, 250px), 1fr))`;
}

function BrowseGridSkeleton({ isDesktop, mobileColumns }: { isDesktop: boolean; mobileColumns: "2" | "3" | "4" }) {
	const count = isDesktop ? 30 : Number(mobileColumns) * 8;
	return (
		<div
			className={cn("w-full grid", isDesktop ? "gap-2 px-[var(--app-px)]" : "gap-px")}
			style={{
				gridTemplateColumns: isDesktop ? "repeat(6, minmax(0, 1fr))" : mobileGridTemplate(mobileColumns),
			}}
		>
			{Array.from({ length: count }).map((_, i) => (
				<div
					key={i}
					className={cn(
						"animate-pulse bg-[var(--surface-2)] relative w-full h-0 pb-[100%] overflow-hidden",
						!isDesktop && "rounded-[4px]",
						isDesktop && "rounded-xl",
					)}
				>
					<div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/30 to-transparent p-2 flex flex-col gap-1.5">
						<div className="h-2.5 w-16 rounded-full bg-white/20" />
					</div>
					<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/30 to-transparent p-2 flex gap-1">
						<div className="h-2 w-8 rounded-full bg-white/20" />
					</div>
				</div>
			))}
		</div>
	);
}

type RowMetrics = { columnCount: number; rowSizePx: number };

type BrowseGridProps = {
	isLoadingCards: boolean;
	cardsError: string | null;
	isLocationMissing?: boolean;
	isIncognitoActive?: boolean;
	onOpenLocation?: () => void;
	onManagePrivacy?: () => void;
	cards: BrowseCard[];
	chatContactIndexByProfileId?: Record<string, ChatContactIndexRecord>;
	localNicknamesByProfileId?: Record<string, string>;
	tapStatusByProfileId?: Record<string, GridTapStatus>;
	onSelectProfile: (profileId: string) => void;
	onDoubleTapProfile?: (profileId: string, tapId: number) => boolean;
	onMessageProfile: (profileId: string) => void;
	onOpenContextMenu?: (card: BrowseCard, x: number, y: number) => void;
	hasMore?: boolean;
	isLoadingMore?: boolean;
	onLoadMore?: () => void;
	// The grid scrolls inside an ancestor GridPage renders (FeedScrollContainer),
	// so the virtualizer needs that element's ref rather than owning its own.
	scrollContainerRef: RefObject<HTMLDivElement | null>;
	// Below let BrowseGrid own the scroll-restore + header-snap logic itself,
	// since only it knows the real (measured) row size needed to do the snap
	// math without querying the DOM for a currently-mounted tile (which,
	// once virtualized, may not be mounted at the restored position yet).
	headerRef?: RefObject<HTMLElement | null>;
	browseCacheKey?: string;
	hasRestoredScroll: boolean;
	onRestoredScrollChange: (restored: boolean) => void;
};

export function BrowseGrid({
	isLoadingCards,
	cardsError,
	isLocationMissing,
	isIncognitoActive,
	onOpenLocation,
	onManagePrivacy,
	cards,
	chatContactIndexByProfileId,
	localNicknamesByProfileId,
	tapStatusByProfileId,
	onSelectProfile,
	onDoubleTapProfile,
	onMessageProfile,
	onOpenContextMenu,
	hasMore,
	isLoadingMore,
	onLoadMore,
	scrollContainerRef,
	headerRef,
	browseCacheKey,
	hasRestoredScroll,
	onRestoredScrollChange,
}: BrowseGridProps) {
	const { t } = useTranslation();
	const { mobileGridColumns } = usePreferences();
	const isDesktop = useDesktopBreakpoint();

	const gridTemplateColumns = isDesktop ? "repeat(6, minmax(0, 1fr))" : mobileGridTemplate(mobileGridColumns);
	const gridClassName = cn("grid w-full", isDesktop ? "gap-2 px-[var(--app-px)]" : "gap-px");

	// Column count and row height (tiles are always square, see BrowseCardTile)
	// aren't knowable from JS in advance — the mobile template uses
	// auto-fill/clamp() percentages the browser resolves at layout time. So
	// we read them back off a live, always-mounted (but invisible) probe grid
	// that shares the exact same template/className as a real row, rather
	// than re-deriving the CSS math (which would drift from actual layout on
	// odd viewport widths).
	const probeElRef = useRef<HTMLDivElement | null>(null);
	const probeObserverRef = useRef<ResizeObserver | null>(null);
	const [rowMetrics, setRowMetrics] = useState<RowMetrics>(() => ({
		columnCount: isDesktop ? 6 : Number(mobileGridColumns),
		rowSizePx: 140,
	}));

	const measureProbe = useCallback((el: HTMLDivElement) => {
		const style = window.getComputedStyle(el);
		const tracks = style.gridTemplateColumns.split(" ").filter(Boolean);
		const columnCount = tracks.length;
		const columnWidthPx = parseFloat(tracks[0] ?? "0");
		const rowGapPx = parseFloat(style.rowGap || "0");
		if (columnCount > 0 && columnWidthPx > 0) {
			const rowSizePx = columnWidthPx + rowGapPx;
			setRowMetrics((prev) =>
				prev.columnCount === columnCount && prev.rowSizePx === rowSizePx
					? prev
					: { columnCount, rowSizePx },
			);
		}
	}, []);

	const probeRefCallback = useCallback(
		(el: HTMLDivElement | null) => {
			probeObserverRef.current?.disconnect();
			probeObserverRef.current = null;
			probeElRef.current = el;
			if (!el) {
				return;
			}
			measureProbe(el);
			const observer = new ResizeObserver(() => measureProbe(el));
			observer.observe(el);
			probeObserverRef.current = observer;
		},
		[measureProbe],
	);

	useEffect(() => {
		if (probeElRef.current) {
			measureProbe(probeElRef.current);
		}
	}, [gridTemplateColumns, gridClassName, measureProbe]);

	const rows = useMemo(() => {
		const columnCount = rowMetrics.columnCount;
		const result: BrowseCard[][] = [];
		for (let i = 0; i < cards.length; i += columnCount) {
			result.push(cards.slice(i, i + columnCount));
		}
		return result;
	}, [cards, rowMetrics.columnCount]);

	const rowVirtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scrollContainerRef.current,
		estimateSize: () => rowMetrics.rowSizePx,
		overscan: 3,
		getItemKey: (index) => rows[index]?.[0]?.profileId ?? index,
	});
	const virtualRows = rowVirtualizer.getVirtualItems();
	const lastVirtualRowIndex = virtualRows.length > 0 ? virtualRows[virtualRows.length - 1].index : -1;

	// Pagination trigger — fires once virtualization has actually rendered the
	// last row, i.e. the user has scrolled to the bottom of what's loaded.
	// Guarded by rows.length so a just-requested page can't trigger a second
	// request before its (possibly small) result has had a chance to push the
	// last row out of view again.
	const lastRequestedAtRowCountRef = useRef(-1);
	useEffect(() => {
		if (!hasMore || !onLoadMore || isLoadingMore) {
			return;
		}
		if (rows.length === 0 || lastVirtualRowIndex < rows.length - 1) {
			return;
		}
		if (lastRequestedAtRowCountRef.current === rows.length) {
			return;
		}
		lastRequestedAtRowCountRef.current = rows.length;
		onLoadMore();
	}, [lastVirtualRowIndex, rows.length, hasMore, isLoadingMore, onLoadMore]);

	// Restore the saved scroll position once cards are in, then nudge it so
	// the topmost partially-visible row aligns with the header's bottom edge
	// instead of being cut off. Done here (not in GridPage) because only the
	// virtualizer knows the real row size — with virtualization the tile that
	// used to be queried via the DOM at the target scroll position may not be
	// mounted yet.
	useLayoutEffect(() => {
		if (cards.length === 0 || hasRestoredScroll || isLoadingCards) {
			return;
		}
		const container = scrollContainerRef.current;
		if (browseCacheKey && container) {
			const saved = sessionStorage.getItem(`grid-scroll-${browseCacheKey}`);
			if (saved) {
				const scrollY = parseInt(saved, 10);
				if (scrollY > 0) {
					container.scrollTop = scrollY;
					const header = headerRef?.current;
					if (header) {
						const headerBottom = header.getBoundingClientRect().bottom;
						const containerTop = container.getBoundingClientRect().top;
						const rowSizePx = rowMetrics.rowSizePx;
						const headerLineContentY = container.scrollTop + (headerBottom - containerTop);
						const rowIndex = Math.floor(headerLineContentY / rowSizePx);
						const rowTopContentY = rowIndex * rowSizePx;
						if (rowTopContentY < headerLineContentY) {
							container.scrollTop -= headerLineContentY - rowTopContentY;
						}
					}
				}
			}
		}
		onRestoredScrollChange(true);
	}, [cards.length, hasRestoredScroll, isLoadingCards, browseCacheKey, rowMetrics.rowSizePx]);

	if (isIncognitoActive) {
		return (
			/* Padding applied to maintain header alignment for non-grid states */
			<div className="w-full px-[var(--app-px)]">
				<div
					className="flex flex-col items-center justify-center gap-4 text-center"
					style={{ minHeight: "60dvh" }}
				>
					<div className="rounded-2xl bg-[var(--surface-2)] p-4">
						<Ghost className="h-7 w-7 text-[var(--accent)]" />
					</div>
					<div className="grid max-w-xs gap-1.5">
						<p className="text-base font-semibold text-[var(--text)]">
							{t("browse_page.incognito_active_title")}
						</p>
						<p className="text-sm text-[var(--text-muted)]">
							{t("browse_page.incognito_active_desc")}
						</p>
					</div>
					{onManagePrivacy && (
						<Button variant="primary" onClick={onManagePrivacy} leftIcon={<Ghost className="h-4 w-4" />}>
							{t("browse_page.incognito_active_button")}
						</Button>
					)}
				</div>
			</div>
		);
	}

	if (isLocationMissing) {
		return (
			/* Padding applied to maintain header alignment for non-grid states */
			<div className="w-full px-[var(--app-px)]">
				<div
					className="flex flex-col items-center justify-center gap-4 text-center"
					style={{ minHeight: "60dvh" }}
				>
					<div className="rounded-2xl bg-[var(--surface-2)] p-4">
						<MapPin className="h-7 w-7 text-[var(--accent)]" />
					</div>
					<div className="grid max-w-xs gap-1.5">
						<p className="text-base font-semibold text-[var(--text)]">
							{t("browse_page.no_location_title")}
						</p>
						<p className="text-sm text-[var(--text-muted)]">
							{t("browse_page.no_location_desc")}
						</p>
					</div>
					<Button variant="primary" onClick={onOpenLocation} leftIcon={<MapPin className="h-4 w-4" />}>
						{t("browse_page.no_location_button")}
					</Button>
				</div>
			</div>
		);
	}

	const viewState = getAsyncState(
		{ isLoading: isLoadingCards, error: cardsError, data: cards },
		cards.length === 0,
	);

	if (viewState === "loading") {
		return (
			<BrowseGridSkeleton isDesktop={isDesktop} mobileColumns={mobileGridColumns} />
		);
	}

	if (viewState === "error") {
		return (
			/* Padding applied to maintain header alignment for non-grid states */
			<div className="w-full px-[var(--app-px)]">
				<ErrorState
					title={t("browse_page.error_load_feed")}
					description={cardsError ?? undefined}
				/>
			</div>
		);
	}

	if (viewState === "empty") {
		return (
			/* Padding applied to maintain header alignment for non-grid states */
			<div className="w-full px-[var(--app-px)]">
				<EmptyState
					title={t("browse_page.empty_title")}
					description={t("browse_page.empty_desc")}
				/>
			</div>
		);
	}

	return (
		<div className="w-full flex flex-col gap-4">
			<div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
				{/* Invisible, always-mounted probe — the only purpose of this element
					is to let us read back the actual column count / track width the
					browser resolved for gridTemplateColumns (auto-fill + clamp() on
					mobile can't be reliably re-derived in JS), via ResizeObserver. */}
				<div
					ref={probeRefCallback}
					aria-hidden="true"
					className={cn(gridClassName, "absolute inset-x-0 top-0 invisible pointer-events-none")}
					style={{ gridTemplateColumns, height: 0, overflow: "hidden" }}
				/>
				{virtualRows.map((virtualRow) => {
					const row = rows[virtualRow.index];
					if (!row) {
						return null;
					}
					return (
						<div
							key={virtualRow.key}
							data-index={virtualRow.index}
							className={cn(gridClassName, "absolute inset-x-0 top-0")}
							style={{
								gridTemplateColumns,
								transform: `translateY(${virtualRow.start}px)`,
							}}
						>
							{row.map((card) => (
								<BrowseCardTile
									key={card.profileId}
									card={card}
									chatContactStatus={chatContactIndexByProfileId?.[card.profileId] ?? null}
									localNickname={localNicknamesByProfileId?.[card.profileId]}
									tapStatus={tapStatusByProfileId?.[card.profileId]}
									onSelectProfile={onSelectProfile}
									onDoubleTapProfile={onDoubleTapProfile}
									onMessageProfile={onMessageProfile}
									onOpenContextMenu={onOpenContextMenu}
									isDesktop={isDesktop}
								/>
							))}
						</div>
					);
				})}
			</div>
			{hasMore && isLoadingMore ? (
				<p className="px-[var(--app-px)] pb-8 text-center text-sm text-[var(--text-muted)]">
					{t("browse_page.loading")}
				</p>
			) : null}
		</div>
	);
}
