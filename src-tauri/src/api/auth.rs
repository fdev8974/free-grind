#[cfg(not(any(target_os = "windows", all(target_os = "macos", debug_assertions))))]
use keyring_core::Entry;
use serde::{Deserialize, Serialize};
#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::path::PathBuf;

use crate::error::AppError;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Legacy (pre-grindr.rs) session shape, kept only so existing installs can be
// migrated instead of forcibly logged out. `grindr::Session` has no
// device_id/advertising_id fields (those now live in a separate
// `grindr::DeviceInfo`), so a legacy blob that fails to decode as the new
// shape is retried against this one and, on success, split into a
// `grindr::Session` + `grindr::DeviceInfo` pair and re-saved in the new
// format. Never written going forward.
// ---------------------------------------------------------------------------
#[derive(Debug, Clone, Serialize, Deserialize)]
struct LegacySession {
    email: String,
    expires_at: u64,
    profile_id: String,
    session_id: String,
    auth_token: String,
    device_id: String,
    advertising_id: String,
}

fn migrate_legacy_session(bytes: &[u8]) -> Option<(grindr::Session, grindr::DeviceInfo)> {
    let legacy: LegacySession = rmp_serde::decode::from_slice(bytes).ok()?;

    let session: grindr::Session = serde_json::from_value(serde_json::json!({
        "email": legacy.email,
        "expires_at": legacy.expires_at,
        "profile_id": legacy.profile_id,
        "session_id": legacy.session_id,
        "auth_token": legacy.auth_token,
    }))
    .ok()?;

    let mut device = grindr::DeviceInfo::generate();
    device.device_id = legacy.device_id;
    device.advertising_id = legacy.advertising_id;

    Some((session, device))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResult {
    pub profile_id: String,
    pub restriction: Option<Restriction>,
}

impl From<grindr::LoginResult> for LoginResult {
    fn from(r: grindr::LoginResult) -> Self {
        Self {
            profile_id: r.profile_id,
            restriction: r.restriction.map(Restriction::from),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Restriction {
    pub kind: String,
    pub region: Option<String>,
    pub reason: Option<String>,
}

impl From<grindr::Restriction> for Restriction {
    fn from(r: grindr::Restriction) -> Self {
        match r {
            grindr::Restriction::AgeVerification { region, reason } => Self {
                kind: "ageVerification".to_owned(),
                region: Some(region_str(region).to_owned()),
                reason: Some(reason),
            },
            grindr::Restriction::TimedBan(details) => Self {
                kind: "timedBan".to_owned(),
                region: None,
                reason: details.reason,
            },
            grindr::Restriction::TrustVendorRejected => Self {
                kind: "trustVendorRejected".to_owned(),
                region: None,
                reason: None,
            },
            grindr::Restriction::Other(raw) => Self {
                kind: "other".to_owned(),
                region: None,
                reason: Some(raw),
            },
            _ => Self {
                kind: "other".to_owned(),
                region: None,
                reason: None,
            },
        }
    }
}

fn region_str(region: grindr::VerificationRegion) -> &'static str {
    match region {
        grindr::VerificationRegion::Uk => "uk",
        grindr::VerificationRegion::Br => "br",
        grindr::VerificationRegion::Au => "au",
        _ => "other",
    }
}

pub struct AuthStorage;

impl AuthStorage {
    #[cfg(target_os = "windows")]
    fn windows_session_file_path() -> Result<PathBuf, AppError> {
        Ok(crate::windows_instance::WindowsInstance::current().session_file_path())
    }

    #[cfg(target_os = "windows")]
    pub fn get_session() -> Result<Option<grindr::Session>, AppError> {
        let path = Self::windows_session_file_path()?;

        let session_bytes = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(AppError::Auth(format!(
                    "Failed to read Windows session from {}: {}",
                    path.display(),
                    error
                )))
            }
        };

        match rmp_serde::decode::from_slice::<grindr::Session>(&session_bytes) {
            Ok(session) => Ok(Some(session)),
            Err(_decode_error) => match migrate_legacy_session(&session_bytes) {
                Some((session, device)) => {
                    let _ = Self::set_session(&session);
                    let _ = DeviceStorage::save(&device);
                    Ok(Some(session))
                }
                None => Err(AppError::Auth(_decode_error.to_string())),
            },
        }
    }

    #[cfg(target_os = "windows")]
    pub fn set_session(session: &grindr::Session) -> Result<(), AppError> {
        let path = Self::windows_session_file_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                AppError::Auth(format!(
                    "Failed to create Windows session directory {}: {}",
                    parent.display(),
                    error
                ))
            })?;
        }

        let session_bytes = rmp_serde::encode::to_vec(session).unwrap();
        std::fs::write(&path, session_bytes).map_err(|error| {
            AppError::Auth(format!(
                "Failed to write Windows session {}: {}",
                path.display(),
                error
            ))
        })
    }

    #[cfg(target_os = "windows")]
    pub fn clear_session() -> Result<(), AppError> {
        let path = Self::windows_session_file_path()?;
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(AppError::Auth(format!(
                "Failed to clear Windows session {}: {}",
                path.display(),
                error
            ))),
        }
    }

    #[cfg(all(target_os = "macos", debug_assertions))]
    fn dev_session_file_path() -> Result<PathBuf, AppError> {
        let home = std::env::var("HOME").map_err(|_| {
            AppError::Auth("HOME is not set; cannot resolve session path".to_owned())
        })?;

        Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("free-grind")
            .join("dev-session.msgpack"))
    }

    #[cfg(all(target_os = "macos", debug_assertions))]
    pub fn get_session() -> Result<Option<grindr::Session>, AppError> {
        let path = Self::dev_session_file_path()?;

        let session_bytes = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(AppError::Auth(format!(
                    "Failed to read dev session from {}: {}",
                    path.display(),
                    error
                )))
            }
        };

        match rmp_serde::decode::from_slice::<grindr::Session>(&session_bytes) {
            Ok(session) => Ok(Some(session)),
            Err(_decode_error) => match migrate_legacy_session(&session_bytes) {
                Some((session, device)) => {
                    let _ = Self::set_session(&session);
                    let _ = DeviceStorage::save(&device);
                    Ok(Some(session))
                }
                None => Err(AppError::Auth(_decode_error.to_string())),
            },
        }
    }

    #[cfg(all(target_os = "macos", debug_assertions))]
    pub fn set_session(session: &grindr::Session) -> Result<(), AppError> {
        let path = Self::dev_session_file_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                AppError::Auth(format!(
                    "Failed to create session directory {}: {}",
                    parent.display(),
                    error
                ))
            })?;
        }

        let session_bytes = rmp_serde::encode::to_vec(session).unwrap();
        std::fs::write(&path, session_bytes).map_err(|error| {
            AppError::Auth(format!(
                "Failed to write dev session {}: {}",
                path.display(),
                error
            ))
        })
    }

    #[cfg(all(target_os = "macos", debug_assertions))]
    pub fn clear_session() -> Result<(), AppError> {
        let path = Self::dev_session_file_path()?;
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(AppError::Auth(format!(
                "Failed to clear dev session {}: {}",
                path.display(),
                error
            ))),
        }
    }

    #[cfg(not(any(target_os = "windows", all(target_os = "macos", debug_assertions))))]
    fn get_session_entry() -> Result<Entry, AppError> {
        Entry::new("free-grind", "session").map_err(|e| AppError::Auth(e.to_string()))
    }

    #[cfg(all(target_os = "macos", not(debug_assertions)))]
    fn macos_fallback_session_file_path() -> Result<PathBuf, AppError> {
        let home = std::env::var("HOME").map_err(|_| {
            AppError::Auth("HOME is not set; cannot resolve fallback session path".to_owned())
        })?;

        Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("free-grind")
            .join("session-fallback.msgpack"))
    }

    #[cfg(all(target_os = "macos", not(debug_assertions)))]
    fn read_macos_fallback_session() -> Result<Option<grindr::Session>, AppError> {
        let path = Self::macos_fallback_session_file_path()?;
        let session_bytes = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(AppError::Auth(format!(
                    "Failed to read macOS fallback session from {}: {}",
                    path.display(),
                    error
                )))
            }
        };

        match rmp_serde::decode::from_slice::<grindr::Session>(&session_bytes) {
            Ok(session) => Ok(Some(session)),
            Err(_decode_error) => match migrate_legacy_session(&session_bytes) {
                Some((session, device)) => {
                    let _ = Self::write_macos_fallback_session(&session);
                    let _ = DeviceStorage::save(&device);
                    Ok(Some(session))
                }
                None => Err(AppError::Auth(_decode_error.to_string())),
            },
        }
    }

    #[cfg(all(target_os = "macos", not(debug_assertions)))]
    fn write_macos_fallback_session(session: &grindr::Session) -> Result<(), AppError> {
        let path = Self::macos_fallback_session_file_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                AppError::Auth(format!(
                    "Failed to create fallback session directory {}: {}",
                    parent.display(),
                    error
                ))
            })?;
        }

        let session_bytes = rmp_serde::encode::to_vec(session).unwrap();
        std::fs::write(&path, session_bytes).map_err(|error| {
            AppError::Auth(format!(
                "Failed to write macOS fallback session {}: {}",
                path.display(),
                error
            ))
        })?;

        #[cfg(target_family = "unix")]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }

        Ok(())
    }

    #[cfg(all(target_os = "macos", not(debug_assertions)))]
    fn clear_macos_fallback_session() -> Result<(), AppError> {
        let path = Self::macos_fallback_session_file_path()?;
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(AppError::Auth(format!(
                "Failed to clear macOS fallback session {}: {}",
                path.display(),
                error
            ))),
        }
    }

    #[cfg(not(any(target_os = "windows", all(target_os = "macos", debug_assertions))))]
    pub fn get_session() -> Result<Option<grindr::Session>, AppError> {
        let entry = match Self::get_session_entry() {
            Ok(entry) => entry,
            Err(_error) => {
                #[cfg(target_os = "macos")]
                {
                    #[cfg(debug_assertions)]
                    eprintln!(
                        "[HTTP-AUTH] Keyring entry creation failed on macOS, trying fallback session file: {}",
                        _error
                    );
                    return Self::read_macos_fallback_session();
                }

                #[cfg(not(target_os = "macos"))]
                {
                    return Err(_error);
                }
            }
        };
        let session_bytes = match entry.get_secret() {
            Ok(bytes) => bytes,
            Err(keyring_core::Error::NoEntry) => {
                #[cfg(target_os = "macos")]
                {
                    return Self::read_macos_fallback_session();
                }

                #[cfg(not(target_os = "macos"))]
                {
                    return Ok(None);
                }
            }
            Err(_e) => {
                #[cfg(target_os = "macos")]
                {
                    #[cfg(debug_assertions)]
                    eprintln!(
                        "[HTTP-AUTH] Keyring read failed on macOS, trying fallback session file: {}",
                        _e
                    );
                    return Self::read_macos_fallback_session();
                }

                #[cfg(not(target_os = "macos"))]
                {
                    return Err(AppError::Auth(_e.to_string()));
                }
            }
        };
        match rmp_serde::decode::from_slice::<grindr::Session>(&session_bytes) {
            Ok(session) => Ok(Some(session)),
            Err(_decode_error) => match migrate_legacy_session(&session_bytes) {
                Some((session, device)) => {
                    let _ = Self::set_session(&session);
                    let _ = DeviceStorage::save(&device);
                    Ok(Some(session))
                }
                #[cfg(target_os = "macos")]
                None => Self::read_macos_fallback_session(),
                #[cfg(not(target_os = "macos"))]
                None => Err(AppError::Auth(_decode_error.to_string())),
            },
        }
    }

    #[cfg(not(any(target_os = "windows", all(target_os = "macos", debug_assertions))))]
    pub fn set_session(session: &grindr::Session) -> Result<(), AppError> {
        let session_bytes = rmp_serde::encode::to_vec(session).unwrap();
        let entry = match Self::get_session_entry() {
            Ok(entry) => entry,
            Err(_error) => {
                #[cfg(target_os = "macos")]
                {
                    #[cfg(debug_assertions)]
                    eprintln!(
                        "[HTTP-AUTH] Keyring entry creation failed on macOS, writing fallback session file: {}",
                        _error
                    );
                    return Self::write_macos_fallback_session(session);
                }

                #[cfg(not(target_os = "macos"))]
                {
                    return Err(_error);
                }
            }
        };
        match entry.set_secret(&session_bytes) {
            Ok(()) => {
                #[cfg(target_os = "macos")]
                {
                    let _ = Self::clear_macos_fallback_session();
                }
                Ok(())
            }
            Err(_error) => {
                #[cfg(target_os = "macos")]
                {
                    #[cfg(debug_assertions)]
                    eprintln!(
                        "[HTTP-AUTH] Keyring write failed on macOS, writing fallback session file: {}",
                        _error
                    );
                    return Self::write_macos_fallback_session(session);
                }

                #[cfg(not(target_os = "macos"))]
                {
                    Err(AppError::Auth(_error.to_string()))
                }
            }
        }
    }

    #[cfg(not(any(target_os = "windows", all(target_os = "macos", debug_assertions))))]
    pub fn clear_session() -> Result<(), AppError> {
        let entry = match Self::get_session_entry() {
            Ok(entry) => Some(entry),
            Err(_error) => {
                #[cfg(not(target_os = "macos"))]
                {
                    return Err(_error);
                }

                #[cfg(target_os = "macos")]
                {
                    #[cfg(debug_assertions)]
                    eprintln!(
                        "[HTTP-AUTH] Keyring entry creation failed on macOS during clear, continuing with fallback clear: {}",
                        _error
                    );
                    None
                }
            }
        };
        if let Some(entry) = entry {
            match entry.delete_credential() {
                Ok(()) | Err(keyring_core::Error::NoEntry) => {}
                Err(_error) => {
                    #[cfg(not(target_os = "macos"))]
                    {
                        return Err(AppError::Auth(_error.to_string()));
                    }

                    #[cfg(target_os = "macos")]
                    {
                        #[cfg(debug_assertions)]
                        eprintln!(
                            "[HTTP-AUTH] Keyring clear failed on macOS, continuing with fallback clear: {}",
                            _error
                        );
                    }
                }
            }
        }

        #[cfg(target_os = "macos")]
        {
            Self::clear_macos_fallback_session()?;
        }

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Generic slot storage — used for DeviceInfo, the signing key, and every
// multi-account slot (session + device per saved account, plus the account
// index). Deliberately simpler than AuthStorage's single "active" slot above
// (no macOS-release file fallback): if keyring access fails here, that one
// slot fails to read/write (logged, non-fatal — the active session is
// completely unaffected), rather than silently falling back to a less secure
// file for every account.
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn slot_file_path(slot: &str) -> PathBuf {
    crate::windows_instance::WindowsInstance::current()
        .data_root()
        .join(format!("{slot}.msgpack"))
}

#[cfg(target_os = "windows")]
fn get_slot_bytes(slot: &str) -> Result<Option<Vec<u8>>, AppError> {
    let path = slot_file_path(slot);
    match std::fs::read(&path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(AppError::Auth(format!(
            "Failed to read {} from {}: {}",
            slot,
            path.display(),
            error
        ))),
    }
}

#[cfg(target_os = "windows")]
fn set_slot_bytes(slot: &str, bytes: &[u8]) -> Result<(), AppError> {
    let path = slot_file_path(slot);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            AppError::Auth(format!(
                "Failed to create directory {}: {}",
                parent.display(),
                error
            ))
        })?;
    }
    std::fs::write(&path, bytes).map_err(|error| {
        AppError::Auth(format!(
            "Failed to write {} to {}: {}",
            slot,
            path.display(),
            error
        ))
    })
}

