//! Uploads a staged video, streamed from disk with its metadata stripped on
//! the way out (see `crate::upload`). Its length and size come from the
//! file's own `moov` box rather than the webview, so `length` is the
//! milliseconds the API documents, like open-grind sends it.

use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime};

use super::edit::{self, VideoEdit};
use super::form::{FormPart, Framing};
use super::staged::{SingleUse, StagedMedia};
use super::stream::{FileBody, Progress};
use super::{io_error, UploadLock};
use crate::commands::media_upload::upload_response;
use crate::error::AppError;
use crate::media::video::probe::{self, Probe};
use crate::media::video::strip::{self, Patch};
use crate::media::video::{boxes, sniff};
use crate::media::{codes, media_error, off_thread};
use crate::state::AppState;

const VIDEO_MP4: &str = "video/mp4";
const SNIFF_LEN: usize = 64;

/// Open-grind's cap for chat media; the server's own isn't documented.
pub const MAX_CHAT_VIDEO_BYTES: u64 = 120 * 1024 * 1024;

#[derive(Debug)]
struct PlannedVideo {
    size: u64,
    probe: Probe,
    patches: Arc<[Patch]>,
}

fn plan_video(path: &Path) -> Result<PlannedVideo, AppError> {
    let mut file = File::open(path).map_err(io_error)?;
    let size = file.metadata().map_err(io_error)?.len();
    let mut head = [0u8; SNIFF_LEN];
    let filled = boxes::read_up_to(&mut file, &mut head).map_err(io_error)?;
    if !sniff::is_video(&head[..filled]) {
        return Err(media_error(codes::NOT_MEDIA));
    }
    // No readable video track: open-grind refuses it as not a video too.
    let probe = probe::probe(&mut file)
        .map_err(io_error)?
        .ok_or_else(|| media_error(codes::NOT_MEDIA))?;
    let uploaded_at = strip::movie_time(SystemTime::now());
    let patches = strip::plan(&mut file, uploaded_at)
        .map_err(io_error)?
        .ok_or_else(|| media_error(codes::VIDEO_UNSTRIPPABLE))?;
    Ok(PlannedVideo {
        size,
        probe,
        patches: Arc::from(patches),
    })
}

/// What the webview hears while a video goes out: `editing` while the cut
/// is written, then `uploading` with the body's bytes sent of `total`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadProgress {
    phase: &'static str,
    sent: u64,
    total: u64,
}

struct VideoUpload<F> {
    staged_id: String,
    /// Uploaded instead of the staged file as it is (see `edit`).
    edit: Option<VideoEdit>,
    progress: Option<Channel<UploadProgress>>,
    multipart: bool,
    max_body_size: u64,
    path_for: F,
}

