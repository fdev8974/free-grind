//! Tauri-side WebSocket bridge for the Grindr realtime API.
//!
//! The actual socket (fingerprinting, auth, auto-reconnect) is owned by
//! `grindr::GrindrClient`'s shared background task — this module only
//! forwards its typed events back to the webview as the same
//! `grindr-ws://event` envelope the frontend already expects, and forwards
//! outgoing frames the other way. `TauriWebSocket`
//! (`src/services/tauriWebSocket.ts`) and `ChatRealtimeManager`
//! (`src/services/chatRealtime.ts`) are unaware anything changed.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::broadcast::error::RecvError;

use crate::error::{AppError, BanInfo};
use crate::state::AppState;

const WS_EVENT: &str = "grindr-ws://event";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionErrorPayload {
    message: String,
    /// The session is gone (401 on refresh); signing in again is the only fix.
    unauthorized: bool,
    /// A retry of the same refresh could still succeed.
    transient: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum WsEvent {
    Open,
    Message { data: String },
    Close { code: u16, reason: String },
    // grindr.rs's `WsConnectionState` doesn't distinguish a clean close from
    // an error — every disconnect surfaces as `Close`. Kept for the wire
    // format's sake (the frontend's `TauriWebSocket` still has an `onerror`
    // path) in case a future need to signal a WS-specific error appears.
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
                    Err(RecvError::Lagged(_skipped)) => {
                        #[cfg(debug_assertions)]
                        eprintln!("[HTTP-WS] event bridge lagged, dropped {_skipped} events");
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
            // value — emitting a spurious `Close` here before any `Open`
            // would make `TauriWebSocket` mark itself permanently closed and
            // ignore the real `Open` that follows once `connect()` succeeds.
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
                        let _ = app.emit(
                            "auth:session-error",
                            SessionErrorPayload {
                                message,
                                unauthorized: false,
                                transient: kind.is_transient(),
                            },
                        );
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
pub async fn ws_connect(state: tauri::State<'_, AppState>, url: Option<String>) -> Result<(), AppError> {
    let _ = url; // kept for frontend call-site compatibility; grindr.rs owns the endpoint
    state.client()?.connect().await;
    Ok(())
}

#[tauri::command]
pub async fn ws_send(state: tauri::State<'_, AppState>, payload: String) -> Result<(), AppError> {
    let frame: OutgoingFrame = serde_json::from_str(&payload)
        .map_err(|e| AppError::Http(format!("invalid outgoing ws frame: {e}")))?;

    let client = state.client()?;
    client
        .ws_sender()
        .send(grindr::WsCommand {
            r#type: frame.r#type,
            ref_id: frame.ref_id,
            payload: frame.payload,
        })
        .await
        .map_err(|_| AppError::Http("websocket not connected".to_owned()))
}

/// There is one grindr-managed socket for the process's lifetime now, not one
/// per `TauriWebSocket` instance, so there is nothing meaningful to tear
/// down per-instance. `ChatRealtimeManager`'s own reconnect logic already
/// tolerates idempotent `ws_connect` calls.
#[tauri::command]
pub async fn ws_disconnect() -> Result<(), AppError> {
    Ok(())
}

#[tauri::command]
pub async fn ws_status(state: tauri::State<'_, AppState>) -> Result<bool, AppError> {
    let client = state.client()?;
    Ok(*client.connection_state().borrow() == grindr::WsConnectionState::Connected)
}

#[tauri::command]
pub fn ws_log_event(message: String) -> Result<(), AppError> {
    eprintln!("[chat-ws-event] {message}");
    Ok(())
}
