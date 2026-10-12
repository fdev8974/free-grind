use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, watch, Mutex, RwLock};
use tokio::time::Instant;

use crate::error::{BanInfo, GrindrError};
use crate::request::{Access, Body, Request};
use crate::rest::InnerClient;

/// How a [`Session`] was obtained.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[non_exhaustive]
pub enum SessionKind {
	/// Email + password sign-in.
	#[default]
	Email,
	/// Google third-party sign-in.
	Google,
	/// Facebook third-party sign-in.
	Facebook,
}

impl SessionKind {
	/// `thirdPartyVendor` for the third-party kinds; `None` for [`Email`].
	///
	/// [`Email`]: SessionKind::Email
	fn third_party_vendor(&self) -> Option<u8> {
		match self {
			SessionKind::Email => None,
			SessionKind::Facebook => Some(1),
			SessionKind::Google => Some(2),
		}
	}
}

/// An authenticated session: the account's [`Credentials`] plus the
/// short-lived [`SessionToken`] once one has been minted.
#[derive(Debug, Clone)]
pub struct Session {
	/// The durable half; persist this.
	pub credentials: Credentials,
	/// The short-lived half; `None` until a session is minted.
	pub token: Option<SessionToken>,
}

/// The short-lived half of a [`Session`], minted by the server.
/// [`fmt::Debug`] redacts `session_id`.
#[derive(Clone)]
pub struct SessionToken {
	/// Short-lived bearer token (a JWT) sent in the `Authorization` header.
	pub session_id: String,
	/// Unix timestamp (seconds) at which `session_id` expires.
	pub expires_at: u64,
	/// Account restriction carried in the JWT, if any. The token is valid.
	pub restriction: Option<Restriction>,
}

impl fmt::Debug for SessionToken {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.debug_struct("SessionToken")
			.field("session_id", &"<redacted>")
			.field("expires_at", &self.expires_at)
			.field("restriction", &self.restriction)
			.finish()
	}
}

/// The durable half of a [`Session`], enough to resume the account on a later
/// run. It is a secret: store it where only the user can read it and delete it
/// on sign out. [`fmt::Debug`] redacts `auth_token`.
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct Credentials {
	/// Account email (or third-party display id for non-email sign-ins).
	pub email: String,
	/// The account's profile id, known once a session has been minted.
	#[serde(default)]
	pub profile_id: Option<String>,
	/// Long-lived token used to mint a fresh `session_id` on refresh.
	pub auth_token: String,
	/// How the session was created.
	#[serde(default)]
	pub kind: SessionKind,
	/// Vendor-scoped user id for third-party sign-ins, if any.
	#[serde(default)]
	pub third_party_user_id: Option<String>,
}

impl fmt::Debug for Credentials {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.debug_struct("Credentials")
			.field("email", &self.email)
			.field("profile_id", &self.profile_id)
			.field("auth_token", &"<redacted>")
			.field("kind", &self.kind)
			.field("third_party_user_id", &self.third_party_user_id)
			.finish()
	}
}

/// An account restriction carried in the session JWT.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum Restriction {
	/// Age verification is required.
	AgeVerification {
		/// Region whose rules apply.
		region: VerificationRegion,
		/// Raw `restrictionReason` value.
		reason: String,
	},
	/// A time-limited ban.
	TimedBan(BanDetails),
	/// Rejected by the anti-fraud vendor.
	TrustVendorRejected,
	/// A value this version does not model.
	Other(String),
}

/// Region for a [`Restriction::AgeVerification`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum VerificationRegion {
	/// United Kingdom.
	Uk,
	/// Brazil.
	Br,
	/// Australia.
	Au,
	/// United States.
	Us,
	/// A region this version does not model.
	Other,
}

/// A timed ban's details, from the JWT `banDetails` claim.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct BanDetails {
	/// Unix seconds when the ban expires.
	pub expiry_time: Option<i64>,
	/// Ban reason.
	pub reason: Option<String>,
	/// Ban sub-reason.
	pub sub_reason: Option<String>,
	/// Whether the ban was automated.
	#[serde(default)]
	pub is_automated: bool,
}

/// The outcome of a successful sign-in or session refresh.
#[derive(Debug, Clone, Serialize)]
#[non_exhaustive]
pub struct SignInResult {
	/// The authenticated account's profile id.
	pub profile_id: String,
	/// Account restriction, if any. A session was still established.
	pub restriction: Option<Restriction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionResponse {
	pub profile_id: String,
	pub session_id: String,
	pub auth_token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EmailSignInRequest {
	pub email: String,
	pub password: String,
	pub token: Option<String>,
	pub geohash: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub captcha_token: Option<String>,
}

/// A first-party account to create with
/// [`create_account_with_email`](crate::GrindrClient::create_account_with_email).
#[derive(Debug, Clone, Copy)]
pub struct NewEmailAccount<'a> {
	/// Account email address.
	pub email: &'a str,
	/// Account password.
	pub password: &'a str,
	/// Date of birth, Unix milliseconds.
	pub birthday_ms: i64,
	/// reCAPTCHA token scored against the `sign_up` action.
	pub captcha_token: &'a str,
	/// The device's FCM push token, sent as `token`.
	pub push_token: &'a str,
	/// Marketing email opt-in.
	pub opt_in: bool,
}

/// `POST /v8/users` body, in the order the app's Moshi adapter writes it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateAccountEmailRequest<'a> {
	email: &'a str,
	password: &'a str,
	birthday: i64,
	captcha_token: &'a str,
	token: &'a str,
	opt_in: bool,
	session_id: Option<&'a str>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAccountResponse {
	profile_id: String,
}

