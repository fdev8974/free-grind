/**
 * HotswapUpdatedToastBridge — shows a one-time "updated" toast after either
 * kind of update: an OTA hotswap bundle applied before the last reload, or a
 * newer native app (APK / desktop binary) than the one seen on the last launch.
 */

import { useEffect } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import semver from "semver";
import { consumeHotswapJustUpdatedVersion, isHotswapAvailable } from "../services/hotswap";

const LAST_NATIVE_VERSION_STORAGE_KEY = "fg-last-native-version";

/**
 * Returns the native version if it's newer than on the previous launch, else
 * null. Android kills the app to install an APK update, so nothing can be
 * written at install time; comparing against the last seen version also
 * covers APKs installed by hand. The first launch only records the version.
 */
async function consumeNativeUpdatedVersion(): Promise<string | null> {
	if (!isHotswapAvailable()) return null;
	const current = await getVersion();
	try {
		const previous = window.localStorage.getItem(LAST_NATIVE_VERSION_STORAGE_KEY);
		window.localStorage.setItem(LAST_NATIVE_VERSION_STORAGE_KEY, current);
		if (previous && semver.valid(previous) && semver.valid(current) && semver.gt(current, previous)) {
			return current;
		}
	} catch {
		// Storage unavailable — skip the toast.
	}
	return null;
}

export function HotswapUpdatedToastBridge() {
	const { t } = useTranslation();

	useEffect(() => {
		const showUpdated = (version: string) =>
			toast.success(t("settings.updated_to_version", { version }), {
				// Shared id: an APK update and an OTA bundle in the same launch show one toast.
				id: "hotswap-updated",
				duration: 5000,
			});

		const otaVersion = consumeHotswapJustUpdatedVersion();
		if (otaVersion) showUpdated(otaVersion);

		void consumeNativeUpdatedVersion()
			.then((nativeVersion) => {
				if (nativeVersion && !otaVersion) showUpdated(nativeVersion);
			})
			.catch(() => {});
	}, [t]);

	return null;
}
