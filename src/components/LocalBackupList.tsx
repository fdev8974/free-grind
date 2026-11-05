import { useEffect, useState } from "react";
import { ChevronRight, FileArchive, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BackupReadStatus } from "./BackupProgressBar";
import { Avatar } from "./ui/avatar";
import { getSavedAccountProfile } from "../services/savedAccountProfiles";
import { getThumbImageUrl } from "../utils/media";
import { listLocalBackups, type BackupReadProgress, type LocalBackup } from "../services/backupRestore";
import { formatBytes } from "../utils/formatBytes";
import { hourCycleOptions } from "../utils/timeFormat";

/** Backups found in the default export folder; null while still scanning. */
export function useLocalBackups(): LocalBackup[] | null {
	const [backups, setBackups] = useState<LocalBackup[] | null>(null);
	useEffect(() => {
		let cancelled = false;
		void listLocalBackups().then((found) => {
			if (!cancelled) setBackups(found);
		});
		return () => {
			cancelled = true;
		};
	}, []);
	return backups;
}

/** Rows for picking one of the backups `useLocalBackups` found: which profile
 * it came from (its saved name and photo, if known), when it was made, and its size. */
export function LocalBackupList({
	backups,
	currentUserId,
	disabled,
	busyPath,
	busyProgress,
	onSelect,
	className = "",
}: {
	backups: LocalBackup[];
	currentUserId: number | null;
	disabled?: boolean;
	/** The row being read right now, shown with a spinner. */
	busyPath?: string | null;
	/** Shown in the busy row in place of its details. */
	busyProgress?: BackupReadProgress | null;
	onSelect: (backup: LocalBackup) => void;
	className?: string;
}) {
	const { t, i18n } = useTranslation();
	const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short", ...hourCycleOptions() });
	const numberFormat = new Intl.NumberFormat(i18n.language);

	return (
		<div className={`native-group text-left ${className}`}>
			{backups.map((backup) => {
				const date = backup.exportedAt > 0 ? backup.exportedAt : backup.modifiedAt;
				const isCurrentProfile = currentUserId != null && backup.ownerUserId === currentUserId;
				// Name and photo as last seen in the account switcher, for profiles used on this device.
				const saved = getSavedAccountProfile(String(backup.ownerUserId));
				const profileId = t("local_backups.profile_id", { defaultValue: "Profile {{id}}", id: backup.ownerUserId });
				const details = [
					dateFormat.format(new Date(date)),
					backup.messageCount != null
						? t("local_backups.message_count", {
								defaultValue: "{{formatted}} messages",
								count: backup.messageCount,
								formatted: numberFormat.format(backup.messageCount),
							})
						: null,
					formatBytes(backup.sizeBytes),
				].filter(Boolean);

				return (
					<button
						key={backup.path}
						type="button"
						onClick={() => onSelect(backup)}
						disabled={disabled}
						title={`${profileId} · ${backup.fileName}`}
						className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover-fill disabled:opacity-50"
					>
						{saved.photoHash ? (
							<Avatar
								src={getThumbImageUrl(saved.photoHash, "75x75")}
								alt=""
								className="h-10 w-10 shrink-0 rounded-2xl border-0 bg-violet-500/15 text-violet-400"
							/>
						) : (
							<div className="shrink-0 rounded-2xl bg-violet-500/15 p-2.5 text-violet-400">
								<FileArchive className="h-5 w-5" />
							</div>
						)}
						<div className="min-w-0 flex-1">
							<p className="flex min-w-0 items-center gap-2 text-sm font-semibold leading-snug text-[var(--text)]">
								<span className="truncate">{saved.displayName || profileId}</span>
								{saved.displayName ? (
									<span className="shrink-0 text-xs font-normal tabular-nums text-[var(--text-muted)]">{backup.ownerUserId}</span>
								) : null}
								{isCurrentProfile ? (
									<span className="shrink-0 rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
										{t("local_backups.this_profile", { defaultValue: "This profile" })}
									</span>
								) : null}
							</p>
							{busyPath === backup.path && busyProgress ? (
								<BackupReadStatus progress={busyProgress} className="mt-1.5" />
							) : (
								<p className="mt-0.5 truncate text-xs leading-snug text-[var(--text-muted)]">{details.join(" · ")}</p>
							)}
						</div>
						{busyPath === backup.path ? (
							<Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--text-muted)]" />
						) : (
							<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)] opacity-50" />
						)}
					</button>
				);
			})}
		</div>
	);
}
