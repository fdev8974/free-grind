/** Haptic feedback (vibration) helper; respects the user's Haptic Feedback setting. */

export const HAPTICS_ENABLED_KEY = "fg-haptics-enabled";

type BridgeWindow = Window & { FreeGrindBridge?: { vibrate?: (ms: number) => void } };

export function isHapticsEnabled(): boolean {
	try {
		return window.localStorage.getItem(HAPTICS_ENABLED_KEY) !== "false";
	} catch {
		return true;
	}
}

/**
 * Vibrates for `ms` milliseconds via the native FreeGrindBridge when present,
 * otherwise via navigator.vibrate (optionally with a richer `fallbackPattern`).
 */
export function haptic(ms: number, fallbackPattern?: number[]): void {
	if (!isHapticsEnabled()) return;
	const bridge = (window as BridgeWindow).FreeGrindBridge;
	if (bridge?.vibrate) {
		bridge.vibrate(ms);
		return;
	}
	navigator.vibrate?.(fallbackPattern ?? ms);
}
