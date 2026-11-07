import { useEffect, useRef, useState } from "react";
import { ArchiveRestore, CircleCheck, DatabaseBackup, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SHEET_GROUP_CLASS, SheetCard, SheetSection } from "./ui/sheet-section";
import { backupProgressFraction, listenBackupProgress, type BackupProgress, type BackupReadProgress } from "../services/backupRestore";
import { formatBytes } from "../utils/formatBytes";

/**
 * What each step of an export/import is, by the archive part backup.rs reports
 * (`table`, e.g. "messages" or "media_files.drawer"). An unknown part (a newer
 * table this list doesn't know yet) shows its raw name.
 */
const TABLE_LABELS: Record<string, string> = {
	conversations: "Conversations",
	conversation_meta: "Conversation details",
	messages: "Chat messages",
	"media_files.chat": "Chat media",
	"media_files.drawer": "Drawer media",
	albums: "Albums",
	album_media: "Album media",
	avatars: "Profile pictures in chats",
	drawer_collections: "Drawer collections",
	settings: "Settings",
	saved_phrases: "Saved phrases",
	saved_locations: "Saved locations",
	sexual_health_prep_doses: "PrEP doses",
	sexual_health_encounters: "Encounters",
	sexual_health_appointments: "Appointments",
	sexual_health_sti_tests: "STI tests",
	own_profile_details: "Profile details",
	own_profile_photos: "Profile photos",
	own_blocked_profiles: "Blocked profiles",
	own_albums: "My albums",
	own_album_media: "My album media",
};

/** Follows the progress events backup.rs emits while `active`; null until the first one. */
function useBackupProgress(kind: "export" | "import", active: boolean): BackupProgress | null {
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

	return progress;
}

function useTableLabel() {
	const { t } = useTranslation();
	return (table: string) => {
		const fallback = TABLE_LABELS[table];
		// i18next keys can't hold the dot of "media_files.drawer".
		return fallback ? t(`data_backup.table_labels.${table.replace(".", "_")}`, { defaultValue: fallback }) : table;
	};
}

type FinishedStep = { table: string; rows: number };

/**
 * Full view of a running export/import, shown in place of the sheet's
 * category picker while it runs, in the sheets' native look: a card with the
 * part being written right now and the overall progress, then the parts
 * already done as a grouped list (like the restore status sheet).
 */
export function BackupProgressView({ kind }: { kind: "export" | "import" }) {
	const { t, i18n } = useTranslation();
	const progress = useBackupProgress(kind, true);
	const tableLabel = useTableLabel();
	const [finished, setFinished] = useState<FinishedStep[]>([]);
	const lastRef = useRef<BackupProgress | null>(null);

	// A new part started: the one before is done, with the entries it reached.
	useEffect(() => {
		const last = lastRef.current;
		lastRef.current = progress;
		if (!progress || !last || last.table === progress.table) return;
		setFinished((prev) =>
			prev.some((step) => step.table === last.table) ? prev : [...prev, { table: last.table, rows: last.rowsTotal ?? last.rowsDone }],
		);
	}, [progress]);

	const fraction = progress ? backupProgressFraction(progress) : null;
	const percent = fraction == null ? null : Math.round(fraction * 100);
	const numberFormat = new Intl.NumberFormat(i18n.language);
	const Icon = kind === "export" ? DatabaseBackup : ArchiveRestore;
	const done = progress ? finished.filter((step) => step.table !== progress.table).reverse() : [];

	return (
		<>
			<div className="px-4 pb-3 text-left">
				<p className="text-sm font-semibold text-[var(--text)]">
					{kind === "export"
						? t("data_backup.progress_title_export", { defaultValue: "Exporting your data…" })
						: t("data_backup.progress_title_import", { defaultValue: "Restoring your data…" })}
				</p>
				<p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">
					{t("data_backup.progress_keep_open", { defaultValue: "Keep the app open until this is done." })}
				</p>
			</div>
			<div role="status" aria-live="polite" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 text-left" data-lenis-prevent>
				<SheetCard className="flex items-center gap-3">
					<div className="shrink-0 rounded-2xl bg-[var(--accent)] p-2.5 text-[var(--accent-contrast)]">
						<Icon className="h-5 w-5" />
					</div>
					<div className="min-w-0 flex-1">
						<div className="flex items-baseline justify-between gap-3">
							<p className="truncate text-sm font-semibold leading-snug text-[var(--text)]">
								{progress ? tableLabel(progress.table) : t("data_backup.progress_preparing", { defaultValue: "Preparing…" })}
							</p>
							{percent != null ? (
								<span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--text)]">{percent}%</span>
							) : null}
						</div>
						{progress ? (
							<p className="mt-0.5 truncate text-xs leading-snug tabular-nums text-[var(--text-muted)]">
								{t("data_backup.progress_step", {
									defaultValue: "Step {{step}} of {{steps}} · {{rows}} entries",
									step: progress.tableIndex + 1,
									steps: progress.tableCount,
									rows:
										progress.rowsTotal != null
											? `${numberFormat.format(progress.rowsDone)} / ${numberFormat.format(progress.rowsTotal)}`
											: numberFormat.format(progress.rowsDone),
								})}
							</p>
						) : null}
						<div className="mt-2 h-1.5 overflow-hidden rounded-full ink-tint-10">
							<div
								className={`h-full rounded-full bg-[var(--accent)] ${percent == null ? "w-2/5 animate-progress-indeterminate" : "transition-[width] duration-300"}`}
								style={percent == null ? undefined : { width: `${percent}%` }}
							/>
						</div>
					</div>
				</SheetCard>
				{done.length > 0 ? (
					<SheetSection title={t("data_backup.progress_done_title", { defaultValue: "Done" })} className="mt-5">
						<ul className={SHEET_GROUP_CLASS}>
							{done.map((step) => (
								<li key={step.table} className="flex items-center gap-3 px-4 py-3">
									<CircleCheck className="h-5 w-5 shrink-0 text-emerald-500" />
									<span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text)]">{tableLabel(step.table)}</span>
									<span className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]">
										{t("data_backup.progress_entries", {
											defaultValue: "{{rows}} entries",
											rows: numberFormat.format(step.rows),
										})}
									</span>
								</li>
							))}
						</ul>
					</SheetSection>
				) : null}
			</div>
		</>
	);
}

/** Status of reading a picked backup (copy to a scratch path, then the check),
 * shown in place of a plain spinner: the copy alone can take a while. */
export function BackupReadStatus({ progress, className = "" }: { progress: BackupReadProgress; className?: string }) {
	const { t } = useTranslation();
	const fraction =
		progress.stage === "copying" && progress.bytesTotal ? Math.min((progress.bytesDone ?? 0) / progress.bytesTotal, 1) : null;

	// While the picker is still open there's nothing to measure: no bar, just a spinner.
	if (progress.stage === "opening") {
		return (
			<p className={`flex items-center gap-1.5 text-xs text-[var(--text-muted)] ${className}`}>
				<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
				{t("data_backup.read_opening", { defaultValue: "Opening file…" })}
			</p>
		);
	}

	return (
		<div className={className}>
			<div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
				<div
					className={`h-full rounded-full bg-[var(--accent)] ${fraction == null ? "w-2/5 animate-progress-indeterminate" : "transition-[width] duration-300"}`}
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