/// Answer of the SMS verification endpoints (SmsCodeResponse).
#[derive(Debug, Clone, Deserialize)]
#[non_exhaustive]
pub struct SmsCodeResponse {
	/// Grindr status code, if any.
	pub code: Option<i32>,
	/// Status message, e.g. `"Profile is already verified"`.
	#[serde(default)]
	pub message: String,
}

#[derive(Debug, Serialize)]
struct SmsCodeRequest<'a> {
	country_code: &'a str,
	phone_number: &'a str,
	#[serde(skip_serializing_if = "Option::is_none")]
	code: Option<&'a str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RefreshRequest {
	pub email: String,
	pub auth_token: String,
	pub token: Option<String>,
	pub geohash: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThirdPartyRefreshRequest<'a> {
	third_party_user_id: &'a str,
	auth_token: &'a str,
	geohash: Option<&'a str>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JwtClaims {
	exp: u64,
	#[serde(default)]
	restriction: Option<String>,
	#[serde(default)]
	restriction_reason: Option<String>,
	#[serde(default)]
	ban_details: Option<BanDetails>,
}

fn restriction_from_claims(claims: &JwtClaims) -> Option<Restriction> {
	let restriction = claims.restriction.as_deref()?;
	Some(match restriction {
		"AGE_RESTRICTED" => Restriction::AgeVerification {
			region: region_from_reason(claims.restriction_reason.as_deref()),
			reason: claims.restriction_reason.clone().unwrap_or_default(),
		},
		"TIMED_BAN" => Restriction::TimedBan(
			claims.ban_details.clone().unwrap_or_default(),
		),
		"TRUST_VENDOR_REJECTED" => Restriction::TrustVendorRejected,
		other => Restriction::Other(other.to_owned()),
	})
}

fn region_from_reason(reason: Option<&str>) -> VerificationRegion {
	match reason {
		Some("UK_VERIFICATION_REQUIRED") => VerificationRegion::Uk,
		Some("BR_VERIFICATION_REQUIRED") => VerificationRegion::Br,
		Some("AU_VERIFICATION_REQUIRED") => VerificationRegion::Au,
		Some("US_VERIFICATION_REQUIRED") => VerificationRegion::Us,
		_ => VerificationRegion::Other,
	}
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThirdPartySignInRequest<'a> {
	third_party_vendor: u8,
	third_party_token: &'a str,
	geohash: Option<&'a str>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThirdPartyAuthResponse {
	#[allow(dead_code)]
	registered: bool,
	authentication_response: Option<ThirdPartySession>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThirdPartySession {
	profile_id: String,
	session_id: String,
	auth_token: String,
	third_party_user_id: String,
	#[serde(default)]
	third_party_user_id_to_show: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AssignmentsResponse {
	#[serde(default)]
	assignments: Vec<Assignment>,
}

#[derive(Debug, Deserialize)]
struct Assignment {
	key: String,
	value: String,
}

fn now_unix() -> u64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|d| d.as_secs())
		.unwrap_or(0)
}

/// Reads the `exp` claim out of a server-issued session JWT.
///
/// The signature is not verified because the token is minted by the
/// Grindr server, the client does not hold the signing key, and the decoded
/// value is only used to decide when to refresh — not for a trust
/// or authorization decision.
fn decode_session_jwt(token: &str) -> Result<JwtClaims, GrindrError> {
	jsonwebtoken::dangerous::insecure_decode::<JwtClaims>(token)
		.map(|d| d.claims)
		.map_err(|e| GrindrError::Auth(format!("JWT decode failed: {e}")))
}

pub(crate) trait AuthRequest: Serialize {
	fn email(&self) -> &str;
}

impl AuthRequest for EmailSignInRequest {
	fn email(&self) -> &str {
		&self.email
	}
}

impl AuthRequest for RefreshRequest {
	fn email(&self) -> &str {
		&self.email
	}
}

/// Why a token refresh failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum RefreshFailureKind {
	/// Connection, DNS, TLS, or timeout failure; the request got no answer.
	Transport,
	/// A Cloudflare challenge or WAF block answered instead of the API.
	Blocked,
	/// The API returned `429`.
	RateLimited,
	/// The API returned some other non-success status.
	Server,
	/// The session itself is unusable; retrying will not help.
	Session,
}

impl RefreshFailureKind {
	/// Whether retrying the same refresh could still succeed.
	pub fn is_transient(self) -> bool {
		!matches!(self, Self::Session)
	}

	fn classify(error: &GrindrError) -> Self {
		match error {
			GrindrError::Http(_)
			| GrindrError::Connect(_)
			| GrindrError::Timeout(_) => Self::Transport,
			GrindrError::Blocked(_) => Self::Blocked,
			GrindrError::RateLimited => Self::RateLimited,
			// Code 30 was an Api error before it got its own variant; keep
			// refresh treating it the same.
			GrindrError::Api { .. } | GrindrError::VerificationRequired { .. } => {
				Self::Server
			}
			_ => Self::Session,
		}
	}
}

