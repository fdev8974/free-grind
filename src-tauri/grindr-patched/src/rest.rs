use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::de::DeserializeOwned;
use tokio::sync::watch;
use wreq::header::{HeaderMap, HeaderValue};
use wreq::{Client, Method};

use crate::auth::AuthState;
use crate::client::Timeouts;
use crate::device::DeviceInfo;
use crate::error::{BanInfo, BanKind, BlockKind, GrindrError};
use crate::request::{Access, Body, Request};
use crate::signing::{DeviceKey, DeviceSigningKey};

#[cfg(not(test))]
pub(crate) fn base_url() -> &'static str {
	"https://grindr.mobi"
}

#[cfg(test)]
pub(crate) fn base_url() -> &'static str {
	crate::testserver::base_url()
}

/// Guards against a `path` that would change the effective host once
/// concatenated onto [`base_url`].
///
/// `format!("{}{path}", base_url())` keeps the request on `grindr.mobi` only
/// when `path` starts with `/`.
pub(crate) fn validate_path(path: &str) -> Result<(), GrindrError> {
	if path.starts_with('/') {
		Ok(())
	} else {
		Err(GrindrError::InvalidRequest(format!(
			"request path must begin with '/', got {path:?}"
		)))
	}
}

/// The status and unparsed body of a response.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RawResponse {
	/// HTTP status code.
	pub status: u16,
	/// Raw, unparsed response body.
	pub body: Vec<u8>,
}

pub struct Fingerprint {
	/// ALPN: `["h2", "http/1.1"]`
	pub http: Client,
	/// ALPN: `["http/1.1"]`
	pub ws_http: Client,
	/// ALPN: `["h2", "http/1.1"]`, pooled apart from the API.
	pub media_http: Client,
	pub device: DeviceInfo,
	pub user_agent: String,
}

impl Fingerprint {
	pub(crate) fn with_media_http(&self, media_http: Client) -> Self {
		Self {
			http: self.http.clone(),
			ws_http: self.ws_http.clone(),
			media_http,
			device: self.device.clone(),
			user_agent: self.user_agent.clone(),
		}
	}
}

pub(crate) const JSON_CONTENT_TYPE: &str = "application/json; charset=utf-8";

pub(crate) const ACCEPT_ENCODING: &str = "accept-encoding";

pub(crate) struct BodyHeaders<'a> {
	pub content_type: &'a HeaderValue,
	pub length: u64,
}

impl BodyHeaders<'_> {
	pub(crate) fn apply(
		self,
		req: wreq::RequestBuilder,
	) -> wreq::RequestBuilder {
		req.header("content-type", self.content_type)
			.header("content-length", self.length.to_string())
	}
}

#[derive(Clone, Copy)]
pub(crate) enum RequiredDeviceInfo {
	Real,
	Anonymous,
}

impl RequiredDeviceInfo {
	fn header_name(self) -> &'static str {
		match self {
			Self::Real => "requirerealdeviceinfo",
			Self::Anonymous => "requireanondeviceinfo",
		}
	}
}

pub(crate) fn apply_required_device_info(
	req: wreq::RequestBuilder,
	required: Option<RequiredDeviceInfo>,
) -> wreq::RequestBuilder {
	match required {
		Some(variant) => req.header(variant.header_name(), "true"),
		None => req,
	}
}

pub(crate) struct InnerClient {
	pub fingerprint: tokio::sync::RwLock<Arc<Fingerprint>>,
	pub captcha:
		std::sync::OnceLock<Arc<dyn crate::captcha::CaptchaTokenProvider>>,
	pub signing: tokio::sync::Mutex<Option<DeviceKey>>,
	pub signing_key_tx: watch::Sender<Option<DeviceSigningKey>>,
	pub server_offset_ms: AtomicI64,
	pub timeouts: Timeouts,
	pub media_liveness: Arc<crate::media::MediaLiveness>,
}

fn local_now_ms() -> i64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|d| d.as_millis() as i64)
		.unwrap_or(0)
}

impl InnerClient {
	pub async fn fingerprint(&self) -> Arc<Fingerprint> {
		Arc::clone(&*self.fingerprint.read().await)
	}

	pub async fn clear_signing(&self) {
		self.signing.lock().await.take();
		let _ = self.signing_key_tx.send(None);
	}

