#[cfg(not(any(target_os = "windows", all(target_os = "macos", debug_assertions))))]
use keyring_core::Entry;
use serde::{Deserialize, Serialize};
#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};

use crate::error::AppError;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Persisted session format
//
// `grindr::Session` isn't serializable — only its durable `Credentials` half
// is. The short-lived token is stored next to it anyway: a resumed session
// then keeps its restriction from the first moment (instead of only after the
// first refresh), and a JWT-only login (no refreshable auth token) survives a
// restart within the JWT's own lifetime, as it did before the transport swap.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
struct StoredToken {
    session_id: String,
    expires_at: u64,
    #[serde(default)]
    restriction: Option<grindr::Restriction>,
}

#[derive(Serialize, Deserialize)]
struct StoredSession {
    credentials: grindr::Credentials,
    #[serde(default)]
    token: Option<StoredToken>,
}

impl From<&grindr::Session> for StoredSession {
    fn from(session: &grindr::Session) -> Self {
        Self {
            credentials: session.credentials.clone(),
            token: session.token.as_ref().map(|token| StoredToken {
                session_id: token.session_id.clone(),
                expires_at: token.expires_at,
                restriction: token.restriction.clone(),
            }),
        }
    }
}

impl From<StoredSession> for grindr::Session {
    fn from(stored: StoredSession) -> Self {
        Self {
            credentials: stored.credentials,
            token: stored.token.map(|token| grindr::SessionToken {
                session_id: token.session_id,
                expires_at: token.expires_at,
                restriction: token.restriction,
            }),
        }
    }
}

/// `grindr::Session` as grindr.rs 0.8 serialized it (positional msgpack).
#[derive(Deserialize)]
struct V08Session {
    email: String,
    expires_at: u64,
    profile_id: String,
    session_id: String,
    auth_token: String,
    #[serde(default)]
    kind: grindr::SessionKind,
    #[serde(default)]
    third_party_user_id: Option<String>,
    #[serde(default)]
    restriction: Option<grindr::Restriction>,
}

impl From<V08Session> for grindr::Session {
    fn from(old: V08Session) -> Self {
        Self {
            credentials: grindr::Credentials {
                email: old.email,
                profile_id: Some(old.profile_id),
                auth_token: old.auth_token,
                kind: old.kind,
                third_party_user_id: old.third_party_user_id,
            },
            token: Some(grindr::SessionToken {
                session_id: old.session_id,
                expires_at: old.expires_at,
                restriction: old.restriction,
            }),
        }
    }
}

/// The session as this app stored it before grindr.rs, with the device ids
/// inlined (they now live in a separate `grindr::DeviceInfo`).
#[derive(Deserialize)]
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
    let legacy: LegacySession = rmp_serde::from_slice(bytes).ok()?;

    let session = grindr::Session {
        credentials: grindr::Credentials {
            email: legacy.email,
            profile_id: Some(legacy.profile_id),
            auth_token: legacy.auth_token,
            kind: grindr::SessionKind::Email,
            third_party_user_id: None,
        },
        token: Some(grindr::SessionToken {
            session_id: legacy.session_id,
            expires_at: legacy.expires_at,
            restriction: None,
        }),
    };

    // Keep the device ids the account has been seen with; the rest of the
    // fingerprint is filled in from a fresh, consistent profile.
    let mut device = grindr::DeviceInfo::generate();
    device.device_id = legacy.device_id;
    device.advertising_id = legacy.advertising_id;

    Some((session, device))
}

struct DecodedSession {
    session: grindr::Session,
    /// Only set for the pre-grindr.rs format, which carried the device ids.
    device: Option<grindr::DeviceInfo>,
    /// Decoded from an older format, so it should be re-saved in the new one.
    migrated: bool,
}

fn decode_session(bytes: &[u8]) -> Option<DecodedSession> {
    if let Ok(stored) = rmp_serde::from_slice::<StoredSession>(bytes) {
        return Some(DecodedSession {
            session: stored.into(),
            device: None,
            migrated: false,
        });
    }
    if let Ok(old) = rmp_serde::from_slice::<V08Session>(bytes) {
        return Some(DecodedSession {
            session: old.into(),
            device: None,
            migrated: true,
        });
    }
    let (session, device) = migrate_legacy_session(bytes)?;
    Some(DecodedSession {
        session,
        device: Some(device),
        migrated: true,
    })
}

fn encode_session(session: &grindr::Session) -> Result<Vec<u8>, AppError> {
    rmp_serde::encode::to_vec_named(&StoredSession::from(session))
        .map_err(|e| AppError::Auth(format!("session encode failed: {e}")))
}

// ---------------------------------------------------------------------------
// Frontend-facing auth types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResult {
    pub profile_id: String,
    pub restriction: Option<Restriction>,
}

