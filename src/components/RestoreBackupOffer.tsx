import { useRef, useState } from "react";
import { FileArchive, FileUp, Loader2, Lock, UploadCloud } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { BackupCategoryPicker } from "./BackupCategoryPicker";
import { BackupProgressBar, BackupReadStatus } from "./BackupProgressBar";
import { FullscreenPrompt, fullscreenSecondaryButtonClass } from "./FullscreenPrompt";
import { BottomSheet, SheetClose, SheetCloseButton, sheetButtonClass, SHEET_FOOTER_FADE_CLASS } from "./ui/bottom-sheet";
import { useDesktopBreakpoint } from "../hooks/useDesktopBreakpoint";
import * as chatDb from "../services/chatDb";
import {
	backupErrorMessage as getErrorMessage,
	cleanupTempFile,
	copyPickedFileToTemp,
	importBackupFile,
	inspectBackupFile,
	pickBackupFile,
	type BackupCategoryId,
	type BackupReadProgress,
} from "../services/backupRestore";
import { markRestoreOffered } from "../utils/restoreOfferStorage";
import { appLog } from "../utils/logger";

export function RestoreBackupOffer({ userId, onDone }: { userId: number; onDone: () => void }) {
	const { t } = useTranslation();
	const isDesktop = useDesktopBreakpoint();
	const fileInputRef = useRef<HTMLInputElement>(null);

	const [isBusy, setIsBusy] = useState(false);
	const [isDragging, setIsDragging] = useState(false);
	const [readProgress, setReadProgress] = useState<BackupReadProgress | null>(null);
	const [pendingImport, setPendingImport] = useState<{
		tempPath: string;
		categories: BackupCategoryId[];
		selected: Set<BackupCategoryId>;
	} | null>(null);

	const finish = () => {
		markRestoreOffered(userId);
		onDone();
	};

	const showImportError = (error: "wrong_owner" | "invalid_format") => {
		toast.error(
			error === "wrong_owner"
				? t("restore_offer.import_wrong_owner", { defaultValue: "This export belongs to a different profile and can't be imported here." })
				: t("restore_offer.import_invalid", { defaultValue: "This file isn't a valid data export." }),
		);
	};

	/** `stage` copies the picked archive to a local scratch path (null = picker
	 * cancelled), reporting its progress through `report`. */
	const handleFilePicked = async (stage: (report: (progress: BackupReadProgress) => void) => Promise<string | null>) => {
		setIsBusy(true);
		let tempPath: string | null = null;
		try {
			tempPath = await stage(setReadProgress);
			if (tempPath == null) return;
			setReadProgress({ stage: "checking" });
			const inspection = await inspectBackupFile(tempPath, userId);
			if (!inspection.ok) {
				showImportError(inspection.error);
				await cleanupTempFile(tempPath);
				return;
			}
			setPendingImport({ tempPath, categories: inspection.categories, selected: new Set(inspection.categories) });
		} catch (error) {
			appLog.error("[RestoreBackupOffer] reading backup file failed", error);
			toast.error(getErrorMessage(error, t("restore_offer.import_failed", { defaultValue: "Failed to read backup file." })));
			if (tempPath != null) await cleanupTempFile(tempPath);
		} finally {
			setReadProgress(null);
			setIsBusy(false);
		}
	};

	const handleCancelImport = () => {
		if (pendingImport) {
			void cleanupTempFile(pendingImport.tempPath);
		}
		setPendingImport(null);
	};

	const handleConfirmImport = async () => {
		if (!pendingImport) return;
		setIsBusy(true);
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
			toast.success(
				t("restore_offer.import_success", { defaultValue: "Imported {{count}} rows. Reloading…", count: result.rowsImported }),
			);
			await cleanupTempFile(pendingImport.tempPath);
			setPendingImport(null);
			finish();
			window.location.reload();
		} catch (error) {
			appLog.error("[RestoreBackupOffer] backup import failed", error);
			toast.error(getErrorMessage(error, t("restore_offer.import_failed", { defaultValue: "Failed to read backup file." })));
		} finally {
			setIsBusy(false);
		}
	};

	const toggleCategory = (id: BackupCategoryId) => {
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

	return (
		<>
			<FullscreenPrompt
				icon={FileUp}
				title={t("restore_offer.title", { defaultValue: "Restore your data?" })}
				description={t("restore_offer.description", {
					defaultValue: "If you have a backup file from this account, you can restore your conversations, media, and settings now.",
				})}
				footer={
					<button type="button" onClick={finish} disabled={isBusy} className={fullscreenSecondaryButtonClass}>
						{t("restore_offer.skip", { defaultValue: "Skip for now" })}
					</button>
				}
			>

				<button
					type="button"
					onClick={() => {
						void pickBackupFile(
							(stage) => void handleFilePicked(stage),
							() => fileInputRef.current?.click(),
						);
					}}
					onDragOver={(event) => {
						event.preventDefault();
						if (!isBusy) setIsDragging(true);
					}}
					onDragLeave={() => setIsDragging(false)}
					onDrop={(event) => {
						event.preventDefault();
						setIsDragging(false);
						const file = event.dataTransfer.files?.[0];
						if (file && !isBusy) void handleFilePicked((report) => copyPickedFileToTemp(file, (bytesDone, bytesTotal) => report({ stage: "copying", bytesDone, bytesTotal })));
					}}
					disabled={isBusy}
					// Lightly accent-tinted drop zone, stronger on hover and while a file is
					// dragged over it. The surface comes first in each mix: where color-mix
					// is unsupported, the build falls back to the first color.
					className={`group flex w-full flex-col items-center gap-3 rounded-3xl border-2 border-dashed px-6 py-7 text-center transition disabled:cursor-wait ${
						isDragging
							? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--surface-2)_82%,var(--accent))]"
							: "border-[color-mix(in_srgb,var(--surface-2)_55%,var(--accent))] bg-[color-mix(in_srgb,var(--surface-2)_92%,var(--accent))] hover:border-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--surface-2)_86%,var(--accent))]"
					}`}
				>
					<span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)] text-[var(--accent-contrast)] shadow-lg shadow-[var(--accent)]/20 transition group-hover:scale-105">
						{isBusy ? <Loader2 className="h-7 w-7 animate-spin" /> : <UploadCloud className="h-7 w-7" />}
					</span>
					<span className="space-y-1">
						<span className="block font-semibold text-[var(--text)]">
							{readProgress
								? t("restore_offer.reading_file", { defaultValue: "Reading backup…" })
								: t("restore_offer.choose_file", { defaultValue: "Choose backup file" })}
						</span>
						{readProgress ? (
							<BackupReadStatus progress={readProgress} className="w-56 max-w-full pt-1" />
						) : (
							<span className="flex items-center justify-center gap-1.5 text-xs text-[var(--text-muted)]">
								<FileArchive className="h-3.5 w-3.5" />
								{t("restore_offer.file_hint", { defaultValue: "Free Grind data export (.zip)" })}
							</span>
						)}
					</span>
				</button>
				<input
					ref={fileInputRef}
					type="file"
					accept="application/zip,.zip"
					className="hidden"
					onChange={(event) => {
						const file = event.target.files?.[0];
						event.target.value = "";
						if (file) void handleFilePicked((report) => copyPickedFileToTemp(file, (bytesDone, bytesTotal) => report({ stage: "copying", bytesDone, bytesTotal })));
					}}
				/>

				<p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-[var(--text-muted)]">
					<Lock className="h-3.5 w-3.5" />
					{t("restore_offer.local_hint", { defaultValue: "Your backup stays on this device." })}
				</p>
			</FullscreenPrompt>

			{pendingImport && (
				<BottomSheet
					onClose={handleCancelImport}
					isDesktop={isDesktop}
					isProcessing={isBusy}
					panelClassName="max-h-[82dvh]"
					zIndex="z-[150]"
				>
					<div className="flex items-center justify-between px-4 pb-3">
						<p className="text-sm font-semibold text-[var(--text)]">
							{t("restore_offer.categories_title", { defaultValue: "What do you want to restore?" })}
						</p>
						<SheetCloseButton disabled={isBusy} />
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto pb-4" data-lenis-prevent>
						<p className="mb-3 px-4 text-xs leading-relaxed text-[var(--text-muted)]">
							{t("restore_offer.categories_desc", { defaultValue: "Only categories present in this file can be restored." })}
						</p>
						<BackupCategoryPicker categories={pendingImport.categories} selected={pendingImport.selected} onToggle={toggleCategory} />
					</div>
					<BackupProgressBar kind="import" active={isBusy} />
					<div className={`flex shrink-0 gap-2.5 px-4 pb-4 ${SHEET_FOOTER_FADE_CLASS}`}>
						<SheetClose
							disabled={isBusy}
							className={sheetButtonClass("secondary")}
						>
							{t("common.cancel", { defaultValue: "Cancel" })}
						</SheetClose>
						<button
							type="button"
							onClick={() => void handleConfirmImport()}
							disabled={isBusy || pendingImport.selected.size === 0}
							className={sheetButtonClass()}
						>
							{isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
							<span>{t("restore_offer.confirm", { defaultValue: "Restore" })}</span>
						</button>
					</div>
				</BottomSheet>
			)}
		</>
	);
}