#[cfg(target_os = "windows")]
fn clear_slot(slot: &str) -> Result<(), AppError> {
    let path = slot_file_path(slot);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError::Auth(format!(
            "Failed to clear {} at {}: {}",
            slot,
            path.display(),
            error
        ))),
    }
}

#[cfg(all(target_os = "macos", debug_assertions))]
fn slot_file_path(slot: &str) -> Result<PathBuf, AppError> {
    let home = std::env::var("HOME")
        .map_err(|_| AppError::Auth("HOME is not set; cannot resolve slot path".to_owned()))?;

    Ok(PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("free-grind")
        .join(format!("{slot}.msgpack")))
}

#[cfg(all(target_os = "macos", debug_assertions))]
fn get_slot_bytes(slot: &str) -> Result<Option<Vec<u8>>, AppError> {
    let path = slot_file_path(slot)?;
    match std::fs::read(&path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(AppError::Auth(format!(
            "Failed to read {} from {}: {}",
            slot,
            path.display(),
            error
        ))),
    }
}

#[cfg(all(target_os = "macos", debug_assertions))]
fn set_slot_bytes(slot: &str, bytes: &[u8]) -> Result<(), AppError> {
    let path = slot_file_path(slot)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            AppError::Auth(format!(
                "Failed to create directory {}: {}",
                parent.display(),
                error
            ))
        })?;
    }
    std::fs::write(&path, bytes).map_err(|error| {
        AppError::Auth(format!(
            "Failed to write {} to {}: {}",
            slot,
            path.display(),
            error
        ))
    })
}