impl From<grindr::SignInResult> for LoginResult {
    fn from(r: grindr::SignInResult) -> Self {
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
    /// Unix seconds a timed ban ends at, when Grindr says.
    pub expires_at: Option<i64>,
    /// A timed ban's sub-category (Grindr's BanSubReason).
    pub sub_reason: Option<String>,
    /// Whether a timed ban was issued automatically.
    pub automated: Option<bool>,
}

impl Restriction {
    fn simple(kind: &str, region: Option<String>, reason: Option<String>) -> Self {
        Self {
            kind: kind.to_owned(),
            region,
            reason,
            expires_at: None,
            sub_reason: None,
            automated: None,
        }
    }
}

impl From<grindr::Restriction> for Restriction {
    fn from(r: grindr::Restriction) -> Self {
        match r {
            grindr::Restriction::AgeVerification { region, reason } => {
                Self::simple("ageVerification", Some(region_str(region).to_owned()), Some(reason))
            }
            grindr::Restriction::TimedBan(details) => Self {
                kind: "timedBan".to_owned(),
                region: None,
                reason: details.reason,
                expires_at: details.expiry_time,
                sub_reason: details.sub_reason,
                automated: Some(details.is_automated),
            },
            grindr::Restriction::TrustVendorRejected => Self::simple("trustVendorRejected", None, None),
            grindr::Restriction::Other(raw) => Self::simple("other", None, Some(raw)),
            _ => Self::simple("other", None, None),
        }
    }
}

fn region_str(region: grindr::VerificationRegion) -> &'static str {
    match region {
        grindr::VerificationRegion::Uk => "uk",
        grindr::VerificationRegion::Br => "br",
        grindr::VerificationRegion::Au => "au",
        grindr::VerificationRegion::Us => "us",
        _ => "other",
    }
}

// ---------------------------------------------------------------------------
// Session JWT decoding — only needed for `login_with_jwt`, where the session
// is built here rather than by grindr.rs. Mirrors grindr.rs's own claim
// handling; the signature isn't verified (the client doesn't hold the key and
// the claims only decide when to refresh / what to show).
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JwtClaims {
    exp: u64,
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    restriction: Option<String>,
    #[serde(default)]
    restriction_reason: Option<String>,
    #[serde(default)]
    ban_details: Option<grindr::BanDetails>,
}

fn decode_jwt(token: &str) -> Result<JwtClaims, AppError> {
    jsonwebtoken::dangerous::insecure_decode::<JwtClaims>(token)
        .map(|data| data.claims)
        .map_err(|e| AppError::Auth(format!("JWT decode failed: {e}")))
}

fn restriction_from_claims(claims: &JwtClaims) -> Option<grindr::Restriction> {
    let restriction = claims.restriction.as_deref()?;
    Some(match restriction {
        "AGE_RESTRICTED" => grindr::Restriction::AgeVerification {
            region: match claims.restriction_reason.as_deref() {
                Some("UK_VERIFICATION_REQUIRED") => grindr::VerificationRegion::Uk,
                Some("BR_VERIFICATION_REQUIRED") => grindr::VerificationRegion::Br,
                Some("AU_VERIFICATION_REQUIRED") => grindr::VerificationRegion::Au,
                Some("US_VERIFICATION_REQUIRED") => grindr::VerificationRegion::Us,
                _ => grindr::VerificationRegion::Other,
            },
            reason: claims.restriction_reason.clone().unwrap_or_default(),
        },
        "TIMED_BAN" => {
            grindr::Restriction::TimedBan(claims.ban_details.clone().unwrap_or_default())
        }
        "TRUST_VENDOR_REJECTED" => grindr::Restriction::TrustVendorRejected,
        other => grindr::Restriction::Other(other.to_owned()),
    })
}

fn token_from_jwt(jwt: &str, claims: &JwtClaims) -> grindr::SessionToken {
    grindr::SessionToken {
        session_id: jwt.to_owned(),
        expires_at: claims.exp,
        restriction: restriction_from_claims(claims),
    }
}

// ---------------------------------------------------------------------------
// Platform storage primitives — byte I/O only; formats are handled above.
//
// The single "active" session slot keeps its historical locations: a file per
// Windows instance, a dev file on macOS debug builds, and the OS keyring
// elsewhere (with a file fallback on macOS release, where some setups can't
// use the keychain). Everything else (device, signing keys, saved accounts)
// uses the generic slots below, which deliberately skip that macOS fallback:
// a failure there is logged and non-fatal rather than silently downgraded to
// a less secure file.
// ---------------------------------------------------------------------------

const SERVICE: &str = "free-grind";
const ACTIVE_SESSION_SLOT: &str = "session";

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn read_file(path: &Path) -> Result<Option<Vec<u8>>, AppError> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(AppError::Auth(format!(
            "Failed to read {}: {error}",
            path.display()
        ))),
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn write_file(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            AppError::Auth(format!(
                "Failed to create directory {}: {error}",
                parent.display()
            ))
        })?;
    }
    std::fs::write(path, bytes).map_err(|error| {
        AppError::Auth(format!("Failed to write {}: {error}", path.display()))
    })?;

    #[cfg(target_family = "unix")]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }

    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn remove_file(path: &Path) -> Result<(), AppError> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError::Auth(format!(
            "Failed to remove {}: {error}",
            path.display()
        ))),
    }
}

#[cfg(target_os = "macos")]
fn app_support_file(name: &str) -> Result<PathBuf, AppError> {
    let home = std::env::var("HOME")
        .map_err(|_| AppError::Auth("HOME is not set; cannot resolve storage path".to_owned()))?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("free-grind")
        .join(name))
}

// --- generic slots ---

#[cfg(target_os = "windows")]
fn slot_path(slot: &str) -> Result<PathBuf, AppError> {
    Ok(crate::windows_instance::WindowsInstance::current()
        .data_root()
        .join(format!("{slot}.msgpack")))
}

