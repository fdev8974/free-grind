/**
 * Android fallback for env(safe-area-inset-*). Older Android System WebViews
 * report 0 for the system bars in the app's edge-to-edge window, so content
 * slid behind the navigation bar on those devices. MainActivity measures the
 * real insets and pushes them as --native-safe-area-* on <html> whenever they
 * change; this pulls the current values once at boot, since a page reload
 * drops those inline properties. index.css combines both into --safe-area-*.
 *
 * Off Android `FreeGrindBridge` is undefined and this is a no-op.
 */
export const SAFE_AREA_CHANGE_EVENT = "fg-safe-area";

type Insets = { top: number; right: number; bottom: number; left: number };

export function applyNativeSafeArea(insets: Insets): void {
	const style = document.documentElement.style;
	for (const side of ["top", "right", "bottom", "left"] as const) {
		const value = Number(insets[side]);
		if (Number.isFinite(value)) style.setProperty(`--native-safe-area-${side}`, `${value}px`);
	}
	window.dispatchEvent(new Event(SAFE_AREA_CHANGE_EVENT));
}

export function installNativeSafeArea(): void {
	const bridge = (window as unknown as { FreeGrindBridge?: { getSafeAreaInsets?: () => string | null } }).FreeGrindBridge;
	(window as unknown as { __fgApplySafeArea?: (i: Insets) => void }).__fgApplySafeArea = applyNativeSafeArea;
	try {
		const json = bridge?.getSafeAreaInsets?.();
		if (json) applyNativeSafeArea(JSON.parse(json) as Insets);
	} catch {
		// Malformed/absent — env() alone still applies.
	}
}
