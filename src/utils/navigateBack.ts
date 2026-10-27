import type { NavigateFunction } from "react-router-dom";

/**
 * Return to `returnTo`, which the caller knows is the entry directly below
 * the current one in history. Popping (instead of pushing/replacing) keeps
 * that entry's router state (e.g. a profile's own returnTo + swipe list) and
 * matches what the Android back button does. Falls back to a replace when
 * there's nothing to pop, e.g. after a cold start from a notification.
 */
export function navigateBackTo(navigate: NavigateFunction, returnTo: string) {
	const idx = (window.history.state as { idx?: unknown } | null)?.idx;
	if (typeof idx === "number" && idx > 0) {
		navigate(-1);
	} else {
		navigate(returnTo, { replace: true });
	}
}
