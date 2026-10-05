use std::fmt;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BanInfo {
    pub kind: String,
    pub code: i32,
    pub message: String,
    pub reason: Option<String>,
    pub sub_reason: Option<String>,
    pub automated: Option<bool>,
}

impl From<grindr::BanInfo> for BanInfo {
    fn from(b: grindr::BanInfo) -> Self {
        let kind = match b.kind {
            grindr::BanKind::Profile => "profile",
            grindr::BanKind::Device => "device",
            grindr::BanKind::Network => "network",
            grindr::BanKind::Underage => "underage",
            _ => "unknown",
        };
        Self {
            kind: kind.to_owned(),
            code: b.code,
            message: b.message,
            reason: b.reason,
            sub_reason: b.sub_reason,
            automated: b.automated,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    Http(String),
    Connect(String),
    Auth(String),
    NotSignedIn,
    SessionStale,
    Api { code: i32, message: String },
    Unauthorized { code: i32, message: String },
    Banned(BanInfo),
    RateLimited,
    RequestBlocked,
    NetworkBlocked,
    SessionCleared,
    NotInitialized,
    Backup(String),
    TokenExpired,
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Http(msg) => write!(f, "HTTP error: {msg}"),
            AppError::Connect(msg) => write!(f, "Could not connect: {msg}"),
            AppError::Auth(msg) => write!(f, "Auth error: {msg}"),
            AppError::NotSignedIn => write!(f, "Not signed in"),
            AppError::SessionStale => write!(f, "Could not refresh the session"),
            AppError::Api { code, message } => write!(f, "API error {code}: {message}"),
            AppError::Unauthorized { code, message } => {
                write!(f, "Unauthorized ({code}): {message}")
            }
            AppError::Banned(info) => write!(f, "Banned ({}): {}", info.kind, info.message),
            AppError::RateLimited => write!(f, "Rate limited"),
            AppError::RequestBlocked => write!(f, "Request blocked by Cloudflare"),
            AppError::NetworkBlocked => write!(f, "Request blocked before it reached Grindr"),
            AppError::SessionCleared => {
                write!(f, "Signed out while the request was in flight")
            }
            AppError::NotInitialized => write!(f, "GrindrClient not initialized"),
            AppError::Backup(msg) => write!(f, "Backup error: {msg}"),
            AppError::TokenExpired => write!(f, "Session token expired"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<grindr::GrindrError> for AppError {
    fn from(e: grindr::GrindrError) -> Self {
        match e {
            grindr::GrindrError::Http(msg) => AppError::Http(msg),
            grindr::GrindrError::Connect(msg) => AppError::Connect(msg),
            grindr::GrindrError::Auth(msg) => AppError::Auth(msg),
            grindr::GrindrError::Api { code, message } => AppError::Api { code, message },
            grindr::GrindrError::Unauthorized { code, message } => {
                AppError::Unauthorized { code, message }
            }
            grindr::GrindrError::Banned(info) => AppError::Banned(info.into()),
            grindr::GrindrError::RateLimited => AppError::RateLimited,
            grindr::GrindrError::Blocked(grindr::BlockKind::Cloudflare) => AppError::RequestBlocked,
            grindr::GrindrError::Blocked(_) => AppError::NetworkBlocked,
            grindr::GrindrError::SessionCleared => AppError::SessionCleared,
            other => AppError::Http(other.to_string()),
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Http(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Backup(e.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Backup(e.to_string())
    }
}

impl From<zip::result::ZipError> for AppError {
    fn from(e: zip::result::ZipError) -> Self {
        AppError::Backup(e.to_string())
    }
}

impl From<AppError> for String {
    fn from(e: AppError) -> Self {
        e.to_string()
    }
}

impl AppError {
    /// A bare `Auth` error means different things depending on the session:
    /// none at all (`NotSignedIn`), or resumed credentials whose first token
    /// couldn't be minted yet (`SessionStale`) — same split as open-grind.
    pub fn from_client_error(error: grindr::GrindrError, client: &grindr::GrindrClient) -> Self {
        let (signed_in, has_token) = match client.session_receiver().borrow().as_ref() {
            None => (false, false),
            Some(session) => (true, session.token.is_some()),
        };
        match AppError::from(error) {
            AppError::Auth(_) if !signed_in => AppError::NotSignedIn,
            AppError::Auth(_) if !has_token => AppError::SessionStale,
            mapped => mapped,
        }
    }
}