#[cfg(all(target_os = "macos", debug_assertions))]
fn slot_path(slot: &str) -> Result<PathBuf, AppError> {
    app_support_file(&format!("{slot}.msgpack"))
}

#[cfg(any(target_os = "windows", all(target_os = "macos", debug_assertions)))]
fn get_slot_bytes(slot: &str) -> Result<Option<Vec<u8>>, AppError> {
    read_file(&slot_path(slot)?)
}

#[cfg(any(target_os = "windows", all(target_os = "macos", debug_assertions)))]
fn set_slot_bytes(slot: &str, bytes: &[u8]) -> Result<(), AppError> {
    write_file(&slot_path(slot)?, bytes)
}

#[cfg(any(target_os = "windows", all(target_os = "macos", debug_assertions)))]
fn clear_slot(slot: &str) -> Result<(), AppError> {
    remove_file(&slot_path(slot)?)
}

#[cfg(not(any(target_os = "windows", all(target_os = "macos", debug_assertions))))]
fn get_slot_bytes(slot: &str) -> Result<Option<Vec<u8>>, AppError> {
    let entry = Entry::new(SERVICE, slot).map_err(|e| AppError::Auth(e.to_string()))?;
    match entry.get_secret() {
        Ok(bytes) => Ok(Some(bytes)),
        Err(keyring_core::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Auth(e.to_string())),
    }
}

#[cfg(not(any(target_os = "windows", all(target_os = "macos", debug_assertions))))]
fn set_slot_bytes(slot: &str, bytes: &[u8]) -> Result<(), AppError> {
    let entry = Entry::new(SERVICE, slot).map_err(|e| AppError::Auth(e.to_string()))?;
    entry
        .set_secret(bytes)
        .map_err(|e| AppError::Auth(e.to_string()))
}

#[cfg(not(any(target_os = "windows", all(target_os = "macos", debug_assertions))))]
fn clear_slot(slot: &str) -> Result<(), AppError> {
    let entry = Entry::new(SERVICE, slot).map_err(|e| AppError::Auth(e.to_string()))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Auth(e.to_string())),
    }
}

// --- the active session slot ---

#[cfg(target_os = "windows")]
fn active_session_path() -> Result<PathBuf, AppError> {
    Ok(crate::windows_instance::WindowsInstance::current().session_file_path())
}

#[cfg(all(target_os = "macos", debug_assertions))]
fn active_session_path() -> Result<PathBuf, AppError> {
    app_support_file("dev-session.msgpack")
}

#[cfg(any(target_os = "windows", all(target_os = "macos", debug_assertions)))]
fn read_active() -> Result<Option<Vec<u8>>, AppError> {
    read_file(&active_session_path()?)
}

#[cfg(any(target_os = "windows", all(target_os = "macos", debug_assertions)))]
fn write_active(bytes: &[u8]) -> Result<(), AppError> {
    write_file(&active_session_path()?, bytes)
}

#[cfg(any(target_os = "windows", all(target_os = "macos", debug_assertions)))]
fn clear_active() -> Result<(), AppError> {
    remove_file(&active_session_path()?)
}

#[cfg(all(target_os = "macos", not(debug_assertions)))]
fn macos_fallback_path() -> Result<PathBuf, AppError> {
    app_support_file("session-fallback.msgpack")
}

#[cfg(not(any(target_os = "windows", all(target_os = "macos", debug_assertions))))]
fn read_active() -> Result<Option<Vec<u8>>, AppError> {
    let keyring = get_slot_bytes(ACTIVE_SESSION_SLOT);
    #[cfg(target_os = "macos")]
    if !matches!(keyring, Ok(Some(_))) {
        return read_file(&macos_fallback_path()?);
    }
    keyring
}

#[cfg(not(any(target_os = "windows", all(target_os = "macos", debug_assertions))))]
fn write_active(bytes: &[u8]) -> Result<(), AppError> {
    let keyring = set_slot_bytes(ACTIVE_SESSION_SLOT, bytes);
    #[cfg(target_os = "macos")]
    let keyring = match keyring {
        Ok(()) => {
            let _ = remove_file(&macos_fallback_path()?);
            Ok(())
        }
        Err(_) => write_file(&macos_fallback_path()?, bytes),
    };
    keyring
}

#[cfg(not(any(target_os = "windows", all(target_os = "macos", debug_assertions))))]
fn clear_active() -> Result<(), AppError> {
    let keyring = clear_slot(ACTIVE_SESSION_SLOT);
    #[cfg(target_os = "macos")]
    let keyring = {
        let _ = keyring;
        remove_file(&macos_fallback_path()?)
    };
    keyring
}

// ---------------------------------------------------------------------------
// Storage APIs
// ---------------------------------------------------------------------------

pub struct AuthStorage;

impl AuthStorage {
    pub fn get_session() -> Result<Option<grindr::Session>, AppError> {
        let Some(bytes) = read_active()? else {
            return Ok(None);
        };
        let decoded = decode_session(&bytes)
            .ok_or_else(|| AppError::Auth("stored session could not be decoded".to_owned()))?;
        if decoded.migrated {
            let _ = Self::set_session(&decoded.session);
            if let Some(device) = &decoded.device {
                let _ = DeviceStorage::save(device);
            }
        }
        Ok(Some(decoded.session))
    }

    pub fn set_session(session: &grindr::Session) -> Result<(), AppError> {
        write_active(&encode_session(session)?)
    }

    pub fn clear_session() -> Result<(), AppError> {
        clear_active()
    }
}

