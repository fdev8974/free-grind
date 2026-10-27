export type RealtimeStatus =
	| "idle"
	| "polling"
	| "connecting"
	| "connected"
	| "reconnecting"
	| "disconnected"
	| "error";

export interface RealtimeEnvelope {
	type?: string;
	event?: string;
	timestamp?: number;
	payload?: unknown;
	data?: unknown;
	[key: string]: unknown;
}

export interface ChatRealtimeManagerOptions {
	onEvent: (event: RealtimeEnvelope) => void;
	onStatusChange?: (status: RealtimeStatus) => void;
	/** The socket came back after a drop; events in the gap were missed. */
	onReconnect?: () => void;
	/** The Rust bridge fell behind and discarded events. */
	onEventsDropped?: () => void;
	onParseError?: (raw: unknown, error: unknown) => void;
}
