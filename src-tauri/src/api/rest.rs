use serde::{Deserialize, Serialize};
use std::str::FromStr;
use std::sync::OnceLock;

use tauri::ipc::Response;

use crate::error::AppError;
use crate::state::AppState;

#[derive(Serialize, Deserialize)]
pub struct RawResponse {
    pub status: u16,
    #[serde(with = "serde_bytes")]
    pub body: Vec<u8>,
}

/// Absolute URLs (this app's own grindapi server: presence, issue reports,
/// update analytics) don't go to Grindr, so they get a plain client — no
/// Grindr fingerprint, headers or session token.
async fn send_external(
    method: grindr::Method,
    url: &str,
    body: Option<Vec<u8>>,
    content_type: Option<&str>,
) -> Result<RawResponse, AppError> {
    static CLIENT: OnceLock<wreq::Client> = OnceLock::new();
    let client = match CLIENT.get() {
        Some(client) => client,
        None => {
            let built = wreq::Client::builder()
                .build()
                .map_err(|e| AppError::Http(format!("Failed to build HTTP client: {e}")))?;
            CLIENT.get_or_init(|| built)
        }
    };

    let mut request = client.request(method, url);
    if let Some(bytes) = body {
        request = request
            .header("content-type", content_type.unwrap_or("application/json"))
            .body(bytes);
    }
    let response = request
        .send()
        .await
        .map_err(|e| AppError::Http(e.to_string()))?;
    let status = response.status().as_u16();
    let body = response
        .bytes()
        .await
        .map_err(|e| AppError::Http(e.to_string()))?
        .to_vec();
    Ok(RawResponse { status, body })
}

#[tauri::command]
pub async fn request(
    state: tauri::State<'_, AppState>,
    method: String,
    path: String,
    body: Option<Vec<u8>>,
    content_type: Option<String>,
) -> Result<Response, AppError> {
    let method = grindr::Method::from_str(&method).map_err(|_| AppError::Api {
        code: 400,
        message: format!("Invalid method: {method}"),
    })?;

    let raw = if path.starts_with("https://") || path.starts_with("http://") {
        send_external(method, &path, body, content_type.as_deref()).await?
    } else {
        let client = state.client()?;
        let mut request = client.request(method, &path);
        request = match (body, content_type) {
            // The frontend JSON-encodes plain object bodies itself and sends no
            // content type for them; re-sending them through `.json()` gives
            // the official client's `application/json; charset=utf-8`.
            (Some(bytes), None) => {
                let value: serde_json::Value = serde_json::from_slice(&bytes)
                    .map_err(|e| AppError::Http(format!("Request body is not JSON: {e}")))?;
                request.json(&value)
            }
            (Some(bytes), Some(content_type)) => request.bytes(&content_type, bytes),
            (None, _) => request,
        };
        let response = request
            .send()
            .await
            .map_err(|e| AppError::from_client_error(e, &client))?;
        RawResponse {
            status: response.status,
            body: response.body,
        }
    };

    Ok(Response::new(
        rmp_serde::encode::to_vec_named(&raw).map_err(|e| AppError::Http(e.to_string()))?,
    ))
}
