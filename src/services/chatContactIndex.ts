import Database from "@tauri-apps/plugin-sql";
import type {
	ChatContactIndexRecord,
	GridContactIndexInput,
	InboxContactIndexInput,
} from "../types/chat-contact-index";
import { appLog } from "../utils/logger";
import { guardAgainstClosedPool } from "./sqlitePoolGuard";

const CHAT_INDEX_DB = "sqlite:chat_contact_status.sqlite3";
const SQLITE_BUSY_TIMEOUT_MS = 5_000;
const SQLITE_LOCK_RETRY_DELAYS_MS = [30, 80, 180, 350] as const;

type ChatContactIndexRow = {
	profile_id: string;
	conversation_id: string | null;
	last_message_timestamp: number | null;
	unread_count: number;
	has_chatted: number | boolean;
	updated_at: number;
};

type LocalNicknameRow = {
	profile_id: string;
	local_nickname: string;
};

let dbPromise: Promise<Database> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

// The contact index lives in one shared sqlite file, but its rows (unread
// count, has-chatted, conversation id) describe *this account's* relationship
// with another profile — so every row is scoped by the logged-in account.
// Without that, a message received on account A lit up the unread badge for
// the sender on account B too, which has no such conversation. Local
// nicknames (chat_local_profile_meta) are the user's own labels for a person
// and intentionally stay shared across accounts.
let activeAccountId: string | null = null;

export function setActiveChatContactIndexAccount(profileId: number | string | null): void {
	activeAccountId = profileId != null ? String(profileId) : null;
}

