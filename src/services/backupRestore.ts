import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { appCacheDir, documentDir, downloadDir, join } from "@tauri-apps/api/path";
import { open as openFileDialog, save } from "@tauri-apps/plugin-dialog";
import { BaseDirectory, mkdir, open, remove } from "@tauri-apps/plugin-fs";
import { AndroidFs, AndroidPublicGeneralPurposeDir } from "tauri-plugin-android-fs-api";
import { isAndroid, isIos } from "./saveMedia";

/**
 * Mirrors `EXPORT_TABLES[].category` in `src-tauri/src/commands/backup.rs` —
 * keep the two lists in sync.
 */
export type BackupCategoryId =
	| "chat_messages"
	| "media_albums"
	| "saved_phrases"
	| "saved_locations"
	| "settings"
	| "sexual_health";

export const BACKUP_CATEGORY_IDS: BackupCategoryId[] = [
	"chat_messages",
	"media_albums",
	"saved_phrases",
	"saved_locations",
	"settings",
	"sexual_health",
];

export type BackupInspection =
	| { ok: true; categories: BackupCategoryId[]; exportedAt: number }
	| { ok: false; error: "wrong_owner" | "invalid_format" };

export type ImportBackupResult = { ok: true; rowsImported: number } | { ok: false; error: "wrong_owner" | "invalid_format" };

/** Payload of the `backup-export-progress` / `backup-import-progress` events emitted by backup.rs. */
export type BackupProgress = {
	table: string;
	tableIndex: number;
	tableCount: number;
	rowsDone: number;
	/** Missing when importing an archive written before the manifest carried row counts. */
	rowsTotal?: number;
};

/** Progress of reading a picked backup before its categories are known: copying
 * it to a scratch path (bytes only when the copy runs in JS), then checking it. */
export type BackupReadProgress =
	| { stage: "copying"; bytesDone?: number; bytesTotal?: number }
	| { stage: "checking" };

const BACKUP_TEMP_DIR = "backup-tmp";
/** Fewer, larger IPC writes — a picked File's stream yields ~64 KB chunks, one round-trip each otherwise. */
const IMPORT_WRITE_CHUNK_SIZE = 8 * 1024 * 1024;

async function tempZipPath(prefix: string): Promise<string> {
	await mkdir(BACKUP_TEMP_DIR, { baseDir: BaseDirectory.AppCache, recursive: true });
	return join(await appCacheDir(), BACKUP_TEMP_DIR, `${prefix}-${crypto.randomUUID()}.zip`);
}

/** Copies a picked `File` to a scratch path on disk, streamed so a large archive
 * never sits fully in WebView memory. `onProgress` gets the bytes written after
 * each chunk: a media backup can be gigabytes, which takes a while. */
export async function copyPickedFileToTemp(
	file: File,
	onProgress?: (bytesDone: number, bytesTotal: number) => void,
): Promise<string> {
	const path = await tempZipPath("import");
	const handle = await open(path, { write: true, create: true, truncate: true });
	try {
		const reader = file.stream().getReader();
		const buffer = new Uint8Array(IMPORT_WRITE_CHUNK_SIZE);
		let filled = 0;
		let written = 0;
		onProgress?.(0, file.size);
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			let offset = 0;
			while (offset < value.length) {
				const take = Math.min(value.length - offset, buffer.length - filled);
				buffer.set(value.subarray(offset, offset + take), filled);
				filled += take;
				offset += take;
				if (filled === buffer.length) {
					await handle.write(buffer);
					written += filled;
					filled = 0;
					onProgress?.(written, file.size);
				}
			}
		}
		if (filled > 0) {
			await handle.write(buffer.subarray(0, filled));
			written += filled;
			onProgress?.(written, file.size);
		}
	} catch (error) {
		await handle.close().catch(() => {});
		await cleanupTempFile(path);
		throw error;
	}
	await handle.close();
	return path;
}

