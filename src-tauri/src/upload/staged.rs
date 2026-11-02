//! Picked files staged into the app cache before upload, ported from
//! open-grind. The webview only has a `File`, so it appends it here in
//! base64 chunks; Rust then reads it from disk instead of over IPC. Files are
//! named by a UUID only, so a staged id can't reach anything else on disk.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{AppHandle, Manager, Runtime};
use uuid::Uuid;

use super::io_error;
use crate::error::AppError;
use crate::media::off_thread;

const DIRECTORY: &str = "staged-media";

const NOT_STAGED: &str = "That file was never staged by this app";

pub struct StagedMedia(PathBuf);

impl StagedMedia {
    pub fn of<R: Runtime>(app: &AppHandle<R>) -> io::Result<Self> {
        app.path()
            .app_cache_dir()
            .map(|cache| Self(cache.join(DIRECTORY)))
            .map_err(io::Error::other)
    }

    pub fn path(&self, id: &str) -> io::Result<PathBuf> {
        let id = Uuid::try_parse(id).map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, NOT_STAGED))?;
        Ok(self.0.join(id.hyphenated().to_string()))
    }

    pub fn create(&self) -> io::Result<String> {
        fs::create_dir_all(&self.0)?;
        let id = Uuid::new_v4().hyphenated().to_string();
        File::create_new(self.0.join(&id))?;
        Ok(id)
    }

    pub fn append(&self, id: &str, bytes: &[u8]) -> io::Result<()> {
        OpenOptions::new().append(true).open(self.path(id)?)?.write_all(bytes)
    }

    pub fn discard(&self, id: &str) -> io::Result<()> {
        ignore_missing(fs::remove_file(self.path(id)?))
    }

    pub fn discard_all(&self) -> io::Result<()> {
        ignore_missing(fs::remove_dir_all(&self.0))
    }
}

fn ignore_missing(removed: io::Result<()>) -> io::Result<()> {
    match removed {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        removed => removed,
    }
}

/// Removes the staged file when dropped: every staged file is uploaded once,
/// whether the upload succeeds or not.
pub struct SingleUse<R: Runtime> {
    pub app: AppHandle<R>,
    pub id: String,
}

impl<R: Runtime> Drop for SingleUse<R> {
    fn drop(&mut self) {
        if let Err(error) = StagedMedia::of(&self.app).and_then(|staged| staged.discard(&self.id)) {
            eprintln!("[upload] could not discard staged media: {error}");
        }
    }
}

/// Clears what an earlier run left behind (a crash or kill mid-upload).
pub fn discard_all<R: Runtime>(app: &AppHandle<R>) {
    if let Err(error) = StagedMedia::of(app).and_then(|staged| staged.discard_all()) {
        eprintln!("[upload] could not clear staged media: {error}");
    }
}

#[tauri::command]
pub async fn stage_media(app: AppHandle) -> Result<String, AppError> {
    off_thread(move || StagedMedia::of(&app)?.create()).await?.map_err(io_error)
}

#[tauri::command]
pub async fn append_staged_media(app: AppHandle, id: String, chunk: String) -> Result<(), AppError> {
    let bytes = STANDARD
        .decode(chunk)
        .map_err(|error| AppError::Media(error.to_string()))?;
    off_thread(move || StagedMedia::of(&app)?.append(&id, &bytes))
        .await?
        .map_err(io_error)
}

#[tauri::command]
pub async fn discard_staged_media(app: AppHandle, id: String) -> Result<(), AppError> {
    off_thread(move || StagedMedia::of(&app)?.discard(&id))
        .await?
        .map_err(io_error)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    static NEXT: AtomicUsize = AtomicUsize::new(0);

    struct TempStage(StagedMedia);

    impl TempStage {
        fn new() -> Self {
            Self(StagedMedia(std::env::temp_dir().join(format!(
                "fg-staged-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ))))
        }
    }

    impl Drop for TempStage {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0 .0).ok();
        }
    }

    #[test]
    fn appended_chunks_land_in_order() {
        let stage = TempStage::new();
        let id = stage.0.create().expect("create");

        stage.0.append(&id, b"first ").expect("append");
        stage.0.append(&id, b"second").expect("append");

        assert_eq!(fs::read(stage.0.path(&id).expect("path")).expect("read"), b"first second");
    }

    #[test]
    fn appending_to_a_file_that_was_never_staged_fails() {
        let stage = TempStage::new();
        fs::create_dir_all(&stage.0 .0).expect("directory");

        let refused = stage.0.append(&Uuid::new_v4().to_string(), b"bytes").expect_err("refused");

        assert_eq!(refused.kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn only_uuids_name_staged_files() {
        let stage = TempStage::new();
        for id in ["", "../preferences.data", "staged", "/etc/passwd"] {
            let refused = stage.0.path(id).expect_err(id);
            assert_eq!(refused.kind(), io::ErrorKind::InvalidInput);
            assert_eq!(refused.to_string(), NOT_STAGED);
        }
    }

    #[test]
    fn discarding_removes_the_file_and_tolerates_a_second_call() {
        let stage = TempStage::new();
        let id = stage.0.create().expect("create");

        stage.0.discard(&id).expect("discard");
        stage.0.discard(&id).expect("discard again");

        assert!(!stage.0.path(&id).expect("path").exists());
    }

    #[test]
    fn discarding_everything_removes_the_directory() {
        let stage = TempStage::new();
        stage.0.create().expect("create");

        stage.0.discard_all().expect("discard all");
        stage.0.discard_all().expect("discard all again");

        assert!(!stage.0 .0.exists());
    }
}
