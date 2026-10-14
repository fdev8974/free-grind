//! "Sign in with Facebook": runs Facebook's OAuth dialog in a separate,
//! incognito webview window and hands the resulting user access token to
//! `GrindrClient::sign_in_with_facebook`.
//!
//! The dialog uses Grindr's own Facebook app id and its registered redirect
//! (`https://web.grindr.com/`); the redirect is intercepted in `on_navigation`
//! and never actually loads. On Android the window lives in its own Activity
//! (`FacebookOAuthActivity`, isolated WebView profile).
//!
//! Adapted from Open Grind (MIT, https://git.opengrind.org/open-grind/open-grind).

#[cfg(target_os = "android")]
mod android;
mod dialog;
#[cfg(any(desktop, target_os = "android"))]
mod web;

use std::sync::Arc;

use crate::api::oauth::{OauthBridge, OauthProvider};
use crate::error::AppError;

/// Matched verbatim by the frontend, which stays silent for it.
pub const CANCELED: &str = "facebook-canceled";

pub struct Facebook;

impl OauthProvider for Facebook {
    const NAME: &'static str = "Facebook";
}

pub type FacebookOauthBridge = OauthBridge<Facebook>;

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri::Manager;

    tauri::plugin::Builder::new("facebook-oauth")
        .setup(|app, _api| {
            app.manage(Arc::new(FacebookOauthBridge::default()));
            #[cfg(target_os = "android")]
            {
                let handle =
                    _api.register_android_plugin("dev.estopia.free_grind", "FacebookOAuthPlugin")?;
                app.manage(android::AndroidFacebookOauth { handle });
            }
            // Shared with google_oauth; one sweep covers both.
            #[cfg(target_os = "windows")]
            crate::api::oauth::sweep_data_dirs(app);
            Ok(())
        })
        .build()
}

/// Opens the Facebook dialog and waits for the user access token.
#[cfg(any(desktop, target_os = "android"))]
pub async fn fetch_access_token(app: &tauri::AppHandle) -> Result<String, AppError> {
    use tauri::Manager;

    let bridge = app.state::<Arc<FacebookOauthBridge>>().inner().clone();
    let rx = bridge.begin()?;
    web::run_flow(app, &bridge, rx)
        .await
        .inspect_err(|_| bridge.abort())
}

#[cfg(not(any(desktop, target_os = "android")))]
pub async fn fetch_access_token(_app: &tauri::AppHandle) -> Result<String, AppError> {
    Err(AppError::Auth(
        "Facebook sign-in is not supported on this platform".into(),
    ))
}

/// Drops the Facebook cookies of the sign-in WebView profile, so the next
/// sign-in doesn't silently reuse the previous Facebook account.
pub async fn forget_sign_in_profile(app: &tauri::AppHandle) {
    #[cfg(target_os = "android")]
    android::clear_profile(app).await;
    #[cfg(not(target_os = "android"))]
    let _ = app;
}
