import { Download, Loader2, RefreshCcw, Zap } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
	dismissPendingHotswapUpdate,
	getActiveHotswapVersion,
	getHotswapProgress,
	getPendingHotswapUpdate,
	installHotswapUpdate,
	isHotswapAutoUpdateEnabled,
	setHotswapAutoUpdateEnabled,
	subscribeHotswapAutoUpdate,
	subscribeHotswapProgress,
	subscribePendingHotswapUpdate,
	type HotswapProgress,
	type PendingHotswapUpdate,
} from "../services/hotswap";
import { appLog } from "../utils/logger";
import { FullscreenPrompt, fullscreenPrimaryButtonClass, fullscreenSecondaryButtonClass, fullscreenCardClass } from "./FullscreenPrompt";
import { ToggleRow } from "./ui/toggle-row";
import { VersionCompare, type VersionCompareSide } from "./ui/version-compare";
import { hourCycleOptions } from "../utils/timeFormat";
import { formatRelativeTime } from "../utils/relativeTime";

/**
 * OTA bundle versions look like `1.2.0-ota.development.1729500000` (see
 * scripts/publish-ota.mjs) — only the release part is meaningful to users.
 */
function displayVersion(version: string | null): string | null {
	return version?.replace(/-ota\..*$/, "") || null;
}

/** The trailing Unix-seconds sequence of an OTA version is its publish time. */
function buildDate(version: string | null): Date | null {
	const seconds = Number(version?.match(/-ota\..*\.(\d{9,})$/)?.[1]);
	return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
}

/** Release part of a bundle version; the embedded frontend has the app's own. */
function releaseOf(version: string | null): string | null {
	return displayVersion(version) ?? import.meta.env.VITE_APP_VERSION ?? null;
}

/**
 * "Today, 09:12" / "Yesterday, 14:03" / "Monday, 14:03" within the last week,
 * else a medium date — the build time is the only thing telling OTA bundles apart.
 */
function formatBuildTime(date: Date, lang: string): string {
	const time = date.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", ...hourCycleOptions() });
	const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const daysAgo = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
	if (daysAgo === 0 || daysAgo === 1) {
		const day = new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(-daysAgo, "day");
		return `${day.charAt(0).toLocaleUpperCase(lang)}${day.slice(1)}, ${time}`;
	}
	if (daysAgo > 1 && daysAgo < 7) {
		return `${date.toLocaleDateString(lang, { weekday: "long" })}, ${time}`;
	}
	return date.toLocaleString(lang, { dateStyle: "medium", timeStyle: "short", ...hourCycleOptions() });
}

/** How much newer the new build is, in its largest whole unit ("3 days newer"). */
function newerBy(t: TFunction, newer: Date, older: Date): string | null {
	const minutes = Math.floor((newer.getTime() - older.getTime()) / 60_000);
	if (minutes < 1) return null;
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (days > 0) return t("ota_prompt.newer_days", { defaultValue: "{{count}} days newer", count: days });
	if (hours > 0) return t("ota_prompt.newer_hours", { defaultValue: "{{count}} hours newer", count: hours });
	return t("ota_prompt.newer_minutes", { defaultValue: "{{count}} minutes newer", count: minutes });
}

/**
 * One side of the installed → new comparison. OTA bundles usually keep the
 * release version and only differ in build time, so the version is only shown
 * when it actually changes.
 */
function bundleSide(
	t: TFunction,
	lang: string,
	label: string,
	version: string | null,
	showVersion: boolean,
	/** Installed version, for the "… newer" hint on the new build. */
	comparedTo?: string | null,
): VersionCompareSide {
	const release = showVersion ? releaseOf(version) : null;
	const builtAt = buildDate(version);
	const olderBuild = buildDate(comparedTo ?? null);
	const newer = builtAt && olderBuild ? newerBy(t, builtAt, olderBuild) : null;

	return {
		label,
		title: builtAt ? formatBuildTime(builtAt, lang) : t("ota_prompt.built_in", { defaultValue: "Included with the app" }),
		detail:
			release || builtAt ? (
				<>
					{release ? t("ota_prompt.version", { defaultValue: "Version {{version}}", version: release }) : null}
					{release && builtAt ? " · " : null}
					{builtAt ? formatRelativeTime(builtAt.getTime()) : null}
					{newer && <span className="font-medium text-[var(--accent)]"> · {newer}</span>}
				</>
			) : undefined,
	};
}