#[cfg(all(target_os = "macos", debug_assertions))]
fn clear_slot(slot: &str) -> Result<(), AppError> {
    let path = slot_file_path(slot)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError::Auth(format!(
            "Failed to clear {} at {}: {}",
            slot,
            path.display(),
            error
        ))),
    }
}

#[cfg(not(any(target_os = "windows", all(target_os = "macos", debug_assertions))))]
fn get_slot_bytes(slot: &str) -> Result<Option<Vec<u8>>, AppError> {
    let entry = Entry::new("free-grind", slot).map_err(|e| AppError::Auth(e.to_string()))?;
    match entry.get_secret() {
        Ok(bytes) => Ok(Some(bytes)),
        Err(keyring_core::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Auth(e.to_string())),
    }
}

#[cfg(not(any(target_os = "windows", all(target_os = "macos", debug_assertions))))]
fn set_slot_bytes(slot: &str, bytes: &[u8]) -> Result<(), AppError> {
    let entry = Entry::new("free-grind", slot).map_err(|e| AppError::Auth(e.to_string()))?;
    entry
        .set_secret(bytes)
        .map_err(|e| AppError::Auth(e.to_string()))
}

#[cfg(not(any(target_os = "windows", all(target_os = "macos", debug_assertions))))]
fn clear_slot(slot: &str) -> Result<(), AppError> {
    let entry = Entry::new("free-grind", slot).map_err(|e| AppError::Auth(e.to_string()))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Auth(e.to_string())),
    }
}

