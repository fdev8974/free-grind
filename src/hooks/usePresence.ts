import { useEffect, useState, type CSSProperties } from "react";

export const MENU_TRANSITION_MS = 150;

/**
 * Keeps `value` rendered for a short exit animation after it goes falsy.
 * `rendered` is what to render (the last truthy value), `visible` drives the
 * transition: false on the first painted frame and again while leaving.
 */
export function usePresence<T>(value: T | null | undefined | false, durationMs = MENU_TRANSITION_MS) {
	const [rendered, setRendered] = useState<T | null>(value || null);
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		if (value) {
			setRendered(value);
			// Two frames, so the hidden start state is painted before transitioning in.
			let inner = 0;
			const outer = requestAnimationFrame(() => {
				inner = requestAnimationFrame(() => setVisible(true));
			});
			return () => {
				cancelAnimationFrame(outer);
				cancelAnimationFrame(inner);
			};
		}
		setVisible(false);
		const timer = setTimeout(() => setRendered(null), durationMs);
		return () => clearTimeout(timer);
	}, [value, durationMs]);

	return { rendered, visible };
}

/** Fade + slight scale from `origin` (the corner nearest the trigger) for dropdown and context menus. */
export function menuTransitionStyle(visible: boolean, origin = "top right"): CSSProperties {
	return {
		opacity: visible ? 1 : 0,
		transform: visible ? "scale(1)" : "scale(0.95)",
		transformOrigin: origin,
		transition: `opacity ${MENU_TRANSITION_MS}ms ease-out, transform ${MENU_TRANSITION_MS}ms cubic-bezier(0.2, 0.9, 0.3, 1.2)`,
		pointerEvents: visible ? undefined : "none",
	};
}