/**
 * Android: lets the user pick a backup via the system picker and copies it to
 * a scratch path natively in Rust. `<input type="file">` on Android's WebView
 * routes the whole archive through JS, which was slow and flaky for large
 * media backups. Resolves to null if the picker was cancelled.
 */
export async function pickBackupFileToTempAndroid(onCopying?: () => void): Promise<string | null> {
	const [uri] = await AndroidFs.showOpenFilePicker({
		// Some file managers report zips as octet-stream; the inspection step
		// rejects anything that isn't actually a backup anyway.
		mimeTypes: ["application/zip", "application/x-zip-compressed", "application/octet-stream"],
	});
	if (!uri) return null;
	// Picked: the native copy reports no progress, so only its start.
	onCopying?.();
	const path = await tempZipPath("import");
	try {
		await invoke("copy_android_uri_to_file", { srcUri: uri, destPath: path });
	} catch (error) {
		await cleanupTempFile(path);
		throw error;
	}
	return path;
}

/**
 * Desktop: picks a backup with the native file dialog and returns its own path.
 * Rust reads the archive in place, so unlike a picked `File` (copied through JS,
 * ~30 s for a large media backup) there's nothing to copy. Null if cancelled.
 */
export async function pickBackupFileDesktop(): Promise<string | null> {
	const path = await openFileDialog({
		multiple: false,
		directory: false,
		filters: [{ name: "Free Grind data export", extensions: ["zip"] }],
	});
	return typeof path === "string" ? path : null;
}

/**
 * Opens the platform's backup picker and hands the result to `onPicked` as a
 * stage for it to run: on Android the native copy, on desktop the picked path
 * as is. `fallbackToInput` opens the `<input type="file">` instead: always on
 * iOS, and on desktop when the native dialog isn't available (e.g. a plain
 * browser in dev).
 */
export async function pickBackupFile(
	onPicked: (stage: (report: (progress: BackupReadProgress) => void) => Promise<string | null>) => void,
	fallbackToInput: () => void,
): Promise<void> {
	if (isAndroid()) {
		onPicked((report) => pickBackupFileToTempAndroid(() => report({ stage: "copying" })));
		return;
	}
	if (isIos()) {
		fallbackToInput();
		return;
	}
	let path: string | null;
	try {
		path = await pickBackupFileDesktop();
	} catch {
		fallbackToInput();
		return;
	}
	if (path != null) onPicked(async () => path);
}

/** Removes a scratch copy made by the pickers above. Anything outside the
 * scratch dir (a backup picked in place on desktop) is the user's own file and
 * is left alone. */
export async function cleanupTempFile(path: string): Promise<void> {
	const scratchDir = await join(await appCacheDir(), BACKUP_TEMP_DIR);
	if (!path.startsWith(scratchDir)) return;
	await remove(path).catch(() => {});
}

export function exportBackupToFile(
	dbFileName: string,
	ownerUserId: number,
	destPath: string,
	categories: BackupCategoryId[],
): Promise<void> {
	return invoke("export_backup_to_file", { dbFileName, ownerUserId, destPath, categories });
}

/** Where `exportBackup` puts the archive. "picker" is the system save/export dialog, which also reaches cloud storage like Google Drive. */
export type BackupExportDestination = "downloads" | "picker";

/**
 * Builds the backup archive natively and puts it where the user can find it:
 * Downloads/FreeGrind on desktop, the app's Documents dir on iOS (exposed in
 * the Files app via UIFileSharingEnabled), and the public Downloads/FreeGrind
 * via MediaStore on Android — or wherever the user picks in the system
 * save/export dialog. All byte shuffling happens in Rust — none of the archive ever
 * crosses the JS bridge. Resolves to false if the save dialog was cancelled.
 */
