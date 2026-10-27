/**
 * pushEventLog.ts — records what the native push pipeline hands the WebView,
 * for the Push Token (FCM) diagnostics sheet: every `fg:push-notification`
 * (FCM pushes as "received", notification taps as "opened") and every
 * `fg:fcm-token`. Started once at launch so events from before the sheet was
 * opened are kept, and persisted (newest LOG_MAX) across restarts.
 *
 * FCM pushes are handed over before native decides whether to show them, so
 * pushes that arrive while the app is open (and are suppressed in favour of
 * the realtime bridge) show up here too. Pushes native drops outright
 * (duplicates, tracking/campaign, unsupported version) never reach the
 * WebView and so aren't logged.
 *
 * Local diagnostics only — this holds message texts, so it never leaves the
 * device.
 */

const STORAGE_KEY = "fg-push-event-log";
const LOG_MAX = 50;

export type PushLogEntry = {
	id: string;
	at: number;
	kind: "push" | "token";
	payload: unknown;
};

let entries: PushLogEntry[] = load();
let started = false;
const listeners = new Set<() => void>();

function load(): PushLogEntry[] {
	try {
		const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
		return Array.isArray(parsed) ? (parsed as PushLogEntry[]) : [];
	} catch {
		return [];
	}
}

function record(kind: PushLogEntry["kind"], payload: unknown) {
	const at = Date.now();
	entries = [...entries, { id: `${at}-${Math.random().toString(36).slice(2, 8)}`, at, kind, payload }].slice(-LOG_MAX);
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
	} catch {
		// Storage full: the in-memory log still works.
	}
	for (const listener of listeners) listener();
}

export function startPushEventLog(): void {
	if (started) return;
	started = true;
	// Dispatched before this listener existed (cold start from a push).
	const queued = (window as Window & { __FG_PUSH_NOTIFICATIONS?: unknown }).__FG_PUSH_NOTIFICATIONS;
	if (Array.isArray(queued)) {
		for (const payload of queued) record("push", payload);
	}
	window.addEventListener("fg:push-notification", (event) => record("push", (event as CustomEvent).detail));
	window.addEventListener("fg:fcm-token", (event) => record("token", (event as CustomEvent).detail));
}

export function subscribePushEventLog(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function getPushEventLog(): PushLogEntry[] {
	return entries;
}

export function clearPushEventLog(): void {
	entries = [];
	try {
		window.localStorage.removeItem(STORAGE_KEY);
	} catch {
		// ignore
	}
	for (const listener of listeners) listener();
}

/** The whole log as readable JSON, oldest first — for export / copy all. */
export function exportPushEventLog(): string {
	return JSON.stringify(
		entries.map((entry) => ({ at: new Date(entry.at).toISOString(), kind: entry.kind, payload: expandJsonStrings(entry.payload) })),
		null,
		2,
	);
}

/**
 * The payload with string values that hold JSON (a push's `message`,
 * `bodyArgs`, …) parsed in place, so the whole thing reads as one tree.
 */
export function expandJsonStrings(value: unknown): unknown {
	if (typeof value === "string") {
		const trimmed = value.trim();
		if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
			try {
				return expandJsonStrings(JSON.parse(trimmed));
			} catch {
				return value;
			}
		}
		return value;
	}
	if (Array.isArray(value)) return value.map(expandJsonStrings);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, expandJsonStrings(inner)]));
	}
	return value;
}