	pub async fn restore_signing_key(
		&self,
		auth: &AuthState,
		key: DeviceSigningKey,
	) -> bool {
		let known_user_id = session_user_id(auth).await.ok().flatten();
		if known_user_id.is_some_and(|id| id != key.user_id()) {
			return false;
		}
		match DeviceKey::from_stored(&key) {
			Some(device_key) => {
				*self.signing.lock().await = Some(device_key);
				let _ = self.signing_key_tx.send(Some(key));
				true
			}
			None => false,
		}
	}

	pub(crate) fn note_server_date(&self, headers: &HeaderMap) {
		let server_ms = headers
			.get("date")
			.and_then(|v| v.to_str().ok())
			.and_then(|d| httpdate::parse_http_date(d).ok())
			.and_then(|t| t.duration_since(UNIX_EPOCH).ok())
			.map(|d| d.as_millis() as i64);
		if let Some(server_ms) = server_ms {
			self.server_offset_ms
				.store(server_ms - local_now_ms(), Ordering::Relaxed);
		}
	}

	pub(crate) fn synced_now_ms(&self) -> u64 {
		(local_now_ms() + self.server_offset_ms.load(Ordering::Relaxed)).max(0)
			as u64
	}

	/// Refreshes first, so the blank profile id a token-resumed session starts
	/// with is filled in before a key binds to it.
	async fn signing_user_id(
		&self,
		auth: &AuthState,
	) -> Result<String, GrindrError> {
		crate::auth::authorize(self, auth).await?;
		match session_user_id(auth).await? {
			Some(id) => Ok(id),
			None => Err(GrindrError::Auth(
				"session has no profile id to bind a device key to".to_owned(),
			)),
		}
	}

	pub(crate) async fn ensure_device_key(
		&self,
		auth: &AuthState,
	) -> Result<(), GrindrError> {
		let user_id = self.signing_user_id(auth).await?;
		let mut guard = self.signing.lock().await;
		if guard.as_ref().is_some_and(|k| k.user_id() == user_id) {
			return Ok(());
		}

		let android_id = self.fingerprint().await.device.device_id.clone();
		let key = DeviceKey::generate(user_id);

		let challenge: crate::signing::ChallengeResponse = parse_json(
			self.exchange(
				Access::Session(auth),
				&Request::new(
					Method::POST,
					"/v1/verification/device-keys/challenge",
					Body::Empty,
				),
			)
			.await?,
		)?;

		let registration_signature =
			key.registration_signature(&android_id, &challenge.challenge);
		let body = Body::json(&crate::signing::RegisterKeyRequest {
			public_key: key.public_key(),
			key_id: key.key_id(),
			registration_signature: &registration_signature,
		})?;

		let captcha =
			match self.captcha.get() {
				Some(provider) => provider
					.token(crate::captcha::CaptchaAction::DeviceKeyRegistration)
					.await,
				None => None,
			};
		let registration = match captcha {
			Some(token) => {
				let mut request = Request::new(
					Method::POST,
					"/v2/verification/device-keys",
					body,
				);
				request.extra_headers.push((
					wreq::header::HeaderName::from_static(
						"x-grindr-captcha-token",
					),
					wreq::header::HeaderValue::from_str(&token)
						.map_err(|e| GrindrError::Http(e.to_string()))?,
				));
				request
			}
			None => {
				Request::new(Method::POST, "/v1/verification/device-keys", body)
			}
		};
		let resp = self.exchange(Access::Session(auth), &registration).await?;
		if !(200..300).contains(&resp.status) {
			return Err(parse_api_error(&resp.body, resp.status));
		}

		let exported = key.export();
		*guard = Some(key);
		let _ = self.signing_key_tx.send(Some(exported));
		Ok(())
	}
}

async fn session_user_id(
	auth: &AuthState,
) -> Result<Option<String>, GrindrError> {
	auth.session
		.read()
		.await
		.as_ref()
		.map(|s| s.credentials.profile_id.clone())
		.ok_or_else(|| GrindrError::Auth("not signed in".to_owned()))
}

const MAX_ERROR_BODY: usize = 256;
const MAX_ERROR_TITLE: usize = 100;

