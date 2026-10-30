/**
 * inboxFreshness.ts — module-level (so it survives ChatPage/ChatInboxPanel
 * remounts) bookkeeping for the cache-first chat list.
 *
 * Once inboxSync has walked the whole inbox, ChatPage renders every
 * conversation straight from chatDb instead of paging /v4/inbox in order,
 * which makes scroll restoration trivial but means most rows start out
 * showing whatever was last synced. This tracks, per profile:
 *
 * - liveAt: when each conversation was last returned by a live /v4/inbox
 *   response. Volatile fields (rightNow) are only shown while this is recent.
 * - pages: which timestamp window each fetched page covered, keyed by the
 *   server filter set it was fetched with. Used both to pick which page a
 *   stale row lives on, and to count a row the server *didn't* return as
 *   checked anyway (otherwise a conversation the server has dropped would be
 *   refetched forever).
 * - snapshot / scrollAnchor: the last unfiltered list and where it was
 *   scrolled to, so a remount can render and restore synchronously.
 */

import type { ConversationEntry } from "../../../types/messages";

// How old a visible row's live data may get before the scroll-idle check
// refetches its page.
export const INBOX_REVALIDATE_AFTER_MS = 2 * 60_000;
// rightNow is only shown while a live response confirmed it this recently.
export const INBOX_RIGHT_NOW_MAX_AGE_MS = 10 * 60_000;
// Fallback for estimating a row's page from its index until a full page has
// been seen — the live API returns ~190 conversations per page.
const DEFAULT_INBOX_PAGE_SIZE = 190;

export type InboxScrollAnchor = {
	conversationId: string;
	// scrollTop minus the anchor row's start offset.
	offset: number;
};

type InboxPageRecord = {
	// Range of non-pinned lastActivityTimestamps the page covered; page 1
	// extends to +Infinity (it also holds every pinned chat) and the last page
	// to -Infinity.
	newest: number;
	oldest: number;
	count: number;
	hasNext: boolean;
	fetchedAt: number;
};

type UserInboxState = {
	snapshot: ConversationEntry[] | null;
	scrollAnchor: InboxScrollAnchor | null;
	liveAt: Map<string, number>;
	pagesByFilterKey: Map<string, Map<number, InboxPageRecord>>;
};

const stateByUser = new Map<number, UserInboxState>();
const listeners = new Set<() => void>();
let version = 0;

function getState(userId: number): UserInboxState {
	let state = stateByUser.get(userId);
	if (!state) {
		state = { snapshot: null, scrollAnchor: null, liveAt: new Map(), pagesByFilterKey: new Map() };
		stateByUser.set(userId, state);
	}
	return state;
}

function getPages(userId: number, filterKey: string): Map<number, InboxPageRecord> {
	const state = getState(userId);
	let pages = state.pagesByFilterKey.get(filterKey);
	if (!pages) {
		pages = new Map();
		state.pagesByFilterKey.set(filterKey, pages);
	}
	return pages;
}

function activityOf(entry: ConversationEntry): number {
	return entry.data.lastActivityTimestamp ?? 0;
}

export function getInboxFilterKey(filters: unknown): string {
	return JSON.stringify(filters ?? {});
}

export function getInboxSnapshot(userId: number | null): ConversationEntry[] | null {
	return userId == null ? null : (stateByUser.get(userId)?.snapshot ?? null);
}

export function setInboxSnapshot(userId: number, entries: ConversationEntry[]): void {
	getState(userId).snapshot = entries;
}

export function getInboxScrollAnchor(userId: number | null): InboxScrollAnchor | null {
	return userId == null ? null : (stateByUser.get(userId)?.scrollAnchor ?? null);
}

export function setInboxScrollAnchor(userId: number, anchor: InboxScrollAnchor | null): void {
	getState(userId).scrollAnchor = anchor;
}

/**
 * Records a live /v4/inbox response. `page` is null for responses whose
 * position in the pagination isn't meaningful (none currently, but keeps
 * callers honest).
 */
