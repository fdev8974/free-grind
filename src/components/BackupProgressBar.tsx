import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { backupProgressFraction, listenBackupProgress, type BackupProgress, type BackupReadProgress } from "../services/backupRestore";
import { formatBytes } from "../utils/formatBytes";

/** Live progress of a running native export/import, fed by the progress events backup.rs emits. */
export function BackupProgressBar({ kind, active }: { kind: "export" | "import"; active: boolean }) {
	const { t, i18n } = useTranslation();
	const [progress, setProgress] = useState<BackupProgress | null>(null);

	useEffect(() => {
		if (!active) {
			setProgress(null);
			return;
		}
		let disposed = false;
		let unlisten: (() => void) | null = null;
		void listenBackupProgress(kind, (next) => {
			if (!disposed) setProgress(next);
		}).then((fn) => {
			if (disposed) fn();
			else unlisten = fn;
		});
		return () => {
			disposed = true;
			unlisten?.();
		};
	}, [kind, active]);

	if (!active) return null;

	const fraction = progress ? backupProgressFraction(progress) : null;
	const numberFormat = new Intl.NumberFormat(i18n.language);

	return (
		<div className="px-4 pb-1 pt-2">
			<div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
				<div
					className={`h-full rounded-full bg-[var(--accent)] transition-[width] duration-300 ${fraction == null ? "w-1/3 animate-pulse" : ""}`}
					style={fraction == null ? undefined : { width: `${Math.round(fraction * 100)}%` }}
				/>
			</div>
			<p className="mt-1.5 text-xs tabular-nums text-[var(--text-muted)]">
				{progress
					? t("data_backup.progress_step", {
							defaultValue: "Step {{step}} of {{steps}} · {{rows}} entries",
							step: progress.tableIndex + 1,
							steps: progress.tableCount,
							rows:
								progress.rowsTotal != null
									? `${numberFormat.format(progress.rowsDone)} / ${numberFormat.format(progress.rowsTotal)}`
									: numberFormat.format(progress.rowsDone),
						})
					: t("data_backup.progress_preparing", { defaultValue: "Preparing…" })}
			</p>
		</div>
	);
}

/** Status of reading a picked backup (copy to a scratch path, then the check),
 * shown in place of a plain spinner: the copy alone can take a while. */
export function BackupReadStatus({ progress, className = "" }: { progress: BackupReadProgress; className?: string }) {
	const { t } = useTranslation();
	const fraction =
		progress.stage === "copying" && progress.bytesTotal ? Math.min((progress.bytesDone ?? 0) / progress.bytesTotal, 1) : null;

	return (
		<div className={className}>
			<div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
				<div
					className={`h-full rounded-full bg-[var(--accent)] transition-[width] duration-300 ${fraction == null ? "w-1/3 animate-pulse" : ""}`}
					style={fraction == null ? undefined : { width: `${Math.round(fraction * 100)}%` }}
				/>
			</div>
			<p className="mt-1.5 text-xs tabular-nums text-[var(--text-muted)]">
				{progress.stage === "checking"
					? t("data_backup.read_checking", { defaultValue: "Checking backup…" })
					: progress.bytesTotal
						? t("data_backup.read_copying_bytes", {
								defaultValue: "Copying backup… {{done}} of {{total}}",
								done: formatBytes(progress.bytesDone ?? 0),
								total: formatBytes(progress.bytesTotal),
							})
						: t("data_backup.read_copying", { defaultValue: "Copying backup…" })}
			</p>
		</div>
	);
}
