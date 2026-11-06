import { useQuery } from "@tanstack/react-query";
import { useApiFunctions } from "../useApiFunctions";
import type { RightNowEntitlements } from "../../types/right-now";

/**
 * Right Now post entitlement (GET /v1/rightnow/entitlements/posts). The
 * count depends on the browse location and refills over time, so it is keyed
 * by geohash and refreshed now and then.
 */
export function useEntitlements(userId: number | null, geohash: string | null, enabled = true) {
	const api = useApiFunctions();
	return useQuery<RightNowEntitlements>({
		queryKey: ["entitlements", userId, geohash],
		queryFn: () => api.getEntitlements(),
		staleTime: 10 * 60 * 1000,
		enabled: enabled && !!userId,
	});
}
