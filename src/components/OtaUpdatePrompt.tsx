import { Download, Loader2, Package, RefreshCcw, Zap } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
	dismissPendingHotswapUpdate,
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
import { FullscreenPrompt, fullscreenPrimaryButtonClass, fullscreenSecondaryButtonClass } from "./FullscreenPrompt";
import { ToggleRow } from "./ui/toggle-row";
import { hourCycleOptions } from "../utils/timeFormat";

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
	const version = displayVersion(update.version);
	const builtAt = buildDate(update.version);
	const [failed, setFailed] = useState(false);
	// Same setting as "Install Automatically" in Settings; the preview only toggles locally.
	const storedAutoUpdate = useSyncExternalStore(subscribeHotswapAutoUpdate, isHotswapAutoUpdateEnabled);
	const [previewAutoUpdate, setPreviewAutoUpdate] = useState(storedAutoUpdate);
	const autoUpdate = update.preview ? previewAutoUpdate : storedAutoUpdate;
	const setAutoUpdate = update.preview ? setPreviewAutoUpdate : setHotswapAutoUpdateEnabled;
	const isBusy = progress.phase === "downloading" || progress.phase === "installing" || progress.phase === "done";

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
							<div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
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
			<div className="surface-card divide-y divide-[var(--border)] overflow-hidden text-left">
				<div className="flex items-center gap-3 px-4 py-3.5">
					<div className="shrink-0 rounded-2xl bg-[var(--surface-2)] p-2.5 text-[var(--accent)]">
						<Package className="h-5 w-5" />
					</div>
					<div className="min-w-0 flex-1">
						<p className="text-sm font-semibold leading-snug text-[var(--text)]">
							{version
								? t("ota_prompt.version", { defaultValue: "Version {{version}}", version })
								: t("ota_prompt.new_version", { defaultValue: "New version" })}
						</p>
						{builtAt && (
							<p className="mt-0.5 text-xs tabular-nums text-[var(--text-muted)]">
								{t("ota_prompt.built_at", {
									defaultValue: "Built {{date}}",
									date: builtAt.toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short", ...hourCycleOptions() }),
								})}
							</p>
						)}
					</div>
				</div>
				<ToggleRow
					checked={autoUpdate}
					onChange={setAutoUpdate}
					icon={<Zap className="h-5 w-5" />}
					iconClass="bg-[var(--surface-2)] text-[var(--accent)]"
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
