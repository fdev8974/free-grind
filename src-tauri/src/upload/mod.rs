//! Video uploads streamed from disk, ported from open-grind. The frontend
//! stages a picked video into the app cache in chunks (`staged`), and the
//! upload commands (`video`) read it from there: the metadata strip is
//! planned once and applied while the body is sent (`stream`), so a video is
//! never held in memory, however large it is. Photos stay small enough after
//! normalization to keep going through `media::sanitize`.

pub mod edit;
mod form;
pub mod staged;
mod stream;
pub mod video;

use crate::error::AppError;

/// Uploads run one at a time, like open-grind's: parallel streams of large
/// videos only slow each other down and multiply what a stall costs.
#[derive(Default)]
pub struct UploadLock(tokio::sync::Mutex<()>);

fn io_error(error: std::io::Error) -> AppError {
    AppError::Media(error.to_string())
}