export function OtaUpdatePromptView({
	update,
	onLater,
}: {
	update: PendingHotswapUpdate;
	onLater: () => void;
}) {
	const { t, i18n } = useTranslation();
	const realProgress = useSyncExternalStore(subscribeHotswapProgress, getHotswapProgress);
	const [previewProgress, setPreviewProgress] = useState<HotswapProgress>({ phase: "idle" });
	const progress = update.preview ? previewProgress : realProgress;
	// undefined while loading, null for the embedded frontend.
	const [installedVersion, setInstalledVersion] = useState<string | null | undefined>(undefined);
	const [failed, setFailed] = useState(false);
	// Same setting as "Install Automatically" in Settings; the preview only toggles locally.
	const storedAutoUpdate = useSyncExternalStore(subscribeHotswapAutoUpdate, isHotswapAutoUpdateEnabled);
	const [previewAutoUpdate, setPreviewAutoUpdate] = useState(storedAutoUpdate);
	const autoUpdate = update.preview ? previewAutoUpdate : storedAutoUpdate;
	const setAutoUpdate = update.preview ? setPreviewAutoUpdate : setHotswapAutoUpdateEnabled;
	const isBusy = progress.phase === "downloading" || progress.phase === "installing" || progress.phase === "done";

	useEffect(() => {
		let cancelled = false;
		void getActiveHotswapVersion().then((v) => {
			if (!cancelled) setInstalledVersion(v);
		});
		return () => {
			cancelled = true;
		};
	}, []);
	const versionChanged = installedVersion !== undefined && releaseOf(installedVersion) !== releaseOf(update.version);

	// Preview: fake ~2.5 MB download, then close instead of reloading.
	useEffect(() => {
		if (!update.preview || previewProgress.phase === "idle") return;
		const timer = window.setTimeout(() => {
			if (previewProgress.phase === "downloading") {
				const total = 2_500_000;
				const downloaded = Math.min(total, previewProgress.downloaded + 125_000);
				setPreviewProgress(downloaded < total ? { phase: "downloading", downloaded, total } : { phase: "installing" });
			} else if (previewProgress.phase === "installing") {
				setPreviewProgress({ phase: "done" });
			} else if (previewProgress.phase === "done") {
				onLater();
			}
		}, previewProgress.phase === "downloading" ? 120 : 900);
		return () => window.clearTimeout(timer);
	}, [update.preview, previewProgress, onLater]);

	const start = () => {
		setFailed(false);
		if (update.preview) {
			setPreviewProgress({ phase: "downloading", downloaded: 0, total: 2_500_000 });
			return;
		}
		installHotswapUpdate()
			.then(() => window.location.reload())
			.catch((error) => {
				appLog.error("[hotswap] Confirmed update failed:", error);
				setFailed(true);
			});
	};

	const percent =
		progress.phase === "downloading" && progress.total
			? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
			: progress.phase === "installing" || progress.phase === "done"
				? 100
				: null;

	return (
		<FullscreenPrompt
			icon={RefreshCcw}
			title={t("ota_prompt.title", { defaultValue: "Update Available" })}
			description={t("ota_prompt.description", {
				defaultValue: "A new version of the app interface is ready to download. It only takes a moment and the app reloads afterwards.",
			})}
			footer={
				<>
					{isBusy && (
						<div className="mb-1 flex flex-col gap-1.5">
							<div className="h-2 w-full overflow-hidden rounded-full ink-tint-10">
								<div
									className={`h-full rounded-full bg-[var(--accent)] transition-[width] duration-200 ${percent === null ? "w-1/3 animate-pulse" : ""}`}
									style={percent === null ? undefined : { width: `${percent}%` }}
								/>
							</div>
							<p className="text-center text-xs text-[var(--text-muted)]">
								{progress.phase === "downloading"
									? percent === null
										? t("update_prompt.downloading", { defaultValue: "Downloading…" })
										: t("update_prompt.downloading_percent", { defaultValue: "Downloading… {{percent}}%", percent })
									: progress.phase === "installing"
										? t("update_prompt.installing", { defaultValue: "Installing…" })
										: t("settings.ota_progress_done", { defaultValue: "Update installed. Reloading…" })}
							</p>
						</div>
					)}
					{failed && (
						<p className="mb-1 text-center text-xs leading-relaxed text-red-400">
							{t("ota_prompt.failed", { defaultValue: "The update couldn't be downloaded. Check your connection and try again." })}
						</p>
					)}
					<button type="button" disabled={isBusy} onClick={start} className={fullscreenPrimaryButtonClass}>
						{isBusy && <Loader2 className="h-4 w-4 animate-spin" />}
						{progress.phase === "downloading"
							? t("update_prompt.downloading", { defaultValue: "Downloading…" })
							: progress.phase === "installing" || progress.phase === "done"
								? t("update_prompt.installing", { defaultValue: "Installing…" })
								: failed
									? t("update_prompt.try_again", { defaultValue: "Try again" })
									: <>{t("ota_prompt.update_now", { defaultValue: "Update now" })}<Download className="h-4 w-4" /></>}
					</button>
					<button type="button" onClick={onLater} disabled={isBusy} className={fullscreenSecondaryButtonClass}>
						{t("ota_prompt.later", { defaultValue: "Later" })}
					</button>
				</>
			}
		>
			<div className={`${fullscreenCardClass} divide-y divide-[var(--border)] overflow-hidden text-left`}>
				<VersionCompare
					from={
						installedVersion === undefined
							? undefined
							: bundleSide(t, i18n.language, t("ota_prompt.installed", { defaultValue: "Installed build" }), installedVersion, versionChanged)
					}
					to={bundleSide(t, i18n.language, t("ota_prompt.new", { defaultValue: "New build" }), update.version, versionChanged, installedVersion)}
				/>
				<ToggleRow
					checked={autoUpdate}
					onChange={setAutoUpdate}
					icon={<Zap className="h-5 w-5" />}
					iconClass="ink-tint-8 text-[var(--accent)]"
					label={t("ota_prompt.auto_title", { defaultValue: "Install automatically" })}
					description={t("ota_prompt.auto_desc", { defaultValue: "Install future frontend updates without asking." })}
				/>
			</div>
		</FullscreenPrompt>
	);
}

/**
 * Shows the OTA update prompt as soon as the startup check finds a frontend
 * update and automatic updates are off — before the onboarding, the version
 * announcement and the routed app. The content behind stays mounted (just
 * hidden), so an onboarding in progress keeps its step when the check only
 * finishes mid-way. OutdatedVersionGate sits inside: the OTA bundle may
 * already bring the frontend up to the latest release.
 */
export function OtaUpdateGate({ children }: { children: ReactNode }) {
	const update = useSyncExternalStore(subscribePendingHotswapUpdate, getPendingHotswapUpdate);

	return (
		<>
			{update && (
				<div className="app-shell">
					<OtaUpdatePromptView update={update} onLater={dismissPendingHotswapUpdate} />
				</div>
			)}
			<div style={{ display: update ? "none" : "contents" }}>{children}</div>
		</>
	);
}