/// Emitted on [`GrindrClient::auth_event_receiver`](crate::GrindrClient::auth_event_receiver)
/// when a background token refresh changes the auth state.
#[derive(Debug, Clone)]
#[non_exhaustive]
pub enum AuthEvent {
	/// Session cleared (`401`); sign in again.
	SignedOut,
	/// The account is banned; session cleared.
	Banned(BanInfo),
	/// A refresh failed, the session is kept. Sent at most once per cooldown,
	/// and never while [inactive](crate::GrindrClient::set_active).
	#[non_exhaustive]
	RefreshFailed {
		/// What went wrong.
		message: String,
		/// The shape of the failure.
		kind: RefreshFailureKind,
	},
	/// A refresh succeeded after a [`RefreshFailed`](Self::RefreshFailed).
	RefreshRecovered,
}

#[derive(Default)]
pub(crate) struct RefreshGate {
	failures: u32,
	retry_at: Option<Instant>,
	reported: bool,
}

const REFRESH_COOLDOWNS: [Duration; 4] = [
	Duration::from_secs(5),
	Duration::from_secs(15),
	Duration::from_secs(30),
	Duration::from_secs(60),
];

impl RefreshGate {
	fn blocked(&self) -> bool {
		self.retry_at.is_some_and(|at| Instant::now() < at)
	}

	fn record_failure(&mut self) {
		let index = (self.failures as usize).min(REFRESH_COOLDOWNS.len() - 1);
		self.retry_at = Instant::now().checked_add(REFRESH_COOLDOWNS[index]);
		self.failures = self.failures.saturating_add(1);
	}

	fn clear_backoff(&mut self) {
		self.failures = 0;
		self.retry_at = None;
	}

	fn take_owed_recovery(&mut self) -> bool {
		self.clear_backoff();
		std::mem::take(&mut self.reported)
	}
}

pub(crate) struct AuthState {
	pub session: RwLock<Option<Session>>,
	pub sign_out_epoch: AtomicU64,
	pub refresh_lock: Mutex<()>,
	pub session_tx: watch::Sender<Option<Session>>,
	pub auth_event_tx: broadcast::Sender<AuthEvent>,
	pub active_tx: watch::Sender<bool>,
	pub refresh_gate: std::sync::Mutex<RefreshGate>,
}

impl AuthState {
	pub fn new(
		initial: Option<Session>,
	) -> (Self, watch::Receiver<Option<Session>>) {
		let (tx, rx) = watch::channel(initial.clone());
		let (auth_event_tx, _) = broadcast::channel(16);
		let (active_tx, _) = watch::channel(true);
		let state = Self {
			session: RwLock::new(initial),
			sign_out_epoch: AtomicU64::new(0),
			refresh_lock: Mutex::new(()),
			session_tx: tx,
			auth_event_tx,
			active_tx,
			refresh_gate: std::sync::Mutex::default(),
		};
		(state, rx)
	}

	pub fn epoch(&self) -> u64 {
		self.sign_out_epoch.load(Ordering::SeqCst)
	}

	pub fn is_active(&self) -> bool {
		*self.active_tx.borrow()
	}

	// `send`, unlike `send_replace`, discards the value while the websocket
	// task has yet to subscribe.
	pub fn set_active(&self, active: bool) {
		let was_active = self.active_tx.send_replace(active);
		if active && !was_active {
			self.refresh_gate.lock().unwrap().clear_backoff();
		}
	}

	pub async fn set_session_if_current(
		&self,
		session: Session,
		epoch: u64,
	) -> bool {
		{
			let mut guard = self.session.write().await;
			if self.epoch() != epoch {
				return false;
			}
			*guard = Some(session.clone());
			let _ = self.session_tx.send(Some(session));
		}
		if self.refresh_gate.lock().unwrap().take_owed_recovery() {
			let _ = self.auth_event_tx.send(AuthEvent::RefreshRecovered);
		}
		true
	}

	pub async fn clear_session(&self) {
		let mut guard = self.session.write().await;
		self.sign_out_epoch.fetch_add(1, Ordering::SeqCst);
		*guard = None;
		let _ = self.session_tx.send(None);
		*self.refresh_gate.lock().unwrap() = RefreshGate::default();
	}
}

pub(crate) async fn create_session(
	inner: &InnerClient,
	path: &str,
	body: &impl AuthRequest,
	kind: SessionKind,
	third_party_user_id: Option<String>,
) -> Result<(Session, SignInResult), GrindrError> {
	let resp: SessionResponse = inner
		.request_no_auth(
			wreq::Method::POST,
			path,
			Some(body),
			crate::rest::RequiredDeviceInfo::Real,
		)
		.await?;

	let claims = decode_session_jwt(&resp.session_id)?;
	let restriction = restriction_from_claims(&claims);

	let result = SignInResult {
		profile_id: resp.profile_id.clone(),
		restriction: restriction.clone(),
	};
	let session = Session {
		credentials: Credentials {
			email: body.email().to_owned(),
			profile_id: Some(resp.profile_id),
			auth_token: resp.auth_token,
			kind,
			third_party_user_id,
		},
		token: Some(SessionToken {
			session_id: resp.session_id,
			expires_at: claims.exp,
			restriction,
		}),
	};
	Ok((session, result))
}

