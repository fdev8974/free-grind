import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Loader2, UserRound } from "lucide-react";
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
	return useLocalBackupsLoader().backups;
}

/**
 * useLocalBackups plus `load`, which scans again and resolves to what it
 * found (joining a scan still running), for a click that has to know
 * whether there are any before deciding what to open.
 */
export function useLocalBackupsLoader(): { backups: LocalBackup[] | null; load: () => Promise<LocalBackup[]> } {
	const [backups, setBackups] = useState<LocalBackup[] | null>(null);
	const pendingRef = useRef<Promise<LocalBackup[]> | null>(null);
	const mountedRef = useRef(true);

	const load = useCallback(() => {
		if (!pendingRef.current) {
			pendingRef.current = listLocalBackups().then((found) => {
				pendingRef.current = null;
				if (mountedRef.current) setBackups(found);
				return found;
			});
		}
		return pendingRef.current;
	}, []);

	useEffect(() => {
		mountedRef.current = true;
		void load();
		return () => {
			mountedRef.current = false;
		};
	}, [load]);

	return { backups, load };
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

	// One group per profile, the current one first; otherwise in the order found (newest first).
	const groups: { ownerUserId: number; backups: LocalBackup[] }[] = [];
	for (const backup of backups) {
		const group = groups.find((g) => g.ownerUserId === backup.ownerUserId);
		if (group) group.backups.push(backup);
		else groups.push({ ownerUserId: backup.ownerUserId, backups: [backup] });
	}
	const isCurrent = (ownerUserId: number) => currentUserId != null && ownerUserId === currentUserId;
	groups.sort((a, b) => Number(isCurrent(b.ownerUserId)) - Number(isCurrent(a.ownerUserId)));

	return (
		<div className={`space-y-4 text-left ${className}`}>
			{groups.map((group) => {
				// Name and photo as last seen in the account switcher, for profiles used on this device.
				const saved = getSavedAccountProfile(String(group.ownerUserId));
				const profileId = t("local_backups.profile_id", { defaultValue: "Profile {{id}}", id: group.ownerUserId });
				return (
					<section key={group.ownerUserId}>
						<div className="mb-2 flex min-w-0 items-center gap-2 px-1" title={profileId}>
							<p className="min-w-0 truncate text-xs font-semibold text-[var(--text-muted)]">{saved.displayName || profileId}</p>
							{isCurrent(group.ownerUserId) ? (
								<span className="ml-auto shrink-0 text-xs font-semibold text-[var(--accent)]">
									{t("local_backups.this_profile", { defaultValue: "This profile" })}
								</span>
							) : null}
						</div>
						<div className="native-group">
							{group.backups.map((backup) => {
								const date = backup.exportedAt > 0 ? backup.exportedAt : backup.modifiedAt;
								const details = [
									backup.messageCount != null
										? t("local_backups.message_count", {
												defaultValue: "{{formatted}} messages",
												count: backup.messageCount,
												formatted: numberFormat.format(backup.messageCount),
											})
										: null,
									formatBytes(backup.sizeBytes),
								].filter(Boolean);
								const busy = busyPath === backup.path;

								return (
									<button
										key={backup.path}
										type="button"
										onClick={() => onSelect(backup)}
										disabled={disabled}
										title={`${profileId} · ${backup.fileName}`}
										className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover-fill disabled:opacity-50"
									>
										{saved.photoHash ? (
											<Avatar
												src={getThumbImageUrl(saved.photoHash, "75x75")}
												alt=""
												className="h-10 w-10 shrink-0 rounded-2xl border-0 bg-violet-500/15 text-violet-400"
											/>
										) : (
											<div className="shrink-0 rounded-2xl bg-violet-500/15 p-2.5 text-violet-400">
												<UserRound className="h-5 w-5" />
											</div>
										)}
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-semibold leading-snug text-[var(--text)]">{dateFormat.format(new Date(date))}</p>
											{busy && busyProgress ? (
												<BackupReadStatus progress={busyProgress} className="mt-1.5" />
											) : (
												<p className="mt-0.5 truncate text-xs leading-snug tabular-nums text-[var(--text-muted)]">{details.join(" · ")}</p>
											)}
										</div>
										{busy ? (
											<Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--text-muted)]" />
										) : (
											<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)] opacity-50" />
										)}
									</button>
								);
							})}
						</div>
					</section>
				);
			})}
		</div>
	);
}
