//! Shared plumbing for the third-party sign-in windows (`facebook_oauth`,
//! `google_oauth`): each opens an incognito webview window and waits for its
//! navigation handler to deliver a provider access token.
//!
//! Adapted from Open Grind (MIT, https://git.opengrind.org/open-grind/open-grind).

use std::marker::PhantomData;
use std::sync::Mutex;

use tauri::Url;
use tokio::sync::oneshot;

use crate::error::AppError;

pub trait OauthProvider: Send + Sync + 'static {
    const NAME: &'static str;
}

/// One sign-in flow at a time; the navigation and window-close handlers
/// deliver its outcome through here. The type parameter gives each provider
/// its own Tauri state key.
pub struct OauthBridge<P: OauthProvider> {
    pending: Mutex<Option<oneshot::Sender<Result<String, String>>>>,
    provider: PhantomData<P>,
}

impl<P: OauthProvider> Default for OauthBridge<P> {
    fn default() -> Self {
        Self {
            pending: Mutex::new(None),
            provider: PhantomData,
        }
    }
}

impl<P: OauthProvider> OauthBridge<P> {
    pub fn begin(&self) -> Result<oneshot::Receiver<Result<String, String>>, AppError> {
        let mut pending = self.pending.lock().unwrap();
        if pending.is_some() {
            return Err(AppError::Auth(format!(
                "{} sign-in already in progress",
                P::NAME
            )));
        }
        let (tx, rx) = oneshot::channel();
        *pending = Some(tx);
        Ok(rx)
    }

    pub fn fulfill(&self, result: Result<String, String>) {
        if let Some(tx) = self.pending.lock().unwrap().take() {
            let _ = tx.send(result);
        }
    }

    pub fn abort(&self) {
        let _ = self.pending.lock().unwrap().take();
    }
}

/// Unguessable per-flow value that ties a result back to the window that asked.
pub fn new_nonce() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// URL without query and fragment, for logging (both can carry the token).
pub fn without_secrets(url: &Url) -> String {
    let mut url = url.clone();
    url.set_query(None);
    url.set_fragment(None);
    url.into()
}

#[cfg(target_os = "windows")]
const DATA_SUBDIR: &str = "oauth-webview";

/// `incognito` silently no-ops on WebView2 older than 101.0.1210.39, so each
/// flow also gets its own throwaway profile folder.
#[cfg(target_os = "windows")]
pub fn data_dir(app: &tauri::AppHandle, nonce: &str) -> Result<std::path::PathBuf, AppError> {
    use tauri::Manager;

    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|e| AppError::Http(format!("no local data dir: {e}")))?;
    let name: String = nonce.chars().take(16).collect();
    Ok(root.join(DATA_SUBDIR).join(name))
}

/// WebView2 locks the folder while the window lives, so sweep at next launch.
#[cfg(target_os = "windows")]
pub fn sweep_data_dirs(app: &tauri::AppHandle) {
    use tauri::Manager;

    let Ok(root) = app.path().app_local_data_dir() else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(root.join(DATA_SUBDIR)) else {
        return;
    };
    for entry in entries.flatten() {
        if let Err(e) = std::fs::remove_dir_all(entry.path()) {
            eprintln!("[oauth] could not remove stale sign-in profile: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestProvider;

    impl OauthProvider for TestProvider {
        const NAME: &'static str = "Test";
    }

    #[test]
    fn a_second_flow_is_refused_while_one_is_pending() {
        let bridge = OauthBridge::<TestProvider>::default();
        let _rx = bridge.begin().expect("first flow starts");
        let Err(AppError::Auth(message)) = bridge.begin() else {
            panic!("a second flow must be refused");
        };
        assert_eq!(message, "Test sign-in already in progress");
    }

    #[test]
    fn delivering_or_aborting_frees_the_slot() {
        let bridge = OauthBridge::<TestProvider>::default();
        let _rx = bridge.begin().expect("first flow starts");
        bridge.fulfill(Ok("token".into()));
        let _rx = bridge.begin().expect("slot freed by a result");
        bridge.abort();
        assert!(bridge.begin().is_ok(), "slot freed by an abort");
    }

    #[test]
    fn each_nonce_is_fresh_and_url_safe() {
        let (a, b) = (new_nonce(), new_nonce());
        assert_ne!(a, b);
        assert!(a.len() >= 32);
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn a_logged_url_keeps_neither_the_query_nor_the_fragment() {
        let url =
            Url::parse("https://web.grindr.com/path?token=secret#access_token=secret").unwrap();
        assert_eq!(without_secrets(&url), "https://web.grindr.com/path");
    }
}
