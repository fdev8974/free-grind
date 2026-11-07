import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { appCacheDir, documentDir, downloadDir, join } from "@tauri-apps/api/path";
import { open as openFileDialog, save } from "@tauri-apps/plugin-dialog";
import { BaseDirectory, mkdir, open, remove } from "@tauri-apps/plugin-fs";
import { AndroidFs, AndroidPublicGeneralPurposeDir } from "tauri-plugin-android-fs-api";
import { isAndroid, isIos } from "./saveMedia";
import type { createApiFunctions } from "./apiFunctions";
import { assertSuccess, parseJsonSafe } from "./apiHelpers";
import * as chatDb from "./chatDb";
import { fetchAndEncode } from "./mediaStore";
import { pickRestorableProfileFields } from "./ownProfileDetails";
import { getProfileImageUrl, validateMediaHash } from "../utils/media";
import { appLog } from "../utils/logger";
import { inboxResponseSchema } from "../types/messages";

/**
 * Mirrors `EXPORT_TABLES[].category` in `src-tauri/src/commands/backup.rs` —
 * keep the two lists in sync.
 */
export type BackupCategoryId =
	| "chat_messages"
	| "media_albums"
	| "drawer_media"
	| "own_albums"
	| "profile_details"
	| "profile_photos"
	| "blocked_profiles"
	| "saved_phrases"
	| "saved_locations"
	| "settings"
	| "sexual_health"
	| "favorites";

export const BACKUP_CATEGORY_IDS: BackupCategoryId[] = [
	"chat_messages",
	"media_albums",
	"drawer_media",
	"own_albums",
	"profile_details",
	"profile_photos",
	"blocked_profiles",
	"saved_phrases",
	"saved_locations",
	"settings",
	"sexual_health",
	"favorites",
];

type ApiFunctions = ReturnType<typeof createApiFunctions>;
/** One `remote/favorites.json` entry; read back by `queue_restored_favorites` in backup.rs. */
type FavoriteProfile = { profileId: string; displayName?: string | null; notes?: string; phoneNumber?: string };

/** Guards both paging loops below against a server that never stops handing out a next page. */
const MAX_FAVORITE_PAGES = 200;

/**
 * Collects every favorited profile. There's no endpoint listing them, so it
 * combines the inbox filtered to favorites (everyone favorited with a chat)
 * with cascade's favorites filter for the rest. The inbox is fetched raw:
 * `listConversations` runs the automation rules on what it loads.
 */
async function fetchFavoriteProfiles(api: ApiFunctions, geohash: string | null | undefined): Promise<FavoriteProfile[]> {
	const favorites = new Map<string, FavoriteProfile>();

	try {
		for (let page = 1, count = 0; count < MAX_FAVORITE_PAGES; count++) {
			// The full filter set, as ChatPage sends it: a body with only favoritesOnly failed.
			const response = await api.request(`/v4/inbox?page=${page}`, {
				method: "POST",
				body: {
					unreadOnly: false,
					chemistryOnly: false,
					favoritesOnly: true,
					rightNowOnly: false,
					onlineNowOnly: false,
					positions: [],
				},
			});
			await assertSuccess(response, "Loading favorites from the inbox failed");
			const parsed = inboxResponseSchema.parse(await parseJsonSafe(response));
			for (const entry of parsed.entries) {
				const profileId = entry.data.participants[0]?.profileId;
				if (profileId != null) favorites.set(String(profileId), { profileId: String(profileId), displayName: entry.data.name || null });
			}
			if (parsed.nextPage == null || parsed.nextPage === page) break;
			page = parsed.nextPage;
		}
	} catch (error) {
		// Not worth failing the whole backup over: the favorite flag the inbox
		// sync stored on the local conversations stands in for the inbox.
		appLog.warn("[backupRestore] loading favorites from the inbox failed, using the local conversations", error);
		for (const conversation of await chatDb.listConversations({ includeArchived: true })) {
			const profileId = conversation.otherProfileId;
			if (!conversation.entry.data.favorite || !profileId || favorites.has(profileId)) continue;
			favorites.set(profileId, { profileId, displayName: conversation.entry.data.name || null });
		}
	}

	// Cascade needs a location; without one only the inbox's favorites are saved.
	if (geohash) {
		let page: number | undefined;
		for (let count = 0; count < MAX_FAVORITE_PAGES; count++) {
			const { cards, nextPage } = await api.getBrowseCards({ geohash, page, filters: { favorites: true } });
			for (const card of cards) {
				if (!favorites.has(card.profileId)) favorites.set(card.profileId, { profileId: card.profileId, displayName: card.displayName });
			}
			if (nextPage == null || nextPage === page || cards.length === 0) break;
			page = nextPage;
		}
	}

	return Array.from(favorites.values());
}

