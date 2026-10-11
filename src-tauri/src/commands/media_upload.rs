//! Media uploads. Only in-app captures (`taken_on_grindr`) go to the
//! device-key-signed endpoints — the server marks anything uploaded there as
//! taken on Grindr regardless of the query parameter, so gallery media must
//! use the older unsigned endpoints. Same split as open-grind.

use crate::error::AppError;
use crate::state::AppState;

async fn send_upload(
    state: &AppState,
    path: &str,
    content_type: &str,
    body: Vec<u8>,
    signed: bool,
) -> Result<serde_json::Value, AppError> {
    let client = state.client()?;
    let request = client.request(grindr::Method::POST, path);
    let request = if signed {
        request.signed_bytes(content_type, body)
    } else {
        request.bytes(content_type, body)
    };
    let response = request
        .send()
        .await
        .map_err(|e| AppError::from_client_error(e, &client))?;

    if !(200..300).contains(&response.status) {
        if let Some(reason) = rejection_reason(&response.body) {
            return Err(AppError::MediaRejected {
                status: response.status,
                reason,
            });
        }
        return Err(AppError::from(grindr::GrindrError::from_response(
            response.status,
            &response.body,
        )));
    }
    serde_json::from_slice(&response.body)
        .map_err(|e| AppError::Http(format!("Failed to parse upload response: {e}")))
}

/// Pulls a documented rejection reason out of an upload error body: the
/// RFC-7807 `type` of a moderation 422 (`urn:gr:err:banned_image` →
/// `banned_image`), or one of the signing errors, whose body shape isn't
/// documented, so those are matched anywhere in the body text.
fn rejection_reason(body: &[u8]) -> Option<String> {
    let problem_type = serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|json| json.get("type")?.as_str().map(str::to_owned));
    if let Some(reason) = problem_type
        .as_deref()
        .and_then(|t| t.strip_prefix("urn:gr:err:"))
    {
        return Some(reason.to_owned());
    }
    let text = String::from_utf8_lossy(body);
    ["timestamp_drift", "nonce_replayed"]
        .into_iter()
        .find(|reason| text.contains(reason))
        .map(str::to_owned)
}

/// Returns the upload response as-is; the frontend reads the media hash out
/// of whichever shape the endpoint used (`hash` / `imageSizes[].mediaHash`).
#[tauri::command]
pub async fn upload_profile_image(
    state: tauri::State<'_, AppState>,
    body: Vec<u8>,
    content_type: String,
    thumb_coords: Option<String>,
    taken_on_grindr: bool,
) -> Result<serde_json::Value, AppError> {
    let mut path = if taken_on_grindr {
        "/v5/media/upload?takenOnGrindr=true".to_owned()
    } else {
        "/v4/media/upload?takenOnGrindr=false".to_owned()
    };
    if let Some(coords) = thumb_coords {
        path.push_str("&thumbCoords=");
        path.push_str(&coords);
    }
    send_upload(&state, &path, &content_type, body, taken_on_grindr).await
}

/// Returns the upload response as-is (`mediaId`, `url`, `mediaHash`, and
/// `expiresAt` where the endpoint sends one).
#[tauri::command]
pub async fn upload_chat_media(
    state: tauri::State<'_, AppState>,
    body: Vec<u8>,
    content_type: String,
    taken_on_grindr: bool,
    length: Option<i64>,
    looping: Option<bool>,
) -> Result<serde_json::Value, AppError> {
    let path = if taken_on_grindr {
        "/v6/chat/media/upload?takenOnGrindr=true".to_owned()
    } else {
        let mut path = "/v5/chat/media/upload?takenOnGrindr=false".to_owned();
        if let Some(length) = length {
            path.push_str(&format!("&length={length}"));
        }
        if let Some(looping) = looping {
            path.push_str(&format!("&looping={looping}"));
        }
        path
    };
    send_upload(&state, &path, &content_type, body, taken_on_grindr).await
}
