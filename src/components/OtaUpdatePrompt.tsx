import { Download, Loader2, RefreshCcw } from "lucide-react";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
	dismissPendingHotswapUpdate,
	getHotswapProgress,
	getPendingHotswapUpdate,
	installHotswapUpdate,
	subscribeHotswapProgress,
	subscribePendingHotswapUpdate,
	type PendingHotswapUpdate,
} from "../services/hotswap";
import { appLog } from "../utils/logger";

export function OtaUpdatePromptView({
	update,
	onLater,
}: {
	update: PendingHotswapUpdate;
	onLater: () => void;
}) {
	const { t } = useTranslation();
	const progress = useSyncExternalStore(subscribeHotswapProgress, getHotswapProgress);
	const [failed, setFailed] = useState(false);
	const isBusy = progress.phase === "downloading" || progress.phase === "installing" || progress.phase === "done";

	const start = () => {
		setFailed(false);
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
		<div className="fs-card-outer fs-card-overlay z-[110] no-touch-callout">
			<div className="fs-card-inner fs-card-lg flex flex-col">
				<div
					className="flex flex-1 flex-col items-center justify-center px-8 text-center"
					style={{
						paddingTop: "max(48px, env(safe-area-inset-top))",
						paddingBottom: "max(24px, env(safe-area-inset-bottom))",
					}}
				>
					<div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-[var(--surface-2)] border border-[var(--border)]">
						<RefreshCcw className="h-9 w-9 text-[var(--accent)]" />
					</div>
					<h1 className="text-2xl font-bold text-[var(--text)]">{t("ota_prompt.title", { defaultValue: "Update Available" })}</h1>
					<div className="flex flex-col items-center overflow-hidden">
						<p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--text-muted)]">
							{update.version
								? t("ota_prompt.description_version", {
										defaultValue: "Version {{version}} of the app interface is ready to download. It only takes a moment and the app reloads afterwards.",
										version: update.version,
									})
								: t("ota_prompt.description", {
										defaultValue: "A new version of the app interface is ready to download. It only takes a moment and the app reloads afterwards.",
									})}
						</p>
						{update.notes && (
							<p className="mt-2 max-w-xs whitespace-pre-line text-sm leading-relaxed text-[var(--text-muted)]">{update.notes}</p>
						)}
						<p className="mt-4 max-w-xs text-xs leading-relaxed text-[var(--text-muted)]">
							{t("ota_prompt.auto_hint", {
								defaultValue: "Turn on automatic updates in Settings to skip this screen.",
							})}
						</p>
					</div>
				</div>

				<div
					className="flex min-h-44 shrink-0 flex-col justify-end gap-2 px-6"
					style={{ paddingBottom: "max(28px, calc(env(safe-area-inset-bottom) + 12px))" }}
				>
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
					<button
						type="button"
						disabled={isBusy}
						onClick={start}
						className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] py-3.5 text-sm font-semibold text-[var(--accent-contrast)] transition hover:brightness-110 disabled:opacity-70"
					>
						{isBusy && <Loader2 className="h-4 w-4 animate-spin" />}
						{progress.phase === "downloading"
							? t("update_prompt.downloading", { defaultValue: "Downloading…" })
							: progress.phase === "installing" || progress.phase === "done"
								? t("update_prompt.installing", { defaultValue: "Installing…" })
								: failed
									? t("update_prompt.try_again", { defaultValue: "Try again" })
									: <>{t("ota_prompt.update_now", { defaultValue: "Update now" })}<Download className="h-4 w-4" /></>}
					</button>
					<button
						type="button"
						onClick={onLater}
						disabled={isBusy}
						className="w-full rounded-xl py-3 text-sm font-medium text-[var(--text-muted)] transition hover:text-[var(--text)] disabled:opacity-50"
					>
						{t("ota_prompt.later", { defaultValue: "Later" })}
					</button>
				</div>
			</div>
		</div>
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
