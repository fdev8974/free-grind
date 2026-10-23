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

/// Grindr's answer (HTTP 412) once it stops accepting this app version.
/// grindr.rs stops refreshing on its own after it; only an update helps.
pub const DEPRECATED_CLIENT_VERSION: i32 = 8;

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

/// Body of `auth:unsupported-version`, in the API's own error shape.
#[derive(Debug, Clone, Serialize)]
pub struct ApiErrorBody {
    pub code: i32,
    pub message: String,
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
            Outcome::UnsupportedVersion(error) => {
                let _ = app.emit("auth:unsupported-version", error);
            }
        }
    });
}

enum Outcome {
    Quiet,
    Failed(SessionErrorPayload),
    Banned(crate::error::BanInfo),
    UnsupportedVersion(ApiErrorBody),
}

/// The final answer a failed refresh gives, or the error back if retrying
/// could still help.
fn settled_by(error: AppError) -> Result<Outcome, AppError> {
    match error {
        AppError::Banned(info) => Ok(Outcome::Banned(info)),
        AppError::Api {
            code: DEPRECATED_CLIENT_VERSION,
            message,
        } => Ok(Outcome::UnsupportedVersion(ApiErrorBody {
            code: DEPRECATED_CLIENT_VERSION,
            message,
        })),
        AppError::Unauthorized { .. } | AppError::NotSignedIn => {
            Ok(Outcome::Failed(SessionErrorPayload {
                message: error.to_string(),
                unauthorized: true,
                transient: false,
            }))
        }
        // Signed out or switched accounts mid-run; not ours to report.
        AppError::SessionCleared => Ok(Outcome::Quiet),
        other => Err(other),
    }
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
            Err(error) => match settled_by(AppError::from_client_error(error, client)) {
                Ok(outcome) => return outcome,
                Err(retryable) => last = Some(retryable),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_refused_app_version_stops_the_retries_and_asks_for_an_update() {
        let outcome = settled_by(AppError::Api {
            code: 8,
            message: "The client version is deprecated".to_owned(),
        });

        let Ok(Outcome::UnsupportedVersion(error)) = outcome else {
            panic!("a refused app version must not be retried");
        };
        let json = serde_json::to_value(error).unwrap();
        assert_eq!(json["code"], 8);
        assert_eq!(json["message"], "The client version is deprecated");
    }

    #[test]
    fn other_api_errors_are_retried() {
        assert!(settled_by(AppError::Api {
            code: 500,
            message: "internal".to_owned(),
        })
        .is_err());
    }
}
