//! Upload normalization, ported from open-grind: every photo leaves as a
//! metadata-free JPEG sized like the official client's, every video leaves
//! with its metadata boxes blanked and its timestamps set to the upload time.
//! Anything else is refused rather than uploaded as-is.

pub mod photo;
pub mod video;

use std::time::SystemTime;

use tauri::{AppHandle, Runtime};

use crate::error::AppError;

const MAX_PHOTO_BYTES: usize = 64 * 1024 * 1024;
const VIDEO_MP4: &str = "video/mp4";

/// Stable codes the frontend maps to translated messages (`AppError::Media`).
pub mod codes {
    pub const NOT_MEDIA: &str = "not_media";
    pub const UNREADABLE: &str = "unreadable";
    pub const TOO_LARGE: &str = "too_large";
    pub const HEIC_UNSUPPORTED: &str = "heic_unsupported";
    pub const VIDEO_UNSTRIPPABLE: &str = "video_unstrippable";
}

pub struct Sanitized {
    pub bytes: Vec<u8>,
    pub content_type: &'static str,
}

pub fn media_error(code: &str) -> AppError {
    AppError::Media(code.to_owned())
}

pub async fn sanitize<R: Runtime>(
    app: &AppHandle<R>,
    bytes: Vec<u8>,
) -> Result<Sanitized, AppError> {
    if photo::source::sniff(&bytes).is_some() {
        if bytes.len() > MAX_PHOTO_BYTES {
            return Err(media_error(codes::TOO_LARGE));
        }
        let bytes = photo::normalize(app, bytes).await?;
        return Ok(Sanitized {
            bytes,
            content_type: photo::JPEG,
        });
    }
    if video::sniff::is_video(&bytes) {
        let bytes = off_thread(move || {
            let uploaded_at = video::strip::movie_time(SystemTime::now());
            video::strip::strip(bytes, uploaded_at)
        })
        .await?
        .ok_or_else(|| media_error(codes::VIDEO_UNSTRIPPABLE))?;
        return Ok(Sanitized {
            bytes,
            content_type: VIDEO_MP4,
        });
    }
    Err(media_error(codes::NOT_MEDIA))
}

pub(crate) async fn off_thread<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| AppError::Media(error.to_string()))
}
