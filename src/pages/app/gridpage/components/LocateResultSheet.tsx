import { Check, Copy, Loader2, Navigation, TriangleAlert } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { BottomSheet, SheetCloseButton, sheetButtonClass } from "../../../../components/ui/bottom-sheet";
import { NATIVE_SHEET_BG } from "../../../../components/ui/action-sheet";
import { isIos } from "../../../../services/saveMedia";
import { appLog } from "../../../../utils/logger";
import { MapLocationPreview } from "./MapLocationPreview";
import { MAP_SHEET_ICON_BUTTON_CLASS, MapSheetLayout, mapSheetProps } from "./MapSheetLayout";

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

/** Overall progress of a run, 0–100 — shared by the sheet and the "Locating…" menu labels. */
export function locatePercent({ status, totalRounds, round, step }: LocateProgress): number {
	const totalSteps = Math.max(1, totalRounds * POINTS_PER_ROUND);
	const doneSteps = status === "done" ? totalSteps : round * POINTS_PER_ROUND + step;
	return Math.min(100, Math.round((doneSteps / totalSteps) * 100));
}

export function LocateResultSheet({ progress, onClose, onCancel, isDesktop }: Props) {
	const { t } = useTranslation();
	const { status, isRestoring, lat, lon, errorMeters, totalRounds, round, step, rounds } = progress;
	const isRunning = status === "measuring" || status === "running";
	const hasEstimate = rounds.some((r) => !r.failed);
	const coords = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;

	const percent = locatePercent(progress);

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
		<BottomSheet
			onClose={onClose}
			isDesktop={isDesktop}
			zIndex="z-[90]"
			bg={NATIVE_SHEET_BG}
			{...mapSheetProps(isDesktop)}
		>
			<div className="mb-3 flex shrink-0 items-center justify-between">
				<h3 className="text-sm font-semibold text-[var(--text)]">
					{t("profile_details.location_finder", { defaultValue: "Location finder" })}
				</h3>
				<SheetCloseButton />
			</div>

			<MapSheetLayout
				map={
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
				}
				pinLabel={hasEstimate ? <span className="font-mono">{coords}</span> : undefined}
				picks={
					// Status card in the same frosted black as the pin pill, so it reads on the fade.
					<div className="px-4">
						<div className="rounded-2xl bg-black/55 px-3.5 py-3 text-white shadow-lg ring-1 ring-white/10 backdrop-blur-md">
							<div className="flex items-center gap-2 text-sm font-medium">
								{isRunning ? (
									<Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--accent)]" />
								) : status === "done" ? (
									<Check className="h-4 w-4 shrink-0 text-[var(--accent)]" />
								) : (
									<TriangleAlert className="h-4 w-4 shrink-0 text-white/70" />
								)}
								<span className="min-w-0 flex-1 truncate">{statusText}</span>
								<span className="shrink-0 tabular-nums text-xs text-white/70">{percent}%</span>
							</div>
							<div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/15">
								<div
									className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500"
									style={{ width: `${percent}%` }}
								/>
							</div>
							{progress.initialDistance !== null || (hasEstimate && errorMeters !== null) || isRestoring ? (
								<div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-white/70">
									{progress.initialDistance !== null ? (
										<span>
											{t("profile_details.location_finder_initial_distance", {
												distance: Math.round(progress.initialDistance),
												defaultValue: "Initial distance: {{distance}} m",
											})}
										</span>
									) : null}
									{hasEstimate && errorMeters !== null ? (
										<span>
											{t("profile_details.location_finder_result_error", {
												error: errorMeters,
												defaultValue: "Estimated error: ~{{error}} m",
											})}
										</span>
									) : null}
									{isRestoring ? (
										<span>
											{t("profile_details.location_finder_restoring", {
												defaultValue: "Restoring your location…",
											})}
										</span>
									) : null}
								</div>
							) : null}
						</div>
					</div>
				}
				footer={
					<>
						{hasEstimate ? (
							<button
								type="button"
								onClick={() => void handleCopy()}
								className={MAP_SHEET_ICON_BUTTON_CLASS}
								aria-label={t("profile_details.location_finder_copy", { defaultValue: "Copy coordinates" })}
							>
								<Copy className="h-4 w-4" />
							</button>
						) : null}
						{isRunning ? (
							<button type="button" onClick={onCancel} className={sheetButtonClass("secondary")}>
								<span className="truncate">{t("profile_details.location_finder_stop", { defaultValue: "Stop" })}</span>
							</button>
						) : null}
						<button
							type="button"
							onClick={handleOpenMaps}
							disabled={!hasEstimate}
							className={sheetButtonClass()}
						>
							<Navigation className="h-4 w-4" />
							<span className="truncate">{t("profile_details.location_finder_open_maps", { defaultValue: "Open in Maps" })}</span>
						</button>
					</>
				}
			/>
		</BottomSheet>
	);
}