pub(crate) async fn create_account_with_email(
	inner: &InnerClient,
	account: &NewEmailAccount<'_>,
) -> Result<String, GrindrError> {
	let body = CreateAccountEmailRequest {
		email: account.email,
		password: account.password,
		birthday: account.birthday_ms,
		captcha_token: account.captcha_token,
		token: account.push_token,
		opt_in: account.opt_in,
		session_id: None,
	};
	// Serialized straight from the struct: Body::json goes through
	// serde_json::Value, which would sort the keys.
	let bytes = serde_json::to_vec(&body)
		.map_err(|e| GrindrError::InvalidRequest(e.to_string()))?;
	let mut request = Request::new(
		wreq::Method::POST,
		"/v8/users",
		Body::Json(bytes.into()),
	);
	request.required_device_info =
		Some(crate::rest::RequiredDeviceInfo::Real);
	let resp: CreateAccountResponse = crate::rest::parse_json(
		inner.send(Access::Anonymous, &request).await?,
	)?;
	Ok(resp.profile_id)
}

/// `POST /v4/sms/verification/{profileId}/{action}` for a profile whose
/// sign-in was refused as verification required (code 30). There is no
/// session yet, so it goes out without one.
pub(crate) async fn sms_verification(
	inner: &InnerClient,
	profile_id: &str,
	action: &str,
	country_code: &str,
	phone_number: &str,
	code: Option<&str>,
) -> Result<SmsCodeResponse, GrindrError> {
	if profile_id.is_empty() || !profile_id.bytes().all(|b| b.is_ascii_digit()) {
		return Err(GrindrError::InvalidRequest(format!(
			"invalid profile id {profile_id:?}"
		)));
	}
	let body = SmsCodeRequest {
		country_code,
		phone_number,
		code,
	};
	let path = format!("/v4/sms/verification/{profile_id}/{action}");
	let mut request =
		Request::new(wreq::Method::POST, &path, Body::json(&body)?);
	request.required_device_info =
		Some(crate::rest::RequiredDeviceInfo::RealAndAnonymous);
	let response = inner.send(Access::Anonymous, &request).await?;
	// An empty success body is a plain "done".
	if (200..300).contains(&response.status)
		&& response.body.iter().all(u8::is_ascii_whitespace)
	{
		return Ok(SmsCodeResponse {
			code: None,
			message: String::new(),
		});
	}
	crate::rest::parse_json(response)
}

pub(crate) async fn sign_in_with_email(
	inner: &InnerClient,
	auth: &AuthState,
	email: &str,
	password: &str,
	geohash: Option<&str>,
	captcha_token: Option<&str>,
) -> Result<SignInResult, GrindrError> {
	let path = if captcha_token.is_some() {
		"/v9/sessions"
	} else {
		"/v8/sessions"
	};
	let body = EmailSignInRequest {
		email: email.to_owned(),
		password: password.to_owned(),
		token: None,
		geohash: geohash.map(str::to_owned),
		captcha_token: captcha_token.map(str::to_owned),
	};
	let epoch = auth.epoch();
	let (session, result) =
		create_session(inner, path, &body, SessionKind::Email, None).await?;
	if !auth.set_session_if_current(session, epoch).await {
		return Err(GrindrError::SessionCleared);
	}
	Ok(result)
}

pub(crate) async fn sign_in_with_third_party(
	inner: &InnerClient,
	auth: &AuthState,
	kind: SessionKind,
	provider_access_token: &str,
	geohash: Option<&str>,
) -> Result<SignInResult, GrindrError> {
	let Some(third_party_vendor) = kind.third_party_vendor() else {
		return Err(GrindrError::Auth(
			"not a third-party session kind".to_owned(),
		));
	};
	let epoch = auth.epoch();
	let body = ThirdPartySignInRequest {
		third_party_vendor,
		third_party_token: provider_access_token,
		geohash,
	};
	let parsed: ThirdPartyAuthResponse = inner
		.request_no_auth(
			wreq::Method::POST,
			"/v8/sessions/thirdparty",
			Some(&body),
			crate::rest::RequiredDeviceInfo::Real,
		)
		.await?;
	let tp = parsed.authentication_response.ok_or_else(|| {
		GrindrError::Auth("account not registered".to_owned())
	})?;
	let fallback_email = tp.third_party_user_id.clone();
	let (session, result) = session_from_third_party(tp, fallback_email, kind)?;
	if !auth.set_session_if_current(session, epoch).await {
		return Err(GrindrError::SessionCleared);
	}
	Ok(result)
}

fn session_from_third_party(
	tp: ThirdPartySession,
	fallback_email: String,
	kind: SessionKind,
) -> Result<(Session, SignInResult), GrindrError> {
	let claims = decode_session_jwt(&tp.session_id)?;
	let restriction = restriction_from_claims(&claims);

	let result = SignInResult {
		profile_id: tp.profile_id.clone(),
		restriction: restriction.clone(),
	};
	let session = Session {
		credentials: Credentials {
			email: tp.third_party_user_id_to_show.unwrap_or(fallback_email),
			profile_id: Some(tp.profile_id),
			auth_token: tp.auth_token,
			kind,
			third_party_user_id: Some(tp.third_party_user_id),
		},
		token: Some(SessionToken {
			session_id: tp.session_id,
			expires_at: claims.exp,
			restriction,
		}),
	};
	Ok((session, result))
}

