import { useEffect, useRef, type RefObject } from "react";
import { haptic } from "../../../../utils/haptics";

/** The drag offset goes onto the carousel as CSS variables that its slides
 * read, rather than state — no re-render per frame of finger movement. */
export function setCarouselDrag(el: HTMLElement, dy: number | null) {
	if (dy === null) {
		el.style.removeProperty("--carousel-drag");
		el.style.removeProperty("--carousel-transition");
		return;
	}
	el.style.setProperty("--carousel-drag", `${dy}px`);
	el.style.setProperty("--carousel-transition", "none");
}

/** Vertical touch swiping through the profile photo carousel (mobile). At
 * either end the gesture is left to the page, so it scrolls normally. */
export function useCarouselSwipe(
	carouselRef: RefObject<HTMLDivElement | null>,
	{
		enabled,
		count,
		index,
		onIndexChange,
	}: {
		enabled: boolean;
		count: number;
		index: number;
		onIndexChange?: (index: number) => void;
	},
) {
	const lastDeltaRef = useRef(0);
	const currentIndexRef = useRef(index);
	currentIndexRef.current = index;
	const onIndexChangeRef = useRef(onIndexChange);
	onIndexChangeRef.current = onIndexChange;

	useEffect(() => {
		const el = carouselRef.current;
		if (!el || !enabled) return;

		let startY = 0, startX = 0;
		let decided = false, navigating = false;

		const onStart = (e: TouchEvent) => {
			startY = e.touches[0].clientY;
			startX = e.touches[0].clientX;
			decided = false;
			navigating = false;
			lastDeltaRef.current = 0;
		};

		const onMove = (e: TouchEvent) => {
			const dy = e.touches[0].clientY - startY;
			const dx = e.touches[0].clientX - startX;

			if (!decided) {
				if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
				decided = true;
				if (Math.abs(dx) >= Math.abs(dy)) return; // horizontal swipe → ignore
				const idx = currentIndexRef.current;
				// only take over when not at a boundary
				if ((dy < 0 && idx < count - 1) || (dy > 0 && idx > 0)) {
					navigating = true;
					e.preventDefault();
				}
				// at boundary: fall through, page scrolls normally
			}

			if (!navigating) return;
			e.preventDefault();
			lastDeltaRef.current = dy;
			setCarouselDrag(el, dy);
		};

		const onEnd = () => {
			if (!navigating) return;
			navigating = false;
			const dy = lastDeltaRef.current;
			const idx = currentIndexRef.current;
			if (dy < -60 && idx < count - 1) {
				haptic(8);
				onIndexChangeRef.current?.(idx + 1);
			} else if (dy > 60 && idx > 0) {
				haptic(8);
				onIndexChangeRef.current?.(idx - 1);
			}
			lastDeltaRef.current = 0;
			setCarouselDrag(el, null);
		};

		el.addEventListener("touchstart", onStart, { passive: true });
		el.addEventListener("touchmove", onMove, { passive: false });
		el.addEventListener("touchend", onEnd, { passive: true });
		el.addEventListener("touchcancel", onEnd, { passive: true });
		return () => {
			el.removeEventListener("touchcancel", onEnd);
			el.removeEventListener("touchstart", onStart);
			el.removeEventListener("touchmove", onMove);
			el.removeEventListener("touchend", onEnd);
		};
	}, [carouselRef, enabled, count]);
}
