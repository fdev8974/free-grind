import { useCallback, useEffect, useState } from "react";

/**
 * Fades the right edge of a horizontally scrolling chip row while more chips
 * are scrolled out of view — otherwise nothing hints that the row scrolls.
 *
 * Expects the scroll container to wrap a single inner row element whose
 * children are the chips. The mask goes on each chip, not the scroll
 * container: a masked ancestor becomes the backdrop root and kills the
 * pills' backdrop-blur glass effect.
 *
 * Returns a callback ref and scroll handler for the scroll container.
 */
export function useScrollRowFade(fadeWidth = 48) {
	const [el, setEl] = useState<HTMLDivElement | null>(null);

	const update = useCallback(() => {
		const row = el?.firstElementChild;
		if (!el || !row) return;
		const hasMore = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
		const fadeEnd = el.getBoundingClientRect().right;
		const fadeStart = fadeEnd - fadeWidth;
		for (const chip of Array.from(row.children) as HTMLElement[]) {
			const rect = chip.getBoundingClientRect();
			let mask = "";
			if (hasMore && rect.right > fadeStart) {
				// Gradient stops in chip-local px so all chips share one continuous fade.
				mask = `linear-gradient(to right, black ${fadeStart - rect.left}px, transparent ${fadeEnd - rect.left}px)`;
			}
			chip.style.maskImage = mask;
			chip.style.webkitMaskImage = mask;
		}
	}, [el, fadeWidth]);

	useEffect(() => {
		if (!el) return;
		update();
		// Observe the inner row too: chips appear/disappear without the
		// scroll container itself changing size.
		const observer = new ResizeObserver(update);
		observer.observe(el);
		if (el.firstElementChild) observer.observe(el.firstElementChild);
		return () => observer.disconnect();
	}, [el, update]);

	return { ref: setEl, onScroll: update };
}