async fn refresh_third_party_session(
	inner: &InnerClient,
	third_party_user_id: &str,
	auth_token: &str,
	fallback_email: String,
	geohash: Option<&str>,
	kind: SessionKind,
) -> Result<(Session, SignInResult), GrindrError> {
	let body = ThirdPartyRefreshRequest {
		third_party_user_id,
		auth_token,
		geohash,
	};
	let parsed: ThirdPartyAuthResponse = inner
		.request_no_auth(
			wreq::Method::POST,
			"/v8/sessions/thirdparty",
			Some(&body),
			crate::rest::RequiredDeviceInfo::Real,
		)
		.await?;
	let tp = parsed.authentication_response.ok_or_else(|| {
		GrindrError::Auth("third-party session refresh rejected".to_owned())
	})?;
	session_from_third_party(tp, fallback_email, kind)
}

pub(crate) async fn refresh_session(
	inner: &InnerClient,
	auth: &AuthState,
	geohash: Option<&str>,
) -> Result<SignInResult, GrindrError> {
	let (kind, email, auth_token, third_party_user_id, epoch) = {
		let guard = auth.session.read().await;
		let s = guard
			.as_ref()
			.ok_or_else(|| GrindrError::Auth("not signed in".to_owned()))?;
		(
			s.credentials.kind.clone(),
			s.credentials.email.clone(),
			s.credentials.auth_token.clone(),
			s.credentials.third_party_user_id.clone(),
			auth.epoch(),
		)
	};

	let (session, result) = match kind {
		SessionKind::Email => {
			let body = RefreshRequest {
				email,
				auth_token,
				token: None,
				geohash: geohash.map(str::to_owned),
			};
			create_session(
				inner,
				"/v8/sessions",
				&body,
				SessionKind::Email,
				None,
			)
			.await?
		}
		kind @ (SessionKind::Google | SessionKind::Facebook) => {
			let third_party_user_id = third_party_user_id.ok_or_else(|| {
				GrindrError::Auth(
					"third-party session missing third-party user id"
						.to_owned(),
				)
			})?;
			refresh_third_party_session(
				inner,
				&third_party_user_id,
				&auth_token,
				email,
				geohash,
				kind,
			)
			.await?
		}
	};

	if !auth.set_session_if_current(session, epoch).await {
		return Err(GrindrError::SessionCleared);
	}
	Ok(result)
}

async fn emit_refresh_failure(auth: &AuthState, error: GrindrError) {
	let event = match error {
		GrindrError::Unauthorized { .. } => {
			auth.clear_session().await;
			AuthEvent::SignedOut
		}
		GrindrError::Banned(info) => {
			auth.clear_session().await;
			AuthEvent::Banned(info)
		}
		other => {
			if auth.session.read().await.is_none() || !auth.is_active() {
				return;
			}
			auth.refresh_gate.lock().unwrap().reported = true;
			AuthEvent::RefreshFailed {
				kind: RefreshFailureKind::classify(&other),
				message: other.to_string(),
			}
		}
	};
	let _ = auth.auth_event_tx.send(event);
}

async fn refresh_gated(
	inner: &InnerClient,
	auth: &AuthState,
	context: &str,
) -> bool {
	if auth.refresh_gate.lock().unwrap().blocked() {
		return false;
	}
	match refresh_session(inner, auth, None).await {
		Ok(_) => true,
		Err(e) => {
			tracing::warn!("{context} token refresh failed: {e}");
			auth.refresh_gate.lock().unwrap().record_failure();
			emit_refresh_failure(auth, e).await;
			false
		}
	}
}

/// Refresh after an authenticated request returned `401`.
pub(crate) async fn refresh_after_unauthorized(
	inner: &InnerClient,
	auth: &AuthState,
	rejected_session_id: &str,
) -> bool {
	let _guard = auth.refresh_lock.lock().await;

	match auth.session.read().await.as_ref() {
		None => return false,
		Some(s) => match &s.token {
			Some(t) if t.session_id == rejected_session_id => {}
			_ => return true,
		},
	}

	refresh_gated(inner, auth, "reactive").await
}

pub(crate) async fn reauthorize_same_profile(
	inner: &InnerClient,
	auth: &AuthState,
	previous: &Authorization,
) -> Result<Authorization, GrindrError> {
	let renewed = authorize(inner, auth).await?;
	if renewed.profile_id != previous.profile_id {
		return Err(GrindrError::SessionCleared);
	}
	Ok(renewed)
}

async fn assignment_enabled(
	inner: &InnerClient,
	key: &str,
) -> Result<bool, GrindrError> {
	let resp: AssignmentsResponse = inner
		.request_no_auth::<(), _>(
			wreq::Method::GET,
			"/public/v1/assignments",
			None,
			crate::rest::RequiredDeviceInfo::Anonymous,
		)
		.await?;
	Ok(resp
		.assignments
		.iter()
		.any(|a| a.key == key && a.value == "on"))
}

pub(crate) async fn recaptcha_first_party_enabled(
	inner: &InnerClient,
) -> Result<bool, GrindrError> {
	assignment_enabled(inner, "recaptcha_first_party").await
}

pub(crate) async fn recaptcha_device_key_registration_enabled(
	inner: &InnerClient,
) -> Result<bool, GrindrError> {
	assignment_enabled(inner, "recaptcha_device_key_registration").await
}

fn expires_before(session: &Session, deadline: u64) -> bool {
	session
		.token
		.as_ref()
		.is_none_or(|token| token.expires_at < deadline)
}