export type BackupInspection =
	| { ok: true; categories: BackupCategoryId[]; exportedAt: number }
	| { ok: false; error: "invalid_format" };

export type ImportBackupResult =
	| { ok: true; rowsImported: number; remoteEntries?: Partial<Record<BackupCategoryId, unknown>> }
	| { ok: false; error: "invalid_format" };

/** Payload of the `backup-export-progress` / `backup-import-progress` events emitted by backup.rs. */
export type BackupProgress = {
	table: string;
	tableIndex: number;
	tableCount: number;
	rowsDone: number;
	/** Missing when importing an archive written before the manifest carried row counts. */
	rowsTotal?: number;
};

/** Progress of reading a picked backup before its categories are known: waiting
 * for the picked file to arrive (the WebView hands a picked `File` over only
 * once it's done preparing it, which for a large backup takes a while), copying
 * it to a scratch path, then checking it. */
export type BackupReadProgress =
	| { stage: "opening" }
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
export async function pickBackupFileToTempAndroid(
	onCopying?: (bytesDone?: number, bytesTotal?: number) => void,
): Promise<string | null> {
	const [uri] = await AndroidFs.showOpenFilePicker({
		// Some file managers report zips as octet-stream; the inspection step
		// rejects anything that isn't actually a backup anyway.
		mimeTypes: ["application/zip", "application/x-zip-compressed", "application/octet-stream"],
	});
	if (!uri) return null;
	onCopying?.();
	const unlisten = await listen<{ bytesDone: number; bytesTotal?: number }>("backup-copy-progress", (event) =>
		onCopying?.(event.payload.bytesDone, event.payload.bytesTotal),
	);
	const path = await tempZipPath("import");
	try {
		await invoke("copy_android_uri_to_file", { srcUri: uri, destPath: path });
	} catch (error) {
		await cleanupTempFile(path);
		throw error;
	} finally {
		unlisten();
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
 * stage for it to run: on Android the picker plus the native copy (which
 * reports progress only once a file was picked), on desktop the picked path
 * as is. Resolves once the dialog closed; on desktop without `onPicked` if it
 * was cancelled. `fallbackToInput` opens the `<input type="file">` instead: always on
 * iOS, and on desktop when the native dialog isn't available (e.g. a plain
 * browser in dev).
 */
export async function pickBackupFile(
	onPicked: (stage: (report: (progress: BackupReadProgress) => void) => Promise<string | null>) => void,
	fallbackToInput: () => void,
): Promise<void> {
	if (isAndroid()) {
		onPicked((report) =>
			pickBackupFileToTempAndroid((bytesDone, bytesTotal) => report({ stage: "copying", bytesDone, bytesTotal })),
		);
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
	remoteEntries: Partial<Record<BackupCategoryId, unknown>> = {},
): Promise<void> {
	return invoke("export_backup_to_file", { dbFileName, ownerUserId, destPath, categories, remoteEntries });
}

/**
 * Fetches the selected server-side categories (`REMOTE_CATEGORY_IDS` in
 * backup.rs), to be passed to `exportBackup`. Favorites carry their note: one
 * can only be saved on a favorite, so both are restored together, the note
 * right after its profile is favorited again (restoredFavorites.ts).
 * `offline` (a banned profile, no session) skips the server: backup.rs then
 * takes the favorites from the local conversations instead, without notes.
 */
export async function fetchRemoteBackupEntries(
	api: ApiFunctions,
	categories: BackupCategoryId[],
	{ geohash, offline = false }: { geohash: string | null | undefined; offline?: boolean },
): Promise<Partial<Record<BackupCategoryId, unknown>>> {
	const entries: Partial<Record<BackupCategoryId, unknown>> = {};
	if (offline) return entries;
	if (categories.includes("favorites")) {
		const [profiles, notes] = await Promise.all([fetchFavoriteProfiles(api, geohash), api.getFavoriteNotes()]);
		const favorites = new Map(profiles.map((profile) => [profile.profileId, profile]));
		for (const { counterpartyId, notes: text, phoneNumber } of notes) {
			if (!text && !phoneNumber) continue;
			const profileId = String(counterpartyId);
			// A note means a favorite, also one neither the inbox nor cascade turned up.
			favorites.set(profileId, { ...favorites.get(profileId), profileId, notes: text, phoneNumber });
		}
		entries.favorites = Array.from(favorites.values());
	}
	return entries;
}

/** remoteEntries key of the own-profile fallback (OWN_PROFILE_FALLBACK_KEY in backup.rs). */
const OWN_PROFILE_FALLBACK_KEY = "ownProfileFallback";

/** Hashes of a /v7/profiles snapshot's photos, primary first. */
function snapshotPhotoHashes(snapshot: Record<string, unknown>): string[] {
	const medias = Array.isArray(snapshot.medias) ? (snapshot.medias as { mediaHash?: unknown }[]) : [];
	const hashes = medias.map((media) => (typeof media?.mediaHash === "string" ? media.mediaHash : ""));
	const primary = typeof snapshot.profileImageMediaHash === "string" ? snapshot.profileImageMediaHash : null;
	if (primary && !hashes.includes(primary)) hashes.unshift(primary);
	return Array.from(new Set(hashes.filter((hash) => validateMediaHash(hash))));
}

/**
 * Profile details and photos for a profile whose own_profile_* tables are
 * empty: data from before they existed, or a profile banned before its first
 * sync. backup.rs then exports them from the profile's last snapshot (taken
 * whenever the own profile was opened), photos downloaded full size from the
 * public CDN, which needs no session. Added to `remoteEntries` as is;
 * resolves to them unchanged when there's nothing to fill in.
 */
export async function addOwnProfileFallback(
	dbFileName: string,
	ownerUserId: number,
	categories: BackupCategoryId[],
	remoteEntries: Partial<Record<BackupCategoryId, unknown>>,
): Promise<Record<string, unknown>> {
	const wantsDetails = categories.includes("profile_details");
	const wantsPhotos = categories.includes("profile_photos");
	if (!wantsDetails && !wantsPhotos) return remoteEntries;
	try {
		const source = await invoke<{ needsDetails: boolean; needsPhotos: boolean; snapshot: string | null }>(
			"read_own_profile_fallback_source",
			{ dbFileName, ownerUserId },
		);
		if (!source.snapshot) return remoteEntries;
		const parsed: unknown = JSON.parse(source.snapshot);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return remoteEntries;
		const snapshot = parsed as Record<string, unknown>;

		const fallback: { details?: Record<string, unknown>; photos?: { mediaHash: string; mimeType: string | null; dataBase64: string }[] } = {};
		if (wantsDetails && source.needsDetails) fallback.details = pickRestorableProfileFields(snapshot);
		if (wantsPhotos && source.needsPhotos) {
			fallback.photos = [];
			for (const hash of snapshotPhotoHashes(snapshot)) {
				const fetched = await fetchAndEncode(getProfileImageUrl(hash, "1024x1024"));
				if (fetched) fallback.photos.push({ mediaHash: hash, mimeType: fetched.mimeType, dataBase64: fetched.base64 });
			}
		}
		appLog.info("[backupRestore] own profile from its last snapshot", {
			details: fallback.details != null,
			photos: fallback.photos?.length ?? 0,
		});
		return { ...remoteEntries, [OWN_PROFILE_FALLBACK_KEY]: fallback };
	} catch (error) {
		// Only a fallback: the export goes on without it.
		appLog.warn("[backupRestore] own profile fallback failed", error);
		return remoteEntries;
	}
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
	remoteEntries: Partial<Record<BackupCategoryId, unknown>> = {},
): Promise<boolean> {
	const fileName = `free-grind-data-${new Date().toISOString().slice(0, 10)}.zip`;

	if (isIos()) {
		if (destination === "downloads") {
			await exportBackupToFile(dbFileName, ownerUserId, await join(await documentDir(), "FreeGrind", fileName), categories, remoteEntries);
			return true;
		}
		// iOS has no "pick a path, write later" dialog: the plugin's save()
		// exports Documents/<fileName> as a copy to wherever the user picks
		// (only creating an empty placeholder if nothing is there yet). So the
		// finished archive goes exactly there first, then gets handed over.
		const stagedPath = await join(await documentDir(), fileName);
		try {
			await exportBackupToFile(dbFileName, ownerUserId, stagedPath, categories, remoteEntries);
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
		await exportBackupToFile(dbFileName, ownerUserId, destPath, categories, remoteEntries);
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
		await exportBackupToFile(dbFileName, ownerUserId, tempPath, categories, remoteEntries);
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

export function inspectBackupFile(srcPath: string): Promise<BackupInspection> {
	return invoke("inspect_backup_file", { srcPath });
}

/** A backup found in the default export folder by `list_local_backups` in backup.rs. */
export type LocalBackup = {
	/** Absolute path, readable in place: pass it straight to inspect/import. */
	path: string;
	fileName: string;
	sizeBytes: number;
	modifiedAt: number;
	exportedAt: number;
	ownerUserId: number;
	categories: BackupCategoryId[];
	conversationCount?: number;
	messageCount?: number;
};

/**
 * Backups sitting in the folder `exportBackup` writes to by default
 * (Downloads/FreeGrind, Documents/FreeGrind on iOS), newest first. On Android
 * only files this install created are visible. Empty on any error, e.g. in a
 * plain browser in dev.
 */
export async function listLocalBackups(): Promise<LocalBackup[]> {
	try {
		return await invoke<LocalBackup[]>("list_local_backups");
	} catch {
		return [];
	}
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