pub struct DeviceStorage;

const ACTIVE_DEVICE_SLOT: &str = "device-info";

impl DeviceStorage {
    /// Devices saved before grindr.rs added `build_id` still load; it stays
    /// empty, which only affects the media-proxy User-Agent this app doesn't use.
    pub fn load() -> Result<Option<grindr::DeviceInfo>, AppError> {
        match get_slot_bytes(ACTIVE_DEVICE_SLOT)? {
            Some(bytes) => rmp_serde::from_slice(&bytes)
                .map(Some)
                .map_err(|e| AppError::Auth(format!("device decode failed: {e}"))),
            None => Ok(None),
        }
    }

    pub fn save(device: &grindr::DeviceInfo) -> Result<(), AppError> {
        let bytes = rmp_serde::encode::to_vec_named(device)
            .map_err(|e| AppError::Auth(format!("device encode failed: {e}")))?;
        set_slot_bytes(ACTIVE_DEVICE_SLOT, &bytes)
    }
}

/// Device signing keys, one per account: grindr.rs refuses to restore a key
/// that belongs to a different account than the session's, so a single slot
/// would lose each account's key on every switch.
pub struct SigningKeyStorage;

impl SigningKeyStorage {
    fn slot(profile_id: &str) -> String {
        format!("device-signing-key-{profile_id}")
    }

    pub fn load(profile_id: &str) -> Option<grindr::DeviceSigningKey> {
        let bytes = get_slot_bytes(&Self::slot(profile_id)).ok()??;
        rmp_serde::from_slice(&bytes).ok()
    }

    pub fn save(profile_id: &str, key: &grindr::DeviceSigningKey) -> Result<(), AppError> {
        let bytes = rmp_serde::encode::to_vec_named(key)
            .map_err(|e| AppError::Auth(format!("signing key encode failed: {e}")))?;
        set_slot_bytes(&Self::slot(profile_id), &bytes)
    }

    pub fn delete(profile_id: &str) {
        let _ = clear_slot(&Self::slot(profile_id));
    }

    /// The single, account-less slot used before keys were scoped per account.
    pub fn forget_unscoped() {
        let _ = clear_slot("device-signing-key");
    }
}

// ---------------------------------------------------------------------------
// Multi-account support — saved accounts you can switch between without
// re-entering a password. Each slot holds the account's session *and* its own
// device identity, so switching accounts also switches device and accounts
// stay un-correlatable from each other.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAccountMeta {
    pub profile_id: String,
    pub email: String,
    pub last_used_at: u64,
}

#[derive(Serialize, Deserialize)]
struct SavedAccount {
    session: StoredSession,
    device: grindr::DeviceInfo,
}

/// A saved account as stored with grindr.rs 0.8.
#[derive(Deserialize)]
struct V08SavedAccount {
    session: V08Session,
    device: grindr::DeviceInfo,
}

fn decode_account(bytes: &[u8]) -> Option<(grindr::Session, grindr::DeviceInfo)> {
    if let Ok(saved) = rmp_serde::from_slice::<SavedAccount>(bytes) {
        return Some((saved.session.into(), saved.device));
    }
    if let Ok(saved) = rmp_serde::from_slice::<V08SavedAccount>(bytes) {
        return Some((saved.session.into(), saved.device));
    }
    // Before grindr.rs, slots held the flat legacy session directly.
    migrate_legacy_session(bytes)
}

const ACCOUNT_INDEX_SLOT: &str = "account-index";

fn account_slot(profile_id: &str) -> String {
    format!("session-{profile_id}")
}

impl AuthStorage {
    fn read_account_index() -> Result<Vec<SavedAccountMeta>, AppError> {
        match get_slot_bytes(ACCOUNT_INDEX_SLOT)? {
            Some(bytes) => rmp_serde::from_slice(&bytes).map_err(|e| AppError::Auth(e.to_string())),
            None => Ok(Vec::new()),
        }
    }

    fn write_account_index(index: &[SavedAccountMeta]) -> Result<(), AppError> {
        let bytes =
            rmp_serde::encode::to_vec_named(index).map_err(|e| AppError::Auth(e.to_string()))?;
        set_slot_bytes(ACCOUNT_INDEX_SLOT, &bytes)
    }

    /// Upserts this session (and its device identity) into the saved-accounts
    /// store, keyed by profile id — called on every session change so
    /// accounts show up in the switcher with no separate "save" step.
    pub fn save_account(session: &grindr::Session, device: &grindr::DeviceInfo) -> Result<(), AppError> {
        let Some(profile_id) = session.credentials.profile_id.clone() else {
            return Ok(());
        };
        let saved = SavedAccount {
            session: StoredSession::from(session),
            device: device.clone(),
        };
        let bytes =
            rmp_serde::encode::to_vec_named(&saved).map_err(|e| AppError::Auth(e.to_string()))?;
        set_slot_bytes(&account_slot(&profile_id), &bytes)?;

        let email = session.credentials.email.clone();
        let mut index = Self::read_account_index()?;
        let now = chrono::Utc::now().timestamp() as u64;
        if let Some(existing) = index.iter_mut().find(|account| account.profile_id == profile_id) {
            existing.email = email;
            existing.last_used_at = now;
        } else {
            index.push(SavedAccountMeta {
                profile_id,
                email,
                last_used_at: now,
            });
        }
        Self::write_account_index(&index)
    }

