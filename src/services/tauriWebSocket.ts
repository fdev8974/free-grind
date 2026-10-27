import { invoke } from "@tauri-apps/api/core";

export function isTauriRuntime(): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	const w = window as unknown as { __TAURI_INTERNALS__?: unknown };
	return Boolean(w.__TAURI_INTERNALS__);
}

// Mirrors a short, human-readable line to this process's own terminal (via
// the `ws_log_event` Rust command's eprintln!) — unlike appLog.debug, which
// only ever reaches the browser DevTools console and is stripped entirely in
// production builds. No-ops outside Tauri (plain browser dev, `vite dev`).
export function logWsEventToTerminal(message: string): void {
	if (!isTauriRuntime()) return;
	void invoke("ws_log_event", { message }).catch(() => {
		// Best-effort only — never let terminal logging break the WS pipeline.
	});
}