pub struct DeviceStorage;

const ACTIVE_DEVICE_SLOT: &str = "device-info";

impl DeviceStorage {
    pub fn load() -> Result<Option<grindr::DeviceInfo>, AppError> {
        match get_slot_bytes(ACTIVE_DEVICE_SLOT)? {
            Some(bytes) => rmp_serde::decode::from_slice(&bytes)
                .map(Some)
                .map_err(|e| AppError::Auth(format!("device decode failed: {e}"))),
            None => Ok(None),
        }
    }

    pub fn save(device: &grindr::DeviceInfo) -> Result<(), AppError> {
        let bytes = rmp_serde::encode::to_vec(device)
            .map_err(|e| AppError::Auth(format!("device encode failed: {e}")))?;
        set_slot_bytes(ACTIVE_DEVICE_SLOT, &bytes)
    }
}

pub struct SigningKeyStorage;

const SIGNING_KEY_SLOT: &str = "device-signing-key";

impl SigningKeyStorage {
    pub fn load() -> Result<Option<grindr::DeviceSigningKey>, AppError> {
        match get_slot_bytes(SIGNING_KEY_SLOT)? {
            Some(bytes) => Ok(rmp_serde::decode::from_slice(&bytes).ok()),
            None => Ok(None),
        }
    }

