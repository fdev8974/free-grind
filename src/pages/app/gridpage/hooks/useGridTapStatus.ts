import { useMemo } from "react";
import { useInterestData } from "../../../../hooks/queries/useInterestQueries";
import type { InterestItem } from "../../interest/interestUtils";

export type GridTapStatus = {
	/** Tap type you sent within the window, or null. */
	sent: number | null;
	/** Tap type you received within the window, or null. */
	received: number | null;
};

type LocalSentTap = { sentAt: number; tapId: number };

function toEpochMs(timestamp: number | null | undefined): number | null {
	if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return null;
	return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

function isRecent(timestamp: number | null | undefined, windowMs: number, now: number): boolean {
	const ms = toEpochMs(timestamp);
	if (ms === null) return false;
	const age = now - ms;
	return age >= 0 && age < windowMs;
}

/**
 * Per-profile tap status for the grid, built from the interest query (sent +
 * received taps) — the same cached query NavBar keeps warm app-wide, so this
 * costs no extra requests. Taps sent this session (`localSentTaps`) are merged
 * on top so a tile updates immediately instead of waiting for a refetch.
 */
export function useGridTapStatus(
	windowMs: number,
	localSentTaps: Record<string, LocalSentTap>,
): Record<string, GridTapStatus> {
	const { data } = useInterestData();

	return useMemo(() => {
		const now = Date.now();
		const result: Record<string, GridTapStatus> = {};
		const entry = (profileId: string) => (result[profileId] ??= { sent: null, received: null });

		const apply = (items: InterestItem[] | undefined, field: keyof GridTapStatus) => {
			for (const item of items ?? []) {
				if (!isRecent(item.timestamp, windowMs, now)) continue;
				entry(item.profileId)[field] = item.tapType ?? 1;
			}
		};
		apply(data?.sentTaps, "sent");
		apply(data?.taps, "received");

		for (const [profileId, local] of Object.entries(localSentTaps)) {
			if (isRecent(local.sentAt, windowMs, now)) entry(profileId).sent = local.tapId;
		}

		return result;
	}, [data?.sentTaps, data?.taps, localSentTaps, windowMs]);
}
