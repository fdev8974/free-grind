use std::sync::Arc;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;

use crate::error::AppError;

use crate::api::oauth::{new_nonce, without_secrets};

use super::dialog::{
    dialog_url, is_allowed_target, is_redirect_url, result_from_redirect, HANDOFF_REFUSED,
};
use super::{FacebookOauthBridge, CANCELED};

const WINDOW_LABEL: &str = "facebook-oauth";

const FLOW_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10 * 60);

#[cfg(desktop)]
const WINDOW_INNER_SIZE: (f64, f64) = (600.0, 700.0);
#[cfg(mobile)]
const WINDOW_INNER_SIZE: (f64, f64) = (500.0, 720.0);

/// Facebook's dialog refuses some embedded desktop webviews (WebKitGTK,
/// WebView2) but accepts a regular Safari.
#[cfg(not(target_os = "android"))]
const DESKTOP_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
     AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

pub(super) async fn run_flow(
    app: &AppHandle,
    bridge: &Arc<FacebookOauthBridge>,
    rx: oneshot::Receiver<Result<String, String>>,
) -> Result<String, AppError> {
    if let Some(stale) = app.get_webview_window(WINDOW_LABEL) {
        let _ = stale.close();
    }

    let state = new_nonce();
    let (window_width, window_height) = WINDOW_INNER_SIZE;
    let bridge_for_nav = bridge.clone();
    let state_for_nav = state.clone();
    let url = dialog_url(&state).map_err(|e| AppError::Http(format!("invalid dialog URL: {e}")))?;

    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(url))
        .title("Sign in with Facebook")
        .inner_size(window_width, window_height)
        .incognito(true)
        .general_autofill_enabled(false)
        .on_navigation(move |url| {
            if !is_allowed_target(url) {
                eprintln!("[fb-oauth] refused {}", without_secrets(url));
                bridge_for_nav.fulfill(Err(HANDOFF_REFUSED.to_owned()));
                return false;
            }
            if !is_redirect_url(url) {
                return true;
            }
            if let Some(result) = result_from_redirect(url, &state_for_nav) {
                bridge_for_nav.fulfill(result);
            }
            false
        });

    #[cfg(not(target_os = "android"))]
    {
        builder = builder.user_agent(DESKTOP_USER_AGENT);
    }

    // tao matches the parent against each Activity's getLocalClassName(), and
    // launched through a disguise <activity-alias> that is the alias
    // (DisguiseDefaultAlias, ...), never "MainActivity". Ask the main window.
    #[cfg(target_os = "android")]
    {
        builder = builder.activity_name("FacebookOAuthActivity");
        if let Some(parent) = app
            .get_webview_window("main")
            .and_then(|main| main.activity_name().ok())
        {
            builder = builder.created_by_activity_name(parent);
        }
    }

    #[cfg(target_os = "windows")]
    {
        builder = builder.data_directory(crate::api::oauth::data_dir(app, &state)?);
    }

    let window = builder
        .build()
        .map_err(|e| AppError::Http(format!("failed to open sign-in window: {e}")))?;

    let bridge_for_close = bridge.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
        ) {
            bridge_for_close.fulfill(Err(CANCELED.to_owned()));
        }
    });

    let result = match tokio::time::timeout(FLOW_TIMEOUT, rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => {
            dismiss_window(app).await;
            return Err(AppError::Auth("sign-in flow ended unexpectedly".into()));
        }
        Err(_) => Err("Sign-in timed out".to_owned()),
    };

    dismiss_window(app).await;

    result.map_err(AppError::Auth)
}

async fn dismiss_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.clear_all_browsing_data();
        let _ = window.close();
    }
    #[cfg(target_os = "android")]
    super::android::dismiss(app).await;
}