async function getDb(): Promise<Database> {
	if (!dbPromise) {
		dbPromise = (async () => {
			const db = guardAgainstClosedPool(await Database.load(CHAT_INDEX_DB), "chat-index");
			// Enable WAL mode and a reasonable busy timeout to improve concurrency.
			// Note: We avoid manual BEGIN transactions because the Tauri plugin uses a connection pool
			// without session affinity, which makes manual transactions unreliable.
			try {
				await db.execute("PRAGMA journal_mode = WAL");
				await db.execute("PRAGMA synchronous = NORMAL");
				await db.execute(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
			} catch (error) {
				appLog.warn("[chat-index] failed to set pragmas", error);
			}

			// Ensure tables are created inside the serialized queue.
			await executeWithLockRetry(db, "init-tables", async () => {
				// Legacy table keyed by profile_id alone, so its rows mixed every
				// account's state together. It's a derived cache (inbox sync and
				// the grid repopulate it), so it's dropped rather than migrated —
				// there's no way to tell which account a legacy row belonged to.
				await db.execute("DROP TABLE IF EXISTS chat_contact_index");
				await db.execute(`
				CREATE TABLE IF NOT EXISTS chat_contact_status (
					account_id TEXT NOT NULL,
					profile_id TEXT NOT NULL,
					conversation_id TEXT,
					last_message_timestamp INTEGER,
					unread_count INTEGER NOT NULL DEFAULT 0,
					has_chatted INTEGER NOT NULL DEFAULT 0,
					updated_at INTEGER NOT NULL,
					PRIMARY KEY (account_id, profile_id)
				)
			`);
				await db.execute(`
				CREATE TABLE IF NOT EXISTS chat_local_profile_meta (
					profile_id TEXT PRIMARY KEY,
					local_nickname TEXT NOT NULL,
					updated_at INTEGER NOT NULL
				)
			`);
				await db.execute(
					"CREATE INDEX IF NOT EXISTS idx_chat_local_profile_meta_updated_at ON chat_local_profile_meta(updated_at DESC)",
				);
				// The profile's own display name as last acknowledged by the user,
				// so a rename behind a nickname can be surfaced, plus the one before
				// it so a view still showing the old name from a stale cache isn't
				// reported as a rename back. Added after the table shipped, hence
				// the guarded ALTERs.
				const columns = await db.select<{ name: string }[]>(
					"PRAGMA table_info(chat_local_profile_meta)",
				);
				for (const column of ["seen_display_name", "previous_seen_display_name"]) {
					if (!columns.some((existing) => existing.name === column)) {
						await db.execute(
							`ALTER TABLE chat_local_profile_meta ADD COLUMN ${column} TEXT`,
						);
					}
				}
			});

			return db;
		})();
	}

	return dbPromise;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function isSqliteLockedError(error: unknown): boolean {
	if (typeof error !== "string") {
		const message = error instanceof Error ? error.message : JSON.stringify(error);
		if (!message) {
			return false;
		}
		return /database is locked|\(code:\s*(5|517)\)/i.test(message);
	}

	return /database is locked|\(code:\s*(5|517)\)/i.test(error);
}

async function executeWithLockRetry(
	_db: Database,
	label: string,
	run: () => Promise<void>,
): Promise<void> {
	const queuedRun = async () => {
		const maxAttempts = SQLITE_LOCK_RETRY_DELAYS_MS.length + 1;

		for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
			try {
				await run();
				if (attempt > 1) {
					appLog.warn("[chat-index] recovered from sqlite lock", {
						label,
						attempt,
					});
				}
				return;
			} catch (error) {
				const locked = isSqliteLockedError(error);
				if (!locked || attempt >= maxAttempts) {
					throw error;
				}

				const delayMs = SQLITE_LOCK_RETRY_DELAYS_MS[attempt - 1] ?? 400;
				appLog.warn("[chat-index] sqlite lock during write, retrying", {
					label,
					attempt,
					delayMs,
				});
				await sleep(delayMs);
			}
		}
	};

	const current = writeQueue.then(queuedRun, queuedRun);
	writeQueue = current.then(() => undefined, () => undefined);
	await current;
}

export async function initChatContactIndex(): Promise<void> {
	await getDb();
}

export async function upsertChatContactIndexFromInbox(
	entries: InboxContactIndexInput[],
): Promise<void> {
	const accountId = activeAccountId;
	if (entries.length === 0 || accountId == null) {
		return;
	}

	const db = await getDb();
	const now = Date.now();

	await executeWithLockRetry(db, "upsert-from-inbox", async () => {
		for (const entry of entries) {
			const profileId = entry.profileId.trim();
			if (!profileId) {
				continue;
			}

			await db.execute(
				`
			INSERT INTO chat_contact_status (
				account_id,
				profile_id,
				conversation_id,
				last_message_timestamp,
				unread_count,
				has_chatted,
				updated_at
			) VALUES ($1, $2, $3, $4, $5, 1, $6)
			ON CONFLICT(account_id, profile_id) DO UPDATE SET
				conversation_id = COALESCE(excluded.conversation_id, chat_contact_status.conversation_id),
				last_message_timestamp = CASE
					WHEN excluded.last_message_timestamp IS NULL THEN chat_contact_status.last_message_timestamp
					WHEN chat_contact_status.last_message_timestamp IS NULL THEN excluded.last_message_timestamp
					WHEN excluded.last_message_timestamp > chat_contact_status.last_message_timestamp THEN excluded.last_message_timestamp
					ELSE chat_contact_status.last_message_timestamp
				END,
				unread_count = COALESCE(excluded.unread_count, chat_contact_status.unread_count),
				has_chatted = 1,
				updated_at = excluded.updated_at
			`,
				[
					accountId,
					profileId,
					entry.conversationId,
					entry.lastMessageTimestamp,
					Math.max(0, entry.unreadCount ?? 0),
					now,
				],
			);
		}
	});

	// appLog.debug("[chat-index] upsert from inbox", { count: entries.length });
}

export async function upsertChatContactIndexFromGrid(
	entries: GridContactIndexInput[],
): Promise<void> {
	const accountId = activeAccountId;
	if (entries.length === 0 || accountId == null) {
		return;
	}

	const db = await getDb();
	const now = Date.now();

	await executeWithLockRetry(db, "upsert-from-grid", async () => {
		for (const entry of entries) {
			const profileId = entry.profileId.trim();
			if (!profileId) {
				continue;
			}

			const unreadCount = Math.max(0, entry.unreadCount ?? 0);

			await db.execute(
				`
			INSERT INTO chat_contact_status (
				account_id,
				profile_id,
				conversation_id,
				last_message_timestamp,
				unread_count,
				has_chatted,
				updated_at
			) VALUES ($1, $2, NULL, NULL, $3, CASE WHEN $3 > 0 THEN 1 ELSE 0 END, $4)
			ON CONFLICT(account_id, profile_id) DO UPDATE SET
				unread_count = CASE
					WHEN excluded.unread_count > chat_contact_status.unread_count THEN excluded.unread_count
					ELSE chat_contact_status.unread_count
				END,
				has_chatted = CASE
					WHEN chat_contact_status.has_chatted = 1 THEN 1
					WHEN excluded.unread_count > 0 THEN 1
					ELSE 0
				END,
				updated_at = excluded.updated_at
			`,
				[accountId, profileId, unreadCount, now],
			);
		}
	});
}

export async function getChatContactIndexForProfiles(
	profileIds: string[],
): Promise<ChatContactIndexRecord[]> {
	const accountId = activeAccountId;
	if (profileIds.length === 0 || accountId == null) {
		return [];
	}

	const db = await getDb();
	const ids = profileIds.map((id) => id.trim()).filter(Boolean);
	if (ids.length === 0) {
		return [];
	}

	const placeholders = ids.map((_, index) => `$${index + 2}`).join(", ");
	const rows = await db.select<ChatContactIndexRow[]>(
		`
		SELECT
			profile_id,
			conversation_id,
			last_message_timestamp,
			unread_count,
			has_chatted,
			updated_at
		FROM chat_contact_status
		WHERE account_id = $1 AND profile_id IN (${placeholders})
		`,
		[accountId, ...ids],
	);

	return rows.map((row) => ({
		profileId: row.profile_id,
		conversationId: row.conversation_id,
		lastMessageTimestamp: row.last_message_timestamp,
		unreadCount: row.unread_count,
		hasChatted: Boolean(row.has_chatted),
		updatedAt: row.updated_at,
	}));
}

export function indexChatContactRecordsByProfileId(
	records: ChatContactIndexRecord[],
): Record<string, ChatContactIndexRecord> {
	const next: Record<string, ChatContactIndexRecord> = {};
	for (const record of records) {
		next[record.profileId] = record;
	}
	return next;
}

/**
 * Increment the unread count for a profile in the local index.
 * Useful for realtime message arrivals when the full inbox isn't being reloaded.
 */
export async function incrementUnreadCountForProfile(
	profileId: string,
	conversationId: string,
	lastMessageTimestamp: number,
): Promise<void> {
	const accountId = activeAccountId;
	const normalizedProfileId = profileId?.trim();
	if (
		accountId == null ||
		!normalizedProfileId ||
		normalizedProfileId === "undefined" ||
		normalizedProfileId === "null"
	) {
		return;
	}

	const db = await getDb();
	const now = Date.now();

	await executeWithLockRetry(db, "increment-unread", async () => {
		await db.execute(
			`
			INSERT INTO chat_contact_status (
				account_id,
				profile_id,
				conversation_id,
				last_message_timestamp,
				unread_count,
				has_chatted,
				updated_at
			) VALUES ($1, $2, $3, $4, 1, 1, $5)
			ON CONFLICT(account_id, profile_id) DO UPDATE SET
				conversation_id = COALESCE(excluded.conversation_id, chat_contact_status.conversation_id),
				last_message_timestamp = CASE
					WHEN excluded.last_message_timestamp > COALESCE(chat_contact_status.last_message_timestamp, 0)
					THEN excluded.last_message_timestamp
					ELSE chat_contact_status.last_message_timestamp
				END,
				unread_count = chat_contact_status.unread_count + 1,
				has_chatted = 1,
				updated_at = excluded.updated_at
			`,
			[accountId, normalizedProfileId, conversationId, lastMessageTimestamp, now],
		);
	});
}

/**
 * Reset the unread count to zero for a profile in the local index.
 */
export async function clearUnreadCountForProfile(
	profileId: string,
): Promise<void> {
	const accountId = activeAccountId;
	const normalizedProfileId = profileId.trim();
	if (accountId == null || !normalizedProfileId) {
		return;
	}

	const db = await getDb();
	const now = Date.now();

	await executeWithLockRetry(db, "clear-unread", async () => {
		await db.execute(
			`
			UPDATE chat_contact_status
			SET unread_count = 0, updated_at = $3
			WHERE account_id = $1 AND profile_id = $2
			`,
			[accountId, normalizedProfileId, now],
		);
	});
}

export async function setLocalNicknameForProfile(
	profileId: string,
	nickname: string | null,
): Promise<void> {
	const normalizedProfileId = profileId.trim();
	if (!normalizedProfileId) {
		return;
	}

	const normalizedNickname = nickname?.trim() ?? "";
	const db = await getDb();

	await executeWithLockRetry(db, "set-local-nickname", async () => {
		if (!normalizedNickname) {
			await db.execute(
				"DELETE FROM chat_local_profile_meta WHERE profile_id = $1",
				[normalizedProfileId],
			);
			return;
		}

		await db.execute(
			`
			INSERT INTO chat_local_profile_meta (
				profile_id,
				local_nickname,
				updated_at
			) VALUES ($1, $2, $3)
			ON CONFLICT(profile_id) DO UPDATE SET
				local_nickname = excluded.local_nickname,
				updated_at = excluded.updated_at
			`,
			[normalizedProfileId, normalizedNickname, Date.now()],
		);
	});
	// A new or removed nickname row starts or drops its seen name.
	notifySeenDisplayNamesChanged();
}

export async function getLocalNicknamesForProfiles(
	profileIds: string[],
): Promise<Record<string, string>> {
	if (profileIds.length === 0) {
		return {};
	}

	const ids = profileIds.map((id) => id.trim()).filter(Boolean);
	if (ids.length === 0) {
		return {};
	}

	const db = await getDb();
	const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
	const rows = await db.select<LocalNicknameRow[]>(
		`
		SELECT profile_id, local_nickname
		FROM chat_local_profile_meta
		WHERE profile_id IN (${placeholders})
		`,
		ids,
	);

	const next: Record<string, string> = {};
	for (const row of rows) {
		const nickname = row.local_nickname.trim();
		if (nickname) {
			next[row.profile_id] = nickname;
		}
	}

	return next;
}

export type SeenDisplayName = {
	/** The display name the user last saw behind their nickname. */
	name: string;
	/** The one acknowledged before that, if any. */
	previousName: string | null;
};

/** Seen display names for nicknamed profiles; profiles without one recorded are left out. */
export async function getSeenDisplayNamesForProfiles(
	profileIds: string[],
): Promise<Record<string, SeenDisplayName>> {
	const ids = profileIds.map((id) => id.trim()).filter(Boolean);
	if (ids.length === 0) {
		return {};
	}

	const db = await getDb();
	const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
	const rows = await db.select<{
		profile_id: string;
		seen_display_name: string | null;
		previous_seen_display_name: string | null;
	}[]>(
		`
		SELECT profile_id, seen_display_name, previous_seen_display_name
		FROM chat_local_profile_meta
		WHERE profile_id IN (${placeholders}) AND seen_display_name IS NOT NULL
		`,
		ids,
	);

	const next: Record<string, SeenDisplayName> = {};
	for (const row of rows) {
		if (row.seen_display_name) {
			next[row.profile_id] = {
				name: row.seen_display_name,
				previousName: row.previous_seen_display_name,
			};
		}
	}
	return next;
}

/**
 * Records the profile's current display name as seen. No-op without a
 * nickname row. `onlyIfUnset` only fills in a missing baseline, so a list
 * that loads a fresh name can't silently swallow a rename.
 */
export async function setSeenDisplayNameForProfile(
	profileId: string,
	displayName: string,
	{ onlyIfUnset = false }: { onlyIfUnset?: boolean } = {},
): Promise<void> {
	const normalizedProfileId = profileId.trim();
	const normalizedName = displayName.trim();
	if (!normalizedProfileId || !normalizedName) {
		return;
	}

	const db = await getDb();
	await executeWithLockRetry(db, "set-seen-display-name", async () => {
		await db.execute(
			onlyIfUnset
				? "UPDATE chat_local_profile_meta SET seen_display_name = $2 WHERE profile_id = $1 AND seen_display_name IS NULL"
				: `
				UPDATE chat_local_profile_meta SET
					previous_seen_display_name = CASE
						WHEN seen_display_name IS NOT NULL AND seen_display_name != $2 THEN seen_display_name
						ELSE previous_seen_display_name
					END,
					seen_display_name = $2
				WHERE profile_id = $1
				`,
			[normalizedProfileId, normalizedName],
		);
	});
	// Filling a baseline changes nothing on screen; notifying for it would
	// just make every list reload once per profile.
	if (!onlyIfUnset) {
		notifySeenDisplayNamesChanged();
	}
}

// Grid tiles, chat rows and headers each read the seen names; acknowledging a
// rename in one place has to clear the marker everywhere else.
const seenDisplayNameListeners = new Set<() => void>();

export function subscribeSeenDisplayNames(listener: () => void): () => void {
	seenDisplayNameListeners.add(listener);
	return () => {
		seenDisplayNameListeners.delete(listener);
	};
}

function notifySeenDisplayNamesChanged(): void {
	for (const listener of seenDisplayNameListeners) {
		listener();
	}
}
