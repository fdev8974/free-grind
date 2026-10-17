import { invoke } from "@tauri-apps/api/core";
import { isAndroid, isIos } from "./saveMedia";
import { isTauriRuntime } from "./tauriWebSocket";

// tauri-plugin-barcode-scanner, called directly instead of through its JS
// package; the plugin is only compiled in for Android and iOS (lib.rs).

type PermissionState = "granted" | "denied" | "prompt" | "prompt-with-rationale";

/** Set on <html> while scanning; layout.css makes the app see-through then. */
const SCANNING_CLASS = "qr-scanning";

export class QrScanError extends Error {
	constructor(readonly reason: "permissionDenied" | "cancelled" | "failed", detail?: string) {
		super(detail ?? reason);
		this.name = "QrScanError";
	}
}

export function isQrScanSupported(): boolean {
	return isTauriRuntime() && (isAndroid() || isIos());
}

async function ensureCameraPermission(): Promise<void> {
	const { camera } = await invoke<{ camera: PermissionState }>("plugin:barcode-scanner|check_permissions");
	if (camera === "granted") return;
	const requested = await invoke<{ camera: PermissionState }>("plugin:barcode-scanner|request_permissions");
	if (requested.camera !== "granted") throw new QrScanError("permissionDenied");
}

/**
 * Shows the camera and resolves with the first QR code it reads. Windowed:
 * the camera sits *behind* the webview, so the page stays on top to draw its
 * own controls (QrScanOverlay) — the plugin's full-screen mode has no way out.
 */
export async function scanQrCode(): Promise<string> {
	await ensureCameraPermission();
	document.documentElement.classList.add(SCANNING_CLASS);
	try {
		const result = await invoke<{ content: string }>("plugin:barcode-scanner|scan", {
			windowed: true,
			formats: ["QR_CODE"],
		});
		return result.content;
	} catch (error) {
		const message = String(error);
		// cancelQrScan() makes the plugin reject the pending scan with "cancelled".
		if (/cancel/i.test(message)) throw new QrScanError("cancelled", message);
		throw new QrScanError("failed", message);
	} finally {
		document.documentElement.classList.remove(SCANNING_CLASS);
	}
}

/** Stops a running scanQrCode(), which then rejects as "cancelled". */
export async function cancelQrScan(): Promise<void> {
	await invoke("plugin:barcode-scanner|cancel").catch(() => {});
}