    pub fn save(key: &grindr::DeviceSigningKey) -> Result<(), AppError> {
        let bytes = rmp_serde::encode::to_vec(key)
            .map_err(|e| AppError::Auth(format!("signing key encode failed: {e}")))?;
        set_slot_bytes(SIGNING_KEY_SLOT, &bytes)
    }

    pub fn delete() {
        let _ = clear_slot(SIGNING_KEY_SLOT);
    }
}

// ---------------------------------------------------------------------------
// Multi-account support — saved accounts you can switch between without
// re-entering a password. Each slot now holds both the account's Session
// *and* its own DeviceInfo (unlike the single-device model the transport
// crate itself uses), so switching accounts also switches device identity —
// keeping accounts un-correlatable from each other, matching the behavior
// this app already had before the transport swap.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAccountMeta {
    pub profile_id: String,
    pub email: String,
    pub last_used_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavedAccount {
    session: grindr::Session,
    device: grindr::DeviceInfo,
}

const ACCOUNT_INDEX_SLOT: &str = "account-index";

fn account_slot(profile_id: &str) -> String {
    format!("session-{profile_id}")
}

impl AuthStorage {
    fn read_account_index() -> Result<Vec<SavedAccountMeta>, AppError> {
        match get_slot_bytes(ACCOUNT_INDEX_SLOT)? {
            Some(bytes) => {
                rmp_serde::decode::from_slice(&bytes).map_err(|e| AppError::Auth(e.to_string()))
            }
            None => Ok(Vec::new()),
        }
    }