async fn upload_staged_video<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
    lock: &UploadLock,
    upload: VideoUpload<impl FnOnce(&Probe) -> String>,
) -> Result<serde_json::Value, AppError> {
    let _single_use = SingleUse {
        app: app.clone(),
        id: upload.staged_id.clone(),
    };
    let client = state.client()?;
    let _one_at_a_time = lock.0.lock().await;

    let staged: PathBuf = StagedMedia::of(app)
        .and_then(|staged| staged.path(&upload.staged_id))
        .map_err(io_error)?;
    let tell = |phase: &'static str, sent: u64, total: u64| {
        if let Some(channel) = &upload.progress {
            let _ = channel.send(UploadProgress { phase, sent, total });
        }
    };
    let (staged, _edited_single_use) = match upload.edit {
        None => (staged, None),
        Some(edit) => {
            tell("editing", 0, 0);
            let app = app.clone();
            let (path, single_use) = off_thread(move || edit::edited(&app, &staged, edit)).await??;
            (path, Some(single_use))
        }
    };
    let planned = {
        let staged = staged.clone();
        off_thread(move || plan_video(&staged)).await??
    };
    let framing = if upload.multipart {
        Framing::new(&FormPart {
            name: "content",
            filename: "",
            content_type: VIDEO_MP4,
        })
    } else {
        Framing::raw(VIDEO_MP4)
    };
    if framing.size(planned.size) > upload.max_body_size {
        return Err(media_error(codes::UPLOAD_TOO_LARGE));
    }
    let path = (upload.path_for)(&planned.probe);
    let content_type = framing.content_type.clone();
    let total = framing.size(planned.size);
    tell("uploading", 0, total);
    let body = FileBody {
        path: staged,
        framing,
        content_len: planned.size,
        patches: planned.patches,
        progress: upload.progress.clone().map(|channel| -> Progress {
            Arc::new(move |sent| {
                let _ = channel.send(UploadProgress {
                    phase: "uploading",
                    sent,
                    total,
                });
            })
        }),
    };

    // A large upload takes a while; one that started for one account must not
    // finish on another's behalf after a switch or sign-out.
    let mut sessions = client.session_receiver();
    let profile_id = sessions
        .borrow()
        .as_ref()
        .and_then(|session| session.credentials.profile_id.clone())
        .ok_or(AppError::NotSignedIn)?;
    let send = client
        .request(grindr::Method::POST, &path)
        .stream(&content_type, body)
        .send();
    let response = tokio::select! {
        biased;
        _ = sessions.wait_for(|session| {
            session.as_ref().and_then(|session| session.credentials.profile_id.as_deref())
                != Some(profile_id.as_str())
        }) => return Err(AppError::SessionCleared),
        sent = send => sent.map_err(|e| AppError::from_client_error(e, &client))?,
    };
    // The chat endpoint answers an oversized body with 413 `internal_error`;
    // its actual limit isn't documented and is below MAX_CHAT_VIDEO_BYTES.
    if response.status == 413 {
        eprintln!("[upload] refused with 413: video of {} bytes", planned.size);
        return Err(media_error(codes::UPLOAD_TOO_LARGE));
    }
    if !(200..300).contains(&response.status) {
        eprintln!("[upload] {path} ({} bytes) refused:", planned.size);
    }
    if response.status == 400 && is_length_out_of_range(&response.body) {
        return Err(media_error(codes::VIDEO_TOO_LONG));
    }
    upload_response(response)
}

/// `length` is always sent, in milliseconds: the file's own duration, else
/// the webview's reading, else 0. Sending seconds doesn't get around the
/// server's length limit: it reads a small `length` as seconds itself.
fn chat_video_path(probe: &Probe, webview_length_ms: Option<u64>, looping: bool) -> String {
    let length = probe.duration_ms.or(webview_length_ms).unwrap_or(0);
    format!("/v5/chat/media/upload?takenOnGrindr=false&length={length}&looping={looping}")
}

/// The chat endpoint's refusal of a video longer than it allows:
/// `400 {"detail":"Length 28000ms is out of range for VIDEO", …}`. The limit
/// itself isn't documented; 20.9 s is already refused.
fn is_length_out_of_range(body: &[u8]) -> bool {
    serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|json| json.get("detail")?.as_str().map(str::to_owned))
        .is_some_and(|detail| detail.contains("is out of range for VIDEO"))
}

fn album_video_path(album_id: u64, probe: &Probe) -> String {
    format!(
        "/v1/albums/{album_id}/content?width={}&height={}",
        probe.width, probe.height
    )
}

/// Videos always go to the unsigned endpoint: only in-app photo captures are
/// signed, and a signed body has to be held whole to be signed.
/// `length_ms` is the webview's reading, used only when the file has none;
/// `edit` the editor's cut, without which the video goes as picked.
#[tauri::command]
pub async fn upload_staged_chat_video(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    lock: tauri::State<'_, UploadLock>,
    staged_id: String,
    looping: bool,
    length_ms: Option<u64>,
    edit: Option<VideoEdit>,
    on_progress: Channel<UploadProgress>,
) -> Result<serde_json::Value, AppError> {
    let upload = VideoUpload {
        staged_id,
        edit,
        progress: Some(on_progress),
        multipart: false,
        max_body_size: MAX_CHAT_VIDEO_BYTES,
        path_for: |probe: &Probe| chat_video_path(probe, length_ms, looping),
    };
    upload_staged_video(&app, &state, &lock, upload).await
}

