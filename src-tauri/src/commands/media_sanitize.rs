//! Normalizes a photo or video before upload (see `crate::media`). The
//! frontend runs every picked file through this once and uploads the result,
//! so the resized dimensions are what thumbnails/crops get computed against.
//!
//! The file arrives as the raw IPC body (a JSON number array on Android) and
//! leaves as msgpack `{ body, contentType }`.

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};

use crate::error::AppError;
use crate::media;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SanitizedUpload<'a> {
    #[serde(with = "serde_bytes")]
    body: &'a [u8],
    content_type: &'a str,
}

#[tauri::command]
pub async fn sanitize_upload_media(
    app: tauri::AppHandle,
    request: Request<'_>,
) -> Result<Response, AppError> {
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        // Android never uses the custom-protocol IPC (its webview can't read
        // request bodies); over postMessage the Uint8Array arrives as a JSON
        // number array.
        InvokeBody::Json(value) => serde_json::from_value::<Vec<u8>>(value.clone())
            .map_err(|_| media::media_error(media::codes::NOT_MEDIA))?,
    };
    let sanitized = media::sanitize(&app, bytes).await?;
    let packed = rmp_serde::encode::to_vec_named(&SanitizedUpload {
        body: &sanitized.bytes,
        content_type: sanitized.content_type,
    })
    .map_err(|e| AppError::Media(e.to_string()))?;
    Ok(Response::new(packed))
}
