/**
 * Extra state handed to the native Android side, which includes it in the
 * report written when the WebView's renderer dies (see RenderProcessGuard.kt).
 * No-op outside the Android WebView.
 */

type CrashContextBridge = {
	setCrashContext?: (key: string, value: string | null) => void;
	takeRenderCrashReport?: () => string | null;
};

function getBridge(): CrashContextBridge | undefined {
	return (window as unknown as { FreeGrindBridge?: CrashContextBridge }).FreeGrindBridge;
}

/** Sets (or with null, clears) one context entry. */
export function setCrashContext(key: string, value: string | number | null): void {
	try {
		getBridge()?.setCrashContext?.(key, value == null ? null : String(value));
	} catch {
		// best effort
	}
}

/** The report of the last renderer death (JSON), once; null if there was none. */
export function takeRenderCrashReport(): string | null {
	try {
		return getBridge()?.takeRenderCrashReport?.() ?? null;
	} catch {
		return null;
	}
}