/// `max_body_size` is the album plan's `maxContentSize`, when known; `edit`
/// the editor's cut, as for chat videos.
#[tauri::command]
pub async fn upload_staged_album_video(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    lock: tauri::State<'_, UploadLock>,
    staged_id: String,
    album_id: u64,
    max_body_size: Option<u64>,
    edit: Option<VideoEdit>,
    on_progress: Channel<UploadProgress>,
) -> Result<serde_json::Value, AppError> {
    let upload = VideoUpload {
        staged_id,
        edit,
        progress: Some(on_progress),
        multipart: true,
        max_body_size: max_body_size.unwrap_or(u64::MAX),
        path_for: |probe: &Probe| album_video_path(album_id, probe),
    };
    upload_staged_video(&app, &state, &lock, upload).await
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    const METADATA: &[u8] = include_bytes!("../media/video/fixtures/metadata.mp4");
    const ROTATED: &[u8] = include_bytes!("../media/video/fixtures/rotated.mp4");

    static NEXT: AtomicUsize = AtomicUsize::new(0);

    struct TempFile(PathBuf);

    impl TempFile {
        fn new(bytes: &[u8]) -> Self {
            let path = std::env::temp_dir().join(format!(
                "fg-video-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::write(&path, bytes).expect("write");
            Self(path)
        }
    }

    impl Drop for TempFile {
        fn drop(&mut self) {
            std::fs::remove_file(&self.0).ok();
        }
    }

    fn refusal(bytes: &[u8]) -> String {
        match plan_video(&TempFile::new(bytes).0) {
            Err(AppError::Media(code)) => code,
            other => panic!("expected a media error, got {other:?}"),
        }
    }

    #[test]
    fn a_clip_is_planned_with_its_length_in_milliseconds() {
        let planned = plan_video(&TempFile::new(METADATA).0).expect("planned");

        assert_eq!(planned.size, METADATA.len() as u64);
        assert!(!planned.patches.is_empty());
        assert_eq!(planned.probe.duration_ms, Some(1000));
        assert!(chat_video_path(&planned.probe, Some(9_000), false).contains("&length=1000&"));
    }

    #[test]
    fn a_rotated_clip_is_sized_as_shown() {
        let planned = plan_video(&TempFile::new(ROTATED).0).expect("planned");

        assert_eq!(
            album_video_path(7, &planned.probe),
            "/v1/albums/7/content?width=32&height=16"
        );
    }

    #[test]
    fn only_the_length_refusal_reads_as_too_long() {
        assert!(is_length_out_of_range(
            br#"{"type":"urn:gr:err:bad_request","status":400,"detail":"Length 28000ms is out of range for VIDEO"}"#
        ));
        assert!(!is_length_out_of_range(
            br#"{"type":"urn:gr:err:bad_request","status":400,"detail":"Image parsing failed for WEBP."}"#
        ));
        assert!(!is_length_out_of_range(b"out of range for VIDEO"));
    }

    #[test]
    fn a_photo_or_junk_is_not_a_video() {
        assert_eq!(refusal(b"\xFF\xD8\xFF\xE0 not a video"), codes::NOT_MEDIA);
        assert_eq!(refusal(b""), codes::NOT_MEDIA);
    }

    #[test]
    fn a_video_brand_without_a_readable_track_is_refused() {
        let mut bytes = b"\0\0\0\x18ftypmp42".to_vec();
        bytes.resize(200, 0);

        assert_eq!(refusal(&bytes), codes::NOT_MEDIA);
    }

    #[test]
    fn a_clip_without_a_length_falls_back_to_the_webview_and_then_zero() {
        let probe = Probe {
            width: 16,
            height: 16,
            duration_ms: None,
        };

        assert_eq!(
            chat_video_path(&probe, Some(4_200), true),
            "/v5/chat/media/upload?takenOnGrindr=false&length=4200&looping=true"
        );
        assert_eq!(
            chat_video_path(&probe, None, false),
            "/v5/chat/media/upload?takenOnGrindr=false&length=0&looping=false"
        );
    }
}
