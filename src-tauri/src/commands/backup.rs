//! Native backup/restore for the local chat database.
//!
//! Replaces the old all-JS export (one giant JSON file with photos/videos
//! base64-embedded inline in the rows) with a zip archive built directly in
//! Rust: SQL reads, base64 decode, and compression all happen natively
//! instead of crossing the JS<->WebView IPC bridge as multi-hundred-MB text.
//!
//! Archive layout (version 2):
//!   tables/<name>.jsonl   - one JSON object per row, ORDER BY the table's primary key
//!                           (only present for tables whose category was selected)
//!   media/<n>.bin         - raw bytes for each blob column, referenced from its
//!                           row as { "$mediaRef": "media/<n>.bin" } instead of
//!                           inlining base64 text
//!   manifest.json        - { version, exportedAt, ownerUserId, categories, rowCounts }
//!                           (written last so it can carry per-table row counts;
//!                           readers look it up by name, so entry order doesn't matter)
//!
//! `categories` lets the caller include/exclude whole groups of tables
//! (chat messages, media/albums, saved phrases, saved locations, settings,
//! sexual health - see `BACKUP_CATEGORY_IDS` in `src/services/backupRestore.ts`)
//! instead of always doing a full all-or-nothing export/import.
//!
//! Blob columns (data_base64 etc.) are stored as base64 TEXT in the sqlite
//! schema itself, so export decodes them once here and stores raw bytes
//! (Stored, uncompressed - photos/video are already compressed); import
//! re-encodes them back to base64 text to match the existing column type.
//!
//! Every command runs its work on a blocking worker thread: plain sync Tauri
//! commands run on the main thread, which froze the UI (and tripped Android's
//! ANR watchdog) for the whole duration of a media-heavy export.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Manager};
use zip::result::ZipError;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::error::AppError;

const BACKUP_VERSION: i64 = 2;
const EXPORT_PROGRESS_EVENT: &str = "backup-export-progress";
const IMPORT_PROGRESS_EVENT: &str = "backup-import-progress";
/// Time-based rather than row-based: one media row can be several MB, so a
/// fixed row interval left the UI without any update for minutes.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(150);
/// The app's own sqlite pool (chatDb.ts) only waits 5s on a locked database,
/// so import commits in short slices instead of holding one write lock for
/// the whole (possibly multi-minute) restore. Import is an upsert-merge, so a
/// restore interrupted between slices is safe to simply run again.
const IMPORT_SLICE_MAX_DURATION: Duration = Duration::from_millis(300);
const IMPORT_SLICE_MAX_BYTES: usize = 32 * 1024 * 1024;
const COPY_BUFFER_SIZE: usize = 1024 * 1024;

struct TableSpec {
    name: &'static str,
    primary_key: &'static str,
    /// One of the user-facing backup categories (see `BACKUP_CATEGORIES` in
    /// `src/services/backupRestore.ts`) - lets export/import include or skip
    /// whole groups of tables together instead of always doing all-or-nothing.
    category: &'static str,
    columns: &'static [&'static str],
    blob_columns: &'static [&'static str],
}

