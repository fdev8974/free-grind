import { useCallback, useEffect, useRef, useState } from "react";

export type RowMetrics = { columnCount: number; rowSizePx: number; rowGapPx: number };

/**
 * Column count and row height of a square-tile CSS grid (tiles are always
 * square, see BrowseCardTile) aren't knowable from JS in advance — the mobile
 * template uses auto-fill/clamp() percentages the browser resolves at layout
 * time. So we read them back off a live, always-mounted (but invisible) probe
 * grid that shares the exact same template/className as a real row, rather
 * than re-deriving the CSS math (which would drift from actual layout on odd
 * viewport widths). Attach `probeRef` to that probe element.
 *
 * `rowSizePx` is only an estimate: virtualized rows should still be measured
 * (measureElement) with `rowGapPx` as the virtualizer's gap, so the vertical
 * spacing always matches the grid's column gap exactly.
 */
export function useGridRowMetrics(gridTemplateColumns: string, gridClassName: string, initialColumnCount: number) {
	const probeElRef = useRef<HTMLDivElement | null>(null);
	const probeObserverRef = useRef<ResizeObserver | null>(null);
	const [rowMetrics, setRowMetrics] = useState<RowMetrics>(() => ({
		columnCount: initialColumnCount,
		rowSizePx: 140,
		rowGapPx: 0,
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
				prev.columnCount === columnCount && prev.rowSizePx === rowSizePx && prev.rowGapPx === rowGapPx
					? prev
					: { columnCount, rowSizePx, rowGapPx },
			);
		}
	}, []);

	const probeRef = useCallback(
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

	return { rowMetrics, probeRef };
}
