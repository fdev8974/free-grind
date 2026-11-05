import { useCallback, useEffect, useRef, useState } from "react";
import {
	Download,
	FileDown,
	Info,
	Loader2,
	RotateCcw,
	ShieldCheck,
	Trash2,
	Upload,
} from "lucide-react";
import { CalendarDaysFilled, FileUpFilled } from "../../components/icons/FilledIcons";
import toast from "react-hot-toast";
import { saveTextFile } from "../../services/saveTextFile";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../../components/PageHeader";
import { RowActionPill } from "../../components/ui/row-action-pill";
import { BackupCategoryPicker } from "../../components/BackupCategoryPicker";
import { BackupExportSheet } from "../../components/BackupExportSheet";
import { BackupProgressBar, BackupReadStatus } from "../../components/BackupProgressBar";
import { LocalBackupList, useLocalBackups } from "../../components/LocalBackupList";
import { RestoreStatusEntry } from "../../components/RestoreStatus";
import { BottomSheet, SheetClose, SheetCloseButton, sheetButtonClass, SHEET_FOOTER_FADE_CLASS } from "../../components/ui/bottom-sheet";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { useAuth } from "../../contexts/useAuth";
import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";
import { useApiFunctions } from "../../hooks/useApiFunctions";
import * as chatDb from "../../services/chatDb";
import {
	BACKUP_CATEGORY_IDS,
	backupErrorMessage as getErrorMessage,
	cleanupTempFile,
	copyPickedFileToTemp,
	importBackupFile,
	inspectBackupFile,
	pickBackupFile,
	restoreRemoteBackupEntries,
	type BackupCategoryId,
	type BackupReadProgress,
} from "../../services/backupRestore";
import { loadEncounters } from "../../services/encounters";
import { encountersToIcs } from "../../services/icsExport";
import { deleteAllDownloadedMedia, getDownloadedMediaUsage, isAndroid, isIos } from "../../services/saveMedia";
import { resetAllSettings } from "../../utils/resetSettings";
import { useSettingsHighlight } from "../../hooks/useSettingsHighlight";
import { appLog } from "../../utils/logger";
import { formatBytes } from "../../utils/formatBytes";

