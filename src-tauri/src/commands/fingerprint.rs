//! Fingerprint verification command
//!
//! Checks the client's TLS/HTTP2 fingerprint against tls.peet.ws

use serde_json::{json, Value};
use crate::error::AppError;

#[tauri::command]
pub async fn check_fingerprint() -> Result<Value, AppError> {
    let client = build_fingerprint_check_client()?;

    let response = client
        .get("https://tls.peet.ws/api/all")
        .header("Connection", "close")
        .send()
        .await
        .map_err(|e| AppError::Http(format!("Fingerprint check failed: {e}")))?;

    let json: Value = response
        .json()
        .await
        .map_err(|e| AppError::Http(format!("Failed to parse fingerprint response: {e}")))?;

    // Extract key fields
    let ja3_hash = json["tls"]["ja3_hash"].as_str().unwrap_or("unknown");
    let http_version = json["http_version"].as_str().unwrap_or("unknown");
    let akamai = json["http2"]["akamai_fingerprint"].as_str().unwrap_or("unknown");

    // Check if it matches expected values
    let ja3_match = ja3_hash == "1d714db2228763eab228fc28ce7f8e4f" || ja3_hash == "62e5cbd375390b136bf5b06be231ed6b";
    let akamai_match = akamai.contains("16777216") && akamai.contains("m,p,a,s");

    Ok(json!({
        "ja3_hash": ja3_hash,
        "ja3_match": ja3_match,
        "http_version": http_version,
        "akamai_fingerprint": akamai,
        "akamai_match": akamai_match,
        "full_response": json,
    }))
}

fn build_fingerprint_check_client() -> Result<wreq::Client, AppError> {
    wreq::Client::builder()
        .emulation(grindr::probe_emulation())
        .gzip(true)
        .no_deflate()
        .no_brotli()
        .no_zstd()
        .build()
        .map_err(|e| AppError::Http(format!("Failed to build fingerprint client: {e}")))
}
