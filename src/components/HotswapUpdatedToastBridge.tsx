/**
 * HotswapUpdatedToastBridge — shows a one-time "updated" toast after either
 * kind of update: an OTA hotswap bundle applied before the last reload, or a
 * newer native app (APK / desktop binary) than the one seen on the last launch.
 */

import { useEffect } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import semver from "semver";
import { consumeHotswapJustUpdatedVersion, isHotswapAvailable } from "../services/hotswap";
import { buildDate, displayVersion, formatBuildTime } from "../utils/otaVersion";
import { formatRelativeTime } from "../utils/relativeTime";

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
	const { t, i18n } = useTranslation();

	useEffect(() => {
		/**
		 * Same details as the update prompt: release version as the title, then
		 * the commit and — for OTA bundles — when the build was published.
		 */
		const showUpdated = (version: string, commit: string | null) => {
			const release = displayVersion(version) ?? version;
			const builtAt = buildDate(version);
			const details = [
				commit ? t("settings.updated_commit", { defaultValue: "Commit {{commit}}", commit }) : null,
				builtAt ? `${formatBuildTime(builtAt, i18n.language)} (${formatRelativeTime(builtAt.getTime())})` : null,
			].filter(Boolean);

			toast.success(
				<div className="min-w-0">
					<p className="font-medium">{t("settings.updated_to_version", { version: release })}</p>
					{details.length > 0 && (
						<p className="mt-0.5 break-words text-xs opacity-70">{details.join(" · ")}</p>
					)}
				</div>,
				{
					// Shared id: an APK update and an OTA bundle in the same launch show one toast.
					id: "hotswap-updated",
					duration: 6000,
				},
			);
		};

		// After the reload the running frontend is the new bundle, so its commit is the one just installed.
		const otaVersion = consumeHotswapJustUpdatedVersion();
		if (otaVersion) showUpdated(otaVersion, import.meta.env.VITE_COMMIT_HASH || null);

		void consumeNativeUpdatedVersion()
			.then(async (nativeVersion) => {
				if (!nativeVersion || otaVersion) return;
				const nativeCommit = await invoke<string | null>("app_commit_hash").catch(() => null);
				showUpdated(nativeVersion, nativeCommit);
			})
			.catch(() => {});
	}, [t, i18n.language]);

	return null;
}
