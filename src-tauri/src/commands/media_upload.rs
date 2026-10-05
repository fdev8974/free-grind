//! Signed media uploads (`POST /v5/media/upload`, `POST /v6/chat/media/upload`).
//!
//! Both require a device-key signature `grindr::GrindrClient` registers and
//! attaches automatically — see `GrindrClient::upload_profile_image` /
//! `upload_chat_media`.

use serde::Serialize;

use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadedProfileImage {
    pub media_hash: String,
    pub full_url: String,
    pub state: Option<String>,
    pub thumbnail: bool,
    pub size: i32,
}

impl From<grindr::UploadedProfileImage> for UploadedProfileImage {
    fn from(i: grindr::UploadedProfileImage) -> Self {
        Self {
            media_hash: i.media_hash,
            full_url: i.full_url,
            state: i.state,
            thumbnail: i.thumbnail,
            size: i.size,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadProfileImageResponse {
    pub hash: String,
    pub image_sizes: Vec<UploadedProfileImage>,
}

impl From<grindr::UploadProfileImageResponse> for UploadProfileImageResponse {
    fn from(r: grindr::UploadProfileImageResponse) -> Self {
        Self {
            hash: r.hash,
            image_sizes: r.image_sizes.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaUploadResponse {
    pub media_id: i64,
    pub url: String,
    pub media_hash: String,
}

impl From<grindr::MediaUploadResponse> for MediaUploadResponse {
    fn from(r: grindr::MediaUploadResponse) -> Self {
        Self {
            media_id: r.media_id,
            url: r.url,
            media_hash: r.media_hash,
        }
    }
}

#[tauri::command]
pub async fn upload_profile_image(
    state: tauri::State<'_, AppState>,
    body: Vec<u8>,
    content_type: String,
    thumb_coords: Option<String>,
    taken_on_grindr: bool,
) -> Result<UploadProfileImageResponse, AppError> {
    let _ = content_type; // grindr.rs always posts profile images as image/jpeg
    let client = state.client()?;
    let response = client
        .upload_profile_image(body, thumb_coords.as_deref(), taken_on_grindr)
        .await
        .map_err(|e| AppError::from_client_error(e, &client))?;
    Ok(response.into())
}

#[tauri::command]
pub async fn upload_chat_media(
    state: tauri::State<'_, AppState>,
    body: Vec<u8>,
    content_type: String,
    taken_on_grindr: bool,
    length: Option<i64>,
    looping: Option<bool>,
) -> Result<MediaUploadResponse, AppError> {
    let client = state.client()?;
    let response = client
        .upload_chat_media(body, &content_type, length, looping, taken_on_grindr)
        .await
        .map_err(|e| AppError::from_client_error(e, &client))?;
    Ok(response.into())
}
