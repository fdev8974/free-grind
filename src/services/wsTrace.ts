/**
 * In-memory log of the realtime socket's traffic for the WebSocket Explorer:
 * every frame ChatRealtimeManager receives or sends, plus connection changes.
 * Like apiTrace it records from app start, so the history is there when the
 * explorer opens.
 */

export type WsTraceDirection = "in" | "out" | "status";

export interface WsTraceEntry {
	id: string;
	timestamp: number;
	direction: WsTraceDirection;
	/** The envelope's `type` (e.g. `chat.v1.message_sent`), or the connection event for status entries. */
	type: string;
	ref: string | null;
	/** HTTP-shaped status of a `.response`, if it carries one. */
	status: number | null;
	/** The raw frame (or the status event's details). */
	data: string;
}

export type WsConnectionState = "connected" | "reconnecting" | "disconnected";

const MAX_ENTRIES = 500;
const MAX_PREVIEW_LENGTH = 20000;

let entries: WsTraceEntry[] = [];
let connection: WsConnectionState = "disconnected";
const listeners = new Set<() => void>();
let nextId = 1;

function emit() {
	for (const listener of listeners) {
		listener();
	}
}

function trimPreview(value: string): string {
	return value.length <= MAX_PREVIEW_LENGTH ? value : `${value.slice(0, MAX_PREVIEW_LENGTH)}\n... (truncated)`;
}

function add(entry: Omit<WsTraceEntry, "id" | "timestamp">) {
	entries = [{ id: String(nextId++), timestamp: Date.now(), ...entry, data: trimPreview(entry.data) }, ...entries].slice(0, MAX_ENTRIES);
	emit();
}

/** A frame as text: type, ref and status are read from it when it's an envelope. */
export function traceWsFrame(direction: "in" | "out", raw: string) {
	let type = "(unparsed)";
	let ref: string | null = null;
	let status: number | null = null;
	try {
		const envelope = JSON.parse(raw) as Record<string, unknown>;
		if (typeof envelope.type === "string") type = envelope.type;
		if (typeof envelope.ref === "string") ref = envelope.ref;
		if (typeof envelope.status === "number") status = envelope.status;
	} catch {
		// Kept as is; the explorer shows the raw text.
	}
	add({ direction, type, ref, status, data: raw });
}

export function traceWsStatus(type: "open" | "close" | "lagged" | "error", details: unknown) {
	if (type === "open") connection = "connected";
	else if (type === "close") connection = "reconnecting";
	add({ direction: "status", type, ref: null, status: null, data: JSON.stringify(details ?? {}, null, 2) });
}

/** For connection changes that come without a socket event (manager start/stop, ws_status). */
export function setWsConnectionState(next: WsConnectionState) {
	if (connection === next) return;
	connection = next;
	emit();
}

export function getWsTraceEntries(): WsTraceEntry[] {
	return entries;
}

export function getWsConnectionState(): WsConnectionState {
	return connection;
}

export function clearWsTraceEntries() {
	entries = [];
	emit();
}

export function subscribeWsTrace(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function exportWsTraceEntries(): string {
	return JSON.stringify(entries, null, 2);
}