    pub fn get_account(profile_id: &str) -> Result<Option<(grindr::Session, grindr::DeviceInfo)>, AppError> {
        Ok(get_slot_bytes(&account_slot(profile_id))?.and_then(|bytes| decode_account(&bytes)))
    }

    pub fn list_saved_accounts() -> Result<Vec<SavedAccountMeta>, AppError> {
        let mut accounts = Self::read_account_index()?;
        accounts.sort_by(|a, b| b.last_used_at.cmp(&a.last_used_at));
        Ok(accounts)
    }

    pub fn remove_saved_account(profile_id: &str) -> Result<(), AppError> {
        clear_slot(&account_slot(profile_id))?;
        SigningKeyStorage::delete(profile_id);
        let mut index = Self::read_account_index()?;
        index.retain(|account| account.profile_id != profile_id);
        Self::write_account_index(&index)
    }
}

fn persist(session: &grindr::Session, device: &grindr::DeviceInfo) {
    if let Err(e) = AuthStorage::set_session(session) {
        eprintln!("[auth] failed to persist session: {e}");
    }
    if let Err(e) = DeviceStorage::save(device) {
        eprintln!("[auth] failed to persist device: {e}");
    }
    if let Err(e) = AuthStorage::save_account(session, device) {
        eprintln!("[auth] failed to register account in switcher: {e}");
    }
}

fn session_profile_id(client: &grindr::GrindrClient) -> Option<String> {
    client
        .session_receiver()
        .borrow()
        .as_ref()?
        .credentials
        .profile_id
        .clone()
}

fn session_restriction(session: Option<&grindr::Session>) -> Option<grindr::Restriction> {
    session?.token.as_ref()?.restriction.clone()
}

/// A session's restriction as the frontend gets it. grindr.rs keeps no reason
/// for `TRUST_VENDOR_REJECTED`, whose `restrictionReason` is free-form text,
/// so that one is read back out of the session JWT.
fn frontend_restriction(session: Option<&grindr::Session>) -> Option<Restriction> {
    let token = session?.token.as_ref()?;
    let mut restriction = Restriction::from(token.restriction.clone()?);
    if restriction.kind == "trustVendorRejected" {
        restriction.reason = decode_jwt(&token.session_id)
            .ok()
            .and_then(|claims| claims.restriction_reason);
    }
    Some(restriction)
}

/// A sign-in/refresh result with the restriction taken from the session it
/// produced, so it carries the details `frontend_restriction` adds.
fn login_result(client: &grindr::GrindrClient, result: grindr::SignInResult) -> LoginResult {
    let mut login = LoginResult::from(result);
    if let Some(restriction) = frontend_restriction(client.session_receiver().borrow().as_ref()) {
        login.restriction = Some(restriction);
    }
    login
}

// ---------------------------------------------------------------------------
// Client lifecycle
// ---------------------------------------------------------------------------

/// (Re)spawns the background tasks bound to `client`: persisting session and
/// signing-key changes, and surfacing a restriction that only shows up on a
/// later token (sessions resume without one). Called at startup and after
/// every client swap.
fn spawn_persistence_tasks(app: &tauri::AppHandle, client: grindr::GrindrClient) {
    let state = app.state::<AppState>();

    {
        let client = client.clone();
        let app = app.clone();
        let mut session_rx = client.session_receiver();
        let mut restriction = session_restriction(session_rx.borrow().as_ref());
        let handle = tauri::async_runtime::spawn(async move {
            while session_rx.changed().await.is_ok() {
                // Cloned out before any `.await` below: the `watch::Ref` guard
                // isn't `Send` and must not live across one.
                let current = session_rx.borrow().clone();
                let Some(session) = current else {
                    let _ = AuthStorage::clear_session();
                    restriction = None;
                    continue;
                };

                let next_restriction = session_restriction(Some(&session));
                if next_restriction != restriction {
                    if let Some(r) = frontend_restriction(Some(&session)) {
                        let _ = app.emit("auth:restriction", r);
                    }
                    restriction = next_restriction;
                }

                let device = client.current_device().await;
                persist(&session, &device);
            }
        });
        state.add_task(handle);
    }

    {
        let client = client.clone();
        let mut key_rx = client.signing_key_receiver();
        let handle = tauri::async_runtime::spawn(async move {
            // Reuse the account's registered key instead of registering a new
            // one every launch; a refused key (wrong account, undecodable) is
            // dropped so it isn't offered again.
            if let Some(profile_id) = session_profile_id(&client) {
                if let Some(key) = SigningKeyStorage::load(&profile_id) {
                    if !client.restore_signing_key(key).await {
                        SigningKeyStorage::delete(&profile_id);
                    }
                }
            }
            while key_rx.changed().await.is_ok() {
                let key = key_rx.borrow().clone();
                // A cleared key (sign-out, device rotation) isn't deleted from
                // storage: the account's saved device may still match it.
                if let (Some(key), Some(profile_id)) = (key, session_profile_id(&client)) {
                    if let Err(e) = SigningKeyStorage::save(&profile_id, &key) {
                        eprintln!("[signing] failed to persist signing key: {e}");
                    }
                }
            }
        });
        state.add_task(handle);
    }
}

