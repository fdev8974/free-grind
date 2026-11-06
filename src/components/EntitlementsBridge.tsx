import { useEffect } from "react";
import { useAuth } from "../contexts/useAuth";
import { usePreferences } from "../contexts/PreferencesContext";
import { appLog } from "../utils/logger";
import { useEntitlements } from "../hooks/queries/useEntitlementQueries";
import { freeRightNowPostsLeft } from "../types/right-now";
import { RIGHT_NOW_UNLIMITED_POSTS } from "../pages/app/rightnow/rightnow-constants";

/**
 * Bridge component that fetches the Right Now post entitlement (remaining
 * posts) when a session is active.
 */
export function EntitlementsBridge() {
	const { userId, isLoading: isAuthLoading } = useAuth();
	const { setPreferences, geohash } = usePreferences();

	const { data: entitlements, isSuccess } = useEntitlements(userId, geohash ?? null, !isAuthLoading);

	useEffect(() => {
		if (!isSuccess || !entitlements) return;
		appLog.info("[HTTP] Right Now entitlements fetched successfully:", entitlements);
		const left = freeRightNowPostsLeft(entitlements);
		// An unknown entitlement type keeps the last known count.
		if (left === null) return;
		void setPreferences({
			rightNowRemaining: left === "unlimited" ? RIGHT_NOW_UNLIMITED_POSTS : left,
		});
	}, [isSuccess, entitlements, setPreferences]);

	return null;
}