export async function exportBackup(
	dbFileName: string,
	ownerUserId: number,
	categories: BackupCategoryId[],
	destination: BackupExportDestination = "downloads",
): Promise<boolean> {
	const fileName = `free-grind-data-${new Date().toISOString().slice(0, 10)}.zip`;

	if (isIos()) {
		if (destination === "downloads") {
			await exportBackupToFile(dbFileName, ownerUserId, await join(await documentDir(), "FreeGrind", fileName), categories);
			return true;
		}
		// iOS has no "pick a path, write later" dialog: the plugin's save()
		// exports Documents/<fileName> as a copy to wherever the user picks
		// (only creating an empty placeholder if nothing is there yet). So the
		// finished archive goes exactly there first, then gets handed over.
		const stagedPath = await join(await documentDir(), fileName);
		try {
			await exportBackupToFile(dbFileName, ownerUserId, stagedPath, categories);
			return (await save({ defaultPath: fileName })) != null;
		} finally {
			// Staged in Documents, outside the scratch dir cleanupTempFile is limited to.
			await remove(stagedPath).catch(() => {});
		}
	}

	if (!isAndroid()) {
		const defaultPath = await join(await downloadDir(), "FreeGrind", fileName);
		const destPath =
			destination === "picker" ? await save({ defaultPath, filters: [{ name: "Free Grind backup", extensions: ["zip"] }] }) : defaultPath;
		if (!destPath) return false;
		await exportBackupToFile(dbFileName, ownerUserId, destPath, categories);
		return true;
	}

	// Asked before the (possibly minutes-long) build so a cancel doesn't waste it.
	const pickedUri = destination === "picker" ? await AndroidFs.showSaveFilePicker(fileName, "application/zip") : null;
	if (destination === "picker" && !pickedUri) return false;

	// Content URIs (MediaStore or a picked document) can only be written
	// through the URI itself, so the archive is built in a scratch file first
	// and then copied over natively.
	const tempPath = await tempZipPath("export");
	try {
		await exportBackupToFile(dbFileName, ownerUserId, tempPath, categories);
		if (pickedUri) {
			await invoke("copy_file_to_android_uri", { srcPath: tempPath, destUri: pickedUri });
			return true;
		}
		const uri = await AndroidFs.createNewPublicFile(AndroidPublicGeneralPurposeDir.Download, `FreeGrind/${fileName}`, "application/zip", {
			isPending: true,
		});
		try {
			await invoke("copy_file_to_android_uri", { srcPath: tempPath, destUri: uri });
			await AndroidFs.setPublicFilePending(uri, false);
			await AndroidFs.scanPublicFile(uri);
		} catch (error) {
			await AndroidFs.removeFile(uri).catch(() => {});
			throw error;
		}
		return true;
	} catch (error) {
		// The save dialog already created an empty file there.
		if (pickedUri) await AndroidFs.removeFile(pickedUri).catch(() => {});
		throw error;
	} finally {
		await cleanupTempFile(tempPath);
	}
}

export function inspectBackupFile(srcPath: string, ownerUserId: number): Promise<BackupInspection> {
	return invoke("inspect_backup_file", { srcPath, ownerUserId });
}

export function importBackupFile(
	dbFileName: string,
	ownerUserId: number,
	srcPath: string,
	categories: BackupCategoryId[],
): Promise<ImportBackupResult> {
	return invoke("import_backup_from_file", { dbFileName, ownerUserId, srcPath, categories });
}

export function listenBackupProgress(kind: "export" | "import", onProgress: (progress: BackupProgress) => void): Promise<() => void> {
	return listen<BackupProgress>(`backup-${kind}-progress`, (event) => onProgress(event.payload));
}

/** Overall 0..1 fraction across all tables, or null while the current table's size is unknown. */
export function backupProgressFraction(progress: BackupProgress): number | null {
	if (progress.tableCount === 0) return null;
	if (progress.rowsTotal == null) return null;
	const withinTable = progress.rowsTotal > 0 ? Math.min(progress.rowsDone / progress.rowsTotal, 1) : 1;
	return (progress.tableIndex + withinTable) / progress.tableCount;
}

/**
 * Tauri commands reject with the serialized `AppError` (`{ kind, message }`),
 * not an `Error` — so `error.message` checks alone always fell back to the
 * generic toast and hid the real cause.
 */
export function backupErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error) return error;
	if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message) {
		return error.message;
	}
	return fallback;
}
