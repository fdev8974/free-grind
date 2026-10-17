import { invoke } from "@tauri-apps/api/core";
import { isAndroid, isIos } from "./saveMedia";
import { isTauriRuntime } from "./tauriWebSocket";

// tauri-plugin-barcode-scanner, called directly instead of through its JS
// package; the plugin is only compiled in for Android and iOS (lib.rs).

type PermissionState = "granted" | "denied" | "prompt" | "prompt-with-rationale";

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

/** Opens the full-screen camera and resolves with the first QR code it reads. */
export async function scanQrCode(): Promise<string> {
	await ensureCameraPermission();
	try {
		const result = await invoke<{ content: string }>("plugin:barcode-scanner|scan", {
			windowed: false,
			formats: ["QR_CODE"],
		});
		return result.content;
	} catch (error) {
		const message = String(error);
		// The plugin rejects with "cancelled" when the user backs out of the camera.
		if (/cancel/i.test(message)) throw new QrScanError("cancelled", message);
		throw new QrScanError("failed", message);
	}
}