    fn write_account_index(index: &[SavedAccountMeta]) -> Result<(), AppError> {
        let bytes = rmp_serde::encode::to_vec(index).map_err(|e| AppError::Auth(e.to_string()))?;
        set_slot_bytes(ACCOUNT_INDEX_SLOT, &bytes)
    }

    /// Upserts this session (and its device identity) into the saved-accounts
    /// store, keyed by profile id — called on every successful login/refresh
    /// so accounts automatically show up in the switcher with no separate
    /// "save" step.
    pub fn save_account(session: &grindr::Session, device: &grindr::DeviceInfo) -> Result<(), AppError> {
        let slot = account_slot(&session.profile_id);
        let saved = SavedAccount {
            session: session.clone(),
            device: device.clone(),
        };
        let bytes = rmp_serde::encode::to_vec(&saved).map_err(|e| AppError::Auth(e.to_string()))?;
        set_slot_bytes(&slot, &bytes)?;

        let mut index = Self::read_account_index()?;
        let now = chrono::Utc::now().timestamp() as u64;
        if let Some(existing) = index
            .iter_mut()
            .find(|account| account.profile_id == session.profile_id)
        {
            existing.email = session.email.clone();
            existing.last_used_at = now;
        } else {
            index.push(SavedAccountMeta {
                profile_id: session.profile_id.clone(),
                email: session.email.clone(),
                last_used_at: now,
            });
        }
        Self::write_account_index(&index)
    }

    pub fn get_account(profile_id: &str) -> Result<Option<(grindr::Session, grindr::DeviceInfo)>, AppError> {
        let slot = account_slot(profile_id);
        match get_slot_bytes(&slot)? {
            Some(bytes) => match rmp_serde::decode::from_slice::<SavedAccount>(&bytes) {
                Ok(saved) => Ok(Some((saved.session, saved.device))),
                // Pre-migration slots stored a flat legacy Session directly
                // (no separate device wrapper) — same shape AuthStorage's
                // single active slot used to store.
                Err(_decode_error) => Ok(migrate_legacy_session(&bytes)),
            },
            None => Ok(None),
        }
    }

    pub fn list_saved_accounts() -> Result<Vec<SavedAccountMeta>, AppError> {
        let mut accounts = Self::read_account_index()?;
        accounts.sort_by(|a, b| b.last_used_at.cmp(&a.last_used_at));
        Ok(accounts)
    }

