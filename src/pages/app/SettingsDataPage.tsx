import { useCallback, useEffect, useRef, useState } from "react";
import {
	Download,
	FileDown,
	Loader2,
	RotateCcw,
	ShieldCheck,
	Trash2,
	Upload,
} from "lucide-react";
import { CalendarDaysFilled, FileUpFilled, MessageSquareQuoteFilled } from "../../components/icons/FilledIcons";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../../components/PageHeader";
import { BackupCategoryPicker } from "../../components/BackupCategoryPicker";
import { BackupProgressBar } from "../../components/BackupProgressBar";
import { BottomSheet, SheetClose, SheetCloseButton, sheetButtonClass } from "../../components/ui/bottom-sheet";
import { Chip } from "../../components/ui/chip";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { useAuth } from "../../contexts/useAuth";
import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";
import { AndroidFs, AndroidPublicGeneralPurposeDir } from "tauri-plugin-android-fs-api";
import { BaseDirectory, mkdir, writeFile as writeFsFile } from "@tauri-apps/plugin-fs";
import * as chatDb from "../../services/chatDb";
import {
	BACKUP_CATEGORY_IDS,
	backupErrorMessage as getErrorMessage,
	cleanupTempFile,
	copyPickedFileToTemp,
	exportBackup,
	importBackupFile,
	inspectBackupFile,
	pickBackupFileToTempAndroid,
	type BackupCategoryId,
	type BackupExportDestination,
} from "../../services/backupRestore";
import { loadEncounters } from "../../services/encounters";
import { encountersToIcs } from "../../services/icsExport";
import { deleteAllDownloadedMedia, getDownloadedMediaUsage, isAndroid, isIos } from "../../services/saveMedia";
import { loadSavedPhrases, parsePhrasesFromTxt, phrasesToTxt, saveSavedPhrases } from "../../services/savedPhrases";
import { resetAllSettings } from "../../utils/resetSettings";
import { useSettingsHighlight } from "../../hooks/useSettingsHighlight";
import { appLog } from "../../utils/logger";

