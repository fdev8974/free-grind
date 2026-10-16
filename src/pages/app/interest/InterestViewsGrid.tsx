import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { useDesktopBreakpoint } from "../../../hooks/useDesktopBreakpoint";
import { cn } from "../../../utils/cn";
import { mobileGridTemplate } from "../gridpage/components/BrowseGrid";
import { useGridRowMetrics } from "../gridpage/hooks/useGridRowMetrics";
import type { BrowseCard } from "../GridPage.types";
import { InterestViewTile } from "./InterestComponents";
import type { InterestItem } from "./interestUtils";

export function useViewsGridLayout() {
	const { mobileViewsGridColumns: mobileGridColumns } = usePreferences();
	const isDesktop = useDesktopBreakpoint();
	return {
		isDesktop,
		mobileGridColumns,
		gridTemplateColumns: isDesktop ? "repeat(6, minmax(0, 1fr))" : mobileGridTemplate(mobileGridColumns),
		gridClassName: cn("grid w-full", isDesktop ? "gap-2 px-[var(--app-px)]" : "gap-px"),
	};
}

/** Row-virtualized grid of view tiles — same approach as the browse grid's
 * BrowseGrid: rows of `columnCount` tiles, sized off an invisible probe grid. */
export function InterestViewsGrid({
	items,
	browseCardsById,
	onOpenProfile,
	now,
	isProfileBlocked,
	scrollContainerRef,
}: {
	items: InterestItem[];
	browseCardsById: Map<string, BrowseCard>;
	onOpenProfile: (profileId: string) => void;
	now: number;
	isProfileBlocked: (profileId: string) => boolean;
	scrollContainerRef: RefObject<HTMLDivElement | null>;
}) {
	const { isDesktop, mobileGridColumns, gridTemplateColumns, gridClassName } = useViewsGridLayout();
	const { rowMetrics, probeRef } = useGridRowMetrics(
		gridTemplateColumns,
		gridClassName,
		isDesktop ? 6 : Number(mobileGridColumns),
	);

	const rows = useMemo(() => {
		const result: InterestItem[][] = [];
		for (let i = 0; i < items.length; i += rowMetrics.columnCount) {
			result.push(items.slice(i, i + rowMetrics.columnCount));
		}
		return result;
	}, [items, rowMetrics.columnCount]);

	// The grid doesn't start at the very top of the scroll container (the feed
	// container pads its content for the header), so tell the virtualizer
	// where it actually begins.
	const listRef = useRef<HTMLDivElement | null>(null);
	const [scrollMargin, setScrollMargin] = useState(0);
	useLayoutEffect(() => {
		const list = listRef.current;
		const container = scrollContainerRef.current;
		if (!list || !container) return;
		const offset = list.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
		setScrollMargin((prev) => (prev === offset ? prev : offset));
	}, [scrollContainerRef, rowMetrics.rowSizePx]);

	const rowVirtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scrollContainerRef.current,
		estimateSize: () => rowMetrics.rowSizePx,
		overscan: 3,
		scrollMargin,
		getItemKey: (index) => rows[index]?.[0]?.profileId ?? index,
	});

	return (
		<div ref={listRef} className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
			{/* Invisible probe — see useGridRowMetrics. */}
			<div
				ref={probeRef}
				aria-hidden="true"
				className={cn(gridClassName, "pointer-events-none invisible absolute inset-x-0 top-0")}
				style={{ gridTemplateColumns, height: 0, overflow: "hidden" }}
			/>
			{rowVirtualizer.getVirtualItems().map((virtualRow) => {
				const row = rows[virtualRow.index];
				if (!row) return null;
				return (
					<div
						key={virtualRow.key}
						data-index={virtualRow.index}
						className={cn(gridClassName, "absolute inset-x-0 top-0")}
						style={{
							gridTemplateColumns,
							transform: `translateY(${virtualRow.start - scrollMargin}px)`,
						}}
					>
						{row.map((item) => (
							<InterestViewTile
								key={item.profileId}
								item={item}
								browseCard={browseCardsById.get(item.profileId)}
								onOpenProfile={onOpenProfile}
								now={now}
								isBlocked={isProfileBlocked(item.profileId)}
								isDesktop={isDesktop}
							/>
						))}
					</div>
				);
			})}
		</div>
	);
}