/// Mirrors `FULL_EXPORT_TABLES` in `src/services/chatDb.ts` exactly, including
/// the deliberate omission of `album_media.position` (a real schema column
/// that the JS export has never included) - keep behavior identical.
const EXPORT_TABLES: &[TableSpec] = &[
    TableSpec {
        name: "conversations",
        primary_key: "conversation_id",
        category: "chat_messages",
        columns: &[
            "conversation_id",
            "other_profile_id",
            "name",
            "participants_json",
            "last_activity_timestamp",
            "unread_count",
            "pinned",
            "muted",
            "favorite",
            "preview_json",
            "archived",
            "archived_reason",
            "archived_at",
            "hidden",
            "last_seen_in_inbox_at",
            "created_at",
            "updated_at",
        ],
        blob_columns: &[],
    },
    TableSpec {
        name: "conversation_meta",
        primary_key: "conversation_id",
        category: "chat_messages",
        columns: &["conversation_id", "last_read_timestamp"],
        blob_columns: &[],
    },
    TableSpec {
        name: "messages",
        primary_key: "message_id",
        category: "chat_messages",
        columns: &[
            "message_id",
            "conversation_id",
            "sender_id",
            "timestamp",
            "type",
            "chat1_type",
            "body_json",
            "unsent",
            "local_history",
            "reply_to_message_id",
            "reply_preview_json",
            "reactions_json",
            "created_at",
            "updated_at",
        ],
        blob_columns: &[],
    },
    TableSpec {
        name: "media_files",
        primary_key: "media_key",
        category: "media_albums",
        columns: &[
            "media_key",
            "conversation_id",
            "message_id",
            "kind",
            "mime_type",
            "data_base64",
            "view_once",
            "size_bytes",
            "fetch_status",
            "fetched_at",
        ],
        blob_columns: &["data_base64"],
    },
    TableSpec {
        name: "albums",
        primary_key: "album_id",
        category: "media_albums",
        columns: &[
            "album_id",
            "owner_profile_id",
            "album_name",
            "conversation_id",
            "shared_via_message_id",
            "preview_cover_base64",
            "preview_cover_mime_type",
            "created_at",
            "updated_at",
        ],
        blob_columns: &["preview_cover_base64"],
    },
    TableSpec {
        name: "album_media",
        primary_key: "content_id",
        category: "media_albums",
        columns: &[
            "content_id",
            "album_id",
            "content_type",
            "data_base64",
            "thumb_data_base64",
            "remaining_views",
            "is_viewable",
            "fetched_at",
        ],
        blob_columns: &["data_base64", "thumb_data_base64"],
    },
    TableSpec {
        name: "avatars",
        primary_key: "media_hash",
        category: "media_albums",
        columns: &["media_hash", "data_base64", "mime_type", "fetched_at"],
        blob_columns: &["data_base64"],
    },
    TableSpec {
        name: "drawer_collections",
        primary_key: "id",
        category: "media_albums",
        columns: &["id", "name", "media_ids_json", "created_at", "updated_at"],
        blob_columns: &[],
    },
    TableSpec {
        name: "settings",
        primary_key: "key",
        category: "settings",
        columns: &["key", "value"],
        blob_columns: &[],
    },
    TableSpec {
        name: "saved_phrases",
        primary_key: "phrase",
        category: "saved_phrases",
        columns: &["phrase", "created_at"],
        blob_columns: &[],
    },
    TableSpec {
        name: "saved_locations",
        primary_key: "id",
        category: "saved_locations",
        columns: &["id", "name", "geohash", "lat", "lon", "created_at"],
        blob_columns: &[],
    },
    TableSpec {
        name: "sexual_health_prep_doses",
        primary_key: "id",
        category: "sexual_health",
        columns: &["id", "taken_at", "scheme", "dose_role", "note", "created_at"],
        blob_columns: &[],
    },
    TableSpec {
        name: "sexual_health_encounters",
        primary_key: "id",
        category: "sexual_health",
        columns: &[
            "id",
            "occurred_at",
            "profile_id",
            "display_name",
            "tags_json",
            "note",
            "conversation_id",
            "created_at",
        ],
        blob_columns: &[],
    },
    TableSpec {
        name: "sexual_health_appointments",
        primary_key: "id",
        category: "sexual_health",
        columns: &[
            "id",
            "title",
            "scheduled_at",
            "kind",
            "location",
            "note",
            "completed_at",
            "created_at",
        ],
        blob_columns: &[],
    },
    TableSpec {
        name: "sexual_health_sti_tests",
        primary_key: "id",
        category: "sexual_health",
        columns: &["id", "tested_at", "test_type", "result", "note", "created_at"],
        blob_columns: &[],
    },
];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupProgress<'a> {
    table: &'a str,
    table_index: usize,
    table_count: usize,
    rows_done: u64,
    /// Missing for archives written before the manifest carried row counts.
    #[serde(skip_serializing_if = "Option::is_none")]
    rows_total: Option<u64>,
}

struct ProgressEmitter<'a> {
    /// None in tests, where there's no app to emit to.
    app: Option<&'a AppHandle>,
    event: &'static str,
    last_emit: Option<Instant>,
}

impl<'a> ProgressEmitter<'a> {
    fn new(app: Option<&'a AppHandle>, event: &'static str) -> Self {
        Self { app, event, last_emit: None }
    }

    fn maybe_emit(&mut self, progress: BackupProgress) {
        if self.last_emit.is_none_or(|t| t.elapsed() >= PROGRESS_INTERVAL) {
            self.emit(progress);
        }
    }