function formatBytes(bytes: number): string {
	if (bytes <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	const value = bytes / 1024 ** exponent;
	return `${exponent === 0 ? value : value.toFixed(1)} ${units[exponent]}`;
}

export function SettingsDataPage() {
	const { t } = useTranslation();
	const highlightId = useSettingsHighlight();
	const { userId } = useAuth();

	const [usage, setUsage] = useState<{ count: number; totalBytes: number } | null>(null);
	const [isLoadingUsage, setIsLoadingUsage] = useState(true);
	const [isDeleting, setIsDeleting] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [isExporting, setIsExporting] = useState(false);
	const [isImporting, setIsImporting] = useState(false);
	const [isResetting, setIsResetting] = useState(false);
	const [showResetConfirm, setShowResetConfirm] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const isDesktop = useDesktopBreakpoint();

	const [exportCategories, setExportCategories] = useState<Set<BackupCategoryId>>(new Set(BACKUP_CATEGORY_IDS));
	const [exportDestination, setExportDestination] = useState<BackupExportDestination>("downloads");
	const [showExportCategoryPicker, setShowExportCategoryPicker] = useState(false);
	// Closes the export picker animated once the export has finished.
	const exportSheetCloseRef = useRef<(() => void) | null>(null);
	const [pendingImport, setPendingImport] = useState<{
		tempPath: string;
		categories: BackupCategoryId[];
		selected: Set<BackupCategoryId>;
	} | null>(null);

	const [savedPhrases, setSavedPhrases] = useState<string[]>([]);
	const [isExportingPhrases, setIsExportingPhrases] = useState(false);
	const [isImportingPhrases, setIsImportingPhrases] = useState(false);
	const phrasesInputRef = useRef<HTMLInputElement>(null);

	const [isExportingEncounters, setIsExportingEncounters] = useState(false);

	useEffect(() => {
		void loadSavedPhrases().then(setSavedPhrases);
	}, []);

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

	const handleExport = async (): Promise<boolean> => {
		if (userId == null) {
			toast.error(t("data_backup.export_no_user", { defaultValue: "You must be signed in to export." }));
			return false;
		}
		if (exportCategories.size === 0) {
			toast.error(t("data_backup.export_no_categories", { defaultValue: "Choose at least one category to export." }));
			return false;
		}
		setIsExporting(true);
		try {
			// The SQL read, base64 decode, zip compression and the copy to the
			// final location all happen natively (src-tauri/src/commands/backup.rs)
			// on a worker thread — nothing of the archive crosses the JS bridge.
			const saved = await exportBackup(chatDb.getActiveChatDbFileName(), userId, Array.from(exportCategories), exportDestination);
			if (!saved) return false;
			toast.success(
				exportDestination === "picker"
					? t("data_backup.export_success_picker", { defaultValue: "Data exported to the chosen location." })
					: isAndroid()
						? t("data_backup.export_success", { defaultValue: "Data exported." })
					: isIos()
						? t("data_backup.export_success_ios", { defaultValue: "Data exported. Find it in the Files app under On My iPhone/iPad → Free Grind." })
						: t("data_backup.export_success_desktop", { defaultValue: "Data exported to Downloads/FreeGrind." }),
			);
			return true;
		} catch (error) {
			appLog.error("[SettingsDataPage] backup export failed", error);
			toast.error(getErrorMessage(error, t("data_backup.export_failed", { defaultValue: "Failed to export data." })));
			return false;
		} finally {
			setIsExporting(false);
		}
	};

	const showImportError = (error: "wrong_owner" | "invalid_format") => {
		toast.error(
			error === "wrong_owner"
				? t("data_backup.import_wrong_owner", { defaultValue: "This export belongs to a different profile and can't be imported here." })
				: t("data_backup.import_invalid", { defaultValue: "This file isn't a valid data export." }),
		);
	};

	/** `stage` copies the picked archive to a local scratch path (null = picker cancelled). */
	const handleImportFile = async (stage: () => Promise<string | null>) => {
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
			tempPath = await stage();
			if (tempPath == null) return;
			const inspection = await inspectBackupFile(tempPath, userId);
			if (!inspection.ok) {
				showImportError(inspection.error);
				await cleanupTempFile(tempPath);
				return;
			}
			setPendingImport({ tempPath, categories: inspection.categories, selected: new Set(inspection.categories) });
		} catch (error) {
			appLog.error("[SettingsDataPage] reading backup file failed", error);
			toast.error(getErrorMessage(error, t("data_backup.import_failed", { defaultValue: "Failed to import data." })));
			if (tempPath != null) await cleanupTempFile(tempPath);
		} finally {
			setIsImporting(false);
		}
	};

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
				showImportError(result.error);
				return;
			}
			// A full import can touch conversations, messages, and every
			// setting (automation, privacy, browse filters, location, etc.),
			// each of which is otherwise cached in memory or React state and
			// only ever (re)loaded on app start / account switch — a reload
			// is the only way to guarantee everything reflects the import.
			toast.success(
				t("data_backup.import_success", {
					defaultValue: "Imported {{count}} rows. Reloading…",
					count: result.rowsImported,
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

	const toggleExportCategory = (id: BackupCategoryId) => {
		setExportCategories((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const handleExportPhrasesTxt = async () => {
		const content = phrasesToTxt(savedPhrases);
		if (!content) {
			toast.error(t("data_backup.phrases_export_empty", { defaultValue: "No saved phrases to export." }));
			return;
		}
		setIsExportingPhrases(true);
		try {
			const bytes = new TextEncoder().encode(`${content}\n`);
			const fileName = `free-grind-saved-phrases-${new Date().toISOString().slice(0, 10)}.txt`;

			if (isAndroid()) {
				// Blob-URL + <a download> doesn't trigger a save on Android's WebView
				// (same reasoning as the other exports on this page), so this writes
				// via the same open-stream + writer pattern used for the encounters
				// export.
				const uri = await AndroidFs.createNewPublicFile(AndroidPublicGeneralPurposeDir.Download, `FreeGrind/${fileName}`, "text/plain", {
					isPending: true,
				});
				try {
					const writable = await AndroidFs.openWriteFileStream(uri);
					const writer = writable.getWriter();
					try {
						await writer.write(bytes);
						await writer.close();
					} catch (error) {
						await writer.abort(error).catch(() => {});
						throw error;
					}
					await AndroidFs.setPublicFilePending(uri, false);
					await AndroidFs.scanPublicFile(uri);
				} catch (error) {
					await AndroidFs.removeFile(uri).catch(() => {});
					throw error;
				}
			} else {
				const baseDir = isIos() ? BaseDirectory.Document : BaseDirectory.Download;
				await mkdir("FreeGrind", { baseDir, recursive: true });
				await writeFsFile(`FreeGrind/${fileName}`, bytes, { baseDir });
			}

			toast.success(
				isAndroid()
					? t("data_backup.phrases_export_success", { defaultValue: "Saved phrases exported." })
					: isIos()
						? t("data_backup.phrases_export_success_ios", {
								defaultValue: "Saved phrases exported. Find it in the Files app under On My iPhone/iPad → Free Grind.",
							})
						: t("data_backup.phrases_export_success_desktop", { defaultValue: "Saved phrases exported to Downloads/FreeGrind." }),
			);
		} catch (error) {
			toast.error(getErrorMessage(error, t("data_backup.phrases_export_failed", { defaultValue: "Failed to export saved phrases." })));
		} finally {
			setIsExportingPhrases(false);
		}
	};

	const handleImportPhrasesFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file) return;

		setIsImportingPhrases(true);
		try {
			const content = await file.text();
			const imported = parsePhrasesFromTxt(content);
			if (imported.length === 0) {
				toast.error(t("data_backup.phrases_import_empty", { defaultValue: "No valid phrases found in that file." }));
				return;
			}
			const updated = await saveSavedPhrases(imported);
			setSavedPhrases(updated);
			toast.success(t("data_backup.phrases_import_success", { defaultValue: "Saved phrases imported." }));
		} catch {
			toast.error(t("data_backup.phrases_import_error", { defaultValue: "Failed to import saved phrases." }));
		} finally {
			setIsImportingPhrases(false);
		}
	};

	const handleExportEncountersIcs = async () => {
		setIsExportingEncounters(true);
		try {
			const encounters = await loadEncounters();
			if (encounters.length === 0) {
				toast.error(t("data_backup.encounters_export_empty", { defaultValue: "No logged encounters to export." }));
				return;
			}
			const bytes = new TextEncoder().encode(encountersToIcs(encounters));
			const fileName = `free-grind-encounters-${new Date().toISOString().slice(0, 10)}.ics`;

			if (isAndroid()) {
				// Blob-URL + <a download> doesn't trigger a save on Android's
				// WebView. Writes via the same open-stream + writer pattern as the
				// saved phrases export above — a
				// direct AndroidFs.writeFile(uri, bytes) call on a freshly-created
				// pending MediaStore entry was unreliable on-device even though it
				// type-checks and works on desktop.
				const uri = await AndroidFs.createNewPublicFile(AndroidPublicGeneralPurposeDir.Download, `FreeGrind/${fileName}`, "text/calendar", {
					isPending: true,
				});
				try {
					const writable = await AndroidFs.openWriteFileStream(uri);
					const writer = writable.getWriter();
					try {
						await writer.write(bytes);
						await writer.close();
					} catch (error) {
						await writer.abort(error).catch(() => {});
						throw error;
					}
					await AndroidFs.setPublicFilePending(uri, false);
					await AndroidFs.scanPublicFile(uri);
				} catch (error) {
					await AndroidFs.removeFile(uri).catch(() => {});
					throw error;
				}
			} else {
				const baseDir = isIos() ? BaseDirectory.Document : BaseDirectory.Download;
				await mkdir("FreeGrind", { baseDir, recursive: true });
				await writeFsFile(`FreeGrind/${fileName}`, bytes, { baseDir });
			}

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
					<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
						<button
							id="data-export"
							type="button"
							onClick={() => setShowExportCategoryPicker(true)}
							disabled={isExporting}
							className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ${isExporting ? "opacity-50" : "hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)]"} ${highlightId === "data-export" ? "animate-settings-highlight" : ""}`}
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
							{isExporting ? (
								<Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--text-muted)]" />
							) : (
								<Download className="h-4 w-4 shrink-0 text-[var(--text-muted)] opacity-50" />
							)}
						</button>

						<button
							id="data-import"
							type="button"
							onClick={() => {
								if (isAndroid()) {
									void handleImportFile(pickBackupFileToTempAndroid);
								} else {
									fileInputRef.current?.click();
								}
							}}
							disabled={isImporting}
							className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ${isImporting ? "opacity-50" : "hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)]"} ${highlightId === "data-import" ? "animate-settings-highlight" : ""}`}
						>
							<div className="shrink-0 rounded-2xl bg-violet-500/15 p-2.5 text-violet-400">
								<FileUpFilled className="h-5 w-5" />
							</div>
							<div className="min-w-0 flex-1">
								<p className="text-sm font-semibold leading-snug">
									{t("data_backup.import", { defaultValue: "Import data" })}
								</p>
								<p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">
									{t("data_backup.import_card_desc", {
										defaultValue: "Merge a previously exported file back in — nothing already here is erased. The app reloads afterwards.",
									})}
								</p>
							</div>
							{isImporting ? (
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
								if (file) void handleImportFile(() => copyPickedFileToTemp(file));
							}}
						/>

						<div className="flex items-start gap-2.5 px-4 py-3">
							<ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
							<p className="text-xs leading-relaxed text-[var(--text-muted)]">
								{t("data_backup.backup_note", {
									defaultValue: "Exports are tied to your profile — a file can only be imported back into the same account it came from.",
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
						<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
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
								<button
									type="button"
									onClick={() => setShowDeleteConfirm(true)}
									disabled={isDeleting || isLoadingUsage || (usage?.count ?? 0) === 0}
									className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-3 text-xs font-semibold text-red-400 transition hover:bg-red-500/20 disabled:opacity-50"
								>
									{isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
									{t("data_backup.delete_all", { defaultValue: "Delete all" })}
								</button>
							</div>
						</div>
					</div>

					{/* Saved Phrases */}
					<div>
						<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
							{t("data_backup.phrases_section", { defaultValue: "Saved Phrases" })}
						</p>
						<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
							<button
								id="data-phrases-export"
								type="button"
								onClick={() => void handleExportPhrasesTxt()}
								disabled={savedPhrases.length === 0 || isExportingPhrases}
								className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ${savedPhrases.length === 0 ? "opacity-50" : "hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)]"} ${highlightId === "data-phrases-export" ? "animate-settings-highlight" : ""}`}
							>
								<div className="shrink-0 rounded-2xl bg-teal-500/15 p-2.5 text-teal-400">
									<MessageSquareQuoteFilled className="h-5 w-5" />
								</div>
								<div className="min-w-0 flex-1">
									<p className="text-sm font-semibold leading-snug">
										{t("data_backup.phrases_export", { defaultValue: "Export .txt" })}
									</p>
									<p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">
										{t("data_backup.phrases_export_desc", {
											defaultValue: "Save your saved phrases as a plain text file, one per line.",
										})}
									</p>
								</div>
								{isExportingPhrases ? (
									<Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--text-muted)]" />
								) : (
									<Download className="h-4 w-4 shrink-0 text-[var(--text-muted)] opacity-50" />
								)}
							</button>

							<button
								id="data-phrases-import"
								type="button"
								onClick={() => phrasesInputRef.current?.click()}
								disabled={isImportingPhrases}
								className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ${isImportingPhrases ? "opacity-50" : "hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)]"} ${highlightId === "data-phrases-import" ? "animate-settings-highlight" : ""}`}
							>
								<div className="shrink-0 rounded-2xl bg-violet-500/15 p-2.5 text-violet-400">
									<Upload className="h-5 w-5" />
								</div>
								<div className="min-w-0 flex-1">
									<p className="text-sm font-semibold leading-snug">
										{isImportingPhrases
											? t("data_backup.phrases_importing", { defaultValue: "Importing…" })
											: t("data_backup.phrases_import", { defaultValue: "Import .txt" })}
									</p>
									<p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">
										{t("data_backup.phrases_import_desc", {
											defaultValue: "One phrase per line — replaces the current list.",
										})}
									</p>
								</div>
								{isImportingPhrases ? (
									<Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--text-muted)]" />
								) : (
									<Upload className="h-4 w-4 shrink-0 text-[var(--text-muted)] opacity-50" />
								)}
							</button>
						</div>
						<input
							ref={phrasesInputRef}
							type="file"
							accept=".txt,text/plain"
							className="hidden"
							onChange={(event) => void handleImportPhrasesFile(event)}
						/>
					</div>

					{/* Encounters */}
					<div>
						<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
							{t("data_backup.encounters_section", { defaultValue: "Sexual Encounters" })}
						</p>
						<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
							<button
								id="data-encounters-export"
								type="button"
								onClick={() => void handleExportEncountersIcs()}
								disabled={isExportingEncounters}
								className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ${isExportingEncounters ? "opacity-50" : "hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)]"} ${highlightId === "data-encounters-export" ? "animate-settings-highlight" : ""}`}
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
					<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
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
							<button
								type="button"
								onClick={() => setShowResetConfirm(true)}
								disabled={isResetting}
								className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-3 text-xs font-semibold text-red-400 transition hover:bg-red-500/20 disabled:opacity-50"
							>
								{isResetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
								{t("data_backup.reset_all", { defaultValue: "Reset all settings" })}
							</button>
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

			{showExportCategoryPicker && (
				<BottomSheet
					onClose={() => setShowExportCategoryPicker(false)}
					closeRef={exportSheetCloseRef}
					isDesktop={isDesktop}
					isProcessing={isExporting}
					panelClassName="max-h-[82dvh]"
				>
					<div className="flex items-center justify-between px-4 pb-3">
						<p className="text-sm font-semibold text-[var(--text)]">
							{t("data_backup.export_categories_title", { defaultValue: "What do you want to export?" })}
						</p>
						<SheetCloseButton disabled={isExporting} />
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto pb-4" data-lenis-prevent>
						<BackupCategoryPicker categories={BACKUP_CATEGORY_IDS} selected={exportCategories} onToggle={toggleExportCategory} />
						<div className="px-4 pt-4">
							<p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
								{t("data_backup.export_destination_title", { defaultValue: "Save to" })}
							</p>
							<div className="flex flex-wrap gap-2">
								<Chip selected={exportDestination === "downloads"} disabled={isExporting} onClick={() => setExportDestination("downloads")}>
									{isIos()
										? t("data_backup.export_destination_device", { defaultValue: "This device" })
										: t("data_backup.export_destination_downloads", { defaultValue: "Downloads" })}
								</Chip>
								<Chip selected={exportDestination === "picker"} disabled={isExporting} onClick={() => setExportDestination("picker")}>
									{t("data_backup.export_destination_picker", { defaultValue: "Choose location…" })}
								</Chip>
							</div>
							<p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">
								{exportDestination === "downloads"
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
					<div className="flex gap-2.5 px-4 pb-4 pt-2">
						<SheetClose
							disabled={isExporting}
							className={sheetButtonClass("secondary")}
						>
							{t("common.cancel", { defaultValue: "Cancel" })}
						</SheetClose>
						<button
							type="button"
							onClick={() => {
								void (async () => {
									const success = await handleExport();
									if (success) {
										exportSheetCloseRef.current?.();
									}
								})();
							}}
							disabled={isExporting || exportCategories.size === 0}
							className={sheetButtonClass()}
						>
							{isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
							<span>{t("data_backup.export_confirm", { defaultValue: "Export" })}</span>
						</button>
					</div>
				</BottomSheet>
			)}

			{pendingImport && (
				<BottomSheet onClose={handleCancelImport} isDesktop={isDesktop} isProcessing={isImporting} panelClassName="max-h-[82dvh]">
					<div className="flex items-center justify-between px-4 pb-3">
						<p className="text-sm font-semibold text-[var(--text)]">
							{t("data_backup.import_categories_title", { defaultValue: "What do you want to restore?" })}
						</p>
						<SheetCloseButton disabled={isImporting} />
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto pb-4" data-lenis-prevent>
						<p className="mb-3 px-4 text-xs leading-relaxed text-[var(--text-muted)]">
							{t("data_backup.import_categories_desc", {
								defaultValue: "Only categories present in this file can be restored.",
							})}
						</p>
						<BackupCategoryPicker categories={pendingImport.categories} selected={pendingImport.selected} onToggle={toggleImportCategory} />
					</div>
					<BackupProgressBar kind="import" active={isImporting} />
					<div className="flex gap-2.5 px-4 pb-4 pt-2">
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