    pub fn remove_saved_account(profile_id: &str) -> Result<(), AppError> {
        let slot = account_slot(profile_id);
        clear_slot(&slot)?;
        let mut index = Self::read_account_index()?;
        index.retain(|account| account.profile_id != profile_id);
        Self::write_account_index(&index)
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// (Re)spawns the background tasks bound to `client`: persisting session and
/// signing-key changes to storage, and saving newly-authenticated accounts
/// into the switcher. Called at startup and after every client swap
/// (`switch_account`, `login_with_jwt`'s exchange).
fn spawn_persistence_tasks(app: &tauri::AppHandle, client: grindr::GrindrClient) {
    use tauri::Manager;
    let state = app.state::<AppState>();

    {
        let client = client.clone();
        let mut session_rx = client.session_receiver();
        let handle = tauri::async_runtime::spawn(async move {
            while session_rx.changed().await.is_ok() {
                // Cloned into an owned value *before* the match so the
                // `watch::Ref` guard (not `Send`) is dropped at the end of
                // this `let`, not held across the `.await` calls below —
                // `match session_rx.borrow().clone() { .. }` would otherwise
                // keep the guard alive for the whole match (matches' scrutinee
                // temporaries live until the match ends).
                let current = session_rx.borrow().clone();
                match current {
                    Some(session) => {
                        let device = client.current_device().await;
                        if let Err(e) = AuthStorage::set_session(&session) {
                            eprintln!("[auth] failed to persist session: {e}");
                        }
                        if let Err(e) = DeviceStorage::save(&device) {
                            eprintln!("[auth] failed to persist device: {e}");
                        }
                        if let Err(e) = AuthStorage::save_account(&session, &device) {
                            eprintln!("[auth] failed to register account in switcher: {e}");
                        }
                    }
                    None => {
                        let _ = AuthStorage::clear_session();
                    }
                }
            }
        });
        state.add_task(handle);
    }

    {
        // Restore a previously-registered signing key for this device before
        // entering the watch loop, so uploads reuse it instead of
        // re-registering a new one every launch.
        let client_for_signing = client.clone();
        let mut key_rx = client.signing_key_receiver();
        let handle = tauri::async_runtime::spawn(async move {
            if let Ok(Some(key)) = SigningKeyStorage::load() {
                client_for_signing.restore_signing_key(key).await;
            }
            while key_rx.changed().await.is_ok() {
                match key_rx.borrow().clone() {
                    Some(key) => {
                        if let Err(e) = SigningKeyStorage::save(&key) {
                            eprintln!("[signing] failed to persist signing key: {e}");
                        }
                    }
                    None => SigningKeyStorage::delete(),
                }
            }
        });
        state.add_task(handle);
    }
}

/// Swaps in a freshly-built client (new device+session) and respawns the
/// persistence and websocket-bridge tasks against it. Closes out whatever
/// client was previously active first — `logout()` only clears local state
/// (no server call), but it does close a live websocket, so the outgoing
/// client doesn't keep an orphaned socket open after being swapped out. That
/// close happens in a spawned task rather than being awaited here, so this
/// function itself stays synchronous and callable from Tauri's `.setup()`.
pub fn adopt_client(
    app: &tauri::AppHandle,
    device: Option<grindr::DeviceInfo>,
    session: Option<grindr::Session>,
) -> Result<grindr::GrindrClient, AppError> {
    use tauri::Manager;

    let client = super::client::build_client(device, session)?;
    let state = app.state::<AppState>();
    if let Some(old_client) = state.set_client(client.clone()) {
        tauri::async_runtime::spawn(async move {
            old_client.logout().await;
        });
    }

    spawn_persistence_tasks(app, client.clone());
    super::websocket::spawn_bridge(app, client.clone());

    Ok(client)
}

#[tauri::command]
pub async fn login(
    state: tauri::State<'_, AppState>,
    email: String,
    password: String,
) -> Result<LoginResult, AppError> {
    let client = state.client()?;

    // A fresh device identity per login attempt (including re-logins to the
    // same account) so logins can't be correlated with each other.
    let device = grindr::DeviceInfo::generate();
    client.rotate_device(device).await.map_err(AppError::from)?;

    let result = client
        .login(&email, &password)
        .await
        .map_err(|e| AppError::from_client_error(e, &client))?;
    Ok(LoginResult::from(result))
}

#[tauri::command]
pub async fn login_with_jwt(app: tauri::AppHandle, token: String) -> Result<LoginResult, AppError> {
    let claims = jsonwebtoken::dangerous::insecure_decode::<serde_json::Value>(&token)
        .map_err(|e| AppError::Auth(format!("JWT decode failed: {e}")))?
        .claims;
    let exp = claims
        .get("exp")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| AppError::Auth("JWT missing exp claim".to_owned()))?;
    let profile_id = claims
        .get("profile_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Auth("JWT missing profile_id claim".to_owned()))?
        .to_owned();

    let session: grindr::Session = serde_json::from_value(serde_json::json!({
        "email": "",
        "expires_at": exp,
        "profile_id": profile_id,
        "session_id": token,
        "auth_token": "",
    }))?;
    let device = grindr::DeviceInfo::generate();

    // Persist immediately (not just on the exchange's success below) so a
    // JWT-only session survives a restart within its own ~15-30 min expiry,
    // same as before the transport swap.
    AuthStorage::set_session(&session)?;
    DeviceStorage::save(&device)?;

    let client = adopt_client(&app, Some(device), Some(session))?;

    // Try to exchange the JWT for a full session (sessionId + authToken) so
    // subsequent refreshes work the same way as email/password login. If the
    // exchange fails, the JWT-only session set above stays active and works
    // until the JWT itself expires.
    let result = match client.refresh_token().await {
        Ok(result) => LoginResult::from(result),
        Err(_exchange_error) => LoginResult {
            profile_id,
            restriction: None,
        },
    };

    Ok(result)
}

#[tauri::command]
pub async fn refresh_token(state: tauri::State<'_, AppState>) -> Result<LoginResult, AppError> {
    let client = state.client()?;
    let session_before = client.session_receiver().borrow().clone();
    match client.refresh_token().await {
        Ok(result) => Ok(LoginResult::from(result)),
        Err(grindr::GrindrError::Unauthorized { .. })
            if session_before.as_ref().is_some_and(|s| s.auth_token.is_empty()) =>
        {
            // JWT-only fallback session (see login_with_jwt) whose own JWT has
            // now expired — there is nothing left to refresh with.
            Err(AppError::TokenExpired)
        }
        Err(e) => Err(AppError::from_client_error(e, &client)),
    }
}

#[tauri::command]
pub async fn logout(app: tauri::AppHandle) -> Result<(), AppError> {
    AuthStorage::clear_session()?;

    // Rotate the device identity so the next login on this "active" slot
    // can't be correlated with the one that just signed out. adopt_client
    // closes out the outgoing client (clears its session/signing key,
    // closes its websocket) before swapping.
    let new_device = grindr::DeviceInfo::generate();
    let _ = DeviceStorage::save(&new_device);
    adopt_client(&app, Some(new_device), None)?;

    Ok(())
}

#[tauri::command]
pub async fn auth_state(state: tauri::State<'_, AppState>) -> Result<Option<u64>, AppError> {
    let Ok(client) = state.client() else {
        return Ok(None);
    };
    Ok(client
        .session_receiver()
        .borrow()
        .as_ref()
        .and_then(|s| s.profile_id.parse::<u64>().ok()))
}

/// The active session's restriction (age verification, timed ban, ...), if
/// any — the session itself is still valid, this is informational for the
/// frontend to gate on. Distinct from `AppError::Banned`, which is a hard
/// login/refresh rejection.
#[tauri::command]
pub async fn account_restriction(state: tauri::State<'_, AppState>) -> Result<Option<Restriction>, AppError> {
    let Ok(client) = state.client() else {
        return Ok(None);
    };
    Ok(client
        .session_receiver()
        .borrow()
        .as_ref()
        .and_then(|s| s.restriction.clone())
        .map(Restriction::from))
}

#[tauri::command]
pub async fn list_saved_accounts() -> Result<Vec<SavedAccountMeta>, AppError> {
    AuthStorage::list_saved_accounts()
}

#[tauri::command]
pub async fn switch_account(app: tauri::AppHandle, profile_id: String) -> Result<LoginResult, AppError> {
    let (session, device) = AuthStorage::get_account(&profile_id)?
        .ok_or_else(|| AppError::Auth("No saved session for this account".to_owned()))?;

    let profile_id = session.profile_id.clone();
    let restriction = session.restriction.clone();

    AuthStorage::set_session(&session)?;
    let _ = DeviceStorage::save(&device);
    adopt_client(&app, Some(device), Some(session))?;

    Ok(LoginResult {
        profile_id,
        restriction: restriction.map(Restriction::from),
    })
}

#[tauri::command]
pub async fn remove_saved_account(profile_id: String) -> Result<(), AppError> {
    AuthStorage::remove_saved_account(&profile_id)
}

#[tauri::command]
pub async fn websocket_token(state: tauri::State<'_, AppState>) -> Result<Option<String>, AppError> {
    let client = state.client()?;

    let needs_refresh = {
        let session = client.session_receiver().borrow().clone();
        let expires_at = session.as_ref().map(|s| s.expires_at).unwrap_or(0);
        expires_at > 0 && expires_at < (chrono::Utc::now().timestamp() as u64 + 60)
    };

    if needs_refresh {
        if let Err(grindr::GrindrError::Unauthorized { .. }) = client.refresh_token().await {
            return Err(AppError::TokenExpired);
        }
    }

    Ok(client
        .session_receiver()
        .borrow()
        .as_ref()
        .map(|s| s.session_id.clone()))
}

#[tauri::command]
pub async fn sync_push_token(state: tauri::State<'_, AppState>, token: String) -> Result<(), AppError> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return Err(AppError::Api {
            code: 400,
            message: "Push token is empty".to_owned(),
        });
    }

    let identifier = trimmed.split(':').next().unwrap_or(trimmed).to_owned();
    let payload = serde_json::json!({
        "vendorProvidedIdentifier": identifier,
        "token": trimmed,
    });
    let body = serde_json::to_vec(&payload)
        .map_err(|e| AppError::Http(format!("Failed to serialize push token payload: {e}")))?;

    let client = state.client()?;
    let response = client
        .request_authenticated_bytes(grindr::Method::POST, "/v3/gcm-push-tokens", "application/json", body)
        .await
        .map_err(|e| AppError::from_client_error(e, &client))?;

    if (200..300).contains(&response.status) {
        Ok(())
    } else {
        Err(AppError::from(grindr::GrindrError::from_response(
            response.status,
            &response.body,
        )))
    }
}