    fn emit(&mut self, progress: BackupProgress) {
        if let Some(app) = self.app {
            let _ = app.emit(self.event, progress);
        }
        self.last_emit = Some(Instant::now());
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    rows_imported: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInspection {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    categories: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    exported_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'static str>,
}

/// Falls back to this if an archive's manifest predates the `categories`
/// field (shouldn't happen in practice - export always writes it now - but
/// costs nothing to handle gracefully rather than hide every table).
const ALL_CATEGORY_IDS: &[&str] =
    &["chat_messages", "media_albums", "saved_phrases", "saved_locations", "settings", "sexual_health"];

enum ManifestCheck {
    Valid { categories: Vec<String>, exported_at: i64, row_counts: HashMap<String, u64> },
    Invalid(&'static str),
}

type Archive = ZipArchive<BufReader<File>>;

fn open_archive(path: &str) -> Result<Archive, AppError> {
    let file = File::open(path)?;
    Ok(ZipArchive::new(BufReader::with_capacity(COPY_BUFFER_SIZE, file))?)
}

/// Shared by `inspect_backup_file` and `import_backup_from_file` so the
/// version/owner validation rules can't drift between the two.
fn read_and_validate_manifest(archive: &mut Archive, owner_user_id: i64) -> Result<ManifestCheck, AppError> {
    let manifest: Value = {
        let mut manifest_file = match archive.by_name("manifest.json") {
            Ok(file) => file,
            Err(_) => return Ok(ManifestCheck::Invalid("invalid_format")),
        };
        let mut text = String::new();
        manifest_file.read_to_string(&mut text)?;
        match serde_json::from_str(&text) {
            Ok(value) => value,
            Err(_) => return Ok(ManifestCheck::Invalid("invalid_format")),
        }
    };

    let version = manifest.get("version").and_then(Value::as_i64);
    if version != Some(BACKUP_VERSION) {
        return Ok(ManifestCheck::Invalid("invalid_format"));
    }
    let manifest_owner = manifest.get("ownerUserId").and_then(Value::as_i64);
    if manifest_owner != Some(owner_user_id) {
        return Ok(ManifestCheck::Invalid("wrong_owner"));
    }

    let exported_at = manifest.get("exportedAt").and_then(Value::as_i64).unwrap_or(0);
    let categories = manifest
        .get("categories")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_else(|| ALL_CATEGORY_IDS.iter().map(|s| s.to_string()).collect());
    let row_counts = manifest
        .get("rowCounts")
        .and_then(Value::as_object)
        .map(|obj| obj.iter().filter_map(|(k, v)| v.as_u64().map(|n| (k.clone(), n))).collect())
        .unwrap_or_default();

    Ok(ManifestCheck::Valid { categories, exported_at, row_counts })
}

fn resolve_db_path(app: &AppHandle, db_file_name: &str) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Backup(format!("failed to resolve app data dir: {e}")))?;
    Ok(dir.join(db_file_name))
}

async fn run_blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| AppError::Backup(format!("backup worker failed: {e}")))?
}

/// Profile dbs that haven't been opened since a table was added lack it until
/// the app's migrations run again; skip it instead of failing the whole backup.
fn table_exists(conn: &Connection, name: &str) -> Result<bool, AppError> {
    Ok(conn
        .prepare_cached("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1")?
        .exists([name])?)
}

fn selected_tables(categories: &[String]) -> Vec<&'static TableSpec> {
    EXPORT_TABLES
        .iter()
        .filter(|t| categories.iter().any(|c| c == t.category))
        .collect()
}

fn sql_value_to_json(row: &rusqlite::Row, idx: usize) -> Result<Value, AppError> {
    use rusqlite::types::ValueRef;
    let value_ref = row.get_ref(idx)?;
    Ok(match value_ref {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Value::String(BASE64.encode(b)),
    })
}

fn json_to_rusqlite(value: &Value) -> Result<rusqlite::types::Value, AppError> {
    Ok(match value {
        Value::Null => rusqlite::types::Value::Null,
        Value::Bool(b) => rusqlite::types::Value::Integer(if *b { 1 } else { 0 }),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                rusqlite::types::Value::Integer(i)
            } else if let Some(u) = n.as_u64() {
                rusqlite::types::Value::Integer(u as i64)
            } else if let Some(f) = n.as_f64() {
                rusqlite::types::Value::Real(f)
            } else {
                return Err(AppError::Backup("unsupported number value in row".into()));
            }
        }
        Value::String(s) => rusqlite::types::Value::Text(s.clone()),
        Value::Array(_) | Value::Object(_) => {
            return Err(AppError::Backup("unsupported nested value in row".into()));
        }
    })
}