pub(crate) struct Authorization {
	pub session_id: String,
	pub profile_id: Option<String>,
}

impl Authorization {
	pub fn header(&self) -> String {
		format!("Grindr3 {}", self.session_id)
	}
}

pub(crate) async fn authorize(
	inner: &InnerClient,
	auth: &AuthState,
) -> Result<Authorization, GrindrError> {
	const REFRESH_BUFFER_SECS: u64 = 60;

	let not_signed_in = || GrindrError::Auth("not signed in".to_owned());

	let expiring = expires_before(
		auth.session
			.read()
			.await
			.as_ref()
			.ok_or_else(not_signed_in)?,
		now_unix() + REFRESH_BUFFER_SECS,
	);

	if expiring {
		let _guard = auth.refresh_lock.lock().await;

		let still_expiring = match auth.session.read().await.as_ref() {
			Some(s) => expires_before(s, now_unix() + REFRESH_BUFFER_SECS),
			None => return Err(not_signed_in()),
		};

		if still_expiring {
			refresh_gated(inner, auth, "proactive").await;
		}
	}

	let session = auth.session.read().await;
	let session = session.as_ref().ok_or_else(not_signed_in)?;
	let token = session.token.as_ref().ok_or_else(not_signed_in)?;
	Ok(Authorization {
		session_id: token.session_id.clone(),
		profile_id: session.credentials.profile_id.clone(),
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn sms_code_bodies_use_snake_case_and_omit_a_missing_code() {
		let send = SmsCodeRequest {
			country_code: "49",
			phone_number: "1701234567",
			code: None,
		};
		assert_eq!(
			serde_json::to_string(&send).unwrap(),
			r#"{"country_code":"49","phone_number":"1701234567"}"#
		);
		let verify = SmsCodeRequest {
			code: Some("123456"),
			..send
		};
		assert_eq!(
			serde_json::to_string(&verify).unwrap(),
			r#"{"country_code":"49","phone_number":"1701234567","code":"123456"}"#
		);
	}

	#[test]
	fn create_account_body_keeps_the_adapter_key_order() {
		let body = CreateAccountEmailRequest {
			email: "user@example.com",
			password: "pw",
			birthday: 946_684_800_000,
			captcha_token: "cap",
			token: "fcm",
			opt_in: false,
			session_id: None,
		};
		assert_eq!(
			serde_json::to_string(&body).unwrap(),
			r#"{"email":"user@example.com","password":"pw","birthday":946684800000,"captchaToken":"cap","token":"fcm","optIn":false,"sessionId":null}"#
		);
	}

	// Header {"alg":"HS256","typ":"JWT"} . payload {"exp":9999999999} . sig
	const JWT: &str =
		"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjk5OTk5OTk5OTl9.sig";

	fn session_named(email: &str) -> Session {
		Session {
			credentials: Credentials {
				email: email.to_owned(),
				profile_id: Some("42".to_owned()),
				auth_token: "auth-tok".to_owned(),
				kind: SessionKind::Email,
				third_party_user_id: None,
			},
			token: Some(SessionToken {
				session_id: JWT.to_owned(),
				expires_at: 9_999_999_999,
				restriction: None,
			}),
		}
	}

	#[tokio::test]
	async fn a_session_minted_before_a_sign_out_is_refused() {
		let (auth, mut rx) = AuthState::new(Some(session_named("old@x")));
		let epoch = auth.epoch();

		auth.clear_session().await;

		assert!(
			!auth.set_session_if_current(session_named("old@x"), epoch).await,
			"a refresh in flight across sign-out must not resurrect the account"
		);
		assert!(auth.session.read().await.is_none());
		assert!(
			rx.borrow_and_update().is_none(),
			"the watch must not be left holding a stale session for the app to persist"
		);
	}

	#[tokio::test]
	async fn a_session_minted_after_a_sign_out_is_accepted() {
		let (auth, _rx) = AuthState::new(Some(session_named("old@x")));
		auth.clear_session().await;

		let epoch = auth.epoch();
		assert!(
			auth.set_session_if_current(session_named("new@x"), epoch)
				.await,
			"signing in again after a sign-out must work"
		);
		assert_eq!(
			auth.session
				.read()
				.await
				.as_ref()
				.unwrap()
				.credentials
				.email,
			"new@x"
		);
	}

	fn third_party_session(show: Option<&str>) -> ThirdPartySession {
		ThirdPartySession {
			profile_id: "42".to_owned(),
			session_id: JWT.to_owned(),
			auth_token: "auth-tok".to_owned(),
			third_party_user_id: "vendor-uid".to_owned(),
			third_party_user_id_to_show: show.map(str::to_owned),
		}
	}

	#[test]
	fn third_party_refresh_body_uses_grindr_wire_keys() {
		let body = ThirdPartyRefreshRequest {
			third_party_user_id: "vendor-uid",
			auth_token: "auth-tok",
			geohash: None,
		};
		let json: serde_json::Value = serde_json::to_value(&body).unwrap();
		assert_eq!(json["thirdPartyUserId"], "vendor-uid");
		assert_eq!(json["authToken"], "auth-tok");
		assert!(json.get("email").is_none());
		assert!(json["geohash"].is_null());
	}

	#[test]
	fn sign_in_bodies_carry_geohash_when_set() {
		let sign_in = serde_json::to_value(EmailSignInRequest {
			email: "user@example.com".to_owned(),
			password: "pw".to_owned(),
			token: None,
			geohash: Some("9q8yyk8yuv".to_owned()),
			captcha_token: None,
		})
		.unwrap();
		assert_eq!(sign_in["geohash"], "9q8yyk8yuv");

		let refresh = serde_json::to_value(RefreshRequest {
			email: "user@example.com".to_owned(),
			auth_token: "auth-tok".to_owned(),
			token: None,
			geohash: Some("9q8yyk8yuv".to_owned()),
		})
		.unwrap();
		assert_eq!(refresh["geohash"], "9q8yyk8yuv");

		let google = serde_json::to_value(ThirdPartySignInRequest {
			third_party_vendor: 2,
			third_party_token: "ya29.token",
			geohash: Some("9q8yyk8yuv"),
		})
		.unwrap();
		assert_eq!(google["geohash"], "9q8yyk8yuv");
	}

	#[test]
	fn sign_in_bodies_omit_geohash_when_none() {
		let sign_in = serde_json::to_value(EmailSignInRequest {
			email: "user@example.com".to_owned(),
			password: "pw".to_owned(),
			token: None,
			geohash: None,
			captcha_token: None,
		})
		.unwrap();
		assert!(sign_in["geohash"].is_null());
	}

	#[test]
	fn a_captcha_token_serializes_camel_cased_and_is_omitted_when_absent() {
		let with_token = serde_json::to_value(EmailSignInRequest {
			email: "user@example.com".to_owned(),
			password: "pw".to_owned(),
			token: None,
			geohash: None,
			captcha_token: Some("tok".to_owned()),
		})
		.unwrap();
		assert_eq!(with_token["captchaToken"], "tok");

		let without_token = serde_json::to_value(EmailSignInRequest {
			email: "user@example.com".to_owned(),
			password: "pw".to_owned(),
			token: None,
			geohash: None,
			captcha_token: None,
		})
		.unwrap();
		assert!(without_token.get("captchaToken").is_none());
	}

	#[test]
	fn session_from_third_party_preserves_google_identity() {
		let (session, _) = session_from_third_party(
			third_party_session(Some("me@example.com")),
			"fallback@example.com".to_owned(),
			SessionKind::Google,
		)
		.unwrap();

		let credentials = session.credentials;
		assert_eq!(credentials.kind, SessionKind::Google);
		assert_eq!(
			credentials.third_party_user_id.as_deref(),
			Some("vendor-uid")
		);
		assert_eq!(credentials.auth_token, "auth-tok");
		assert_eq!(credentials.email, "me@example.com");
	}

	#[test]
	fn session_from_third_party_falls_back_when_no_display_id() {
		let (session, _) = session_from_third_party(
			third_party_session(None),
			"fallback@example.com".to_owned(),
			SessionKind::Google,
		)
		.unwrap();
		assert_eq!(session.credentials.email, "fallback@example.com");
	}

	#[test]
	fn session_from_third_party_tags_the_facebook_kind() {
		let (session, _) = session_from_third_party(
			third_party_session(Some("me@example.com")),
			"fallback@example.com".to_owned(),
			SessionKind::Facebook,
		)
		.unwrap();
		assert_eq!(session.credentials.kind, SessionKind::Facebook);
	}

	#[test]
	fn vendor_ids_match_the_documented_third_party_vendors() {
		assert_eq!(SessionKind::Facebook.third_party_vendor(), Some(1));
		assert_eq!(SessionKind::Google.third_party_vendor(), Some(2));
		assert_eq!(SessionKind::Email.third_party_vendor(), None);
	}

	#[test]
	fn age_restricted_claims_map_to_age_verification() {
		let claims = JwtClaims {
			exp: 0,
			restriction: Some("AGE_RESTRICTED".to_owned()),
			restriction_reason: Some("UK_VERIFICATION_REQUIRED".to_owned()),
			ban_details: None,
		};
		assert_eq!(
			restriction_from_claims(&claims),
			Some(Restriction::AgeVerification {
				region: VerificationRegion::Uk,
				reason: "UK_VERIFICATION_REQUIRED".to_owned(),
			})
		);
	}

	#[test]
	fn the_verification_reason_picks_the_region() {
		for (reason, region) in [
			("UK_VERIFICATION_REQUIRED", VerificationRegion::Uk),
			("BR_VERIFICATION_REQUIRED", VerificationRegion::Br),
			("AU_VERIFICATION_REQUIRED", VerificationRegion::Au),
			("US_VERIFICATION_REQUIRED", VerificationRegion::Us),
			("BANNED_USER", VerificationRegion::Other),
		] {
			assert_eq!(region_from_reason(Some(reason)), region, "{reason}");
		}
		assert_eq!(region_from_reason(None), VerificationRegion::Other);
	}

	#[test]
	fn unrestricted_claims_map_to_none() {
		let claims = JwtClaims {
			exp: 0,
			restriction: None,
			restriction_reason: None,
			ban_details: None,
		};
		assert_eq!(restriction_from_claims(&claims), None);
	}

	#[test]
	fn transport_failures_are_transient_and_session_failures_are_not() {
		let transport = RefreshFailureKind::classify(&GrindrError::Http(
			"reset".to_owned(),
		));
		assert_eq!(transport, RefreshFailureKind::Transport);
		assert!(transport.is_transient());
		assert_eq!(
			RefreshFailureKind::classify(&GrindrError::Timeout(
				crate::error::TimeoutPhase::Headers
			)),
			RefreshFailureKind::Transport
		);

		assert!(RefreshFailureKind::classify(&GrindrError::RateLimited)
			.is_transient());
		assert!(RefreshFailureKind::classify(&GrindrError::Blocked(
			crate::error::BlockKind::Cloudflare
		))
		.is_transient());
		assert!(RefreshFailureKind::classify(&GrindrError::Api {
			code: 500,
			message: "boom".to_owned(),
		})
		.is_transient());

		let session = RefreshFailureKind::classify(&GrindrError::Auth(
			"not signed in".to_owned(),
		));
		assert_eq!(session, RefreshFailureKind::Session);
		assert!(!session.is_transient());
	}

	#[tokio::test(start_paused = true)]
	async fn the_gate_backs_off_and_escalates_between_attempts() {
		let mut gate = RefreshGate::default();
		assert!(!gate.blocked());

		gate.record_failure();
		assert!(gate.blocked(), "a fresh failure must suppress the next try");

		tokio::time::advance(Duration::from_secs(5)).await;
		assert!(!gate.blocked(), "the first cooldown is 5s");

		gate.record_failure();
		tokio::time::advance(Duration::from_secs(5)).await;
		assert!(
			gate.blocked(),
			"the second cooldown is longer than the first"
		);
		tokio::time::advance(Duration::from_secs(10)).await;
		assert!(!gate.blocked());
	}

	#[test]
	fn coming_back_to_the_foreground_drops_a_backoff_earned_in_the_background()
	{
		let (auth, _rx) = AuthState::new(Some(session_named("a@b.c")));
		auth.set_active(false);

		auth.refresh_gate.lock().unwrap().record_failure();
		auth.refresh_gate.lock().unwrap().reported = true;
		assert!(auth.refresh_gate.lock().unwrap().blocked());

		auth.set_active(true);

		let gate = auth.refresh_gate.lock().unwrap();
		assert!(
			!gate.blocked(),
			"the resume refresh must not be skipped for failures against a \
			 network the process no longer has"
		);
		assert!(gate.reported, "a recovery still owed is not forgotten");
	}

	#[test]
	fn the_gate_owes_a_recovery_only_after_a_reported_failure() {
		let mut gate = RefreshGate::default();
		gate.record_failure();
		assert!(
			!gate.take_owed_recovery(),
			"a failure nobody was told about owes nothing"
		);

		gate.record_failure();
		gate.reported = true;
		assert!(gate.take_owed_recovery());
		assert!(
			!gate.take_owed_recovery(),
			"a recovery is owed exactly once"
		);
	}

	#[tokio::test]
	async fn a_successful_refresh_retracts_a_reported_failure() {
		let (auth, _rx) = AuthState::new(Some(session_named("a@b.c")));
		let mut events = auth.auth_event_tx.subscribe();
		auth.refresh_gate.lock().unwrap().reported = true;

		let epoch = auth.epoch();
		assert!(
			auth.set_session_if_current(session_named("a@b.c"), epoch)
				.await
		);

		assert!(matches!(events.try_recv(), Ok(AuthEvent::RefreshRecovered)));
	}

	#[tokio::test]
	async fn a_refresh_that_nobody_heard_about_sends_no_recovery() {
		let (auth, _rx) = AuthState::new(Some(session_named("a@b.c")));
		let mut events = auth.auth_event_tx.subscribe();

		let epoch = auth.epoch();
		assert!(
			auth.set_session_if_current(session_named("a@b.c"), epoch)
				.await
		);

		assert!(events.try_recv().is_err());
	}

	#[tokio::test]
	async fn an_idle_client_stays_quiet_about_transport_failures() {
		let (auth, _rx) = AuthState::new(Some(session_named("a@b.c")));
		let mut events = auth.auth_event_tx.subscribe();
		auth.set_active(false);

		emit_refresh_failure(&auth, GrindrError::Http("no route".to_owned()))
			.await;

		assert!(events.try_recv().is_err());
		assert!(
			!auth.refresh_gate.lock().unwrap().reported,
			"nothing was reported, so nothing is owed a retraction"
		);
	}

	#[tokio::test]
	async fn an_idle_client_still_reports_a_revoked_session() {
		let (auth, _rx) = AuthState::new(Some(session_named("a@b.c")));
		let mut events = auth.auth_event_tx.subscribe();
		auth.set_active(false);

		emit_refresh_failure(
			&auth,
			GrindrError::Unauthorized {
				code: 401,
				message: "revoked".to_owned(),
			},
		)
		.await;

		assert!(matches!(events.try_recv(), Ok(AuthEvent::SignedOut)));
		assert!(auth.session.read().await.is_none());
	}

	#[tokio::test]
	async fn an_active_client_reports_a_transport_failure_with_its_kind() {
		let (auth, _rx) = AuthState::new(Some(session_named("a@b.c")));
		let mut events = auth.auth_event_tx.subscribe();

		emit_refresh_failure(&auth, GrindrError::Http("no route".to_owned()))
			.await;

		let event = events.try_recv().unwrap();
		let AuthEvent::RefreshFailed { kind, .. } = event else {
			panic!("expected a RefreshFailed, got {event:?}");
		};
		assert_eq!(kind, RefreshFailureKind::Transport);
	}
}
