import { useQuery } from "@tanstack/react-query";
import { useApiFunctions } from "../useApiFunctions";
import { usePreferences } from "../../contexts/PreferencesContext";
import { useFeatureFlag } from "../../services/assignmentsStore";
import type { RightNowSortOption } from "../../pages/app/rightnow/rightnow-filters-storage";
import type { RightNowFeedEntry, RightNowFeedVersion } from "../../types/right-now";

import { DEFAULT_STALE_TIME_MS } from "../../config/ui-constants";

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

export function useRightNowFeed(params: RightNowQueryParams) {
	const api = useApiFunctions();
	// The feed is located server-side, so the browse location must be part of
	// the key — otherwise a location change keeps serving the old area's posts.
	const { geohash } = usePreferences();
	const version = useRightNowFeedVersion();

	return useQuery({
		queryKey: ["rightnow", "feed", params, geohash, version],
		queryFn: async () => {
			const feed = await api.getRightNowFeed({ ...params, version });
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
		staleTime: DEFAULT_STALE_TIME_MS,
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
