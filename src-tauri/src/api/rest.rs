use serde::{Deserialize, Serialize};
use std::str::FromStr;

use tauri::ipc::Response;

use crate::error::AppError;
use crate::state::AppState;

#[derive(Serialize, Deserialize)]
pub struct RawResponse {
    pub status: u16,
    #[serde(with = "serde_bytes")]
    pub body: Vec<u8>,
}

#[tauri::command]
pub async fn request(
    state: tauri::State<'_, AppState>,
    method: String,
    path: String,
    body: Option<Vec<u8>>,
    content_type: Option<String>,
) -> Result<Response, AppError> {
    let method_str = method.clone();
    let method = grindr::Method::from_str(&method).map_err(|_| AppError::Api {
        code: 400,
        message: format!("Invalid method: {method_str}"),
    })?;

    let client = state.client()?;

    // Mirrors the previous hand-rolled `request_raw`: the body always goes
    // over the wire as-is (the frontend already UTF8/JSON-encodes plain
    // object bodies itself before calling this command), Content-Type
    // defaults to `application/json` when a body is present but no explicit
    // type was given, and a bodyless call sends no body/Content-Type at all.
    let raw = match body {
        Some(bytes) => client
            .request_authenticated_bytes(
                method,
                &path,
                content_type.as_deref().unwrap_or("application/json"),
                bytes,
            )
            .await
            .map_err(|e| AppError::from_client_error(e, &client))?,
        None => client
            .request_authenticated_raw(method, &path, None)
            .await
            .map_err(|e| AppError::from_client_error(e, &client))?,
    };

    let raw = RawResponse {
        status: raw.status,
        body: raw.body,
    };

    Ok(Response::new(
        rmp_serde::encode::to_vec_named(&raw).map_err(|e| AppError::Http(e.to_string()))?,
    ))
}