/// A `403` whose body isn't JSON: a Cloudflare block page, a WAF custom
/// response, or an intercepting proxy answered instead of the API. Scoped to
/// `403` — an HTML `502` is a plain upstream failure, not a block.
pub(crate) fn is_edge_block(status: u16, body: &[u8]) -> bool {
	if status != 403 {
		return false;
	}
	let body = body.trim_ascii();
	!body.is_empty()
		&& serde_json::from_slice::<serde_json::Value>(body).is_err()
}

/// Cloudflare's "Just a moment..." browser challenge.
pub(crate) fn is_cloudflare_challenge(status: u16, body: &[u8]) -> bool {
	if (200..300).contains(&status) {
		return false;
	}
	let text = String::from_utf8_lossy(body);
	text.contains("_cf_chl_opt")
		|| text.contains("/cdn-cgi/challenge-platform/")
}

fn is_cloudflare_block_page(body: &[u8]) -> bool {
	let text = String::from_utf8_lossy(body);
	text.contains("Attention Required! | Cloudflare")
		|| text.contains("Sorry, you have been blocked")
		|| text.contains("/cdn-cgi/")
}

pub(crate) fn block_kind(status: u16, body: &[u8]) -> Option<BlockKind> {
	if is_cloudflare_challenge(status, body) {
		return Some(BlockKind::Cloudflare);
	}
	if !is_edge_block(status, body) {
		return None;
	}
	Some(if is_cloudflare_block_page(body) {
		BlockKind::Cloudflare
	} else {
		BlockKind::Edge
	})
}

pub(crate) fn parse_json<T: DeserializeOwned>(
	response: RawResponse,
) -> Result<T, GrindrError> {
	if !(200..300).contains(&response.status) {
		return Err(parse_api_error(&response.body, response.status));
	}
	serde_json::from_slice(&response.body)
		.map_err(|e| GrindrError::Http(e.to_string()))
}

pub(crate) fn raw_or_blocked(
	status: u16,
	body: Vec<u8>,
) -> Result<RawResponse, GrindrError> {
	if let Some(kind) = block_kind(status, &body) {
		return Err(GrindrError::Blocked(kind));
	}
	Ok(RawResponse { status, body })
}

pub(crate) fn parse_api_error(bytes: &[u8], http_status: u16) -> GrindrError {
	if let Some(kind) = block_kind(http_status, bytes) {
		return GrindrError::Blocked(kind);
	}

	let (code, message) = extract_api_error(bytes, http_status);

	if let Some(kind) = BanKind::from_code(code) {
		return GrindrError::Banned(ban_info(kind, code, message, bytes));
	}

	match http_status {
		401 => GrindrError::Unauthorized { code, message },
		429 => GrindrError::RateLimited,
		_ => GrindrError::Api { code, message },
	}
}

fn ban_info(
	kind: BanKind,
	code: i32,
	message: String,
	bytes: &[u8],
) -> BanInfo {
	let json = serde_json::from_slice::<serde_json::Value>(bytes).ok();
	let field = |key: &str| json.as_ref().and_then(|j| j.get(key));
	BanInfo {
		kind,
		code,
		message,
		reason: field("reason").and_then(|v| v.as_str()).map(str::to_owned),
		sub_reason: field("banSubReason")
			.and_then(|v| v.as_str())
			.map(str::to_owned),
		automated: field("isBanAutomated").and_then(|v| v.as_bool()),
	}
}

fn extract_api_error(bytes: &[u8], http_status: u16) -> (i32, String) {
	if let Ok(json) = serde_json::from_slice::<serde_json::Value>(bytes) {
		let code = json
			.get("code")
			.and_then(|c| c.as_i64())
			.map(|c| c as i32)
			.unwrap_or(http_status as i32);
		if let Some(msg) = json.get("message").and_then(|m| m.as_str()) {
			return (code, msg.to_owned());
		}
	}
	(http_status as i32, summarize_error_body(bytes))
}

fn summarize_error_body(bytes: &[u8]) -> String {
	let lossy = String::from_utf8_lossy(bytes);
	let text = lossy.trim();
	if text.is_empty() {
		return "unknown error".to_owned();
	}
	if looks_like_markup(text) {
		let size = bytes.len();
		return match html_title(text) {
			Some(title) => {
				format!(
					"non-JSON response (html, {size} bytes, title: {title:?})"
				)
			}
			None => format!("non-JSON response (html, {size} bytes)"),
		};
	}
	if text.len() <= MAX_ERROR_BODY {
		return text.to_owned();
	}
	let mut end = MAX_ERROR_BODY;
	while end > 0 && !text.is_char_boundary(end) {
		end -= 1;
	}
	format!("{}...", &text[..end])
}