fn build_upsert_sql(table: &TableSpec) -> String {
    let cols_csv = table.columns.join(", ");
    let placeholders = (1..=table.columns.len())
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(", ");
    let update_set = table
        .columns
        .iter()
        .copied()
        .filter(|&c| c != table.primary_key)
        .map(|c| format!("{c} = excluded.{c}"))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "INSERT INTO {} ({cols_csv}) VALUES ({placeholders}) ON CONFLICT({}) DO UPDATE SET {update_set}",
        table.name, table.primary_key
    )
}

fn partial_path(dest: &Path) -> PathBuf {
    let mut name = dest.as_os_str().to_owned();
    name.push(".partial");
    PathBuf::from(name)
}

/// Writes the archive to `<dest_path>.partial` and only renames it into place
/// once it's complete, so a failed or interrupted export never leaves a
/// truncated zip behind that looks like a valid backup.
#[tauri::command]
pub async fn export_backup_to_file(
    app: AppHandle,
    db_file_name: String,
    owner_user_id: i64,
    dest_path: String,
    categories: Vec<String>,
) -> Result<(), AppError> {
    run_blocking(move || {
        let dest = PathBuf::from(dest_path);
        let partial = partial_path(&dest);
        let result = (|| {
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let db_path = resolve_db_path(&app, &db_file_name)?;
            let mut progress = ProgressEmitter::new(Some(&app), EXPORT_PROGRESS_EVENT);
            write_export_archive(&db_path, owner_user_id, &partial, &categories, &mut progress)?;
            std::fs::rename(&partial, &dest)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&partial);
        }
        result
    })
    .await
}