export function recordLiveInboxPage(
	userId: number,
	filterKey: string,
	page: number | null,
	entries: ConversationEntry[],
	hasNext: boolean,
): void {
	const now = Date.now();
	const state = getState(userId);
	for (const entry of entries) {
		state.liveAt.set(entry.data.conversationId, now);
	}

	if (page != null && (entries.length > 0 || page === 1)) {
		const timestamps = entries.filter((entry) => !entry.data.pinned).map(activityOf);
		const record: InboxPageRecord = {
			newest: page === 1 ? Infinity : timestamps.length > 0 ? Math.max(...timestamps) : -Infinity,
			oldest: !hasNext ? -Infinity : timestamps.length > 0 ? Math.min(...timestamps) : Infinity,
			count: entries.length,
			hasNext,
			fetchedAt: now,
		};
		getPages(userId, filterKey).set(page, record);
	}

	version += 1;
	for (const listener of listeners) {
		listener();
	}
}

function findCoveringPage(
	pages: Map<number, InboxPageRecord>,
	entry: ConversationEntry,
): { page: number; fetchedAt: number } | null {
	if (entry.data.pinned) {
		const first = pages.get(1);
		return first ? { page: 1, fetchedAt: first.fetchedAt } : null;
	}
	const activity = activityOf(entry);
	let best: { page: number; fetchedAt: number } | null = null;
	for (const [page, record] of pages) {
		if (activity <= record.newest && activity >= record.oldest) {
			if (!best || record.fetchedAt > best.fetchedAt) {
				best = { page, fetchedAt: record.fetchedAt };
			}
			continue;
		}
		// Between two adjacent fetched pages: the server listed neither side
		// with it, so it's as checked as the older of the two fetches.
		const next = pages.get(page + 1);
		if (next && activity < record.oldest && activity > next.newest) {
			const fetchedAt = Math.min(record.fetchedAt, next.fetchedAt);
			if (!best || fetchedAt > best.fetchedAt) {
				best = { page: page + 1, fetchedAt };
			}
		}
	}
	return best;
}

/** When this row was last verified against the server, 0 if never. */
export function getInboxEntryCheckedAt(
	userId: number,
	filterKey: string,
	entry: ConversationEntry,
): number {
	const state = getState(userId);
	const liveAt = state.liveAt.get(entry.data.conversationId) ?? 0;
	const covering = findCoveringPage(getPages(userId, filterKey), entry);
	return Math.max(liveAt, covering?.fetchedAt ?? 0);
}

/**
 * Best guess at which /v4/inbox page holds `entry`, given its index in the
 * (identically sorted) local list. Known page ranges win over the index
 * estimate, since new conversations at the top shift every index.
 */
export function pickInboxPageForEntry(
	userId: number,
	filterKey: string,
	entry: ConversationEntry,
	index: number,
): number {
	const pages = getPages(userId, filterKey);
	const covering = findCoveringPage(pages, entry);
	if (covering) {
		return covering.page;
	}
	if (entry.data.pinned) {
		return 1;
	}

	let pageSize = DEFAULT_INBOX_PAGE_SIZE;
	for (const record of pages.values()) {
		if (record.hasNext && record.count > 0) {
			pageSize = record.count;
			break;
		}
	}

	const activity = activityOf(entry);
	let page = Math.floor(index / pageSize) + 1;
	// Step away from known pages that rule the estimate out. Bounded, and
	// can't ping-pong: a row between two adjacent known pages is covered above.
	for (let step = 0; step < 50; step += 1) {
		const record = pages.get(page);
		if (!record) break;
		if (activity < record.oldest && record.hasNext) {
			page += 1;
		} else if (activity > record.newest && page > 1) {
			page -= 1;
		} else {
			break;
		}
	}
	return page;
}

export function isInboxRightNowFresh(userId: number | null, conversationId: string, now: number): boolean {
	if (userId == null) {
		return false;
	}
	const liveAt = stateByUser.get(userId)?.liveAt.get(conversationId);
	return liveAt != null && now - liveAt < INBOX_RIGHT_NOW_MAX_AGE_MS;
}

export function subscribeInboxFreshness(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function getInboxFreshnessVersion(): number {
	return version;
}
