import { useQuery } from "@tanstack/react-query";
import { useApiFunctions } from "../useApiFunctions";
import { usePreferences } from "../../contexts/PreferencesContext";
import { useFeatureFlag } from "../../services/assignmentsStore";
import { getIncognitoMode } from "../../utils/privacy";
import type { RightNowSortOption } from "../../pages/app/rightnow/rightnow-filters-storage";
import type { RightNowFeedEntry, RightNowFeedVersion } from "../../types/right-now";

const RIGHT_NOW_FEED_POLL_MS = 2 * 60_000;

interface RightNowQueryParams {
	sort: RightNowSortOption;
	hosting?: boolean;
	ageMin?: number;
	ageMax?: number;
	sexualPositions?: string;
}

/** Stable key for a feed entry; discreet posts have no profileId. */
export function getRightNowEntryKey(item: RightNowFeedEntry): string {
	return item.kind === "discreet" ? `discreet-${item.id}` : String(item.id ?? item.profileId);
}

/**
 * The feed version the official client would ask for: v6 with the
 * right-now-explicit-images assignment, v5 with right-now-discreet, v4
 * otherwise. All three return the same items.
 */
export function useRightNowFeedVersion(): RightNowFeedVersion {
	const explicitImages = useFeatureFlag("right-now-explicit-images");
	const discreet = useFeatureFlag("right-now-discreet");
	if (explicitImages) return "v6";
	return discreet ? "v5" : "v4";
}

export function useRightNowFeed(params: RightNowQueryParams, enabled = true) {
	const api = useApiFunctions();
	// The feed is located server-side, so the browse location must be part of
	// the key — otherwise a location change keeps serving the old area's posts.
	const { geohash } = usePreferences();
	const version = useRightNowFeedVersion();

	return useQuery({
		queryKey: ["rightnow", "feed", params, geohash, version],
		queryFn: async () => {
			const feed = await api.getRightNowFeed({ ...params, version, geohash });
			// Deduplicate items by their ID to prevent React "duplicate key" errors
			// if the API returns overlapping data during refreshes.
			const seen = new Set<string>();
			return {
				...feed,
				items: feed.items.filter((item) => {
					const key = getRightNowEntryKey(item);
					if (seen.has(key)) return false;
					seen.add(key);
					return true;
				}),
			};
		},
		enabled,
		staleTime: RIGHT_NOW_FEED_POLL_MS,
		// Like open-grind: every 2 minutes while the page is open and visible
		// (react-query pauses the interval while the window is hidden). Not in
		// incognito, which keeps background requests to a minimum.
		refetchInterval: () => (getIncognitoMode() ? false : RIGHT_NOW_FEED_POLL_MS),
		refetchOnWindowFocus: true,
	});
}

const REQUESTS_POLL_MS = 30_000;

/**
 * Requests we sent to discreet posts, keyed by post id. Polled so a card
 * flips to "Open chat" once its author accepts.
 */
export function useSentRightNowRequests(enabled = true) {
	const api = useApiFunctions();
	return useQuery({
		queryKey: ["rightnow", "requests", "outbox"],
		queryFn: async () => {
			const requests = await api.getSentRightNowRequests();
			return new Map(requests.map((request) => [request.postId, request]));
		},
		enabled,
		staleTime: REQUESTS_POLL_MS,
		refetchInterval: enabled ? REQUESTS_POLL_MS : false,
		refetchOnWindowFocus: true,
	});
}

/** Requests others sent to our own (discreet) post. */
export function useReceivedRightNowRequests(enabled = true) {
	const api = useApiFunctions();
	return useQuery({
		queryKey: ["rightnow", "requests", "inbox"],
		queryFn: () => api.getReceivedRightNowRequests(),
		enabled,
		staleTime: REQUESTS_POLL_MS,
		refetchInterval: enabled ? REQUESTS_POLL_MS : false,
		refetchOnWindowFocus: true,
	});
}
