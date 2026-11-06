import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { BackupCategoryPicker } from "./BackupCategoryPicker";
import { BackupProgressBar } from "./BackupProgressBar";
import { BottomSheet, SheetClose, SheetCloseButton, sheetButtonClass, SHEET_FOOTER_FADE_CLASS } from "./ui/bottom-sheet";
import { Chip } from "./ui/chip";
import { useApiFunctions } from "../hooks/useApiFunctions";
import { usePreferences } from "../contexts/PreferencesContext";
import {
	addOwnProfileFallback,
	backupErrorMessage,
	exportBackup,
	fetchRemoteBackupEntries,
	type BackupCategoryId,
	type BackupExportDestination,
} from "../services/backupRestore";
import { isAndroid, isIos } from "../services/saveMedia";
import { appLog } from "../utils/logger";

/**
 * Picks categories and a destination, then exports the profile's data — shared
 * by the data settings page and the account-status (ban) prompt, which offers
 * it so the data can still be restored into a new profile.
 */
export function BackupExportSheet({
	profileId,
	dbFileName,
	categories,
	isDesktop,
	zIndex,
	offline = false,
	onClose,
}: {
	profileId: number;
	/** The profile's db file (see chatDb.chatDbFileNameFor); needn't be the active one. */
	dbFileName: string;
	categories: BackupCategoryId[];
	isDesktop: boolean;
	zIndex?: string;
	/** No session (banned): server-side categories come from local data, see fetchRemoteBackupEntries. */
	offline?: boolean;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const apiFunctions = useApiFunctions();
	const { geohash } = usePreferences();
	const [selected, setSelected] = useState<Set<BackupCategoryId>>(() => new Set(categories));
	const [destination, setDestination] = useState<BackupExportDestination>("downloads");
	const [isExporting, setIsExporting] = useState(false);
	// Closes the sheet animated once the export has finished.
	const closeRef = useRef<(() => void) | null>(null);

	const toggle = (id: BackupCategoryId) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const handleExport = async () => {
		if (selected.size === 0) {
			toast.error(t("data_backup.export_no_categories", { defaultValue: "Choose at least one category to export." }));
			return;
		}
		setIsExporting(true);
		try {
			// The SQL read, base64 decode, zip compression and the copy to the
			// final location all happen natively (src-tauri/src/commands/backup.rs)
			// on a worker thread — nothing of the archive crosses the JS bridge.
			// Server-side categories (favorites with their notes) are fetched here and written into the archive as is.
			const chosen = Array.from(selected);
			// Profile data from before the own_profile_* tables existed comes from the profile's last snapshot.
			const remoteEntries = await addOwnProfileFallback(
				dbFileName,
				profileId,
				chosen,
				await fetchRemoteBackupEntries(apiFunctions, chosen, { geohash, offline }),
			);
			const saved = await exportBackup(dbFileName, profileId, chosen, destination, remoteEntries);
			if (!saved) return;
			toast.success(
				destination === "picker"
					? t("data_backup.export_success_picker", { defaultValue: "Data exported to the chosen location." })
					: isAndroid()
						? t("data_backup.export_success", { defaultValue: "Data exported." })
					: isIos()
						? t("data_backup.export_success_ios", { defaultValue: "Data exported. Find it in the Files app under On My iPhone/iPad → Free Grind." })
						: t("data_backup.export_success_desktop", { defaultValue: "Data exported to Downloads/FreeGrind." }),
			);
			closeRef.current?.();
		} catch (error) {
			appLog.error("[BackupExportSheet] backup export failed", error);
			toast.error(backupErrorMessage(error, t("data_backup.export_failed", { defaultValue: "Failed to export data." })));
		} finally {
			setIsExporting(false);
		}
	};

	return (
		<BottomSheet
			onClose={onClose}
			closeRef={closeRef}
			isDesktop={isDesktop}
			isProcessing={isExporting}
			zIndex={zIndex}
			panelClassName="max-h-[82dvh]"
		>
			<div className="flex items-center justify-between px-4 pb-3 text-left">
				<p className="text-sm font-semibold text-[var(--text)]">
					{t("data_backup.export_categories_title", { defaultValue: "What do you want to export?" })}
				</p>
				<SheetCloseButton disabled={isExporting} />
			</div>
			{/* text-left: on the account-status prompt the sheet would inherit its centered text. */}
			<div className="min-h-0 flex-1 overflow-y-auto pb-4 text-left" data-lenis-prevent>
				<BackupCategoryPicker categories={categories} selected={selected} onToggle={toggle} />
				<div className="px-4 pt-4">
					<p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
						{t("data_backup.export_destination_title", { defaultValue: "Save to" })}
					</p>
					<div className="flex flex-wrap gap-2">
						<Chip selected={destination === "downloads"} disabled={isExporting} onClick={() => setDestination("downloads")}>
							{isIos()
								? t("data_backup.export_destination_device", { defaultValue: "This device" })
								: t("data_backup.export_destination_downloads", { defaultValue: "Downloads" })}
						</Chip>
						<Chip selected={destination === "picker"} disabled={isExporting} onClick={() => setDestination("picker")}>
							{t("data_backup.export_destination_picker", { defaultValue: "Choose location…" })}
						</Chip>
					</div>
					<p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">
						{destination === "downloads"
							? isIos()
								? t("data_backup.export_destination_device_hint_ios", {
										defaultValue: "Saved in the Files app under On My iPhone/iPad → Free Grind.",
									})
								: t("data_backup.export_destination_downloads_hint", { defaultValue: "Saved to Downloads/FreeGrind on this device." })
							: isAndroid() || isIos()
								? t("data_backup.export_destination_picker_hint", {
										defaultValue: "Pick any folder or cloud storage, e.g. Google Drive (requires the Drive app).",
									})
								: t("data_backup.export_destination_picker_hint_desktop", {
										defaultValue: "Pick any folder, e.g. one synced by Google Drive for desktop.",
									})}
					</p>
				</div>
			</div>
			<BackupProgressBar kind="export" active={isExporting} />
			<div className={`flex shrink-0 gap-2.5 px-4 pb-4 ${SHEET_FOOTER_FADE_CLASS}`}>
				<SheetClose disabled={isExporting} className={sheetButtonClass("secondary")}>
					{t("common.cancel", { defaultValue: "Cancel" })}
				</SheetClose>
				<button
					type="button"
					onClick={() => void handleExport()}
					disabled={isExporting || selected.size === 0}
					className={sheetButtonClass()}
				>
					{isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
					<span>{t("data_backup.export_confirm", { defaultValue: "Export" })}</span>
				</button>
			</div>
		</BottomSheet>
	);
}