fn write_export_archive(
    db_path: &Path,
    owner_user_id: i64,
    out_path: &Path,
    categories: &[String],
    progress: &mut ProgressEmitter,
) -> Result<(), AppError> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    conn.busy_timeout(Duration::from_secs(30))?;

    let tables = selected_tables(categories);
    let table_count = tables.len();

    let file = File::create(out_path)?;
    let mut zip = ZipWriter::new(BufWriter::with_capacity(COPY_BUFFER_SIZE, file));
    // large_file: entry sizes aren't known up front, and a big messages table
    // or video must not fail the whole export past the 4 GiB zip32 limit.
    let text_options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .large_file(true);
    let blob_options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);

    let mut media_counter: u64 = 0;
    let mut row_counts = Map::new();

    for (table_index, table) in tables.into_iter().enumerate() {
        if !table_exists(&conn, table.name)? {
            continue;
        }
        let rows_total = conn
            .query_row(&format!("SELECT COUNT(*) FROM {}", table.name), [], |r| r.get::<_, i64>(0))
            .map_err(|e| AppError::Backup(format!("failed to count {}: {e}", table.name)))?
            as u64;
        progress.emit(BackupProgress { table: table.name, table_index, table_count, rows_done: 0, rows_total: Some(rows_total) });

        let entry_name = format!("tables/{}.jsonl", table.name);
        // A zip writer only has one open entry at a time: starting a media/<n>.bin
        // entry closes the current one, so a table with blob columns can't
        // stream its jsonl while it also writes media. Its rows (blob refs
        // only, so small) are buffered and written after its media instead.
        let has_blobs = !table.blob_columns.is_empty();
        let mut buffered_jsonl: Vec<u8> = Vec::new();
        if !has_blobs {
            zip.start_file(entry_name.as_str(), text_options)?;
        }

        let select_sql = format!(
            "SELECT {} FROM {} ORDER BY {}",
            table.columns.join(", "),
            table.name,
            table.primary_key
        );
        let mut stmt = conn
            .prepare(&select_sql)
            .map_err(|e| AppError::Backup(format!("failed to query {}: {e}", table.name)))?;
        let mut rows = stmt
            .query([])
            .map_err(|e| AppError::Backup(format!("failed to query {}: {e}", table.name)))?;

        let mut rows_done: u64 = 0;
        while let Some(row) = rows
            .next()
            .map_err(|e| AppError::Backup(format!("failed to read row from {}: {e}", table.name)))?
        {
            let mut obj = Map::new();
            for (col_index, col) in table.columns.iter().copied().enumerate() {
                if !table.blob_columns.contains(&col) {
                    obj.insert(col.to_string(), sql_value_to_json(row, col_index)?);
                    continue;
                }
                use rusqlite::types::ValueRef;
                let bytes = match row.get_ref(col_index)? {
                    ValueRef::Null => None,
                    ValueRef::Text(text) => match BASE64.decode(text) {
                        Ok(bytes) => Some(bytes),
                        // Not worth failing a whole multi-GB export over one
                        // malformed cell: keep it verbatim inline instead.
                        Err(_) => {
                            obj.insert(col.to_string(), Value::String(String::from_utf8_lossy(text).into_owned()));
                            continue;
                        }
                    },
                    ValueRef::Blob(b) => Some(b.to_vec()),
                    ValueRef::Integer(_) | ValueRef::Real(_) => {
                        obj.insert(col.to_string(), sql_value_to_json(row, col_index)?);
                        continue;
                    }
                };
                match bytes {
                    Some(bytes) => {
                        let media_path = format!("media/{media_counter}.bin");
                        media_counter += 1;
                        zip.start_file(
                            media_path.as_str(),
                            blob_options.large_file(bytes.len() as u64 >= u32::MAX as u64),
                        )?;
                        zip.write_all(&bytes)?;
                        obj.insert(col.to_string(), json!({ "$mediaRef": media_path }));
                    }
                    None => {
                        obj.insert(col.to_string(), Value::Null);
                    }
                }
            }

            let line = Value::Object(obj).to_string();
            if has_blobs {
                buffered_jsonl.extend_from_slice(line.as_bytes());
                buffered_jsonl.push(b'\n');
            } else {
                zip.write_all(line.as_bytes())?;
                zip.write_all(b"\n")?;
            }

            rows_done += 1;
            progress.maybe_emit(BackupProgress { table: table.name, table_index, table_count, rows_done, rows_total: Some(rows_total) });
        }

        if has_blobs {
            zip.start_file(entry_name.as_str(), text_options)?;
            zip.write_all(&buffered_jsonl)?;
        }

        row_counts.insert(table.name.to_string(), json!(rows_done));
        progress.emit(BackupProgress { table: table.name, table_index, table_count, rows_done, rows_total: Some(rows_total) });
    }

    zip.start_file("manifest.json", text_options)?;
    let manifest = json!({
        "version": BACKUP_VERSION,
        "exportedAt": chrono::Utc::now().timestamp_millis(),
        "ownerUserId": owner_user_id,
        "categories": categories,
        "rowCounts": row_counts,
    });
    zip.write_all(manifest.to_string().as_bytes())?;

    let mut writer = zip.finish()?;
    writer.flush()?;
    writer
        .into_inner()
        .map_err(|e| AppError::Backup(format!("failed to flush archive: {e}")))?
        .sync_all()?;
    Ok(())
}

#[tauri::command]
pub async fn inspect_backup_file(src_path: String, owner_user_id: i64) -> Result<BackupInspection, AppError> {
    run_blocking(move || {
        let file = File::open(&src_path)?;
        let mut archive = match ZipArchive::new(BufReader::with_capacity(COPY_BUFFER_SIZE, file)) {
            Ok(archive) => archive,
            // Not a zip at all (wrong file picked) - same message as any other bad file.
            Err(_) => {
                return Ok(BackupInspection { ok: false, categories: None, exported_at: None, error: Some("invalid_format") });
            }
        };

        Ok(match read_and_validate_manifest(&mut archive, owner_user_id)? {
            ManifestCheck::Invalid(error) => BackupInspection { ok: false, categories: None, exported_at: None, error: Some(error) },
            ManifestCheck::Valid { categories, exported_at, .. } => {
                BackupInspection { ok: true, categories: Some(categories), exported_at: Some(exported_at), error: None }
            }
        })
    })
    .await
}

#[tauri::command]
pub async fn import_backup_from_file(
    app: AppHandle,
    db_file_name: String,
    owner_user_id: i64,
    src_path: String,
    categories: Vec<String>,
) -> Result<ImportOutcome, AppError> {
    run_blocking(move || {
        let db_path = resolve_db_path(&app, &db_file_name)?;
        let mut progress = ProgressEmitter::new(Some(&app), IMPORT_PROGRESS_EVENT);
        import_archive(&db_path, owner_user_id, &src_path, &categories, &mut progress)
    })
    .await
}

