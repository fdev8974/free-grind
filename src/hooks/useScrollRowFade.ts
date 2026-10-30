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
 * Also makes the row scrollable with a mouse (desktop, narrow window): the
 * vertical wheel scrolls it sideways, and it can be dragged — a drag doesn't
 * click the chip it started on.
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

	useEffect(() => {
		if (!el) return;
		const overflows = () => el.scrollWidth > el.clientWidth + 1;

		// Non-passive so the page doesn't scroll as well while the row takes the wheel.
		const onWheel = (e: WheelEvent) => {
			if (!overflows() || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
			const max = el.scrollWidth - el.clientWidth;
			const next = Math.max(0, Math.min(max, el.scrollLeft + e.deltaY));
			if (next === el.scrollLeft) return;
			e.preventDefault();
			el.scrollLeft = next;
		};

		const onPointerDown = (e: PointerEvent) => {
			if (e.pointerType !== "mouse" || e.button !== 0 || !overflows()) return;
			const startX = e.clientX;
			const startScroll = el.scrollLeft;
			let dragging = false;
			const onMove = (ev: PointerEvent) => {
				const dx = ev.clientX - startX;
				if (!dragging && Math.abs(dx) < 5) return;
				dragging = true;
				el.scrollLeft = startScroll - dx;
			};
			const onUp = () => {
				window.removeEventListener("pointermove", onMove);
				window.removeEventListener("pointerup", onUp);
				if (!dragging) return;
				// Swallow the click that ends the drag.
				const block = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
				el.addEventListener("click", block, { capture: true, once: true });
				setTimeout(() => el.removeEventListener("click", block, { capture: true }), 0);
			};
			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", onUp);
		};

		el.addEventListener("wheel", onWheel, { passive: false });
		el.addEventListener("pointerdown", onPointerDown);
		return () => {
			el.removeEventListener("wheel", onWheel);
			el.removeEventListener("pointerdown", onPointerDown);
		};
	}, [el]);

	return { ref: setEl, onScroll: update };
}
