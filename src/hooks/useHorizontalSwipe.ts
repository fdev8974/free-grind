import { useRef, type TouchEvent } from "react";

const MIN_DISTANCE_PX = 50;

/**
 * Touch handlers for paging with a horizontal swipe: left calls `onNext`,
 * right calls `onPrev`. Pass undefined for a direction that's not allowed
 * right now. Mostly-vertical drags are ignored, so scrolling still works.
 */
export function useHorizontalSwipe({ onNext, onPrev }: { onNext?: () => void; onPrev?: () => void }) {
	const start = useRef<{ x: number; y: number } | null>(null);

	return {
		onTouchStart: (e: TouchEvent) => {
			const touch = e.touches[0];
			start.current = e.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
		},
		onTouchEnd: (e: TouchEvent) => {
			const from = start.current;
			start.current = null;
			if (!from) return;
			const touch = e.changedTouches[0];
			const dx = touch.clientX - from.x;
			const dy = touch.clientY - from.y;
			if (Math.abs(dx) < MIN_DISTANCE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
			if (dx < 0) onNext?.();
			else onPrev?.();
		},
	};
}