fn import_archive(
    db_path: &Path,
    owner_user_id: i64,
    src_path: &str,
    categories: &[String],
    progress: &mut ProgressEmitter,
) -> Result<ImportOutcome, AppError> {
    let mut archive = open_archive(src_path)?;

    let row_counts = match read_and_validate_manifest(&mut archive, owner_user_id)? {
        ManifestCheck::Invalid(error) => {
            return Ok(ImportOutcome { ok: false, rows_imported: None, error: Some(error) });
        }
        ManifestCheck::Valid { row_counts, .. } => row_counts,
    };

    // A second handle on the same file: a table's jsonl entry streams from
    // `archive` while the media it references is read from this one,
    // instead of first collecting every line of the table into memory.
    let mut media_archive = open_archive(src_path)?;

    let conn = Connection::open(db_path)?;
    conn.busy_timeout(Duration::from_secs(30))?;
    conn.execute_batch("BEGIN IMMEDIATE")?;

    let result = import_tables(&conn, &mut archive, &mut media_archive, categories, &row_counts, progress);
    match result {
        Ok(rows_imported) => {
            conn.execute_batch("COMMIT")?;
            Ok(ImportOutcome { ok: true, rows_imported: Some(rows_imported), error: None })
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

/// Expects to be called inside an open transaction; leaves one open on success.
fn import_tables(
    conn: &Connection,
    archive: &mut Archive,
    media_archive: &mut Archive,
    categories: &[String],
    row_counts: &HashMap<String, u64>,
    progress: &mut ProgressEmitter,
) -> Result<u64, AppError> {
    let tables = selected_tables(categories);
    let table_count = tables.len();
    let mut total_rows_imported: u64 = 0;
    let mut slice_started = Instant::now();
    let mut slice_bytes: usize = 0;

    for (table_index, table) in tables.into_iter().enumerate() {
        let rows_total = row_counts.get(table.name).copied();
        progress.emit(BackupProgress { table: table.name, table_index, table_count, rows_done: 0, rows_total });

        if !table_exists(conn, table.name)? {
            continue;
        }
        let entry_name = format!("tables/{}.jsonl", table.name);
        let entry = match archive.by_name(&entry_name) {
            Ok(entry) => entry,
            Err(ZipError::FileNotFound) => continue,
            Err(e) => return Err(e.into()),
        };

        let upsert_sql = build_upsert_sql(table);
        let mut rows_done: u64 = 0;

        for line in BufReader::with_capacity(COPY_BUFFER_SIZE, entry).lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            let row_value: Value = serde_json::from_str(&line)
                .map_err(|e| AppError::Backup(format!("corrupt row in {}: {e}", table.name)))?;
            let Value::Object(mut row_map) = row_value else {
                continue;
            };

            let pk_present = row_map.get(table.primary_key).map(|v| !v.is_null()).unwrap_or(false);
            if !pk_present {
                continue;
            }

            for blob_col in table.blob_columns.iter().copied() {
                let resolved = match row_map.get(blob_col) {
                    Some(Value::Object(ref_obj)) => {
                        let media_path = ref_obj.get("$mediaRef").and_then(Value::as_str).ok_or_else(|| {
                            AppError::Backup(format!("missing $mediaRef in {}.{blob_col}", table.name))
                        })?;
                        let mut media_file = media_archive.by_name(media_path)?;
                        let mut bytes = Vec::with_capacity(media_file.size() as usize);
                        media_file.read_to_end(&mut bytes)?;
                        slice_bytes += bytes.len();
                        Value::String(BASE64.encode(bytes))
                    }
                    // Export keeps a cell that wasn't valid base64 verbatim inline.
                    Some(Value::String(text)) => Value::String(text.clone()),
                    Some(Value::Null) | None => Value::Null,
                    Some(_) => {
                        return Err(AppError::Backup(format!(
                            "unexpected value for blob column {}.{blob_col}",
                            table.name
                        )));
                    }
                };
                row_map.insert(blob_col.to_string(), resolved);
            }

            let params = table
                .columns
                .iter()
                .copied()
                .map(|c| json_to_rusqlite(row_map.get(c).unwrap_or(&Value::Null)))
                .collect::<Result<Vec<_>, AppError>>()?;

            conn.prepare_cached(&upsert_sql)?
                .execute(rusqlite::params_from_iter(params.iter()))?;
            slice_bytes += line.len();

            rows_done += 1;
            total_rows_imported += 1;
            progress.maybe_emit(BackupProgress { table: table.name, table_index, table_count, rows_done, rows_total });

            if slice_started.elapsed() >= IMPORT_SLICE_MAX_DURATION || slice_bytes >= IMPORT_SLICE_MAX_BYTES {
                conn.execute_batch("COMMIT")?;
                // Give the app's own connection a window to grab the write lock
                // (sqlite's busy handler polls in up-to-100ms steps).
                std::thread::sleep(Duration::from_millis(60));
                conn.execute_batch("BEGIN IMMEDIATE")?;
                slice_started = Instant::now();
                slice_bytes = 0;
            }
        }

        progress.emit(BackupProgress { table: table.name, table_index, table_count, rows_done, rows_total });
    }

    Ok(total_rows_imported)
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn copy_to_file(src: impl Read, mut dest: File) -> Result<(), AppError> {
    let mut reader = BufReader::with_capacity(COPY_BUFFER_SIZE, src);
    std::io::copy(&mut reader, &mut dest)?;
    dest.flush()?;
    // Some content providers hand out pipes/sockets, which can't be fsync'd.
    let _ = dest.sync_all();
    Ok(())
}

/// Android: copies a finished export into a MediaStore/SAF file natively.
/// Going through the JS write stream instead meant one IPC round-trip per
/// 512 KB chunk, which for a media-heavy backup crawled and eventually failed.
#[tauri::command]
pub async fn copy_file_to_android_uri(app: AppHandle, src_path: String, dest_uri: Value) -> Result<(), AppError> {
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_android_fs::{AndroidFsExt, FileUri};
        let uri: FileUri = serde_json::from_value(dest_uri)
            .map_err(|e| AppError::Backup(format!("invalid destination uri: {e}")))?;
        let dest = app
            .android_fs_async()
            .open_file_writable(&uri)
            .await
            .map_err(|e| AppError::Backup(format!("failed to open destination: {e}")))?;
        run_blocking(move || copy_to_file(File::open(&src_path)?, dest)).await
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, src_path, dest_uri);
        Err(AppError::Backup("copy_file_to_android_uri is Android-only".into()))
    }
}

/// Android: copies a file picked via the system picker to a local scratch
/// path natively (see `copy_file_to_android_uri` for why not via JS).
#[tauri::command]
pub async fn copy_android_uri_to_file(app: AppHandle, src_uri: Value, dest_path: String) -> Result<(), AppError> {
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_android_fs::{AndroidFsExt, FileUri};
        let uri: FileUri = serde_json::from_value(src_uri)
            .map_err(|e| AppError::Backup(format!("invalid source uri: {e}")))?;
        let src = app
            .android_fs_async()
            .open_file_readable(&uri)
            .await
            .map_err(|e| AppError::Backup(format!("failed to open picked file: {e}")))?;
        run_blocking(move || copy_to_file(src, File::create(&dest_path)?)).await
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, src_uri, dest_path);
        Err(AppError::Backup("copy_android_uri_to_file is Android-only".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::types::Value as SqlValue;

    fn create_schema(conn: &Connection) {
        for table in EXPORT_TABLES {
            let cols = table
                .columns
                .iter()
                .map(|&c| if c == table.primary_key { format!("{c} PRIMARY KEY") } else { c.to_string() })
                .collect::<Vec<_>>()
                .join(", ");
            conn.execute_batch(&format!("CREATE TABLE {} ({cols})", table.name)).unwrap();
        }
    }

    fn dump(conn: &Connection, table: &TableSpec) -> Vec<Vec<SqlValue>> {
        let mut stmt = conn
            .prepare(&format!("SELECT {} FROM {} ORDER BY {}", table.columns.join(", "), table.name, table.primary_key))
            .unwrap();
        stmt.query_map([], |row| (0..table.columns.len()).map(|i| row.get::<_, SqlValue>(i)).collect())
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    /// Regression: blob tables used to write their jsonl rows into whichever
    /// media/<n>.bin entry was open last, so media/album rows never came back.
    #[test]
    fn export_then_import_round_trips_every_table() {
        let dir = std::env::temp_dir().join(format!("fg-backup-roundtrip-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src_db = dir.join("src.sqlite3");
        let dst_db = dir.join("dst.sqlite3");
        let archive = dir.join("backup.zip");

        let src = Connection::open(&src_db).unwrap();
        create_schema(&src);
        for table in EXPORT_TABLES {
            for i in 0..3usize {
                let values: Vec<SqlValue> = table
                    .columns
                    .iter()
                    .map(|&c| {
                        if c == table.primary_key {
                            SqlValue::Text(format!("{}-{i}", table.name))
                        } else if table.blob_columns.contains(&c) {
                            match i {
                                0 => SqlValue::Text(BASE64.encode((0..5000).map(|b| (b * 7 + i) as u8).collect::<Vec<_>>())),
                                1 => SqlValue::Null,
                                _ => SqlValue::Text("not valid base64!".into()),
                            }
                        } else if i == 1 {
                            SqlValue::Integer(i as i64)
                        } else {
                            SqlValue::Text(format!("{c}-{i}"))
                        }
                    })
                    .collect();
                let placeholders = (1..=values.len()).map(|n| format!("?{n}")).collect::<Vec<_>>().join(", ");
                src.execute(
                    &format!("INSERT INTO {} ({}) VALUES ({placeholders})", table.name, table.columns.join(", ")),
                    rusqlite::params_from_iter(values.iter()),
                )
                .unwrap();
            }
        }

        let categories: Vec<String> = ALL_CATEGORY_IDS.iter().map(|s| s.to_string()).collect();
        write_export_archive(&src_db, 42, &archive, &categories, &mut ProgressEmitter::new(None, "")).unwrap();

        create_schema(&Connection::open(&dst_db).unwrap());
        let wrong_owner =
            import_archive(&dst_db, 7, archive.to_str().unwrap(), &categories, &mut ProgressEmitter::new(None, "")).unwrap();
        assert_eq!(wrong_owner.error, Some("wrong_owner"));

        let outcome =
            import_archive(&dst_db, 42, archive.to_str().unwrap(), &categories, &mut ProgressEmitter::new(None, "")).unwrap();
        assert!(outcome.ok);
        assert_eq!(outcome.rows_imported, Some(EXPORT_TABLES.len() as u64 * 3));

        let dst = Connection::open(&dst_db).unwrap();
        for table in EXPORT_TABLES {
            assert_eq!(dump(&src, table), dump(&dst, table), "table {} differs after round trip", table.name);
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Manual check against a real chat database:
    /// `FG_BACKUP_TEST_DB=/path/to/chat-<id>.sqlite3 cargo test real_db_round_trip -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_db_round_trip() {
        let real_db = PathBuf::from(std::env::var("FG_BACKUP_TEST_DB").expect("set FG_BACKUP_TEST_DB"));
        let dir = std::env::temp_dir().join(format!("fg-backup-real-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src_db = dir.join("src.sqlite3");
        let dst_db = dir.join("dst.sqlite3");
        let archive = dir.join("backup.zip");

        // VACUUM INTO takes a consistent snapshot even while the app has the db open in WAL mode.
        Connection::open_with_flags(&real_db, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .unwrap()
            .execute("VACUUM INTO ?1", [src_db.to_str().unwrap()])
            .unwrap();
        std::fs::copy(&src_db, &dst_db).unwrap();
        let dst = Connection::open(&dst_db).unwrap();
        for table in EXPORT_TABLES {
            if table_exists(&dst, table.name).unwrap() {
                dst.execute(&format!("DELETE FROM {}", table.name), []).unwrap();
            }
        }
        drop(dst);

        let categories: Vec<String> = ALL_CATEGORY_IDS.iter().map(|s| s.to_string()).collect();
        let started = Instant::now();
        write_export_archive(&src_db, 42, &archive, &categories, &mut ProgressEmitter::new(None, "")).unwrap();
        println!(
            "export: {:?}, {} MB",
            started.elapsed(),
            std::fs::metadata(&archive).unwrap().len() / 1_000_000
        );

        let started = Instant::now();
        let outcome =
            import_archive(&dst_db, 42, archive.to_str().unwrap(), &categories, &mut ProgressEmitter::new(None, "")).unwrap();
        println!("import: {:?}, {:?} rows", started.elapsed(), outcome.rows_imported);
        assert!(outcome.ok);

        let src = Connection::open(&src_db).unwrap();
        let dst = Connection::open(&dst_db).unwrap();
        for table in EXPORT_TABLES {
            if table_exists(&src, table.name).unwrap() {
                assert_eq!(dump(&src, table), dump(&dst, table), "table {} differs after round trip", table.name);
            }
        }

        let _ = std::fs::remove_dir_all(&dir);
    }
}
