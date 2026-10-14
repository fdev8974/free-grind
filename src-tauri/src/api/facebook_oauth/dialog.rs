use tauri::Url;

use super::CANCELED;

const DIALOG_URL: &str = "https://www.facebook.com/v16.0/dialog/oauth";
/// Grindr's own Facebook app; only its registered redirect is accepted.
const APP_ID: &str = "1273378622718674";
const SCOPE: &str = "public_profile,email";
const REDIRECT_URI: &str = "https://web.grindr.com/";
const REDIRECT_HOST: &str = "web.grindr.com";
const REDIRECT_PATH: &str = "/";

const ALLOWED_SCHEMES: [&str; 2] = ["https", "about"];

/// Matched verbatim by the frontend; Meta's own wording only reaches the log.
pub const DIALOG_ERROR: &str = "facebook-dialog-error";
/// The dialog tried to hand off to the Facebook app or another non-web target.
pub const HANDOFF_REFUSED: &str = "facebook-handoff-refused";

pub fn dialog_url(state: &str) -> Result<Url, String> {
    Url::parse_with_params(
        DIALOG_URL,
        &[
            ("client_id", APP_ID),
            ("redirect_uri", REDIRECT_URI),
            ("response_type", "token"),
            ("scope", SCOPE),
            ("display", "popup"),
            ("state", state),
        ],
    )
    .map_err(|e| e.to_string())
}

/// The app's own origins (tauri.localhost, ipc.localhost, ...) must never load
/// in the sign-in window.
fn is_served_locally(host: &str) -> bool {
    let host = host.trim_end_matches('.');
    host == "localhost" || host.ends_with(".localhost")
}

pub fn is_allowed_target(url: &Url) -> bool {
    ALLOWED_SCHEMES.contains(&url.scheme()) && !url.host_str().is_some_and(is_served_locally)
}

pub fn is_redirect_url(url: &Url) -> bool {
    url.host_str() == Some(REDIRECT_HOST) && url.path() == REDIRECT_PATH
}

fn decode_pairs(encoded: Option<&str>) -> Vec<(String, String)> {
    encoded
        .and_then(|s| Url::parse(&format!("x:/?{s}")).ok())
        .map(|parsed| {
            parsed
                .query_pairs()
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .collect()
        })
        .unwrap_or_default()
}

/// The token (or the refusal) the dialog redirected back with; `None` while
/// the redirect carries no verdict yet.
pub fn result_from_redirect(url: &Url, state: &str) -> Option<Result<String, String>> {
    let mut fields = decode_pairs(url.query());
    fields.extend(decode_pairs(url.fragment()));
    let field = |name: &str| {
        fields
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
    };

    if let Some(error) = field("error_description")
        .or_else(|| field("error_message"))
        .or_else(|| field("error"))
    {
        if field("error").as_deref() == Some("access_denied") {
            return Some(Err(CANCELED.to_owned()));
        }
        eprintln!("[fb-oauth] the dialog refused the sign-in: {error}");
        return Some(Err(DIALOG_ERROR.to_owned()));
    }

    let token = field("access_token")?;
    if field("state").as_deref() != Some(state) {
        return Some(Err("Sign-in could not be verified".to_owned()));
    }
    Some(Ok(token))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn param(built: &Url, name: &str) -> Option<String> {
        built
            .query_pairs()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
    }

    #[test]
    fn the_dialog_url_carries_the_app_id_and_the_registered_redirect() {
        let built = dialog_url("st4te").unwrap();
        assert_eq!(param(&built, "client_id").as_deref(), Some(APP_ID));
        assert_eq!(param(&built, "response_type").as_deref(), Some("token"));
        assert_eq!(param(&built, "state").as_deref(), Some("st4te"));
        assert_eq!(param(&built, "redirect_uri").as_deref(), Some(REDIRECT_URI));
    }

    #[test]
    fn a_token_in_the_fragment_is_accepted_when_the_state_matches() {
        let redirect =
            url("https://web.grindr.com/#access_token=EAAtok&expires_in=6805&state=st4te");
        assert_eq!(
            result_from_redirect(&redirect, "st4te"),
            Some(Ok("EAAtok".into()))
        );
    }

    #[test]
    fn a_mismatched_or_missing_state_is_refused() {
        for redirect in [
            "https://web.grindr.com/#access_token=EAAtok&state=other",
            "https://web.grindr.com/#access_token=EAAtok",
        ] {
            assert!(matches!(
                result_from_redirect(&url(redirect), "st4te"),
                Some(Err(_))
            ));
        }
    }

    #[test]
    fn a_denied_consent_reads_as_a_cancellation() {
        let redirect =
            url("https://web.grindr.com/?error=access_denied&error_description=Permissions+error");
        assert_eq!(
            result_from_redirect(&redirect, "st4te"),
            Some(Err(CANCELED.into()))
        );
    }

    #[test]
    fn any_other_dialog_error_never_leaks_metas_wording() {
        let redirect =
            url("https://web.grindr.com/?error=server_error&error_description=Try+again+later");
        assert_eq!(
            result_from_redirect(&redirect, "st4te"),
            Some(Err(DIALOG_ERROR.into()))
        );
    }

    #[test]
    fn a_redirect_without_a_result_yet_is_not_a_verdict() {
        assert_eq!(
            result_from_redirect(&url("https://web.grindr.com/"), "s"),
            None
        );
    }

    #[test]
    fn only_the_registered_redirect_counts_as_the_redirect() {
        assert!(!is_redirect_url(&url(
            "https://www.facebook.com/v16.0/dialog/oauth?client_id=1"
        )));
        assert!(!is_redirect_url(&url("https://web.grindr.com/auth")));
        assert!(is_redirect_url(&url("https://web.grindr.com/")));
    }

    #[test]
    fn only_web_steps_of_the_flow_may_load() {
        for allowed in [
            "https://www.facebook.com/v16.0/dialog/oauth",
            "https://m.facebook.com/login.php",
            "https://web.grindr.com/",
            "about:blank",
        ] {
            assert!(is_allowed_target(&url(allowed)), "{allowed} must load");
        }
        for refused in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "intent://authorize/#Intent;package=com.facebook.katana;end",
            "fb1273378622718674://authorize/",
            "http://web.grindr.com/",
            "https://tauri.localhost/",
            "https://ipc.localhost/",
            "https://localhost./",
            "https://localhost/",
        ] {
            assert!(!is_allowed_target(&url(refused)), "{refused} must not load");
        }
    }
}
