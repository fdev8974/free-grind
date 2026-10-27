//! The Honduras entitlement bypass (<https://opengrind.org/guides/bypasses>),
//! ported from open-grind. Grindr decides a session's entitlements from the
//! geohash sent when its token is minted, so re-issuing the token from
//! Honduras unlocks paid features (expiring photos, unsending, album
//! sharing) for that token. `enter_honduras` moves the server-side location
//! there and leaves it; the paid action runs while still in Honduras (Grindr
//! re-checks the location when the action runs), then `leave_honduras` moves
//! it back home.

use std::fs;
use std::future::Future;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tokio::time::timeout;

use crate::error::AppError;
use crate::state::AppState;

const STEP_TIMEOUT: Duration = Duration::from_secs(10);
const RECONNECT_STEP_TIMEOUT: Duration = Duration::from_secs(3);

/// Marks that the server-side location is parked in Honduras. Written (holding
/// the home geohash) before the location is moved and removed only once it has
/// been moved back, so an interrupted trip can be repaired on the next launch
/// or sign-out (fixes the "stranded in Honduras" bug, open-grind #446).
const MARKER_FILE: &str = "honduras-hold.data";

fn marker_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Backup(format!("failed to resolve app data dir: {e}")))?;
    Ok(dir.join(MARKER_FILE))
}

fn write_marker_at(path: &Path, home: &str) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, home)?;
    Ok(())
}

/// The stored home geohash, or `None` when nothing is stranded.
fn read_marker_at(path: &Path) -> Result<Option<String>, AppError> {
    match fs::read_to_string(path) {
        Ok(contents) => {
            let home = contents.trim().to_owned();
            Ok(if home.is_empty() { None } else { Some(home) })
        }
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn remove_marker_at(path: &Path) -> Result<(), AppError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

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

/// Moves the server-side location to `honduras`, re-issues the session there,
/// and reconnects the websocket — then **leaves the location in Honduras** so
/// the caller can perform the paid action while Grindr still allows it. The
/// caller must pair every successful `enter_honduras` with [`leave_honduras`]
/// to move back home.
///
/// A recovery marker holding `home` is written before the location leaves home,
/// so a trip interrupted by a crash, a suspended mobile app, or a failed
/// move-back can be repaired by [`restore_stranded_location`] on the next
/// launch or sign-out. [`leave_honduras`] clears it once home again.
#[tauri::command]
pub async fn enter_honduras(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    honduras: String,
    home: String,
) -> Result<(), AppError> {
    let client = state.client()?;

    match marker_path(&app) {
        Ok(path) => {
            if let Err(e) = write_marker_at(&path, &home) {
                eprintln!("[entitlements] could not write the Honduras recovery marker: {e}");
            }
        }
        Err(e) => eprintln!("[entitlements] could not resolve the recovery marker path: {e}"),
    }

    within("the handover", async {
        update_location(&client, &honduras).await?;
        client
            .refresh_session_at_geohash(Some(&honduras))
            .await
            .map_err(|e| AppError::from_client_error(e, &client))?;
        Ok(())
    })
    .await?;

    reconnect_ws(&client).await;
    Ok(())
}

/// Moves the server-side location back to `home` after an [`enter_honduras`]
/// and clears the recovery marker. On failure the marker is kept so
/// [`restore_stranded_location`] can retry on a later launch or sign-out.
#[tauri::command]
pub async fn leave_honduras(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    home: String,
) -> Result<(), AppError> {
    let client = state.client()?;
    within("moving back", update_location(&client, &home)).await?;
    if let Ok(path) = marker_path(&app) {
        if let Err(e) = remove_marker_at(&path) {
            eprintln!("[entitlements] could not clear the Honduras recovery marker: {e}");
        }
    }
    Ok(())
}

/// Moves the server-side location back home when a previous bypass was
/// interrupted before it could return (see [`entitlement_bypass`]). A no-op
/// when nothing is stranded or no session is active yet; the marker is kept on
/// failure so a later launch or sign-out can retry. Called on app launch and
/// before sign-out.
#[tauri::command]
pub async fn restore_stranded_location(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let path = marker_path(&app)?;
    let Some(home) = read_marker_at(&path)? else {
        return Ok(());
    };
    // No session yet (e.g. not signed in): leave the marker for a later retry.
    let Ok(client) = state.client() else {
        return Ok(());
    };
    within("moving back", update_location(&client, &home)).await?;
    remove_marker_at(&path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_marker() -> PathBuf {
        let unique = format!(
            "free-grind-honduras-test-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        );
        std::env::temp_dir().join(unique).join(MARKER_FILE)
    }

    #[test]
    fn roundtrips_and_clears_the_marker() {
        let path = temp_marker();

        // Nothing stranded yet.
        assert_eq!(read_marker_at(&path).unwrap(), None);

        // A trip writes the home geohash; recovery reads it back verbatim.
        write_marker_at(&path, "d4f8h").unwrap();
        assert_eq!(read_marker_at(&path).unwrap(), Some("d4f8h".to_owned()));

        // A completed trip clears it, leaving nothing to recover.
        remove_marker_at(&path).unwrap();
        assert_eq!(read_marker_at(&path).unwrap(), None);

        // Removing an absent marker is a no-op, not an error.
        remove_marker_at(&path).unwrap();

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn treats_a_blank_marker_as_nothing_stranded() {
        let path = temp_marker();
        write_marker_at(&path, "  \n").unwrap();
        assert_eq!(read_marker_at(&path).unwrap(), None);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
