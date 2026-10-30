import { useCallback, useRef, type RefObject } from "react";
import type { ConversationEntry } from "../../../types/messages";
import { getInboxEntryCheckedAt, pickInboxPageForEntry } from "./inboxFreshness";

// A visible range can straddle two pages, and a mis-estimated page costs one
// more — never chase further than this per scroll stop.
const MAX_PAGES_PER_PASS = 3;
const MIN_REQUEST_GAP_MS = 1_000;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stale-while-revalidate for the chat list: given the rows currently in
 * view, refetches only the /v4/inbox page(s) holding rows whose live data is
 * older than `minAgeMs` (see inboxFreshness.ts). One request at a time with a
 * minimum gap; a call arriving mid-pass replaces any queued one, so a fast
 * fling only ever revalidates wherever scrolling finally stops.
 */
export function useInboxRevalidation({
	userId,
	conversationsRef,
	getFilterKey,
	fetchPage,
}: {
	userId: number | null;
	conversationsRef: RefObject<ConversationEntry[]>;
	getFilterKey: () => string;
	fetchPage: (page: number) => Promise<void>;
}) {
	const latestRef = useRef({ userId, getFilterKey, fetchPage });
	latestRef.current = { userId, getFilterKey, fetchPage };
	const isRunningRef = useRef(false);
	const queuedRef = useRef<{ ids: string[]; minAgeMs: number } | null>(null);
	const lastRequestAtRef = useRef(0);

	const runPass = useCallback(
		async (ids: string[], minAgeMs: number) => {
			const attemptedPages = new Set<number>();
			for (let i = 0; i < MAX_PAGES_PER_PASS; i += 1) {
				const { userId: currentUserId, getFilterKey: currentFilterKey, fetchPage: currentFetchPage } =
					latestRef.current;
				if (currentUserId == null || document.hidden) {
					return;
				}
				const filterKey = currentFilterKey();
				const list = conversationsRef.current;
				const indexById = new Map(list.map((entry, index) => [entry.data.conversationId, index] as const));
				const now = Date.now();
				let targetIndex: number | null = null;
				for (const id of ids) {
					const index = indexById.get(id);
					if (index == null) continue;
					if (now - getInboxEntryCheckedAt(currentUserId, filterKey, list[index]) >= minAgeMs) {
						targetIndex = index;
						break;
					}
				}
				if (targetIndex == null) {
					return;
				}

				const page = pickInboxPageForEntry(currentUserId, filterKey, list[targetIndex], targetIndex);
				// Already fetched this pass and the row still isn't covered —
				// the estimate is off in a way another request won't fix now.
				if (attemptedPages.has(page)) {
					return;
				}
				attemptedPages.add(page);

				const wait = lastRequestAtRef.current + MIN_REQUEST_GAP_MS - Date.now();
				if (wait > 0) {
					await sleep(wait);
				}
				lastRequestAtRef.current = Date.now();
				await currentFetchPage(page);
			}
		},
		[conversationsRef],
	);

	return useCallback(
		(ids: string[], minAgeMs: number) => {
			if (ids.length === 0) {
				return;
			}
			if (isRunningRef.current) {
				queuedRef.current = { ids, minAgeMs };
				return;
			}
			isRunningRef.current = true;
			void (async () => {
				let next: { ids: string[]; minAgeMs: number } | null = { ids, minAgeMs };
				try {
					while (next) {
						queuedRef.current = null;
						await runPass(next.ids, next.minAgeMs);
						next = queuedRef.current;
					}
				} finally {
					isRunningRef.current = false;
				}
			})();
		},
		[runPass],
	);
}
