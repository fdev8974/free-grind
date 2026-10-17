import { useCallback, useSyncExternalStore } from "react";
import { assertSuccess, parseJsonSafe } from "./apiHelpers";
import { appLog } from "../utils/logger";
import type { RestResponse } from "../types/chat-service";
import {
	type Assignment,
	isAssignmentValueOn,
	parseAssignments,
	parseJwtAssignments,
} from "../utils/assignments";

/**
 * App-wide cache of every assignment / feature flag source, loaded at app
 * start by AssignmentsBridge and mirrored to localStorage per account, so a
 * flag can be read anywhere (`useFeatureFlag`, or `isFeatureOn` outside React)
 * and is already known on the next launch before the refetch lands.
 * See docs/content/grindr-api/analytics/assignments.md.
 */

export type AssignmentSourceId = "jwt" | "account" | "public" | "anonymous";

export type AssignmentSourceState = {
	assignments: Assignment[];
	error: string | null;
};

export type AssignmentsSnapshot = {
	sources: Record<AssignmentSourceId, AssignmentSourceState> | null;
	isLoading: boolean;
	updatedAt: number | null;
};

// Which source wins when a key shows up in several: the account endpoint is
// the most specific (per user + geohash), the anonymous one the least.
const RESOLUTION_ORDER: AssignmentSourceId[] = ["account", "jwt", "public", "anonymous"];

const STORAGE_KEY_PREFIX = "open-grind:assignments:";

export type AssignmentsFetchDeps = {
	request: (path: string, init: { method: "GET" }) => Promise<RestResponse>;
	getSessionToken: () => Promise<string | null | undefined>;
	geohash: string | null;
};

let snapshot: AssignmentsSnapshot = { sources: null, isLoading: false, updatedAt: null };
let resolved = new Map<string, Assignment>();
let currentUserKey: string | null = null;
let loadSeq = 0;
const listeners = new Set<() => void>();

function rebuildResolved() {
	const next = new Map<string, Assignment>();
	if (snapshot.sources) {
		// Lowest priority first so higher ones overwrite.
		for (const id of [...RESOLUTION_ORDER].reverse()) {
			for (const assignment of snapshot.sources[id]?.assignments ?? []) next.set(assignment.key, assignment);
		}
	}
	resolved = next;
}

function setSnapshot(next: AssignmentsSnapshot) {
	snapshot = next;
	rebuildResolved();
	for (const listener of listeners) listener();
}

function storageKey(userKey: string) {
	return `${STORAGE_KEY_PREFIX}${userKey}`;
}

/** Switches the cache to this account, restoring its last stored assignments. */
export function hydrateAssignments(userKey: string | null) {
	if (userKey === currentUserKey) return;
	currentUserKey = userKey;
	// Drops any in-flight load for the previous account.
	loadSeq++;
	let stored: AssignmentsSnapshot["sources"] = null;
	let updatedAt: number | null = null;
	if (userKey) {
		try {
			const raw = window.localStorage.getItem(storageKey(userKey));
			if (raw) {
				const parsed = JSON.parse(raw) as { sources?: AssignmentsSnapshot["sources"]; updatedAt?: number };
				stored = parsed.sources ?? null;
				updatedAt = typeof parsed.updatedAt === "number" ? parsed.updatedAt : null;
			}
		} catch {
			// corrupt/unavailable storage: start empty, the bridge refetches anyway
		}
	}
	setSnapshot({ sources: stored, isLoading: false, updatedAt });
}

async function fetchSource(deps: AssignmentsFetchDeps, path: string): Promise<AssignmentSourceState> {
	try {
		const response = await deps.request(path, { method: "GET" });
		await assertSuccess(response, "Failed to load assignments");
		return { assignments: parseAssignments(await parseJsonSafe(response)), error: null };
	} catch (error) {
		return { assignments: [], error: error instanceof Error ? error.message : String(error) };
	}
}

async function fetchJwt(deps: AssignmentsFetchDeps): Promise<AssignmentSourceState> {
	try {
		const token = await deps.getSessionToken();
		if (!token) return { assignments: [], error: "No active session token" };
		return { assignments: parseJwtAssignments(token), error: null };
	} catch (error) {
		return { assignments: [], error: error instanceof Error ? error.message : String(error) };
	}
}

/** Refetches every source. A source that fails keeps its previously cached assignments. */
export async function refreshAssignments(deps: AssignmentsFetchDeps): Promise<void> {
	const seq = ++loadSeq;
	const userKey = currentUserKey;
	setSnapshot({ ...snapshot, isLoading: true });

	const accountPath = deps.geohash
		? `/v3/assignment?geohash=${encodeURIComponent(deps.geohash)}`
		: "/v3/assignment";
	const [jwt, account, publicFeatures, anonymous] = await Promise.all([
		fetchJwt(deps),
		fetchSource(deps, accountPath),
		fetchSource(deps, "/public/v1/public-features"),
		fetchSource(deps, "/public/v1/assignments"),
	]);
	// A newer load (or an account switch) superseded this one.
	if (seq !== loadSeq) return;

	const fresh: Record<AssignmentSourceId, AssignmentSourceState> = { jwt, account, public: publicFeatures, anonymous };
	const previous = snapshot.sources;
	const sources = { ...fresh };
	for (const id of Object.keys(fresh) as AssignmentSourceId[]) {
		if (!fresh[id].error) continue;
		appLog.warn(`[assignments] ${id} failed:`, fresh[id].error);
		const cached = previous?.[id]?.assignments;
		if (cached && cached.length > 0) sources[id] = { assignments: cached, error: fresh[id].error };
	}
	const updatedAt = Date.now();
	setSnapshot({ sources, isLoading: false, updatedAt });

	if (userKey) {
		try {
			window.localStorage.setItem(storageKey(userKey), JSON.stringify({ sources, updatedAt }));
		} catch {
			// quota/private mode: the in-memory cache still works for this session
		}
	}
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function getSnapshot() {
	return snapshot;
}

/** Resolved assignment for a key across all sources (see RESOLUTION_ORDER). Non-reactive. */
export function getAssignment(key: string): Assignment | null {
	return resolved.get(key) ?? null;
}

/** Non-reactive feature check, for use outside React. False until the key is known. */
export function isFeatureOn(key: string): boolean {
	const assignment = resolved.get(key);
	return assignment ? isAssignmentValueOn(assignment.value) : false;
}

export function useAssignmentsSnapshot(): AssignmentsSnapshot {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useAssignment(key: string): Assignment | null {
	const getter = useCallback(() => resolved.get(key) ?? null, [key]);
	return useSyncExternalStore(subscribe, getter, getter);
}

/** Reactive feature check: false while unknown, so gated UI stays hidden by default. */
export function useFeatureFlag(key: string): boolean {
	const assignment = useAssignment(key);
	return assignment ? isAssignmentValueOn(assignment.value) : false;
}
