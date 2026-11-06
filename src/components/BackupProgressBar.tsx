import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
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
	const tableLabel = (table: string) => {
		const fallback = TABLE_LABELS[table];
		// i18next keys can't hold the dot of "media_files.drawer".
		return fallback ? t(`data_backup.table_labels.${table.replace(".", "_")}`, { defaultValue: fallback }) : table;
	};
	const numberFormat = new Intl.NumberFormat(i18n.language);

	return (
		<div className="px-4 pb-1 pt-2">
			<div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
				<div
					className={`h-full rounded-full bg-[var(--accent)] ${fraction == null ? "w-2/5 animate-progress-indeterminate" : "transition-[width] duration-300"}`}
					style={fraction == null ? undefined : { width: `${Math.round(fraction * 100)}%` }}
				/>
			</div>
			<p className="mt-1.5 break-words text-xs tabular-nums text-[var(--text-muted)]">
				{progress
					? t("data_backup.progress_table", {
							defaultValue: "{{label}} · step {{step}} of {{steps}} · {{rows}} entries",
							label: tableLabel(progress.table),
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