/// Swaps in a freshly-built client (new device+session) and respawns the
/// persistence and websocket-bridge tasks against it. The outgoing client is
/// signed out — local state only, no server call — which closes its websocket
/// so it doesn't linger after the swap; that happens in a spawned task so this
/// stays synchronous and callable from Tauri's `.setup()`.
pub fn adopt_client(
    app: &tauri::AppHandle,
    device: Option<grindr::DeviceInfo>,
    session: Option<grindr::Session>,
) -> Result<grindr::GrindrClient, AppError> {
    let client = super::client::build_client(device, session)?;
    let state = app.state::<AppState>();
    if let Some(old_client) = state.set_client(client.clone()) {
        tauri::async_runtime::spawn(async move {
            old_client.sign_out().await;
        });
    }

    spawn_persistence_tasks(app, client.clone());
    super::websocket::spawn_bridge(app, client.clone());

    Ok(client)
}

/// Builds the session for a pasted JWT: a session token from the JWT itself,
/// and the JWT doubling as the auth token — what this app always refreshed
/// such sessions with, since there is no real auth token to use.
fn jwt_only_session(jwt: &str, claims: &JwtClaims, profile_id: String) -> grindr::Session {
    grindr::Session {
        credentials: grindr::Credentials {
            email: String::new(),
            profile_id: Some(profile_id),
            auth_token: jwt.to_owned(),
            kind: grindr::SessionKind::Email,
            third_party_user_id: None,
        },
        token: Some(token_from_jwt(jwt, claims)),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeResponse {
    profile_id: String,
    session_id: String,
    auth_token: String,
}

/// Exchanges a pasted JWT for a full session (sessionId + authToken), so it
/// refreshes like an email login afterwards. Sent authenticated with the JWT
/// (`Grindr3 <JWT>`) and the JWT as the body's authToken, as this app always
/// did — grindr.rs's own refresh goes out without the Authorization header.
async fn exchange_jwt(client: &grindr::GrindrClient, jwt: &str) -> Option<grindr::Session> {
    let response = client
        .request(grindr::Method::POST, "/v8/sessions")
        .json(&serde_json::json!({
            "email": "",
            "authToken": jwt,
            "token": null,
            "geohash": null,
        }))
        .send()
        .await
        .ok()?;
    if !(200..300).contains(&response.status) {
        return None;
    }
    let exchanged: ExchangeResponse = serde_json::from_slice(&response.body).ok()?;
    let claims = decode_jwt(&exchanged.session_id).ok()?;
    Some(grindr::Session {
        credentials: grindr::Credentials {
            email: String::new(),
            profile_id: Some(exchanged.profile_id),
            auth_token: exchanged.auth_token,
            kind: grindr::SessionKind::Email,
            third_party_user_id: None,
        },
        token: Some(token_from_jwt(&exchanged.session_id, &claims)),
    })
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn login(
    state: tauri::State<'_, AppState>,
    email: String,
    password: String,
) -> Result<LoginResult, AppError> {
    let client = state.client()?;

    // A fresh device identity per login attempt (including re-logins to the
    // same account) so logins can't be correlated with each other.
    client
        .rotate_device(grindr::DeviceInfo::generate())
        .await
        .map_err(AppError::from)?;

    let result = client
        .sign_in_with_email(&email, &password)
        .await
        .map_err(|e| AppError::from_client_error(e, &client))?;

    // A key stored for this account belongs to its previous device.
    SigningKeyStorage::delete(&result.profile_id);
    Ok(login_result(&client, result))
}

#[tauri::command]
pub async fn login_with_jwt(app: tauri::AppHandle, token: String) -> Result<LoginResult, AppError> {
    let claims = decode_jwt(&token)?;
    let profile_id = claims
        .profile_id
        .clone()
        .ok_or_else(|| AppError::Auth("JWT missing profileId claim".to_owned()))?;
    let device = grindr::DeviceInfo::generate();

    // Persisted right away, not only after the exchange below, so a JWT-only
    // session survives a restart within its own lifetime.
    let jwt_only = jwt_only_session(&token, &claims, profile_id.clone());
    persist(&jwt_only, &device);
    let client = adopt_client(&app, Some(device.clone()), Some(jwt_only.clone()))?;
    SigningKeyStorage::delete(&profile_id);

    let session = match exchange_jwt(&client, &token).await {
        Some(full) => {
            persist(&full, &device);
            adopt_client(&app, Some(device), Some(full.clone()))?;
            full
        }
        None => jwt_only,
    };

    Ok(LoginResult {
        profile_id: session.credentials.profile_id.clone().unwrap_or(profile_id),
        restriction: frontend_restriction(Some(&session)),
    })
}

#[tauri::command]
pub async fn refresh_token(state: tauri::State<'_, AppState>) -> Result<LoginResult, AppError> {
    let client = state.client()?;
    match client.refresh_session().await {
        Ok(result) => Ok(login_result(&client, result)),
        // A 401 on refresh ends the session (grindr.rs clears it); surface it as
        // the expired-session prompt rather than a generic auth error.
        Err(grindr::GrindrError::Unauthorized { .. }) => Err(AppError::TokenExpired),
        Err(e) => Err(AppError::from_client_error(e, &client)),
    }
}

#[tauri::command]
pub async fn logout(app: tauri::AppHandle) -> Result<(), AppError> {
    AuthStorage::clear_session()?;

    // Rotate the device identity so the next login on this "active" slot
    // can't be correlated with the one that just signed out.
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
    Ok(session_profile_id(&client).and_then(|id| id.parse::<u64>().ok()))
}

/// The active session's restriction (age verification, timed ban, ...), if
/// any — the session itself is still valid, this is informational for the
/// frontend to gate on. Distinct from `AppError::Banned`, which is a hard
/// login/refresh rejection. A restriction that only appears on a later token
/// is pushed as `auth:restriction` instead.
#[tauri::command]
pub async fn account_restriction(state: tauri::State<'_, AppState>) -> Result<Option<Restriction>, AppError> {
    let Ok(client) = state.client() else {
        return Ok(None);
    };
    let restriction = frontend_restriction(client.session_receiver().borrow().as_ref());
    Ok(restriction)
}

#[tauri::command]
pub async fn list_saved_accounts() -> Result<Vec<SavedAccountMeta>, AppError> {
    AuthStorage::list_saved_accounts()
}

#[tauri::command]
pub async fn switch_account(app: tauri::AppHandle, profile_id: String) -> Result<LoginResult, AppError> {
    let (session, device) = AuthStorage::get_account(&profile_id)?
        .ok_or_else(|| AppError::Auth("No saved session for this account".to_owned()))?;

    let result = LoginResult {
        profile_id: session.credentials.profile_id.clone().unwrap_or(profile_id),
        restriction: frontend_restriction(Some(&session)),
    };

    AuthStorage::set_session(&session)?;
    let _ = DeviceStorage::save(&device);
    adopt_client(&app, Some(device), Some(session))?;

    Ok(result)
}

#[tauri::command]
pub async fn remove_saved_account(profile_id: String) -> Result<(), AppError> {
    AuthStorage::remove_saved_account(&profile_id)
}

#[tauri::command]
pub async fn websocket_token(state: tauri::State<'_, AppState>) -> Result<Option<String>, AppError> {
    let client = state.client()?;

    // A resumed session has no token until its first refresh.
    let needs_refresh = match client.session_receiver().borrow().as_ref() {
        None => return Ok(None),
        Some(session) => session.token.as_ref().is_none_or(|token| {
            token.expires_at < chrono::Utc::now().timestamp() as u64 + 60
        }),
    };

    if needs_refresh {
        if let Err(grindr::GrindrError::Unauthorized { .. }) = client.refresh_session().await {
            return Err(AppError::TokenExpired);
        }
    }

    Ok(client
        .session_receiver()
        .borrow()
        .as_ref()
        .and_then(|s| s.token.as_ref())
        .map(|token| token.session_id.clone()))
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

    let identifier = trimmed.split(':').next().unwrap_or(trimmed);
    let client = state.client()?;
    let response = client
        .request(grindr::Method::POST, "/v3/gcm-push-tokens")
        .json(&serde_json::json!({
            "vendorProvidedIdentifier": identifier,
            "token": trimmed,
        }))
        .send()
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

#[cfg(test)]
mod tests {
    use super::*;

    // Positional (`to_vec`) mirrors of the shapes older builds wrote.

    #[derive(Serialize)]
    struct V08SessionOut {
        email: String,
        expires_at: u64,
        profile_id: String,
        session_id: String,
        auth_token: String,
        kind: grindr::SessionKind,
        third_party_user_id: Option<String>,
        restriction: Option<grindr::Restriction>,
    }

    #[derive(Serialize)]
    struct LegacySessionOut {
        email: String,
        expires_at: u64,
        profile_id: String,
        session_id: String,
        auth_token: String,
        device_id: String,
        advertising_id: String,
    }

    #[derive(Serialize)]
    struct V08DeviceOut {
        device_type: u8,
        device_id: String,
        os: String,
        screen_resolution: String,
        total_ram: String,
        advertising_id: String,
        device_model: String,
        manufacturer: String,
        timezone: String,
        locale: String,
        accept_language: String,
    }

    fn v08_session() -> V08SessionOut {
        V08SessionOut {
            email: "user@example.com".to_owned(),
            expires_at: 9_999_999_999,
            profile_id: "42".to_owned(),
            session_id: "sid".to_owned(),
            auth_token: "atok".to_owned(),
            kind: grindr::SessionKind::Email,
            third_party_user_id: None,
            restriction: Some(grindr::Restriction::TrustVendorRejected),
        }
    }

    fn v08_device() -> V08DeviceOut {
        V08DeviceOut {
            device_type: 2,
            device_id: "0123456789abcdef".to_owned(),
            os: "Android 14".to_owned(),
            screen_resolution: "2400x1080".to_owned(),
            total_ram: "8026152960".to_owned(),
            advertising_id: "ad-id".to_owned(),
            device_model: "Pixel 8".to_owned(),
            manufacturer: "Google".to_owned(),
            timezone: "Europe/Dublin".to_owned(),
            locale: "en_US".to_owned(),
            accept_language: "en-US".to_owned(),
        }
    }

    #[test]
    fn current_format_round_trips_with_its_token() {
        let session = grindr::Session {
            credentials: grindr::Credentials {
                email: "user@example.com".to_owned(),
                profile_id: Some("42".to_owned()),
                auth_token: "atok".to_owned(),
                kind: grindr::SessionKind::Email,
                third_party_user_id: None,
            },
            token: Some(grindr::SessionToken {
                session_id: "sid".to_owned(),
                expires_at: 123,
                restriction: Some(grindr::Restriction::TrustVendorRejected),
            }),
        };

        let decoded = decode_session(&encode_session(&session).unwrap()).unwrap();
        assert!(!decoded.migrated);
        assert_eq!(decoded.session.credentials, session.credentials);
        let token = decoded.session.token.unwrap();
        assert_eq!(token.session_id, "sid");
        assert_eq!(token.expires_at, 123);
        assert_eq!(token.restriction, Some(grindr::Restriction::TrustVendorRejected));
    }

    #[test]
    fn grindr_0_8_session_migrates_with_its_token_and_restriction() {
        let bytes = rmp_serde::to_vec(&v08_session()).unwrap();
        let decoded = decode_session(&bytes).unwrap();
        assert!(decoded.migrated);
        assert!(decoded.device.is_none());
        assert_eq!(decoded.session.credentials.profile_id.as_deref(), Some("42"));
        assert_eq!(decoded.session.credentials.auth_token, "atok");
        let token = decoded.session.token.unwrap();
        assert_eq!(token.session_id, "sid");
        assert_eq!(token.restriction, Some(grindr::Restriction::TrustVendorRejected));
    }

    #[test]
    fn pre_grindr_session_migrates_and_keeps_its_device_ids() {
        let bytes = rmp_serde::to_vec(&LegacySessionOut {
            email: "user@example.com".to_owned(),
            expires_at: 9_999_999_999,
            profile_id: "42".to_owned(),
            session_id: "sid".to_owned(),
            auth_token: "atok".to_owned(),
            device_id: "0123456789abcdef".to_owned(),
            advertising_id: "ad-id".to_owned(),
        })
        .unwrap();
        let decoded = decode_session(&bytes).unwrap();
        assert!(decoded.migrated);
        assert_eq!(decoded.session.credentials.auth_token, "atok");
        let device = decoded.device.unwrap();
        assert_eq!(device.device_id, "0123456789abcdef");
        assert_eq!(device.advertising_id, "ad-id");
    }

    #[test]
    fn grindr_0_8_device_without_build_id_still_loads() {
        let bytes = rmp_serde::to_vec(&v08_device()).unwrap();
        let device: grindr::DeviceInfo = rmp_serde::from_slice(&bytes).unwrap();
        assert_eq!(device.device_id, "0123456789abcdef");
        assert!(device.build_id.is_empty());
    }

    #[test]
    fn grindr_0_8_saved_account_migrates() {
        let bytes = rmp_serde::to_vec(&(v08_session(), v08_device())).unwrap();
        let (session, device) = decode_account(&bytes).unwrap();
        assert_eq!(session.credentials.profile_id.as_deref(), Some("42"));
        assert_eq!(device.device_id, "0123456789abcdef");
    }

    #[test]
    fn timed_ban_keeps_its_reason_and_expiry_for_the_frontend() {
        let details: grindr::BanDetails = serde_json::from_value(serde_json::json!({
            "expiryTime": 1_800_000_000,
            "reason": "SPAM",
        }))
        .unwrap();
        let json = serde_json::to_value(Restriction::from(grindr::Restriction::TimedBan(details))).unwrap();
        assert_eq!(json["kind"], "timedBan");
        assert_eq!(json["reason"], "SPAM");
        assert_eq!(json["expiresAt"], 1_800_000_000);
        assert_eq!(json["automated"], false);
    }

    #[test]
    fn trust_vendor_rejection_reads_its_reason_from_the_jwt() {
        // ... {"exp":9999999999,"profileId":"42","restriction":"TRUST_VENDOR_REJECTED","restrictionReason":"Device risk too high"} ...
        let jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjk5OTk5OTk5OTksInByb2ZpbGVJZCI6IjQyIiwicmVzdHJpY3Rpb24iOiJUUlVTVF9WRU5ET1JfUkVKRUNURUQiLCJyZXN0cmljdGlvblJlYXNvbiI6IkRldmljZSByaXNrIHRvbyBoaWdoIn0.sig";
        let claims = decode_jwt(jwt).unwrap();
        let session = jwt_only_session(jwt, &claims, "42".to_owned());
        let restriction = frontend_restriction(Some(&session)).unwrap();
        assert_eq!(restriction.kind, "trustVendorRejected");
        assert_eq!(restriction.reason.as_deref(), Some("Device risk too high"));
    }

    #[test]
    fn jwt_claims_carry_profile_id_and_age_restriction() {
        // {"alg":"HS256","typ":"JWT"} . {"exp":9999999999,"profileId":"42","restriction":"AGE_RESTRICTED","restrictionReason":"UK_VERIFICATION_REQUIRED"} . sig
        let jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjk5OTk5OTk5OTksInByb2ZpbGVJZCI6IjQyIiwicmVzdHJpY3Rpb24iOiJBR0VfUkVTVFJJQ1RFRCIsInJlc3RyaWN0aW9uUmVhc29uIjoiVUtfVkVSSUZJQ0FUSU9OX1JFUVVJUkVEIn0.sig";
        let claims = decode_jwt(jwt).unwrap();
        assert_eq!(claims.profile_id.as_deref(), Some("42"));
        let session = jwt_only_session(jwt, &claims, "42".to_owned());
        assert_eq!(session.credentials.auth_token, jwt);
        assert_eq!(
            session_restriction(Some(&session)),
            Some(grindr::Restriction::AgeVerification {
                region: grindr::VerificationRegion::Uk,
                reason: "UK_VERIFICATION_REQUIRED".to_owned(),
            })
        );
    }
}
