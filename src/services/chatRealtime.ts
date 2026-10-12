/**
 * ChatRealtimeManager — the webview's view of the Rust-owned realtime socket.
 *
 * grindr.rs owns the one real socket (auth, fingerprinting, reconnect with
 * backoff) and forwards everything as `grindr-ws://event`. This class keeps a
 * single listener on that stream for as long as it runs and mirrors the Rust
 * connection state; it deliberately has no reconnect logic of its own. An
 * earlier per-socket wrapper with its own JS backoff unregistered its listener
 * on every Rust-side drop and only re-listened once its own (longer) timer
 * fired, silently losing every event that arrived in between — and its
 * "reconnects" never reached the real socket anyway.
 *
 * Forcing a fresh socket (resume, network change) is `appLifecycle`'s job.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
	ChatRealtimeManagerOptions,
	RealtimeEnvelope,
	RealtimeStatus,
} from "../types/chat-realtime";
import { appLog } from "../utils/logger";
import { logWsEventToTerminal } from "./tauriWebSocket";

type BridgeEvent =
	| { kind: "open" }
	| { kind: "message"; data: string }
	| { kind: "lagged"; skipped: number }
	| { kind: "close"; code: number; reason: string }
	| { kind: "error"; message: string };

const WS_EVENT_NAME = "grindr-ws://event";
const COMMAND_TIMEOUT_MS = 10_000;
// How long a sent message stays eligible for the message_sent fallback match,
// even after its command timed out — a late echo must still land on it, not
// on a newer send to the same person.
const SEND_MATCH_WINDOW_MS = 60_000;

type PendingSend = { ref: string; targetId: string | null; type: unknown; sentAt: number };

function messageSendTarget(payload: unknown): { targetId: string | null; type: unknown } {
	const p = payload as { type?: unknown; target?: { targetId?: unknown } } | null;
	const targetId = p?.target?.targetId;
	return {
		targetId: targetId == null ? null : String(targetId),
		type: p?.type,
	};
}

export class ChatRealtimeManager {
	private readonly options: ChatRealtimeManagerOptions;
	private unlisten: UnlistenFn | null = null;
	private stopped = true;
	// Bumped on every start/stop so a listen() or ws_status that resolves after
	// the run it belonged to has ended can tell and back out.
	private generation = 0;
	// Bumped on every open/close event, so a ws_status answer that raced one
	// doesn't overwrite the newer state the event carried.
	private stateVersion = 0;
	private connected = false;
	private hasConnected = false;
	private pendingCommands = new Map<
		string,
		{ resolve: (result: unknown) => void; reject: (err: Error) => void; timer: number }
	>();
	// chat.v1.message.send commands still eligible for the message_sent
	// fallback match (see dispatchEvent), oldest first.
	private pendingSends: PendingSend[] = [];

	constructor(options: ChatRealtimeManagerOptions) {
		this.options = options;
	}

	start() {
		if (!this.stopped) {
			return;
		}
		this.stopped = false;
		const generation = ++this.generation;
		this.setStatus("connecting");
		void this.bootstrap(generation);
	}

	stop(options?: { suppressStatus?: boolean }) {
		if (this.stopped) {
			return;
		}
		this.stopped = true;
		this.generation += 1;
		this.unlisten?.();
		this.unlisten = null;
		this.connected = false;
		this.hasConnected = false;
		this.clearPendingCommands(new Error("WebSocket stopped"));
		if (!options?.suppressStatus) {
			this.setStatus("disconnected");
		}
	}

	send(commandType: string, payload: unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (this.stopped || !this.connected) {
				reject(new Error("WebSocket not connected"));
				return;
			}
			const ref = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
			const timer = window.setTimeout(() => {
				// The send stays in pendingSends: the command did go out, so a
				// late message_sent still belongs to it, not to the next send.
				this.pendingCommands.delete(ref);
				reject(new Error("WebSocket command timed out"));
			}, COMMAND_TIMEOUT_MS);
			this.pendingCommands.set(ref, { resolve, reject, timer });
			if (commandType === "chat.v1.message.send") {
				const now = Date.now();
				this.pendingSends = this.pendingSends.filter(
					(p) => now - p.sentAt < SEND_MATCH_WINDOW_MS,
				);
				this.pendingSends.push({ ref, ...messageSendTarget(payload), sentAt: now });
			}
			// The Rust side injects the session token itself.
			const msg = { type: commandType, ref, payload };
			appLog.debug("[chat-ws:send] outgoing", JSON.stringify(msg));
			invoke("ws_send", { payload: JSON.stringify(msg) }).catch((err: unknown) => {
				const pending = this.pendingCommands.get(ref);
				if (!pending) return;
				window.clearTimeout(pending.timer);
				this.pendingCommands.delete(ref);
				this.pendingSends = this.pendingSends.filter((p) => p.ref !== ref);
				reject(err instanceof Error ? err : new Error(String(err)));
			});
		});
	}

	isConnected(): boolean {
		return !this.stopped && this.connected;
	}

	private async bootstrap(generation: number) {
		try {
			const unlisten = await listen<BridgeEvent>(WS_EVENT_NAME, (event) => {
				if (generation !== this.generation) return;
				this.handleEvent(event.payload);
			});
			if (generation !== this.generation) {
				unlisten();
				return;
			}
			this.unlisten = unlisten;

			// Starts grindr.rs's socket task unless it's already running.
			await invoke("ws_connect");

			// The bridge only reports transitions; the socket may well be up
			// already (manager restarted for a new user, StrictMode remount).
			const version = this.stateVersion;
			const connected = await invoke<boolean>("ws_status");
			if (generation !== this.generation || version !== this.stateVersion) {
				return;
			}
			if (connected) {
				this.markConnected();
			}
		} catch (error) {
			appLog.warn("[chat-ws] bootstrap failed", error);
			if (generation === this.generation) {
				this.setStatus("error");
			}
		}
	}

	private handleEvent(event: BridgeEvent) {
		switch (event.kind) {
			case "open":
				this.stateVersion += 1;
				this.markConnected();
				return;
			case "close":
				this.stateVersion += 1;
				appLog.debug("[chat-ws] close", event);
				this.connected = false;
				this.clearPendingCommands(new Error("WebSocket closed"));
				// grindr.rs reconnects on its own; nothing to schedule here.
				this.setStatus("reconnecting");
				return;
			case "message":
				this.handleMessage(event.data);
				return;
			case "lagged":
				appLog.warn(`[chat-ws] bridge dropped ${event.skipped} events`);
				this.options.onEventsDropped?.();
				return;
			case "error":
				appLog.warn("[chat-ws] error", event.message);
				return;
		}
	}

	private markConnected() {
		// grindr.rs re-sends Connected without a Disconnected in between in
		// some paths; only a real transition counts.
		if (this.connected) return;
		this.connected = true;
		this.setStatus("connected");
		if (this.hasConnected) {
			this.options.onReconnect?.();
		}
		this.hasConnected = true;
	}

	private handleMessage(data: string) {
		let envelope: RealtimeEnvelope;
		try {
			envelope = JSON.parse(data) as RealtimeEnvelope;
		} catch (error) {
			this.options.onParseError?.(data, error);
			return;
		}
		this.dispatchEvent(envelope);
	}

	private setStatus(next: RealtimeStatus) {
		this.options.onStatusChange?.(next);
	}

	private clearPendingCommands(err: Error) {
		for (const pending of this.pendingCommands.values()) {
			window.clearTimeout(pending.timer);
			pending.reject(err);
		}
		this.pendingCommands.clear();
		this.pendingSends = [];
	}

	private dispatchEvent(envelope: RealtimeEnvelope) {
		appLog.debug("[chat-ws:recv] incoming", JSON.stringify(envelope));
		const eventType = (envelope as Record<string, unknown>).type as string | undefined;
		// appLog.debug never reaches the Tauri terminal (browser-console-only,
		// stripped in prod builds) — mirror just the readable event name there
		// too, so event traffic is visible without devtools open.
		logWsEventToTerminal(eventType ?? "(no type)");
		// Every command is answered on `<type>.response`, echoing our ref and
		// carrying an HTTP-shaped status.
		const ref = (envelope as Record<string, unknown>).ref as string | undefined;
		if (ref) {
			this.pendingSends = this.pendingSends.filter((p) => p.ref !== ref);
			const pending = this.pendingCommands.get(ref);
			if (pending) {
				window.clearTimeout(pending.timer);
				this.pendingCommands.delete(ref);
				const status = (envelope as Record<string, unknown>).status as number | undefined;
				if (status != null && status >= 400) {
					pending.reject(new Error(`WS command failed with status ${status}`));
				} else {
					pending.resolve(envelope.payload);
				}
				return;
			}
		}
		// A response whose command already settled (timed out, or matched via
		// the fallback below) — nothing else consumes these.
		if (eventType?.endsWith(".response")) {
			return;
		}
		// Fallback for message sends, in case the response is late or missing:
		// the chat.v1.message_sent echo (ref always null). That event fires for
		// *every* message in our conversations, incoming ones included, so only
		// take one we sent to that send's recipient — never one from them.
		if (eventType === "chat.v1.message_sent") {
			const msg = envelope.payload as
				| { senderId?: unknown; conversationId?: unknown; type?: unknown }
				| undefined;
			const participants =
				typeof msg?.conversationId === "string" ? msg.conversationId.split(":") : [];
			const index = this.pendingSends.findIndex(
				(p) =>
					p.targetId != null &&
					String(msg?.senderId) !== p.targetId &&
					participants.includes(p.targetId) &&
					msg?.type === p.type,
			);
			if (index !== -1) {
				const [match] = this.pendingSends.splice(index, 1);
				const pending = this.pendingCommands.get(match.ref);
				if (pending) {
					window.clearTimeout(pending.timer);
					this.pendingCommands.delete(match.ref);
					pending.resolve(envelope.payload);
				}
				// Fall through to onEvent so ChatRealtimeBridge still persists the message
			}
		}
		this.options.onEvent(envelope);
	}
}

let _activeManager: ChatRealtimeManager | null = null;

export function setActiveRealtimeManager(
	manager: ChatRealtimeManager | null,
) {
	_activeManager = manager;
}

export function sendViaRealtime(
	commandType: string,
	payload: unknown,
): Promise<unknown> {
	if (!_activeManager?.isConnected()) {
		return Promise.reject(new Error("WebSocket not available"));
	}
	return _activeManager.send(commandType, payload);
}
