//! The Honduras entitlement bypass (<https://opengrind.org/guides/bypasses>),
//! ported from open-grind. Grindr decides a session's entitlements from the
//! geohash sent when its token is minted, so re-issuing the token from
//! Honduras unlocks paid features (expiring photos, unsending, album
//! sharing) for that token. The server-side location is moved there only
//! for the handover and always moved back home afterwards.

use std::future::Future;
use std::time::Duration;

use tokio::time::timeout;

use crate::error::AppError;
use crate::state::AppState;

const STEP_TIMEOUT: Duration = Duration::from_secs(10);
const RECONNECT_STEP_TIMEOUT: Duration = Duration::from_secs(3);

async fn within<T>(
    step: &str,
    work: impl Future<Output = Result<T, AppError>>,
) -> Result<T, AppError> {
    timeout(STEP_TIMEOUT, work)
        .await
        .map_err(|_| AppError::Http(format!("{step} timed out")))?
}

async fn update_location(client: &grindr::GrindrClient, geohash: &str) -> Result<(), AppError> {
    let response = client
        .request(grindr::Method::PUT, "/v4/location")
        .json(&serde_json::json!({ "geohash": geohash }))
        .send()
        .await
        .map_err(|e| AppError::from_client_error(e, client))?;
    if (200..300).contains(&response.status) {
        Ok(())
    } else {
        Err(AppError::from(grindr::GrindrError::from_response(
            response.status,
            &response.body,
        )))
    }
}

/// Cycles the realtime socket so it reconnects with the re-issued token.
async fn reconnect_ws(client: &grindr::GrindrClient) {
    let mut states = client.connection_state();
    if *states.borrow_and_update() != grindr::WsConnectionState::Connected {
        return;
    }
    client.set_active(false);
    let _ = timeout(
        RECONNECT_STEP_TIMEOUT,
        states.wait_for(|state| *state == grindr::WsConnectionState::Disconnected),
    )
    .await;
    client.set_active(true);
    let _ = timeout(
        RECONNECT_STEP_TIMEOUT,
        states.wait_for(|state| *state == grindr::WsConnectionState::Connected),
    )
    .await;
}

/// Moves to `honduras`, re-issues the session there, then moves back to
/// `home` — even when the re-issue failed — and reconnects the websocket.
#[tauri::command]
pub async fn entitlement_bypass(
    state: tauri::State<'_, AppState>,
    honduras: String,
    home: String,
) -> Result<(), AppError> {
    let client = state.client()?;

    let granted = within("the handover", async {
        update_location(&client, &honduras).await?;
        client
            .refresh_session_at_geohash(Some(&honduras))
            .await
            .map_err(|e| AppError::from_client_error(e, &client))?;
        Ok(())
    })
    .await;

    if let Err(e) = within("moving back", update_location(&client, &home)).await {
        eprintln!("[entitlements] could not move back from Honduras: {e}");
    }

    granted?;
    reconnect_ws(&client).await;
    Ok(())
}
