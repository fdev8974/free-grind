//! Tauri-side WebSocket bridge for the Grindr realtime API.
//!
//! The actual socket (fingerprinting, auth, auto-reconnect) is owned by
//! `grindr::GrindrClient`'s shared background task — this module only
//! forwards its typed events and connection state to the webview as
//! `grindr-ws://event` (consumed by `ChatRealtimeManager`,
//! `src/services/chatRealtime.ts`), forwards outgoing frames the other way,
//! and lets the frontend's app lifecycle deactivate or force-reconnect it.

use std::sync::atomic::Ordering;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::broadcast::error::RecvError;
use tokio::time::timeout;

use super::session_recovery::{report_refresh_failure, SessionErrorPayload};
use crate::error::{AppError, BanInfo};
use crate::state::AppState;

const WS_EVENT: &str = "grindr-ws://event";

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum WsEvent {
    Open,
    Message { data: String },
    /// The bridge fell behind and the broadcast channel discarded events; the
    /// frontend refetches over REST.
    Lagged { skipped: u64 },
    Close { code: u16, reason: String },
    // grindr.rs's `WsConnectionState` doesn't distinguish a clean close from
    // an error — every disconnect surfaces as `Close`. Kept for the wire
    // format's sake (the frontend still handles it) in case a future need to
    // signal a WS-specific error appears.
    #[allow(dead_code)]
    Error { message: String },
}

fn emit(app: &AppHandle, event: WsEvent) {
    if let Err(_error) = app.emit(WS_EVENT, &event) {
        #[cfg(debug_assertions)]
        eprintln!("[HTTP-WS] failed to emit event: {_error}");
    }
}

/// Spawns the background tasks that bridge one `grindr::GrindrClient`'s
/// realtime events to the webview. Called once per client (at startup and
/// after every swap in `adopt_client`); their `JoinHandle`s are registered
/// with `AppState` so they get aborted together with the rest of that
/// client's tasks when it's replaced.
pub fn spawn_bridge(app: &AppHandle, client: grindr::GrindrClient) {
    let app = app.clone();
    use tauri::Manager;

    let events_handle = {
        let app = app.clone();
        let mut rx = client.ws_receiver();
        tauri::async_runtime::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(event) => {
                        emit(
                            &app,
                            WsEvent::Message {
                                data: event.payload.to_string(),
                            },
                        );
                    }
                    Err(RecvError::Lagged(skipped)) => {
                        #[cfg(debug_assertions)]
                        eprintln!("[HTTP-WS] event bridge lagged, dropped {skipped} events");
                        emit(&app, WsEvent::Lagged { skipped });
                    }
                    Err(RecvError::Closed) => break,
                }
            }
        })
    };

    let state_handle = {
        let app = app.clone();
        let mut rx = client.connection_state();
        tauri::async_runtime::spawn(async move {
            // React only to transitions, not the initial (always
            // `Disconnected`, since nothing has attempted to connect yet)
            // value; the frontend reads the current state via `ws_status`.
            while rx.changed().await.is_ok() {
                match &*rx.borrow() {
                    grindr::WsConnectionState::Connected => emit(&app, WsEvent::Open),
                    grindr::WsConnectionState::Disconnected => emit(
                        &app,
                        WsEvent::Close {
                            code: 1000,
                            reason: "disconnected".to_owned(),
                        },
                    ),
                }
            }
        })
    };

    // Distinct from the `grindr-ws://event` bridge above: these are
    // account-status signals for the login-gate UI (see
    // `AccountStatusPrompt.tsx`), not chat-socket frames. A `LoggedOut` /
    // `Banned` auth event also closes the realtime socket, but that's
    // already covered by the `connection_state` watcher above (which emits
    // its own `Close` once grindr.rs actually tears the socket down) — no
    // need to synthesize a second, WS-specific signal here.
    let auth_handle = {
        let app = app.clone();
        let mut rx = client.auth_event_receiver();
        tauri::async_runtime::spawn(async move {
            loop {
                let event = match rx.recv().await {
                    Ok(event) => event,
                    Err(RecvError::Lagged(_)) => continue,
                    Err(RecvError::Closed) => break,
                };
                match event {
                    grindr::AuthEvent::SignedOut => {
                        let _ = app.emit(
                            "auth:session-error",
                            SessionErrorPayload {
                                message: "Session expired".to_owned(),
                                unauthorized: true,
                                transient: false,
                            },
                        );
                    }
                    grindr::AuthEvent::RefreshFailed { message, kind, .. } => {
                        report_refresh_failure(&app, message, kind.is_transient());
                    }
                    grindr::AuthEvent::RefreshRecovered => {
                        let _ = app.emit("auth:session-ok", ());
                    }
                    grindr::AuthEvent::Banned(info) => {
                        let _ = app.emit("auth:banned", BanInfo::from(info));
                    }
                    _ => {}
                }
            }
        })
    };

    let state = app.state::<AppState>();
    state.add_task(events_handle);
    state.add_task(state_handle);
    state.add_task(auth_handle);
}

