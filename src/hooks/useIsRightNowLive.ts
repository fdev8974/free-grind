import { useEffect, useState } from "react";
import { usePreferences } from "../contexts/PreferencesContext";

/**
 * Whether the active profile has a running, public (not paused) Right Now
 * session. Re-renders at the expiry time, so callers flip back on their own.
 */
export function useIsRightNowLive(): boolean {
	const { activeRightNowId, activeRightNowExpiresAt, activeRightNowHidden } = usePreferences();
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (!activeRightNowExpiresAt) return;
		const remaining = activeRightNowExpiresAt - Date.now();
		if (remaining <= 0) return;
		// setTimeout caps at ~24.8 days; sessions are far shorter, but stay safe.
		const timer = setTimeout(() => setNow(Date.now()), Math.min(remaining + 50, 2_147_483_647));
		return () => clearTimeout(timer);
	}, [activeRightNowExpiresAt]);

	return (
		!!activeRightNowId &&
		!!activeRightNowExpiresAt &&
		!activeRightNowHidden &&
		activeRightNowExpiresAt > Math.max(now, Date.now())
	);
}
