//! Active recovery from transient token-refresh failures.
//!
//! When a background refresh fails on a network hiccup, grindr.rs reports
//! `RefreshFailed` and backs off — but nothing retries on its own. The
//! realtime socket is hit hardest: on an auth error its task parks until the
//! session *changes*, so it stays down until some unrelated REST call happens
//! to mint a new token. This supervisor retries the refresh a few times (an
//! explicit `refresh_session` bypasses grindr.rs's cooldown gate); a success
//! swaps the session, which wakes the socket task straight back up.
//!
//! Ported from open-grind's `session_recovery.rs`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::error::AppError;
use crate::state::AppState;

/// Lets a burst of failures (REST calls and the socket all refreshing at
/// once) settle into a single recovery run.
const COALESCE: Duration = Duration::from_millis(1500);

const ATTEMPT_DELAYS: [Duration; 3] = [
    Duration::ZERO,
    Duration::from_secs(4),
    Duration::from_secs(12),
];

/// Same margin `websocket_token` uses for "needs a refresh".
const REFRESH_BUFFER_SECS: u64 = 60;

/// Only one recovery run at a time, process-wide.
static RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionErrorPayload {
    pub message: String,
    /// The session is gone (401 on refresh); signing in again is the only fix.
    pub unauthorized: bool,
    /// A retry of the same refresh could still succeed.
    pub transient: bool,
}

/// Handles a `RefreshFailed` auth event: non-transient failures go straight
/// to the UI, transient ones get retried before the UI hears about them.
pub fn report_refresh_failure(app: &AppHandle, message: String, transient: bool) {
    if !transient {
        let _ = app.emit(
            "auth:session-error",
            SessionErrorPayload {
                message,
                unauthorized: false,
                transient: false,
            },
        );
        return;
    }

    let Ok(client) = app.state::<AppState>().client() else {
        return;
    };
    if RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let outcome = supervise(&client).await;
        RUNNING.store(false, Ordering::SeqCst);
        match outcome {
            Outcome::Quiet => {}
            Outcome::Failed(payload) => {
                let _ = app.emit("auth:session-error", payload);
            }
            Outcome::Banned(info) => {
                let _ = app.emit("auth:banned", info);
            }
        }
    });
}

enum Outcome {
    Quiet,
    Failed(SessionErrorPayload),
    Banned(crate::error::BanInfo),
}

async fn supervise(client: &grindr::GrindrClient) -> Outcome {
    tokio::time::sleep(COALESCE).await;

    let mut last: Option<AppError> = None;

    for delay in ATTEMPT_DELAYS {
        tokio::time::sleep(delay).await;

        // Backgrounded (refreshes are paused on purpose) or something else
        // already got a fresh token in the meantime.
        if !client.is_active() || !session_is_stale(client) {
            return Outcome::Quiet;
        }

        match client.refresh_session().await {
            Ok(_) => return Outcome::Quiet,
            Err(error) => match AppError::from_client_error(error, client) {
                AppError::Banned(info) => return Outcome::Banned(info),
                mapped @ (AppError::Unauthorized { .. } | AppError::NotSignedIn) => {
                    return Outcome::Failed(SessionErrorPayload {
                        message: mapped.to_string(),
                        unauthorized: true,
                        transient: false,
                    });
                }
                // Signed out or switched accounts mid-run; not ours to report.
                AppError::SessionCleared => return Outcome::Quiet,
                mapped => last = Some(mapped),
            },
        }
    }

    match last {
        Some(error) => Outcome::Failed(SessionErrorPayload {
            message: error.to_string(),
            unauthorized: false,
            transient: true,
        }),
        None => Outcome::Quiet,
    }
}

fn session_is_stale(client: &grindr::GrindrClient) -> bool {
    let now = chrono::Utc::now().timestamp() as u64;
    match client.session_receiver().borrow().as_ref() {
        // Signed out meanwhile — nothing to recover.
        None => false,
        Some(session) => session
            .token
            .as_ref()
            .is_none_or(|token| token.expires_at < now + REFRESH_BUFFER_SECS),
    }
}