fn looks_like_markup(text: &str) -> bool {
	text.starts_with('<')
		|| find_ignore_ascii_case(text, "<html").is_some()
		|| find_ignore_ascii_case(text, "<!doctype").is_some()
}

/// Error templates routinely give the tag attributes, as in
/// `<title data-translate="error">`, so the opening tag ends at the next `>`.
fn html_title(text: &str) -> Option<String> {
	const OPEN: &str = "<title";
	let after_name = &text[find_ignore_ascii_case(text, OPEN)? + OPEN.len()..];
	let rest = &after_name[after_name.find('>')? + 1..];
	let title: String = rest[..find_ignore_ascii_case(rest, "</title>")?]
		.trim()
		.chars()
		.take(MAX_ERROR_TITLE)
		.collect();
	(!title.is_empty()).then_some(title)
}

/// An ASCII needle can only match at a char boundary, so offsets slice safely.
fn find_ignore_ascii_case(haystack: &str, needle: &str) -> Option<usize> {
	haystack
		.as_bytes()
		.windows(needle.len())
		.position(|w| w.eq_ignore_ascii_case(needle.as_bytes()))
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::auth::Session;
	use crate::GrindrClient;

	fn session_for(profile_id: Option<&str>) -> Session {
		Session {
			credentials: crate::auth::Credentials {
				email: "a@b.c".to_owned(),
				profile_id: profile_id.map(str::to_owned),
				auth_token: "auth-tok".to_owned(),
				kind: crate::auth::SessionKind::Email,
				third_party_user_id: None,
			},
			token: None,
		}
	}

	fn client_signed_in_as(profile_id: &str) -> GrindrClient {
		GrindrClient::new(
			DeviceInfo::generate(),
			Some(session_for(Some(profile_id))),
		)
		.unwrap()
	}

	fn client_resumed_without_profile() -> GrindrClient {
		GrindrClient::new(DeviceInfo::generate(), Some(session_for(None)))
			.unwrap()
	}

	async fn restored_key_user_id(client: &GrindrClient) -> Option<String> {
		client
			.signing_key_receiver()
			.borrow()
			.as_ref()
			.map(|k| k.user_id().to_owned())
	}

	#[tokio::test]
	async fn a_signing_key_from_another_account_is_refused() {
		let client = client_signed_in_as("42");
		let foreign = DeviceKey::generate("99".to_owned()).export();

		assert!(!client.restore_signing_key(foreign).await);
		assert!(
			restored_key_user_id(&client).await.is_none(),
			"a refused key must not reach the signing slot or the watch"
		);
	}

	#[tokio::test]
	async fn a_signing_key_is_restored_for_its_own_account() {
		let client = client_signed_in_as("42");
		let own = DeviceKey::generate("42".to_owned()).export();

		assert!(client.restore_signing_key(own).await);
		assert_eq!(restored_key_user_id(&client).await.as_deref(), Some("42"));
	}

	#[tokio::test]
	async fn a_token_resumed_session_accepts_a_key_before_its_first_refresh() {
		let client = client_resumed_without_profile();
		let key = DeviceKey::generate("42".to_owned()).export();

		assert!(client.restore_signing_key(key).await);
	}

	#[test]
	fn accepts_absolute_paths() {
		assert!(validate_path("/v3/me/profile").is_ok());
		assert!(validate_path("/").is_ok());
	}

	#[test]
	fn rejects_host_repointing_paths() {
		for bad in ["@evil.com/x", "https://evil.com", "evil.com", ""] {
			assert!(
				matches!(
					validate_path(bad),
					Err(GrindrError::InvalidRequest(_))
				),
				"expected {bad:?} to be rejected"
			);
		}
	}

	#[test]
	fn from_response_parses_api_code_and_message() {
		let err = GrindrError::from_response(
			400,
			br#"{"code":4,"message":"Media not allowed"}"#,
		);
		assert!(
			matches!(err, GrindrError::Api { code: 4, ref message } if message == "Media not allowed"),
			"got {err:?}"
		);
	}

	#[test]
	fn from_response_maps_401_to_unauthorized() {
		let err = GrindrError::from_response(401, b"{}");
		assert!(matches!(err, GrindrError::Unauthorized { code: 401, .. }));
	}

	#[test]
	fn from_response_maps_429_to_rate_limited() {
		let err = GrindrError::from_response(429, b"{}");
		assert!(matches!(err, GrindrError::RateLimited));
	}

	#[test]
	fn from_response_classifies_ban_with_body_fields() {
		let err = GrindrError::from_response(
            403,
            br#"{"code":27,"message":"Profile is banned","banSubReason":"DRUG_SALES","isBanAutomated":true}"#,
        );
		let GrindrError::Banned(info) = err else {
			panic!("expected Banned, got {err:?}");
		};
		assert_eq!(info.kind, BanKind::Profile);
		assert_eq!(info.code, 27);
		assert_eq!(info.sub_reason.as_deref(), Some("DRUG_SALES"));
		assert_eq!(info.automated, Some(true));
	}

	#[test]
	fn from_response_maps_device_ban_code() {
		let err = GrindrError::from_response(
			403,
			br#"{"code":28,"message":"ACCOUNT_BANNED"}"#,
		);
		assert!(
			matches!(err, GrindrError::Banned(info) if info.kind == BanKind::Device)
		);
	}

	const CLOUDFLARE_BLOCK_PAGE: &[u8] = br#"<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head><body><h1>Sorry, you have been blocked</h1><p>You are unable to access grindr.mobi</p></body></html>"#;

	#[test]
	fn from_response_maps_cloudflare_block_to_blocked() {
		let err = GrindrError::from_response(403, CLOUDFLARE_BLOCK_PAGE);
		assert!(
			matches!(err, GrindrError::Blocked(BlockKind::Cloudflare)),
			"got {err:?}"
		);
	}

	/// A WAF custom response: a block that carries none of the markers the
	/// classic interstitial does.
	const WAF_CUSTOM_BLOCK_PAGE: &[u8] =
		br#"<!DOCTYPE html><html><head><title>Access denied</title></head><body><h1>Request rejected</h1><p>Error code 1020</p></body></html>"#;

	#[test]
	fn edge_block_catches_any_non_json_403() {
		for page in [
			CLOUDFLARE_BLOCK_PAGE,
			CLOUDFLARE_CHALLENGE_PAGE,
			WAF_CUSTOM_BLOCK_PAGE,
			b"<title>Attention Required! | Cloudflare</title>",
			b"Forbidden",
		] {
			assert!(is_edge_block(403, page), "expected a block for {page:?}");
			assert!(matches!(
				GrindrError::from_response(403, page),
				GrindrError::Blocked(_)
			));
		}
	}

	#[test]
	fn only_cloudflare_pages_are_attributed_to_cloudflare() {
		for page in [CLOUDFLARE_BLOCK_PAGE, CLOUDFLARE_CHALLENGE_PAGE] {
			assert_eq!(block_kind(403, page), Some(BlockKind::Cloudflare));
		}
		for page in [WAF_CUSTOM_BLOCK_PAGE, &b"Forbidden"[..]] {
			assert_eq!(block_kind(403, page), Some(BlockKind::Edge));
		}
		assert_eq!(block_kind(403, br#"{"code":28}"#), None);
	}

	#[test]
	fn a_challenge_is_cloudflare_on_non_403_statuses() {
		for status in [429, 503] {
			assert_eq!(
				block_kind(status, CLOUDFLARE_CHALLENGE_PAGE),
				Some(BlockKind::Cloudflare),
			);
			assert_eq!(block_kind(status, WAF_CUSTOM_BLOCK_PAGE), None);
		}
	}

	#[test]
	fn edge_block_leaves_api_answered_403s_alone() {
		for body in [
			&br#"{"code":28,"message":"ACCOUNT_BANNED"}"#[..],
			&br#"{"type":"urn:gr:err:unauthorized_action","status":403}"#[..],
			b"",
			b"   ",
		] {
			assert!(!is_edge_block(403, body), "unexpected block for {body:?}");
		}
	}

	#[test]
	fn edge_block_is_scoped_to_403() {
		for status in [400, 401, 429, 500, 502, 503] {
			assert!(
				!is_edge_block(status, WAF_CUSTOM_BLOCK_PAGE),
				"expected {status} to stay an upstream failure"
			);
		}
		assert!(!is_edge_block(200, WAF_CUSTOM_BLOCK_PAGE));
	}

	/// A plain upstream failure: HTML, but with no block or edge marker.
	const UPSTREAM_HTML_ERROR_PAGE: &[u8] = br#"<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><center><h1>Bad Gateway</h1></center><hr><center>nginx</center></body></html>"#;

	#[test]
	fn an_unmarked_html_502_stays_an_upstream_failure() {
		assert_eq!(block_kind(502, UPSTREAM_HTML_ERROR_PAGE), None);

		let err = GrindrError::from_response(502, UPSTREAM_HTML_ERROR_PAGE);
		let GrindrError::Api { code, message } = err else {
			panic!("expected an Api error, got {err:?}");
		};
		assert_eq!(code, 502);
		assert!(!message.contains('<'), "markup leaked: {message}");
		assert!(!message.contains("nginx"), "page text leaked: {message}");
		assert!(
			message.contains("html")
				&& message
					.contains(&UPSTREAM_HTML_ERROR_PAGE.len().to_string())
				&& message.contains("502 Bad Gateway"),
			"expected a summary with size and title, got {message}"
		);
	}

	const CLOUDFLARE_CHALLENGE_PAGE: &[u8] = br#"<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="refresh" content="360"></head><body><div class="main-wrapper" role="main"><noscript><span id="challenge-error-text">Enable JavaScript and cookies to continue</span></noscript></div><script nonce="UWPAt20YJwDjVxfZvpSJVX">(function(){window._cf_chl_opt = {cRay: 'a1fbdcf40dd6851a',cType: 'interactive',cZone: 'grindr.mobi'};var a = document.createElement('script');a.src = '/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=a1fbdcf40dd6851a';document.getElementsByTagName('head')[0].appendChild(a);}());</script></body></html>"#;

	#[test]
	fn from_response_maps_cloudflare_challenge_to_blocked() {
		let err = GrindrError::from_response(403, CLOUDFLARE_CHALLENGE_PAGE);
		assert!(
			matches!(err, GrindrError::Blocked(BlockKind::Cloudflare)),
			"got {err:?}"
		);
	}

	#[test]
	fn challenge_is_detected_on_every_status_cloudflare_uses() {
		for status in [403, 429, 503] {
			assert!(
				is_cloudflare_challenge(status, CLOUDFLARE_CHALLENGE_PAGE),
				"expected {status} challenge to be detected"
			);
			assert!(matches!(
				GrindrError::from_response(status, CLOUDFLARE_CHALLENGE_PAGE),
				GrindrError::Blocked(BlockKind::Cloudflare)
			));
		}
	}

	#[test]
	fn either_challenge_marker_alone_is_conclusive() {
		assert!(is_cloudflare_challenge(
			403,
			b"<html><script>window._cf_chl_opt = {};</script></html>"
		));
		assert!(is_cloudflare_challenge(
			403,
			b"<html><script src='/cdn-cgi/challenge-platform/h/b/x'></script></html>"
		));
		// The title alone is localized, so it is deliberately not a marker
		assert!(!is_cloudflare_challenge(
			403,
			b"<html><head><title>Just a moment...</title></head></html>"
		));
	}

	#[test]
	fn challenge_check_skips_successful_responses() {
		assert!(!is_cloudflare_challenge(200, CLOUDFLARE_CHALLENGE_PAGE));
		assert!(!is_cloudflare_challenge(204, CLOUDFLARE_CHALLENGE_PAGE));
		assert!(is_cloudflare_challenge(403, CLOUDFLARE_CHALLENGE_PAGE));
	}

	#[test]
	fn challenge_check_leaves_grindr_error_bodies_alone() {
		for body in [
			&br#"{"code":28,"message":"ACCOUNT_BANNED"}"#[..],
			&br#"{"code":4,"message":"Media not allowed"}"#[..],
			b"Bad Gateway",
			b"",
		] {
			assert!(!is_cloudflare_challenge(403, body));
			assert!(!is_cloudflare_challenge(429, body));
		}
		assert!(matches!(
			GrindrError::from_response(429, b"{}"),
			GrindrError::RateLimited
		));
	}

	#[test]
	fn raw_or_blocked_rejects_every_interstitial() {
		for page in [
			CLOUDFLARE_BLOCK_PAGE,
			CLOUDFLARE_CHALLENGE_PAGE,
			WAF_CUSTOM_BLOCK_PAGE,
		] {
			let err = raw_or_blocked(403, page.to_vec()).unwrap_err();
			assert!(matches!(err, GrindrError::Blocked(_)), "got {err:?}");
		}
		let ok = raw_or_blocked(403, b"{\"code\":4}".to_vec()).unwrap();
		assert_eq!(ok.status, 403);
	}

	#[test]
	fn cloudflare_check_precedes_ban_classification() {
		let err = GrindrError::from_response(
			403,
			br#"{"code":27,"message":"Profile is banned"}"#,
		);
		assert!(matches!(err, GrindrError::Banned(_)), "got {err:?}");
	}

	#[test]
	fn from_response_falls_back_to_raw_body() {
		let err = GrindrError::from_response(502, b"Bad Gateway");
		assert!(
			matches!(err, GrindrError::Api { code: 502, ref message } if message == "Bad Gateway"),
			"got {err:?}"
		);

		let err = GrindrError::from_response(500, b"");
		assert!(
			matches!(err, GrindrError::Api { code: 500, ref message } if message == "unknown error"),
			"got {err:?}"
		);
	}

	#[test]
	fn a_json_body_without_a_message_is_not_dumped_whole() {
		let body = format!(r#"{{"trace":"{}"}}"#, "x".repeat(4096));
		let err = GrindrError::from_response(500, body.as_bytes());
		let GrindrError::Api { message, .. } = err else {
			panic!("expected an Api error, got {err:?}");
		};
		assert!(message.len() <= MAX_ERROR_BODY + 3, "{}", message.len());
	}

	#[test]
	fn an_attributed_title_is_still_read() {
		let page: &[u8] = br#"<!DOCTYPE html><html><head><title data-translate="error">Access denied</title></head><body>nope</body></html>"#;
		let err = GrindrError::from_response(500, page);
		let GrindrError::Api { message, .. } = err else {
			panic!("expected an Api error, got {err:?}");
		};
		assert!(
			message.contains("title: \"Access denied\""),
			"expected the title to be read, got {message}"
		);
	}

	#[test]
	fn a_titleless_markup_body_is_still_summarized() {
		let page: &[u8] = b"<html><body>upstream exploded</body></html>";
		let err = GrindrError::from_response(500, page);
		let GrindrError::Api { message, .. } = err else {
			panic!("expected an Api error, got {err:?}");
		};
		assert_eq!(
			message,
			format!("non-JSON response (html, {} bytes)", page.len())
		);
	}

	#[test]
	fn from_response_truncates_long_bodies_on_char_boundaries() {
		// 3-byte chars with MAX_ERROR_BODY % 3 == 1 put the cut mid-character,
		// so this only passes if the boundary backoff steps back a byte.
		let body = "€".repeat(400);
		let err = GrindrError::from_response(500, body.as_bytes());
		let GrindrError::Api { message, .. } = err else {
			panic!("expected Api error");
		};
		let prefix = message.strip_suffix("...").expect("truncation suffix");
		assert_eq!(prefix.len(), MAX_ERROR_BODY - 1);
		assert!(prefix.chars().all(|c| c == '€'));
	}

	#[tokio::test]
	async fn okhttp_byte_parity_on_pre_auth_requests() {
		let device = DeviceInfo::generate();
		let device_id = device.device_id.clone();
		let client = GrindrClient::new(device, None).unwrap();

		client.recaptcha_first_party_enabled().await.ok();

		let requests = crate::testserver::requests_from(&device_id);
		let assignments = requests
			.iter()
			.find(|r| r.path == "/public/v1/assignments")
			.expect("assignments request recorded");
		assert_eq!(
			assignments.header("requireanondeviceinfo"),
			Some("true"),
			"the public endpoint asks for anonymous device info"
		);
		assert_eq!(
			assignments.headers[0].0.to_ascii_lowercase(),
			"requireanondeviceinfo",
			"the device-info header precedes every client header"
		);
	}

	#[tokio::test]
	async fn sign_in_and_a_refresh_of_the_same_url_are_both_marked() {
		let device = DeviceInfo::generate();
		let device_id = device.device_id.clone();
		let client = GrindrClient::new(device, None).unwrap();
		client.sign_in_with_email("a@b.c", "pw").await.unwrap();

		let sign_in = crate::testserver::requests_from(&device_id)
			.into_iter()
			.find(|r| r.path == "/v8/sessions")
			.expect("sign-in recorded");
		assert_eq!(
			sign_in.header("requirerealdeviceinfo"),
			Some("true"),
			"LoginRestService annotates sign-in with requireRealDeviceInfo"
		);
		assert_eq!(
			sign_in.header("content-type"),
			Some(JSON_CONTENT_TYPE),
			"Moshi's media type, charset included"
		);

		let refresh_device = DeviceInfo::generate();
		let refresh_device_id = refresh_device.device_id.clone();
		let refreshing = GrindrClient::new(
			refresh_device,
			Some(Session {
				credentials: crate::auth::Credentials {
					email: "a@b.c".to_owned(),
					profile_id: None,
					auth_token: "stored-tok".to_owned(),
					kind: crate::auth::SessionKind::Email,
					third_party_user_id: None,
				},
				token: None,
			}),
		)
		.unwrap();
		refreshing
			.request(Method::GET, "/v3/bootstrap")
			.send()
			.await
			.unwrap();

		let refresh = crate::testserver::requests_from(&refresh_device_id)
			.into_iter()
			.find(|r| r.path == "/v8/sessions")
			.expect("refresh recorded");
		assert_eq!(
			refresh.header("requirerealdeviceinfo"),
			Some("true"),
			"RefreshSessionRestService annotates refresh with requireRealDeviceInfo"
		);
		assert_eq!(
			refresh.headers[0].0.to_ascii_lowercase(),
			"requirerealdeviceinfo",
			"the device-info header precedes every client header"
		);
	}

	#[tokio::test]
	async fn a_third_party_refresh_is_marked() {
		let device = DeviceInfo::generate();
		let device_id = device.device_id.clone();
		let client = GrindrClient::new(
			device,
			Some(Session {
				credentials: crate::auth::Credentials {
					email: "a@b.c".to_owned(),
					profile_id: None,
					auth_token: "stored-tok".to_owned(),
					kind: crate::auth::SessionKind::Google,
					third_party_user_id: Some("vendor-uid".to_owned()),
				},
				token: None,
			}),
		)
		.unwrap();
		client.refresh_session().await.unwrap_err();

		let refresh = crate::testserver::requests_from(&device_id)
			.into_iter()
			.find(|r| r.path == "/v8/sessions/thirdparty")
			.expect("refresh recorded");
		assert_eq!(refresh.header("requirerealdeviceinfo"), Some("true"));
		assert_eq!(
			refresh.headers[0].0.to_ascii_lowercase(),
			"requirerealdeviceinfo"
		);
	}

	#[tokio::test]
	async fn a_bodied_request_ends_with_okhttp_s_bridge_interceptor_order() {
		let device = DeviceInfo::generate();
		let device_id = device.device_id.clone();
		let client = GrindrClient::new(device, None).unwrap();
		client.sign_in_with_email("a@b.c", "pw").await.unwrap();

		let sign_in = crate::testserver::requests_from(&device_id)
			.into_iter()
			.find(|r| r.path == "/v8/sessions")
			.expect("sign-in recorded");
		let names: Vec<String> = sign_in
			.headers
			.iter()
			.map(|(n, _)| n.to_ascii_lowercase())
			.collect();
		let at = |n: &str| names.iter().position(|h| h == n);
		let (ct, cl, ae) = (
			at("content-type").expect("content-type"),
			at("content-length").expect("content-length"),
			at("accept-encoding").expect("accept-encoding"),
		);
		assert!(
			ct < cl && cl < ae,
			"BridgeInterceptor appends Content-Type, Content-Length, then Accept-Encoding; got {names:?}"
		);
		assert_eq!(
			names.iter().filter(|h| *h == "content-length").count(),
			1,
			"setting content-length ourselves must not duplicate hyper's"
		);
	}
}
