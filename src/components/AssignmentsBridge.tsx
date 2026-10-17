import { useCallback, useEffect } from "react";
import { useAuth } from "../contexts/useAuth";
import { usePreferences } from "../contexts/PreferencesContext";
import { useApi } from "../hooks/useApi";
import { useApiFunctions } from "../hooks/useApiFunctions";
import { hydrateAssignments, refreshAssignments } from "../services/assignmentsStore";
import { getIncognitoMode } from "../utils/privacy";

/** Returns a function that refetches every assignment source into the store. */
export function useRefreshAssignments() {
	const { geohash } = usePreferences();
	const { callMethod } = useApi();
	const apiFunctions = useApiFunctions();

	return useCallback(
		() =>
			refreshAssignments({
				request: (path, init) => apiFunctions.request(path, init),
				getSessionToken: () => callMethod("websocket_token"),
				// A geohash-tagged request updates the account's server-side
				// location and with it the "online" status — skip it while
				// incognito, the untagged endpoint still returns the flags.
				geohash: getIncognitoMode() ? null : geohash,
			}),
		[apiFunctions, callMethod, geohash],
	);
}

/**
 * Bridge component that loads all assignments / feature flags into the
 * app-wide assignmentsStore once a session is active, and again whenever the
 * browse location changes (the account assignments are per geohash).
 */
export function AssignmentsBridge() {
	const { userId, isLoading: isAuthLoading, settingsReady } = useAuth();
	const refresh = useRefreshAssignments();

	useEffect(() => {
		if (isAuthLoading) return;
		hydrateAssignments(userId ? String(userId) : null);
		// Waits for settingsReady so the privacy cache (incognito) is loaded
		// before the first fetch decides whether to send the geohash.
		if (userId && settingsReady) void refresh();
	}, [userId, isAuthLoading, settingsReady, refresh]);

	return null;
}
