import { useCallback, useEffect } from "react";
import { useAuth } from "../contexts/useAuth";
import { usePreferences } from "../contexts/PreferencesContext";
import { useApi } from "../hooks/useApi";
import { useApiFunctions } from "../hooks/useApiFunctions";
import { hydrateAssignments, refreshAssignments } from "../services/assignmentsStore";

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
				geohash,
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
	const { userId, isLoading: isAuthLoading } = useAuth();
	const refresh = useRefreshAssignments();

	useEffect(() => {
		if (isAuthLoading) return;
		hydrateAssignments(userId ? String(userId) : null);
		if (userId) void refresh();
	}, [userId, isAuthLoading, refresh]);

	return null;
}