export function SettingsDataPage() {
	const { t } = useTranslation();
	const highlightId = useSettingsHighlight();
	const { userId } = useAuth();
	const apiFunctions = useApiFunctions();

	const [usage, setUsage] = useState<{ count: number; totalBytes: number } | null>(null);
	const [isLoadingUsage, setIsLoadingUsage] = useState(true);
	const [isDeleting, setIsDeleting] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [isImporting, setIsImporting] = useState(false);
	const [readProgress, setReadProgress] = useState<BackupReadProgress | null>(null);
	const [isResetting, setIsResetting] = useState(false);
	const [showResetConfirm, setShowResetConfirm] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const isDesktop = useDesktopBreakpoint();

	const [showExportSheet, setShowExportSheet] = useState(false);
	const localBackups = useLocalBackups();
	const [showLocalBackups, setShowLocalBackups] = useState(false);
	const [selectedLocalPath, setSelectedLocalPath] = useState<string | null>(null);
	const [pickingOtherFile, setPickingOtherFile] = useState(false);
	const [pendingImport, setPendingImport] = useState<{
		tempPath: string;
		categories: BackupCategoryId[];
		selected: Set<BackupCategoryId>;
	} | null>(null);


	const [isExportingEncounters, setIsExportingEncounters] = useState(false);

	const loadUsage = useCallback(async () => {
		setIsLoadingUsage(true);
		try {
			setUsage(await getDownloadedMediaUsage());
		} catch (error) {
			appLog.error("[SettingsDataPage] failed to load downloaded-media usage", error);
		} finally {
			setIsLoadingUsage(false);
		}
	}, []);

	useEffect(() => {
		void loadUsage();
	}, [loadUsage]);

	const handleDeleteAll = async () => {
		setIsDeleting(true);
		try {
			const result = await deleteAllDownloadedMedia();
			if (result.failed > 0) {
				toast.error(
					t("data_backup.delete_partial", {
						defaultValue: "Deleted {{deleted}} files, {{failed}} failed.",
						deleted: result.deleted,
						failed: result.failed,
					}),
				);
			} else {
				toast.success(
					t("data_backup.delete_success", {
						defaultValue: "Deleted {{count}} downloaded files.",
						count: result.deleted,
					}),
				);
			}
			await loadUsage();
		} catch (error) {
			toast.error(getErrorMessage(error, t("data_backup.delete_failed", { defaultValue: "Failed to delete downloaded media." })));
		} finally {
			setIsDeleting(false);
			setShowDeleteConfirm(false);
		}
	};

	const openExportSheet = () => {
		if (userId == null) {
			toast.error(t("data_backup.export_no_user", { defaultValue: "You must be signed in to export." }));
			return;
		}
		setShowExportSheet(true);
	};

	const showImportError = () => {
		toast.error(t("data_backup.import_invalid", { defaultValue: "This file isn't a valid data export." }));
	};

	/** `stage` copies the picked archive to a local scratch path (null = picker
	 * cancelled), reporting its progress through `report`. */
	const handleImportFile = async (stage: (report: (progress: BackupReadProgress) => void) => Promise<string | null>) => {
		if (userId == null) {
			toast.error(t("data_backup.import_no_user", { defaultValue: "You must be signed in to import." }));
			return;
		}
		setIsImporting(true);
		// Copy the picked file to disk first, then hand a plain path to Rust
		// for inspection — only once we know which categories are actually in
		// the file do we ask the user which of those to restore.
		let tempPath: string | null = null;
		try {
			tempPath = await stage(setReadProgress);
			if (tempPath == null) return;
			setReadProgress({ stage: "checking" });
			const inspection = await inspectBackupFile(tempPath);
			if (!inspection.ok) {
				showImportError();
				await cleanupTempFile(tempPath);
				return;
			}
			setPendingImport({ tempPath, categories: inspection.categories, selected: new Set(inspection.categories) });
		} catch (error) {
			appLog.error("[SettingsDataPage] reading backup file failed", error);
			toast.error(getErrorMessage(error, t("data_backup.import_failed", { defaultValue: "Failed to import data." })));
			if (tempPath != null) await cleanupTempFile(tempPath);
		} finally {
			setReadProgress(null);
			setIsImporting(false);
		}
	};

	/** Resolves once the picked file was read (or the picker cancelled); right
	 * away for the <input> fallback, whose result arrives through onChange. */
	const openBackupPicker = () =>
		new Promise<void>((resolve) => {
			let picked = false;
			void pickBackupFile(
				(stage) => {
					picked = true;
					void handleImportFile(stage).finally(resolve);
				},
				() => {
					setReadProgress({ stage: "opening" });
					fileInputRef.current?.click();
				},
			).finally(() => {
				// Cancelled, or the <input> fallback (its result arrives through onChange).
				if (!picked) resolve();
			});
		});

	// The <input> fallback's "Opening file…" ends on change, or here if the picker was dismissed.
	useEffect(() => {
		const input = fileInputRef.current;
		if (!input) return;
		const onCancel = () => setReadProgress((prev) => (prev?.stage === "opening" ? null : prev));
		input.addEventListener("cancel", onCancel);
		return () => input.removeEventListener("cancel", onCancel);
	}, []);

	const handleCancelImport = () => {
		if (pendingImport) {
			void cleanupTempFile(pendingImport.tempPath);
		}
		setPendingImport(null);
	};

	const handleConfirmImport = async () => {
		if (!pendingImport || userId == null) {
			return;
		}
		setIsImporting(true);
		try {
			const result = await importBackupFile(
				chatDb.getActiveChatDbFileName(),
				userId,
				pendingImport.tempPath,
				Array.from(pendingImport.selected),
			);
			if (!result.ok) {
				showImportError();
				return;
			}
			const remote = await restoreRemoteBackupEntries(apiFunctions, result.remoteEntries);
			if (remote.failed > 0) {
				toast.error(
					t("data_backup.import_notes_failed", {
						defaultValue: "{{count}} favorite notes couldn't be restored.",
						count: remote.failed,
					}),
				);
			}
			// A full import can touch conversations, messages, and every
			// setting (automation, privacy, browse filters, location, etc.),
			// each of which is otherwise cached in memory or React state and
			// only ever (re)loaded on app start / account switch — a reload
			// is the only way to guarantee everything reflects the import.
			toast.success(
				t("data_backup.import_success", {
					defaultValue: "Imported {{count}} rows. Reloading…",
					count: result.rowsImported + remote.restored,
				}),
			);
			await cleanupTempFile(pendingImport.tempPath);
			setPendingImport(null);
			window.location.reload();
		} catch (error) {
			appLog.error("[SettingsDataPage] backup import failed", error);
			toast.error(getErrorMessage(error, t("data_backup.import_failed", { defaultValue: "Failed to import data." })));
		} finally {
			setIsImporting(false);
		}
	};

	const toggleImportCategory = (id: BackupCategoryId) => {
		setPendingImport((prev) => {
			if (!prev) return prev;
			const next = new Set(prev.selected);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return { ...prev, selected: next };
		});
	};

	const handleExportEncountersIcs = async () => {
		setIsExportingEncounters(true);
		try {
			const encounters = await loadEncounters();
			if (encounters.length === 0) {
				toast.error(t("data_backup.encounters_export_empty", { defaultValue: "No logged encounters to export." }));
				return;
			}
			const fileName = `free-grind-encounters-${new Date().toISOString().slice(0, 10)}.ics`;
			await saveTextFile(fileName, encountersToIcs(encounters), "text/calendar");

			toast.success(
				isAndroid()
					? t("data_backup.encounters_export_success", { defaultValue: "Encounters exported." })
					: isIos()
						? t("data_backup.encounters_export_success_ios", {
								defaultValue: "Encounters exported. Find it in the Files app under On My iPhone/iPad → Free Grind.",
							})
						: t("data_backup.encounters_export_success_desktop", { defaultValue: "Encounters exported to Downloads/FreeGrind." }),
			);
		} catch (error) {
			toast.error(getErrorMessage(error, t("data_backup.encounters_export_failed", { defaultValue: "Failed to export encounters." })));
		} finally {
			setIsExportingEncounters(false);
		}
	};

	const handleResetAllSettings = async () => {
		setIsResetting(true);
		try {
			await resetAllSettings();
			toast.success(t("data_backup.reset_success", { defaultValue: "All settings reset. Reloading…" }));
			window.location.reload();
		} catch (error) {
			toast.error(getErrorMessage(error, t("data_backup.reset_failed", { defaultValue: "Failed to reset settings." })));
			setIsResetting(false);
			setShowResetConfirm(false);
		}
	};

	return (
		<section className="app-screen">
			<PageHeader
				backTo="/settings"
				title={t("data_backup.title", { defaultValue: "Backup & Restore" })}
				subtitle={t("data_backup.subtitle", { defaultValue: "Manage downloaded media and back up your account's entire data." })}
			/>

			<div className="grid gap-8">
				<div>
					<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
						{t("data_backup.backup_section", { defaultValue: "Account Backup" })}
					</p>
					<div className="native-group">
						<RestoreStatusEntry variant="row" />
						<button
							id="data-export"
							type="button"
							onClick={openExportSheet}
							className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover-fill ${highlightId === "data-export" ? "animate-settings-highlight" : ""}`}
						>
							<div className="shrink-0 rounded-2xl bg-teal-500/15 p-2.5 text-teal-400">
								<FileDown className="h-5 w-5" />
							</div>
							<div className="min-w-0 flex-1">
								<p className="text-sm font-semibold leading-snug">
									{t("data_backup.export", { defaultValue: "Export all data" })}
								</p>
								<p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">
									{t("data_backup.export_card_desc", {
										defaultValue: "Save your entire account to a file: conversations, messages, albums, avatars, cached photos/videos, saved phrases, saved locations, and every app setting.",
									})}
								</p>
							</div>
							<Download className="h-4 w-4 shrink-0 text-[var(--text-muted)] opacity-50" />
						</button>

						<button
							id="data-import"
							type="button"
							onClick={() => {
								if (localBackups && localBackups.length > 0) {
									setShowLocalBackups(true);
								} else {
									openBackupPicker();
								}
							}}
							disabled={isImporting}
							className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ${isImporting ? "opacity-50" : "hover-fill"} ${highlightId === "data-import" ? "animate-settings-highlight" : ""}`}
						>
							<div className="shrink-0 rounded-2xl bg-violet-500/15 p-2.5 text-violet-400">
								<FileUpFilled className="h-5 w-5" />
							</div>
							<div className="min-w-0 flex-1">
								<p className="text-sm font-semibold leading-snug">
									{t("data_backup.import", { defaultValue: "Import data" })}
								</p>
								{readProgress ? (
									<BackupReadStatus progress={readProgress} className="mt-1.5" />
								) : (
									<p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">
										{t("data_backup.import_card_desc", {
											defaultValue: "Merge a previously exported file back in — nothing already here is erased. The app reloads afterwards.",
										})}
									</p>
								)}
							</div>
							{isImporting || readProgress ? (
								<Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--text-muted)]" />
							) : (
								<Upload className="h-4 w-4 shrink-0 text-[var(--text-muted)] opacity-50" />
							)}
						</button>
						<input
							ref={fileInputRef}
							type="file"
							accept="application/zip,.zip"
							className="hidden"
							onChange={(event) => {
								const file = event.target.files?.[0];
								event.target.value = "";
								if (!file) setReadProgress(null);
								if (file) void handleImportFile((report) => copyPickedFileToTemp(file, (bytesDone, bytesTotal) => report({ stage: "copying", bytesDone, bytesTotal })));
							}}
						/>

						<div className="flex items-start gap-2.5 px-4 py-3">
							<ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
							<p className="text-xs leading-relaxed text-[var(--text-muted)]">
								{t("data_backup.backup_note", {
									defaultValue: "A backup can also be imported into a different profile, e.g. after a ban: chats, albums, and drawer media are moved over to it.",
								})}
							</p>
						</div>
					</div>
				</div>

				<div className="grid gap-4">
					{/* Media Storage */}
					<div>
						<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
							{t("data_backup.media_storage", { defaultValue: "Media Storage" })}
						</p>
						<div className="native-group">
							<div
								id="data-storage-used"
								className={`flex items-center justify-between gap-4 px-4 py-3.5 ${highlightId === "data-storage-used" ? "animate-settings-highlight" : ""}`}
							>
								<div className="min-w-0">
									<p className="text-sm font-medium text-[var(--text)]">
										{t("data_backup.storage_used", { defaultValue: "Storage used" })}
									</p>
									<p className="mt-0.5 text-xs text-[var(--text-muted)]">
										{isLoadingUsage
											? t("data_backup.storage_loading", { defaultValue: "Calculating…" })
											: t("data_backup.storage_summary", {
													defaultValue: "{{size}} across {{count}} files",
													size: formatBytes(usage?.totalBytes ?? 0),
													count: usage?.count ?? 0,
												})}
									</p>
								</div>
								<RowActionPill
									tone="danger"
									onClick={() => setShowDeleteConfirm(true)}
									disabled={isLoadingUsage || (usage?.count ?? 0) === 0}
									loading={isDeleting}
									loadingLabel={t("data_backup.delete_all", { defaultValue: "Delete all" })}
								>
									<Trash2 className="h-3.5 w-3.5" />
									{t("data_backup.delete_all", { defaultValue: "Delete all" })}
								</RowActionPill>
							</div>

							<div className="flex items-start gap-2.5 px-4 py-3">
								<Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
								<p className="text-xs leading-relaxed text-[var(--text-muted)]">
									{t("data_backup.storage_note", {
										defaultValue: "Photos and videos you saved to your device from the app. Your chats and the app's cache aren't counted, and files you added to the same album or folder yourself aren't touched.",
									})}
								</p>
							</div>
						</div>
					</div>

					{/* Encounters */}
					<div>
						<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
							{t("data_backup.encounters_section", { defaultValue: "Sexual Encounters" })}
						</p>
						<div className="native-group">
							<button
								id="data-encounters-export"
								type="button"
								onClick={() => void handleExportEncountersIcs()}
								disabled={isExportingEncounters}
								className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ${isExportingEncounters ? "opacity-50" : "hover-fill"} ${highlightId === "data-encounters-export" ? "animate-settings-highlight" : ""}`}
							>
								<div className="shrink-0 rounded-2xl bg-teal-500/15 p-2.5 text-teal-400">
									<CalendarDaysFilled className="h-5 w-5" />
								</div>
								<div className="min-w-0 flex-1">
									<p className="text-sm font-semibold leading-snug">
										{t("data_backup.encounters_export", { defaultValue: "Export .ics" })}
									</p>
									<p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">
										{t("data_backup.encounters_export_desc", {
											defaultValue: "Save your logged encounters as a calendar file you can import into any calendar app.",
										})}
									</p>
								</div>
								{isExportingEncounters ? (
									<Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--text-muted)]" />
								) : (
									<Download className="h-4 w-4 shrink-0 text-[var(--text-muted)] opacity-50" />
								)}
							</button>
						</div>
					</div>
				</div>

				{/* Danger Zone */}
				<div>
					<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
						{t("data_backup.danger_zone", { defaultValue: "Danger Zone" })}
					</p>
					<div className="native-group">
						<div
							id="data-reset-all"
							className={`flex items-center justify-between gap-4 px-4 py-3.5 ${highlightId === "data-reset-all" ? "animate-settings-highlight" : ""}`}
						>
							<div className="min-w-0">
								<p className="text-sm font-medium text-[var(--text)]">
									{t("data_backup.reset_all", { defaultValue: "Reset all settings" })}
								</p>
								<p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">
									{t("data_backup.reset_all_desc", {
										defaultValue: "Restores theme, layout, privacy, automation, filters and notification settings to their defaults. Conversations and media are not affected.",
									})}
								</p>
							</div>
							<RowActionPill
								tone="danger"
								onClick={() => setShowResetConfirm(true)}
								loading={isResetting}
								loadingLabel={t("data_backup.reset_all", { defaultValue: "Reset all settings" })}
							>
								<RotateCcw className="h-3.5 w-3.5" />
								{t("data_backup.reset_all", { defaultValue: "Reset all settings" })}
							</RowActionPill>
						</div>
					</div>
				</div>
			</div>

			<ConfirmDialog
				isOpen={showDeleteConfirm}
				title={t("data_backup.delete_confirm_title", { defaultValue: "Delete all downloaded media?" })}
				message={t("data_backup.delete_confirm_message", {
					defaultValue: "This permanently deletes every photo and video this app has saved to your device. The app's own local cache is not affected.",
				})}
				confirmLabel={t("data_backup.delete_all", { defaultValue: "Delete all" })}
				cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
				confirmTone="danger"
				isProcessing={isDeleting}
				onConfirm={() => void handleDeleteAll()}
				onCancel={() => setShowDeleteConfirm(false)}
			/>

			<ConfirmDialog
				isOpen={showResetConfirm}
				title={t("data_backup.reset_confirm_title", { defaultValue: "Reset all settings?" })}
				message={t("data_backup.reset_confirm_message", {
					defaultValue: "This restores theme, layout, privacy, automation, filters and notification settings to their defaults. Conversations, media and your account are not affected. The app will reload.",
				})}
				confirmLabel={t("data_backup.reset_all", { defaultValue: "Reset all settings" })}
				cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
				confirmTone="danger"
				isProcessing={isResetting}
				onConfirm={() => void handleResetAllSettings()}
				onCancel={() => setShowResetConfirm(false)}
			/>

			{showExportSheet && userId != null && (
				<BackupExportSheet
					profileId={userId}
					dbFileName={chatDb.getActiveChatDbFileName()}
					categories={BACKUP_CATEGORY_IDS}
					isDesktop={isDesktop}
					onClose={() => setShowExportSheet(false)}
				/>
			)}

			{showLocalBackups && localBackups && (
				<BottomSheet
					onClose={() => setShowLocalBackups(false)}
					isDesktop={isDesktop}
					isProcessing={isImporting}
					panelClassName="max-h-[82dvh]"
				>
					<div className="flex items-center justify-between gap-3 px-4 pb-3">
						<div className="min-w-0">
							<p className="text-sm font-semibold text-[var(--text)]">
								{t("local_backups.sheet_title", { defaultValue: "Choose a backup" })}
							</p>
							<p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">
								{t("local_backups.sheet_desc", { defaultValue: "These backups were found in Downloads/FreeGrind on this device." })}
							</p>
						</div>
						<SheetCloseButton disabled={isImporting} />
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4" data-lenis-prevent>
						<LocalBackupList
							backups={localBackups}
							currentUserId={userId}
							disabled={isImporting}
							busyPath={selectedLocalPath}
							busyProgress={readProgress}
							onSelect={(backup) => {
								// The sheet stays open, with the status in the picked row, until the
								// backup is read; then the category sheet takes over.
								setSelectedLocalPath(backup.path);
								void handleImportFile(async () => backup.path).finally(() => {
									setSelectedLocalPath(null);
									setShowLocalBackups(false);
								});
							}}
						/>
					</div>
					{pickingOtherFile && readProgress ? <BackupReadStatus progress={readProgress} className="px-4 pb-3" /> : null}
					<div className={`flex shrink-0 gap-2.5 px-4 pb-4 ${SHEET_FOOTER_FADE_CLASS}`}>
						<button
							type="button"
							onClick={() => {
								// Stays open with the status below until the file is read; then the
								// category sheet takes over.
								setPickingOtherFile(true);
								void openBackupPicker().finally(() => {
									setPickingOtherFile(false);
									setShowLocalBackups(false);
								});
							}}
							disabled={isImporting}
							className={sheetButtonClass("secondary")}
						>
							{pickingOtherFile && readProgress ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUpFilled className="h-4 w-4" />}
							<span>{t("local_backups.choose_other", { defaultValue: "Choose another file…" })}</span>
						</button>
					</div>
				</BottomSheet>
			)}

			{pendingImport && (
				<BottomSheet onClose={handleCancelImport} isDesktop={isDesktop} isProcessing={isImporting} panelClassName="max-h-[82dvh]">
					<div className="flex items-center justify-between gap-3 px-4 pb-3">
						<div className="min-w-0">
							<p className="text-sm font-semibold text-[var(--text)]">
								{t("data_backup.import_categories_title", { defaultValue: "What do you want to restore?" })}
							</p>
							<p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">
								{t("data_backup.import_categories_desc", { defaultValue: "Only categories present in this file can be restored." })}
							</p>
						</div>
						<SheetCloseButton disabled={isImporting} />
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto pb-4" data-lenis-prevent>
						<BackupCategoryPicker categories={pendingImport.categories} selected={pendingImport.selected} onToggle={toggleImportCategory} />
					</div>
					<BackupProgressBar kind="import" active={isImporting} />
					<div className={`flex shrink-0 gap-2.5 px-4 pb-4 ${SHEET_FOOTER_FADE_CLASS}`}>
						<SheetClose
							disabled={isImporting}
							className={sheetButtonClass("secondary")}
						>
							{t("common.cancel", { defaultValue: "Cancel" })}
						</SheetClose>
						<button
							type="button"
							onClick={() => void handleConfirmImport()}
							disabled={isImporting || pendingImport.selected.size === 0}
							className={sheetButtonClass()}
						>
							{isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
							<span>{t("data_backup.import_confirm", { defaultValue: "Restore" })}</span>
						</button>
					</div>
				</BottomSheet>
			)}
		</section>
	);
}
