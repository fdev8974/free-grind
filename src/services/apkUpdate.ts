import { useCallback, useEffect, useState } from "react";

/**
 * In-app APK self-update on Android — the native side lives in
 * ApkUpdater.kt and reports through `fg:apk-update` window events.
 */
type ApkUpdateBridge = {
	downloadApkUpdate?: (url: string) => boolean;
	installDownloadedApkUpdate?: () => boolean;
	canInstallApkUpdates?: () => boolean;
	openInstallPermissionSettings?: () => boolean;
};

type NativeEvent =
	| { state: "downloading"; received: number; total: number }
	| { state: "verifying" | "needs-permission" | "installing" | "installed" }
	| { state: "error"; code: string; message?: string };

export type ApkUpdateState =
	| { phase: "idle" }
	| { phase: "downloading"; progress: number | null }
	| { phase: "verifying" | "needs-permission" | "installing" | "installed" }
	| { phase: "error"; code: string; message?: string };

function getBridge(): ApkUpdateBridge | null {
	const bridge = (window as unknown as { FreeGrindBridge?: ApkUpdateBridge }).FreeGrindBridge;
	return bridge?.downloadApkUpdate ? bridge : null;
}

export function isApkUpdateSupported(): boolean {
	return getBridge() !== null;
}

export function describeApkUpdateError(code: string): string {
	switch (code) {
		case "canceled":
			return "The installation was canceled.";
		case "network":
		case "http":
		case "incomplete":
			return "The download failed. Check your connection and try again.";
		case "foreign-signer":
		case "incompatible":
			return "This APK is signed differently from the installed app, so Android can't update it in place.";
		case "downgrade":
			return "The downloaded version is older than the installed one.";
		case "storage":
			return "Not enough storage to install the update.";
		case "blocked":
			return "Android blocked the installation.";
		case "start-failed":
			return "Couldn't start the download.";
		default:
			return "The update couldn't be installed.";
	}
}

export function useApkUpdate(apkUrl: string | undefined) {
	const [state, setState] = useState<ApkUpdateState>({ phase: "idle" });
	const supported = Boolean(apkUrl) && isApkUpdateSupported();

	useEffect(() => {
		if (!supported) return;
		const handler = (event: Event) => {
			const detail = (event as CustomEvent<NativeEvent>).detail;
			if (!detail) return;
			if (detail.state === "downloading") {
				setState({
					phase: "downloading",
					progress: detail.total > 0 ? Math.min(1, detail.received / detail.total) : null,
				});
			} else if (detail.state === "error") {
				setState({ phase: "error", code: detail.code, message: detail.message });
			} else {
				setState({ phase: detail.state });
			}
		};
		window.addEventListener("fg:apk-update", handler);
		return () => window.removeEventListener("fg:apk-update", handler);
	}, [supported]);

	const installDownloaded = useCallback(() => {
		if (getBridge()?.installDownloadedApkUpdate?.()) {
			setState({ phase: "verifying" });
		}
	}, []);

	// Coming back from the "install unknown apps" settings screen: continue
	// with the APK that's already on disk instead of downloading it again.
	useEffect(() => {
		if (state.phase !== "needs-permission") return;
		const resume = () => {
			if (document.visibilityState !== "visible") return;
			if (getBridge()?.canInstallApkUpdates?.()) installDownloaded();
		};
		document.addEventListener("visibilitychange", resume);
		window.addEventListener("focus", resume);
		return () => {
			document.removeEventListener("visibilitychange", resume);
			window.removeEventListener("focus", resume);
		};
	}, [state.phase, installDownloaded]);

	const start = useCallback(() => {
		const bridge = getBridge();
		if (!bridge || !apkUrl) return;
		if (bridge.downloadApkUpdate?.(apkUrl)) {
			setState({ phase: "downloading", progress: 0 });
		} else {
			setState({ phase: "error", code: "start-failed" });
		}
	}, [apkUrl]);

	const openPermissionSettings = useCallback(() => {
		getBridge()?.openInstallPermissionSettings?.();
	}, []);

	return { supported, state, start, installDownloaded, openPermissionSettings };
}
