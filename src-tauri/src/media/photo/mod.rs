mod encode;
mod heif;
pub mod source;

use tauri::{AppHandle, Runtime};

use super::{codes, media_error, off_thread};
use crate::error::AppError;

use source::Format;

pub const JPEG: &str = "image/jpeg";

#[cfg(target_os = "android")]
pub use heif::plugin;

/// `bytes` must already be sniffed as a photo (`source::sniff`).
pub async fn normalize<R: Runtime>(app: &AppHandle<R>, bytes: Vec<u8>) -> Result<Vec<u8>, AppError> {
    let Some(format) = source::sniff(&bytes) else {
        return Err(media_error(codes::NOT_MEDIA));
    };

    let source = if format == Format::Heif {
        heif::decode(app, bytes).await?
    } else {
        off_thread(move || source::decode(format, &bytes))
            .await?
            .ok_or_else(|| media_error(codes::UNREADABLE))?
    };

    off_thread(move || encode::to_jpeg(source))
        .await?
        .ok_or_else(|| media_error(codes::UNREADABLE))
}
