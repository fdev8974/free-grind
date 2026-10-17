import { useCallback, useEffect, useRef, useState } from "react";
import i18n from "i18next";

/**
 * In-app APK self-update on Android — the native side lives in ApkUpdater.kt
 * and reports through `fg:apk-update` window events, tagged with the
 * `target` they belong to ("app").
 */
type ApkUpdateBridge = {
	downloadApkUpdate?: (url: string) => boolean;
	installDownloadedApkUpdate?: () => boolean;
	canInstallApkUpdates?: () => boolean;
	openInstallPermissionSettings?: () => boolean;
};

type ApkInstallTarget = "app";

type NativeEvent = { target?: ApkInstallTarget } & (
	| { state: "downloading"; received: number; total: number }
	| { state: "verifying" | "needs-permission" | "installing" | "installed" }
	| { state: "error"; code: string; message?: string }
);

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

const APK_UPDATE_ERRORS: Record<string, [key: string, english: string]> = {
	canceled: ["canceled", "The installation was canceled."],
	network: ["download", "The download failed. Check your connection and try again."],
	http: ["download", "The download failed. Check your connection and try again."],
	incomplete: ["download", "The download failed. Check your connection and try again."],
	"foreign-signer": ["foreign_signer", "This APK is signed differently from the installed app, so Android can't update it in place."],
	incompatible: ["foreign_signer", "This APK is signed differently from the installed app, so Android can't update it in place."],
	downgrade: ["downgrade", "The downloaded version is older than the installed one."],
	storage: ["storage", "Not enough storage to install the update."],
	blocked: ["blocked", "Android blocked the installation."],
	"start-failed": ["start_failed", "Couldn't start the download."],
	"no-asset": ["no_asset", "There's no download for this device's processor."],
	conflict: ["conflict", "A differently signed version is already installed. Uninstall it first, then try again."],
};

export function describeApkUpdateError(code: string): string {
	const [key, english] = APK_UPDATE_ERRORS[code] ?? ["generic", "The update couldn't be installed."];
	return i18n.t(`apk_update.errors.${key}`, { defaultValue: english });
}

/**
 * Tracks one target's install from its native events, and resumes the
 * install of the already downloaded APK when the user comes back from the
 * "install unknown apps" settings screen.
 */
function useApkInstall(target: ApkInstallTarget, enabled: boolean, installDownloadedNative: () => boolean | undefined) {
	const [state, setState] = useState<ApkUpdateState>({ phase: "idle" });

	useEffect(() => {
		if (!enabled) return;
		const handler = (event: Event) => {
			const detail = (event as CustomEvent<NativeEvent>).detail;
			if (!detail || (detail.target ?? "app") !== target) return;
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
	}, [enabled, target]);

	const installDownloadedRef = useRef(installDownloadedNative);
	installDownloadedRef.current = installDownloadedNative;
	const installDownloaded = useCallback(() => {
		if (installDownloadedRef.current()) {
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

	const openPermissionSettings = useCallback(() => {
		getBridge()?.openInstallPermissionSettings?.();
	}, []);

	return { state, setState, installDownloaded, openPermissionSettings };
}

export function useApkUpdate(apkUrl: string | undefined) {
	const supported = Boolean(apkUrl) && isApkUpdateSupported();
	const { state, setState, installDownloaded, openPermissionSettings } = useApkInstall(
		"app",
		supported,
		() => getBridge()?.installDownloadedApkUpdate?.(),
	);

	const start = useCallback(() => {
		const bridge = getBridge();
		if (!bridge || !apkUrl) return;
		if (bridge.downloadApkUpdate?.(apkUrl)) {
			setState({ phase: "downloading", progress: 0 });
		} else {
			setState({ phase: "error", code: "start-failed" });
		}
	}, [apkUrl, setState]);

	return { supported, state, start, installDownloaded, openPermissionSettings };
}