#[derive(Deserialize)]
struct OutgoingFrame {
    #[serde(rename = "type")]
    r#type: String,
    #[serde(rename = "ref")]
    ref_id: String,
    payload: serde_json::Value,
}

#[tauri::command]
pub async fn ws_connect(state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    state.client()?.connect().await;
    Ok(())
}

#[tauri::command]
pub async fn ws_send(state: tauri::State<'_, AppState>, payload: String) -> Result<(), AppError> {
    let frame: OutgoingFrame = serde_json::from_str(&payload)
        .map_err(|e| AppError::Http(format!("invalid outgoing ws frame: {e}")))?;

    let client = state.client()?;

    // grindr.rs's ws task keeps the command receiver alive while it backs
    // off, so without this gate a command sent while the socket is down sits
    // in the buffer and goes out on the next reconnect — long after the
    // frontend timed it out and reported the send as failed.
    if *client.connection_state().borrow() != grindr::WsConnectionState::Connected {
        return Err(AppError::Http("websocket not connected".to_owned()));
    }

    // `try_send`, so a backed-up buffer fails instead of parking the caller.
    client
        .ws_sender()
        .try_send(grindr::WsCommand {
            r#type: frame.r#type,
            ref_id: frame.ref_id,
            payload: frame.payload,
        })
        .map_err(|e| AppError::Http(format!("websocket send failed: {e}")))
}

#[tauri::command]
pub async fn ws_status(state: tauri::State<'_, AppState>) -> Result<bool, AppError> {
    let client = state.client()?;
    Ok(*client.connection_state().borrow() == grindr::WsConnectionState::Connected)
}

/// Foreground/background signal from the webview (Android only — iOS and
/// desktop have no push channel and keep the socket up in the background).
///
/// Going inactive closes the realtime socket and pauses session refreshes;
/// FCM covers notifications meanwhile. Coming back drops the connection pool
/// and TLS session cache first: sockets that idled through a suspend are
/// often half-dead with neither end having noticed, and the ping loop never
/// checks for a pong, so it would otherwise take minutes for TCP to give up.
#[tauri::command]
pub async fn set_app_active(
    state: tauri::State<'_, AppState>,
    active: bool,
) -> Result<(), AppError> {
    state.app_active.store(active, Ordering::SeqCst);
    let client = state.client()?;
    let resuming = active && !client.is_active();
    if resuming {
        client.reset_transport().await?;
    }
    client.set_active(active);
    Ok(())
}

const RECONNECT_STEP_TIMEOUT: Duration = Duration::from_secs(3);

/// Forces a fresh realtime socket on a fresh transport. For the cases where
/// the existing one may be silently dead but nothing deactivated it: resume
/// on iOS/desktop, or the network coming back / changing.
#[tauri::command]
pub async fn ws_reconnect(state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    let client = state.client()?;
    if !state.app_active.load(Ordering::SeqCst) {
        return Ok(());
    }

    let mut states = client.connection_state();
    if *states.borrow_and_update() == grindr::WsConnectionState::Connected {
        client.set_active(false);
        let stopped = timeout(
            RECONNECT_STEP_TIMEOUT,
            states.wait_for(|s| *s == grindr::WsConnectionState::Disconnected),
        )
        .await
        .is_ok();
        if !stopped {
            client.set_active(state.app_active.load(Ordering::SeqCst));
            return Err(AppError::Http("WS did not go down in time".to_owned()));
        }
    }

    // Also covers a socket stuck backing off on a dead transport: the fresh
    // one is picked up by its next attempt.
    let reset = client.reset_transport().await;
    // Not a plain `true`: the app may have been backgrounded meanwhile.
    client.set_active(state.app_active.load(Ordering::SeqCst));
    reset?;
    Ok(())
}

#[tauri::command]
pub fn ws_log_event(message: String) -> Result<(), AppError> {
    eprintln!("[chat-ws-event] {message}");
    Ok(())
}
