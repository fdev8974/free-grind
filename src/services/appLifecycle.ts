/**
 * Keeps grindr.rs's realtime socket honest across suspend/resume and network
 * changes. Its ping loop never checks for a pong, so a socket that idled
 * through a suspend or a Wi-Fi ↔ mobile switch can sit half-dead, still
 * reporting "connected", until TCP gives up minutes later.
 *
 * - Android: backgrounding deactivates the client (socket closed, FCM covers
 *   notifications); foregrounding resets the transport and reconnects at once.
 * - iOS/desktop: there is no push channel, so the socket stays up in the
 *   background; instead, coming back after a while forces a fresh socket.
 * - Everywhere: the network coming back, or the machine waking from sleep
 *   (detected by timer drift — desktop sleep doesn't flip visibility), forces
 *   a fresh socket too.
 */

import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import { appLog } from "../utils/logger";
import { isTauriRuntime } from "./tauriWebSocket";

const IOS_RESUME_RECONNECT_MS = 15_000;
const DESKTOP_RESUME_RECONNECT_MS = 5 * 60_000;
const WAKE_CHECK_INTERVAL_MS = 15_000;
const WAKE_DRIFT_MS = 60_000;
const RECONNECT_THROTTLE_MS = 5_000;

function currentPlatform(): string | null {
	try {
		return platform();
	} catch {
		return null;
	}
}

let lastReconnectAt = 0;

function forceReconnect(reason: string) {
	const now = Date.now();
	if (now - lastReconnectAt < RECONNECT_THROTTLE_MS) return;
	lastReconnectAt = now;
	appLog.debug(`[lifecycle] forcing ws reconnect (${reason})`);
	invoke("ws_reconnect").catch((error: unknown) => {
		appLog.warn("[lifecycle] ws_reconnect failed", error);
	});
}

function setAppActive(active: boolean) {
	invoke("set_app_active", { active }).catch((error: unknown) => {
		appLog.warn("[lifecycle] set_app_active failed", error);
	});
}

export function installAppLifecycle(): () => void {
	if (!isTauriRuntime() || typeof document === "undefined") {
		return () => {};
	}

	const os = currentPlatform();
	const isAndroid = os === "android";
	const resumeReconnectMs = os === "ios" ? IOS_RESUME_RECONNECT_MS : DESKTOP_RESUME_RECONNECT_MS;
	let hiddenAt: number | null = null;

	const onVisibilityChange = () => {
		if (document.visibilityState === "hidden") {
			hiddenAt = Date.now();
			if (isAndroid) setAppActive(false);
			return;
		}
		const awayMs = hiddenAt === null ? 0 : Date.now() - hiddenAt;
		hiddenAt = null;
		if (isAndroid) {
			setAppActive(true);
		} else if (awayMs >= resumeReconnectMs) {
			forceReconnect(`resumed after ${Math.round(awayMs / 1000)}s`);
		}
	};

	const onOnline = () => forceReconnect("network online");

	let lastTick = Date.now();
	const wakeTimer = window.setInterval(() => {
		const now = Date.now();
		const drift = now - lastTick - WAKE_CHECK_INTERVAL_MS;
		lastTick = now;
		// Android resumes through set_app_active already.
		if (!isAndroid && drift > WAKE_DRIFT_MS && document.visibilityState === "visible") {
			forceReconnect(`woke after ${Math.round(drift / 1000)}s asleep`);
		}
	}, WAKE_CHECK_INTERVAL_MS);

	document.addEventListener("visibilitychange", onVisibilityChange);
	window.addEventListener("online", onOnline);

	// Sync Rust with the actual state on every mount. Rust's active flag
	// outlives the page: a reload (incl. dev hot reload) fires a `hidden`
	// visibilitychange while unloading, which deactivates the client, and the
	// fresh page starts out `visible` with no event to switch it back on.
	// A redundant `true` is a no-op on the Rust side.
	if (document.visibilityState === "hidden") {
		hiddenAt = Date.now();
		if (isAndroid) setAppActive(false);
	} else {
		setAppActive(true);
	}

	return () => {
		document.removeEventListener("visibilitychange", onVisibilityChange);
		window.removeEventListener("online", onOnline);
		window.clearInterval(wakeTimer);
	};
}
