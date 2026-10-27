//! Desktop and iOS "Sign in with Google": loads `https://web.grindr.com/` in a separate,
//! incognito webview window, swaps the page for a single sign-in button and
//! runs Google Identity Services there with Grindr's own client id (it only
//! accepts that origin). The access token is the same one the browser
//! extension hands out for copying, so it goes to `sign_in_with_google`.
//!
//! The page scripts come from the Free Grind Google OAuth web extension
//! (git submodule `src-tauri/vendor/freegrind-google-oauth-webextension`).
//! On iOS the window is a full-screen WKWebView over the app (tao attaches it
//! to the main scene). Android runs the same extension in GeckoView instead
//! (see GoogleOAuthActivity.kt): its System WebView is refused by Google.
//!
//! Adapted from Open Grind (MIT, https://git.opengrind.org/open-grind/open-grind).

#[cfg(any(desktop, target_os = "ios"))]
mod web;

#[cfg(any(desktop, target_os = "ios"))]
use crate::api::oauth::{OauthBridge, OauthProvider};
use crate::error::AppError;

/// Matched verbatim by the frontend, which stays silent for it.
#[cfg(any(desktop, target_os = "ios"))]
pub const CANCELED: &str = "google-canceled";

#[cfg(any(desktop, target_os = "ios"))]
pub struct Google;

#[cfg(any(desktop, target_os = "ios"))]
impl OauthProvider for Google {
    const NAME: &'static str = "Google";
}

#[cfg(any(desktop, target_os = "ios"))]
pub type GoogleOauthBridge = OauthBridge<Google>;

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("google-oauth")
        .setup(|_app, _api| {
            #[cfg(any(desktop, target_os = "ios"))]
            {
                use tauri::Manager;
                _app.manage(std::sync::Arc::new(GoogleOauthBridge::default()));
            }
            Ok(())
        })
        .build()
}

/// Opens the Google sign-in window and waits for the access token.
#[cfg(any(desktop, target_os = "ios"))]
pub async fn fetch_access_token(app: &tauri::AppHandle) -> Result<String, AppError> {
    use tauri::Manager;

    let bridge = app
        .state::<std::sync::Arc<GoogleOauthBridge>>()
        .inner()
        .clone();
    let rx = bridge.begin()?;
    web::run_flow(app, &bridge, rx)
        .await
        .inspect_err(|_| bridge.abort())
}

#[cfg(target_os = "android")]
pub async fn fetch_access_token(_app: &tauri::AppHandle) -> Result<String, AppError> {
    Err(AppError::Auth(
        "The Google sign-in window is not used on Android (see GoogleOAuthActivity)".into(),
    ))
}
