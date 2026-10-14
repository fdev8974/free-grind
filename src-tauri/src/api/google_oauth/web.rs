use std::sync::Arc;

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;

use crate::api::oauth::{new_nonce, without_secrets};
use crate::error::AppError;

use super::{GoogleOauthBridge, CANCELED};

const HELPER_URL: &str = "https://web.grindr.com/";
const HELPER_HOST: &str = "web.grindr.com";
const WINDOW_LABEL: &str = "google-oauth";
const WINDOW_INNER_SIZE: (f64, f64) = (800.0, 560.0);

const FLOW_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10 * 60);

/// Google refuses sign-in from some embedded desktop webviews (WebKitGTK,
/// WebView2) but accepts a regular Safari.
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
     AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

/// The init script reports here; the navigation never actually loads.
const RESULT_PATH: &str = "/__free_grind_oauth__";

/// The nonce and the exact result URL are what keep a foreign origin from
/// delivering a token; this only stops the two schemes a page must never reach.
const REFUSED_SCHEMES: [&str; 2] = ["file", "javascript"];

macro_rules! vendored {
    ($file:literal) => {
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/vendor/freegrind-google-oauth-webextension/shared/",
            $file
        ))
    };
}

const OAUTH_UI_CSS: &str = vendored!("oauth-ui.css");
const PRELUDE: &str = concat!(vendored!("gis-core.js"), "\n", vendored!("oauth-ui.js"));
const OAUTH_INIT: &str = include_str!("oauth_init.js");

fn init_script(nonce: &str) -> String {
    let config = serde_json::json!({ "css": OAUTH_UI_CSS, "nonce": nonce });
    format!("{PRELUDE}\n({OAUTH_INIT})({config});")
}

fn is_allowed_target(url: &Url) -> bool {
    !REFUSED_SCHEMES.contains(&url.scheme())
}

fn is_result_url(url: &Url) -> bool {
    url.host_str() == Some(HELPER_HOST) && url.path() == RESULT_PATH
}

fn result_from_query(url: &Url, nonce: &str) -> Option<Result<String, String>> {
    let mut nonce_matched = false;
    let mut result = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "nonce" => nonce_matched = value == nonce,
            "token" => result = Some(Ok(value.into_owned())),
            "error" => result = Some(Err(value.into_owned())),
            _ => {}
        }
    }
    nonce_matched.then_some(result).flatten()
}

pub(super) async fn run_flow(
    app: &AppHandle,
    bridge: &Arc<GoogleOauthBridge>,
    rx: oneshot::Receiver<Result<String, String>>,
) -> Result<String, AppError> {
    if let Some(stale) = app.get_webview_window(WINDOW_LABEL) {
        let _ = stale.close();
    }

    let url =
        Url::parse(HELPER_URL).map_err(|e| AppError::Http(format!("invalid helper URL: {e}")))?;

    let nonce = new_nonce();
    let (window_width, window_height) = WINDOW_INNER_SIZE;
    let bridge_for_nav = bridge.clone();
    let nonce_for_nav = nonce.clone();

    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(url))
        .title("Sign in with Google")
        .inner_size(window_width, window_height)
        .user_agent(USER_AGENT)
        .initialization_script(init_script(&nonce))
        .incognito(true)
        .general_autofill_enabled(false)
        .on_navigation(move |url| {
            if !is_allowed_target(url) {
                eprintln!("[google-oauth] refused {}", without_secrets(url));
                return false;
            }
            if !is_result_url(url) {
                return true;
            }
            if let Some(result) = result_from_query(url, &nonce_for_nav) {
                bridge_for_nav.fulfill(result);
            }
            false
        });

    #[cfg(target_os = "windows")]
    {
        builder = builder.data_directory(crate::api::oauth::data_dir(app, &nonce)?);
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
        Ok(Err(_)) => Err("sign-in flow ended unexpectedly".to_owned()),
        Err(_) => Err("Sign-in timed out".to_owned()),
    };

    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.clear_all_browsing_data();
        let _ = window.close();
    }

    result.map_err(AppError::Auth)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allows(url: &str) -> bool {
        is_allowed_target(&Url::parse(url).unwrap())
    }

    fn result_of(url: &str, nonce: &str) -> Option<Result<String, String>> {
        result_from_query(&Url::parse(url).unwrap(), nonce)
    }

    #[test]
    fn never_cancels_a_step_of_the_sign_in_flow() {
        for url in [
            "https://web.grindr.com/",
            "https://accounts.google.com/o/oauth2/auth",
            "https://accounts.youtube.com/accounts/SetSID",
            "https://www.google.com/recaptcha/enterprise/anchor",
            "about:blank",
            "about:srcdoc",
        ] {
            assert!(allows(url), "{url} is part of the flow and must load");
        }
    }

    #[test]
    fn refuses_schemes_that_cannot_be_part_of_the_flow() {
        for url in ["file:///etc/passwd", "javascript:alert(1)"] {
            assert!(!allows(url), "{url} must never load in the sign-in window");
        }
    }

    #[test]
    fn accepts_a_result_carrying_the_matching_nonce() {
        let result = result_of(
            "https://web.grindr.com/__free_grind_oauth__?nonce=abc&token=t0ken",
            "abc",
        );
        assert_eq!(result, Some(Ok("t0ken".to_string())));
    }

    #[test]
    fn rejects_a_result_whose_nonce_is_wrong_or_absent() {
        for url in [
            "https://web.grindr.com/__free_grind_oauth__?nonce=nope&token=t0ken",
            "https://web.grindr.com/__free_grind_oauth__?token=t0ken",
            "https://web.grindr.com/__free_grind_oauth__?nonce=&token=t0ken",
            "https://web.grindr.com/__free_grind_oauth__?error=denied",
        ] {
            assert_eq!(result_of(url, "abc"), None, "{url} must be ignored");
        }
    }

    #[test]
    fn the_init_script_reports_to_the_result_path_with_the_nonce() {
        let script = init_script("s3cret");
        assert!(script.contains("\"nonce\":\"s3cret\""));
        assert!(OAUTH_INIT.contains(RESULT_PATH));
        assert!(PRELUDE.contains("window.__grindrGis"));
        assert!(PRELUDE.contains("window.__grindrOauthUi"));
    }

    #[test]
    fn identifies_only_the_result_path() {
        let is_result = |u: &str| is_result_url(&Url::parse(u).unwrap());
        assert!(is_result("https://web.grindr.com/__free_grind_oauth__?x=1"));
        assert!(!is_result("https://web.grindr.com/"));
        assert!(!is_result(
            "https://accounts.google.com/__free_grind_oauth__"
        ));
    }
}
