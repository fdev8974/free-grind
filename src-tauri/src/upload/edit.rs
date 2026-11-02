//! The video editor's Rust half (see `crate::media::video::trim`): its trim
//! points, the encoded frames the webview re-encodes a video from (one that
//! isn't H.264 with AAC already, or is landscape, or is Matroska), and the
//! edited file that is uploaded in place of the picked one.

use std::fs::File;
use std::io::{BufWriter, Cursor, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Runtime};

use super::io_error;
use super::staged::{SingleUse, StagedMedia};
use crate::error::AppError;
use crate::media::video::matroska;
use crate::media::video::trim::{self, DecodeWindow, Encoded, EncodedAudio, EncodedChunk, Trim, TrimPoints};
use crate::media::{codes, media_error, off_thread};

/// The window the editor picked, and the webview's re-encoding of it when
/// the video had to be turned portrait.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoEdit {
    pub start_ms: u64,
    pub max_ms: u64,
    #[serde(default)]
    pub reencoded: Option<Reencoded>,
}

/// The re-encoded H.264 chunks, staged back to back in decode order, then
/// the re-encoded AAC frames when `audio` is there.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reencoded {
    pub staged_id: String,
    pub width: u32,
    pub height: u32,
    /// The encoder's `decoderConfig.description`, base64.
    pub avcc: String,
    pub chunks: Vec<ChunkSpec>,
    #[serde(default)]
    pub audio: Option<ReencodedAudio>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReencodedAudio {
    pub sample_rate: u32,
    pub channels: u16,
    /// The AAC encoder's AudioSpecificConfig, base64.
    pub config: String,
    pub chunks: Vec<ChunkSpec>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkSpec {
    pub size: u32,
    pub timestamp_us: i64,
    pub key: bool,
}

/// Writes the edited video next to the staged original and returns it,
/// discarded once dropped like the original. The re-encoded chunks' staged
/// file is read and discarded here.
pub fn edited<R: Runtime>(
    app: &AppHandle<R>,
    original: &Path,
    edit: VideoEdit,
) -> Result<(PathBuf, SingleUse<R>), AppError> {
    let staged = StagedMedia::of(app).map_err(io_error)?;
    let id = staged.create().map_err(io_error)?;
    let guard = SingleUse {
        app: app.clone(),
        id: id.clone(),
    };
    let path = staged.path(&id).map_err(io_error)?;
    let trim = Trim {
        start_ms: edit.start_ms,
        max_ms: edit.max_ms,
    };
    let mut source = File::open(original).map_err(io_error)?;
    let matroska = is_matroska(&mut source).map_err(io_error)?;
    let mut out = BufWriter::new(File::create(&path).map_err(io_error)?);
    let written = match edit.reencoded {
        // A Matroska file has nothing to copy as is: it can only go re-encoded.
        None if matroska => Ok(None),
        None => trim::trim(&mut source, trim, &mut out),
        Some(reencoded) => {
            let _chunks_single_use = SingleUse {
                app: app.clone(),
                id: reencoded.staged_id.clone(),
            };
            let base64 = |text: &str| STANDARD.decode(text).map_err(|error| AppError::Media(error.to_string()));
            let encoded = Encoded {
                width: reencoded.width,
                height: reencoded.height,
                avcc: base64(&reencoded.avcc)?,
                chunks: chunk_specs(&reencoded.chunks),
                audio: match &reencoded.audio {
                    Some(audio) => Some(EncodedAudio {
                        sample_rate: audio.sample_rate,
                        channels: audio.channels,
                        config: base64(&audio.config)?,
                        chunks: chunk_specs(&audio.chunks),
                    }),
                    None => None,
                },
            };
            let mut chunks = File::open(staged.path(&reencoded.staged_id).map_err(io_error)?).map_err(io_error)?;
            // With its own sound (or none to copy), the result needs nothing of the original.
            if encoded.audio.is_some() || matroska {
                trim::mux_encoded(&mut chunks, &encoded, &mut out)
            } else {
                trim::mux(&mut source, &mut chunks, trim, &encoded, &mut out)
            }
        }
    }
    .map_err(io_error)?;
    written.ok_or_else(|| media_error(codes::VIDEO_UNTRIMMABLE))?;
    out.flush().map_err(io_error)?;
    Ok((path, guard))
}

fn chunk_specs(chunks: &[ChunkSpec]) -> Vec<EncodedChunk> {
    chunks
        .iter()
        .map(|chunk| EncodedChunk {
            size: chunk.size,
            timestamp_us: chunk.timestamp_us,
            key: chunk.key,
        })
        .collect()
}

fn is_matroska<R: Read + Seek>(reader: &mut R) -> std::io::Result<bool> {
    let mut head = [0u8; 4];
    reader.seek(SeekFrom::Start(0))?;
    let filled = crate::media::video::boxes::read_up_to(reader, &mut head)?;
    reader.seek(SeekFrom::Start(0))?;
    Ok(matroska::is_matroska(&head[..filled]))
}

/// The trim points of a video's `moov` box (or, for Matroska, of the file's
/// first bytes, which hold its header), which the webview cuts out of the
/// file itself so the editor opens without staging the whole video. `None`
/// when it isn't a video this can cut or re-encode.
#[tauri::command]
pub async fn video_trim_points(request: Request<'_>) -> Result<Option<TrimPoints>, AppError> {
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        // Android's IPC delivers the Uint8Array as a JSON number array.
        InvokeBody::Json(value) => {
            serde_json::from_value::<Vec<u8>>(value.clone()).map_err(|_| media_error(codes::NOT_MEDIA))?
        }
    };
    off_thread(move || {
        let mut reader = Cursor::new(bytes);
        if matroska::is_matroska(reader.get_ref()) {
            matroska::trim_points(&mut reader)
        } else {
            trim::trim_points(&mut reader)
        }
    })
    .await?
    .map_err(io_error)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowBatch {
    codec: String,
    #[serde(with = "serde_bytes")]
    description: Vec<u8>,
    coded_width: u32,
    coded_height: u32,
    rotation: u16,
    lead_us: i64,
    total: usize,
    samples: Vec<BatchSample>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchSample {
    #[serde(with = "serde_bytes")]
    data: Vec<u8>,
    timestamp_us: i64,
    duration_us: u64,
    key: bool,
}

/// Samples `from…` of the window's encoded video, as msgpack, stopping
/// after `max_bytes` of sample data (at least one sample) so no single IPC
/// message gets large. `None` when the codec isn't one WebCodecs is told
/// how to configure (H.264, HEVC, VP8, VP9, AV1) or the video can't be cut.
#[tauri::command]
pub async fn video_decode_window(
    app: AppHandle,
    staged_id: String,
    start_ms: u64,
    max_ms: u64,
    from: usize,
    max_bytes: usize,
) -> Result<Response, AppError> {
    let batch = off_thread(move || -> Result<Option<WindowBatch>, AppError> {
        let path = StagedMedia::of(&app).and_then(|staged| staged.path(&staged_id)).map_err(io_error)?;
        let mut file = File::open(path).map_err(io_error)?;
        let trim = Trim { start_ms, max_ms };
        let window: Option<DecodeWindow> = if is_matroska(&mut file).map_err(io_error)? {
            matroska::decode_window(&mut std::io::BufReader::new(&mut file), trim)
        } else {
            trim::decode_window(&mut file, trim)
        }
        .map_err(io_error)?;
        let Some(window) = window else {
            return Ok(None);
        };
        let mut samples = Vec::new();
        let mut taken = 0usize;
        for sample in window.samples.iter().skip(from) {
            if !samples.is_empty() && taken + sample.size as usize > max_bytes {
                break;
            }
            let mut data = vec![0u8; sample.size as usize];
            file.seek(SeekFrom::Start(sample.offset)).map_err(io_error)?;
            file.read_exact(&mut data).map_err(io_error)?;
            taken += data.len();
            samples.push(BatchSample {
                data,
                timestamp_us: sample.timestamp_us,
                duration_us: sample.duration_us,
                key: sample.key,
            });
        }
        Ok(Some(WindowBatch {
            codec: window.codec,
            description: window.description,
            coded_width: window.coded_width,
            coded_height: window.coded_height,
            rotation: window.rotation,
            lead_us: window.lead_us,
            total: window.samples.len(),
            samples,
        }))
    })
    .await??;
    let packed = rmp_serde::encode::to_vec_named(&batch).map_err(|error| AppError::Media(error.to_string()))?;
    Ok(Response::new(packed))
}
