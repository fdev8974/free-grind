import { Check, Copy, Loader2, TriangleAlert, X } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { BottomSheet, SheetClose } from "../../../../components/ui/bottom-sheet";
import { isIos } from "../../../../services/saveMedia";
import { appLog } from "../../../../utils/logger";
import { MapLocationPreview } from "./MapLocationPreview";

export type LocateRoundResult = {
	round: number;
	lat: number;
	lon: number;
	errorMeters: number;
	failed: boolean;
};

export type LocateProgress = {
	status: "measuring" | "running" | "done" | "error" | "cancelled";
	/** True while the user's own server location is still being restored. */
	isRestoring: boolean;
	initialDistance: number | null;
	totalRounds: number;
	/** 0-based index of the round in progress. */
	round: number;
	/** Measurement points finished in the current round (0–3). */
	step: number;
	/** Current best estimate — the user's own position before round 1 finishes. */
	lat: number;
	lon: number;
	errorMeters: number | null;
	rounds: LocateRoundResult[];
	errorMessage: string | null;
};

type Props = {
	progress: LocateProgress;
	onClose: () => void;
	onCancel: () => void;
	isDesktop: boolean;
};

const POINTS_PER_ROUND = 3;

export function LocateResultSheet({ progress, onClose, onCancel, isDesktop }: Props) {
	const { t } = useTranslation();
	const { status, isRestoring, lat, lon, errorMeters, totalRounds, round, step, rounds } = progress;
	const isRunning = status === "measuring" || status === "running";
	const hasEstimate = rounds.some((r) => !r.failed);
	const coords = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;

	const totalSteps = Math.max(1, totalRounds * POINTS_PER_ROUND);
	const doneSteps = status === "done" ? totalSteps : round * POINTS_PER_ROUND + step;
	const percent = Math.min(100, Math.round((doneSteps / totalSteps) * 100));

	const statusText = (() => {
		switch (status) {
			case "measuring":
				return t("profile_details.location_finder_status_measuring", {
					defaultValue: "Measuring initial distance…",
				});
			case "running":
				return t("profile_details.location_finder_status_round", {
					round: round + 1,
					rounds: totalRounds,
					point: Math.min(step + 1, POINTS_PER_ROUND),
					defaultValue: "Round {{round}}/{{rounds}} · measuring point {{point}}/3",
				});
			case "done":
				return t("profile_details.location_finder_result_title", { defaultValue: "Location found" });
			case "cancelled":
				return t("profile_details.location_finder_status_cancelled", { defaultValue: "Stopped" });
			case "error":
				return progress.errorMessage ?? t("profile_details.location_finder_error_general");
		}
	})();

	const handleOpenMaps = () => {
		const url = isDesktop
			? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
			: isIos()
			? `https://maps.apple.com/?ll=${lat},${lon}&q=${lat},${lon}`
			: `geo:${lat},${lon}?q=${lat},${lon}`;
		openUrl(url).catch((error) => {
			appLog.error("Failed to open map URL", error);
			window.open(url, "_blank");
		});
	};

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(coords);
			toast.success(t("profile_details.location_finder_location_copied"));
		} catch (error) {
			appLog.error("Failed to copy location to clipboard", error);
		}
	};

	return (
		<BottomSheet onClose={onClose} isDesktop={isDesktop} zIndex="z-[90]">
			<div className="flex items-center justify-between px-4 pb-3">
				<p className="text-sm font-semibold text-[var(--text)]">
					{t("profile_details.location_finder", { defaultValue: "Location finder" })}
				</p>
				<SheetClose className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
					<X className="h-4 w-4" />
				</SheetClose>
			</div>

			<div className="px-3 pb-3">
				<div
					className="overflow-hidden rounded-xl border border-[var(--border)]"
					style={{ height: "40dvh" }}
					data-lenis-prevent
				>
					<MapLocationPreview
						lat={lat}
						lon={lon}
						zoom={16}
						interactive
						radiusMeters={
							hasEstimate
								? (errorMeters ?? undefined)
								: (progress.initialDistance ?? undefined)
						}
						className="h-full w-full"
					/>
				</div>

				<div className="mt-3 rounded-xl bg-[var(--surface-2)] px-3 py-2.5">
					<div className="flex items-center gap-2 text-sm text-[var(--text)]">
						{isRunning ? (
							<Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--accent)]" />
						) : status === "done" ? (
							<Check className="h-4 w-4 shrink-0 text-[var(--accent)]" />
						) : (
							<TriangleAlert className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
						)}
						<span className="min-w-0 flex-1 truncate">{statusText}</span>
						<span className="shrink-0 tabular-nums text-xs text-[var(--text-muted)]">{percent}%</span>
					</div>
					<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface)]">
						<div
							className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500"
							style={{ width: `${percent}%` }}
						/>
					</div>
					{progress.initialDistance !== null ? (
						<p className="mt-2 text-xs text-[var(--text-muted)]">
							{t("profile_details.location_finder_initial_distance", {
								distance: Math.round(progress.initialDistance),
								defaultValue: "Initial distance: {{distance}} m",
							})}
						</p>
					) : null}
					{isRestoring ? (
						<p className="mt-1 text-xs text-[var(--text-muted)]">
							{t("profile_details.location_finder_restoring", {
								defaultValue: "Restoring your location…",
							})}
						</p>
					) : null}
				</div>

				{hasEstimate ? (
					<div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-[var(--surface-2)] px-3 py-2">
						<div className="min-w-0">
							<p className="select-text truncate font-mono text-sm text-[var(--text)]">{coords}</p>
							{errorMeters !== null ? (
								<p className="text-xs text-[var(--text-muted)]">
									{t("profile_details.location_finder_result_error", {
										error: errorMeters,
										defaultValue: "Estimated error: ~{{error}} m",
									})}
								</p>
							) : null}
						</div>
						<button
							type="button"
							onClick={() => void handleCopy()}
							className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface)] hover:text-[var(--text)]"
							aria-label={t("profile_details.location_finder_copy", { defaultValue: "Copy coordinates" })}
						>
							<Copy className="h-4 w-4" />
						</button>
					</div>
				) : null}
			</div>

			<div className="flex gap-2 px-3">
				{isRunning ? (
					<button
						type="button"
						onClick={onCancel}
						className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)]"
					>
						{t("profile_details.location_finder_stop", { defaultValue: "Stop" })}
					</button>
				) : null}
				<button
					type="button"
					onClick={handleOpenMaps}
					disabled={!hasEstimate}
					className="flex-1 rounded-xl border border-[var(--accent)] bg-[var(--accent)] py-2.5 text-sm font-semibold text-[var(--accent-contrast)] transition hover:brightness-110 disabled:opacity-50"
				>
					{t("profile_details.location_finder_open_maps", { defaultValue: "Open in Maps" })}
				</button>
			</div>
		</BottomSheet>
	);
}
