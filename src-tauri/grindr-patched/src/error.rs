use std::fmt;

use thiserror::Error;

/// Who answered instead of the API, for a [`GrindrError::Blocked`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockKind {
	/// A Cloudflare block page or "Just a moment..." browser challenge.
	Cloudflare,
	/// An interstitial block.
	Edge,
}

impl fmt::Display for BlockKind {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			BlockKind::Cloudflare => write!(f, "Cloudflare"),
			BlockKind::Edge => write!(f, "network edge"),
		}
	}
}

/// Where a request was when it timed out, for a [`GrindrError::Timeout`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum TimeoutPhase {
	/// The request body stopped being sent.
	Sending,
	/// The response headers did not arrive in time.
	Headers,
	/// The response body stopped arriving.
	Receiving,
	/// The whole transfer ran past its ceiling.
	Unfinished,
}

impl fmt::Display for TimeoutPhase {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.write_str(match self {
			TimeoutPhase::Sending => "the upload stopped moving",
			TimeoutPhase::Headers => "no response in time",
			TimeoutPhase::Receiving => "the response stopped moving",
			TimeoutPhase::Unfinished => "the transfer did not finish in time",
		})
	}
}

/// Errors returned by this crate.
///
/// The enum is `#[non_exhaustive]`; match with a wildcard arm so that future
/// variants do not break your build.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum GrindrError {
	/// Transport-level failure (connection, TLS, malformed header value).
	#[error("HTTP error: {0}")]
	Http(String),

	/// The connection to the server could not be established (DNS, TCP or TLS).
	#[error("could not connect: {0}")]
	Connect(String),

	/// A request timed out.
	#[error("timed out: {0}")]
	Timeout(TimeoutPhase),

	/// Authentication problem that is not a server `401` (e.g. not signed in,
	/// JWT could not be decoded, or a third-party account is not registered).
	#[error("auth error: {0}")]
	Auth(String),

	/// The API returned a non-success status. `code` is the Grindr error code
	/// from the body, or the HTTP status if there isn't one.
	#[error("API error {code}: {message}")]
	Api {
		/// Grindr error code, or the HTTP status if absent.
		code: i32,
		/// Message from the response body.
		message: String,
	},

	/// The API returned `401`. If this happens during a token refresh, the
	/// session is cleared for you.
	#[error("unauthorized ({code}): {message}")]
	Unauthorized {
		/// Grindr error code, or `401` if absent.
		code: i32,
		/// Message from the response body.
		message: String,
	},

	/// Sign-in or refresh was refused because the account, device, or network
	/// is banned.
	#[error("banned: {0}")]
	Banned(BanInfo),

	/// The API returned `429`.
	#[error("rate limited")]
	RateLimited,

	/// An edge in front of Grindr answered instead of the API: a Cloudflare
	/// block page, a "Just a moment..." browser challenge, a WAF custom
	/// response, or an intercepting proxy — usually because Cloudflare didn't
	/// like the TLS/HTTP fingerprint. Recognized by shape: a `403` whose body
	/// isn't JSON, or a challenge marker on any non-success status.
	///
	/// Often transient: retrying the same request sometimes gets through, so
	/// this is worth a backoff-and-retry rather than treating it as terminal.
	/// If it persists, rotate the device identity with
	/// [`rotate_device`](crate::GrindrClient::rotate_device).
	#[error("blocked before reaching the API ({0})")]
	Blocked(BlockKind),

	/// A request argument was malformed, e.g. a path that does not begin with
	/// `/` and could therefore repoint the request to a different host.
	#[error("invalid request: {0}")]
	InvalidRequest(String),

	/// Signed out while this request was in flight
	#[error("session was cleared while the request was in flight")]
	SessionCleared,

	/// A media body is larger than `MediaRequest::max_bytes` and was not buffered.
	#[error("media body exceeds {max_bytes} bytes")]
	MediaTooLarge {
		/// The ceiling the request set.
		max_bytes: usize,
	},
}

/// What a [`GrindrError::Banned`] applies to, from the error code in the body.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum BanKind {
	/// Code 27.
	Profile,
	/// Code 28. Often spurious: a bad security fingerprint blocks the request,
	/// not the account.
	Device,
	/// Code 31 (`SUSPICIOUS_NETWORK`).
	Network,
	/// Codes 35 and 36 (underage).
	Underage,
}

impl BanKind {
	pub(crate) fn from_code(code: i32) -> Option<Self> {
		Some(match code {
			27 => Self::Profile,
			28 => Self::Device,
			31 => Self::Network,
			35 | 36 => Self::Underage,
			_ => return None,
		})
	}
}

/// Details of a ban from the sign-in/refresh response body.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct BanInfo {
	/// What the ban applies to.
	pub kind: BanKind,
	/// Grindr error code.
	pub code: i32,
	/// Message from the body.
	pub message: String,
	/// Body `reason`, if present.
	pub reason: Option<String>,
	/// Body `banSubReason`, if present.
	pub sub_reason: Option<String>,
	/// Body `isBanAutomated`, if present.
	pub automated: Option<bool>,
}

impl std::fmt::Display for BanInfo {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		write!(f, "{:?} (code {}): {}", self.kind, self.code, self.message)
	}
}

impl GrindrError {
	/// Builds the error for a non-success [`RawResponse`](crate::RawResponse).
	pub fn from_response(status: u16, body: &[u8]) -> Self {
		crate::rest::parse_api_error(body, status)
	}
}

impl From<wreq::Error> for GrindrError {
	fn from(e: wreq::Error) -> Self {
		if e.is_connect() {
			GrindrError::Connect(e.to_string())
		} else if e.is_timeout() {
			GrindrError::Timeout(if e.is_request() {
				TimeoutPhase::Headers
			} else {
				TimeoutPhase::Receiving
			})
		} else {
			GrindrError::Http(e.to_string())
		}
	}
}

#[cfg(test)]
mod tests {
	use std::time::{Duration, Instant};

	use super::*;
	use crate::client::{ClientSetup, Timeouts};
	use crate::testserver::{
		HOLD_BEFORE_CLOSING, MEDIA_PREFIX, SLOW_READ_PREFIX, STALLED_PATH,
	};
	use crate::{DeviceInfo, GrindrClient, Method};

	#[tokio::test]
	async fn a_refused_connection_is_a_connect_error() {
		let error = wreq::Client::new()
			.get("http://127.0.0.1:1/")
			.send()
			.await
			.unwrap_err();
		assert!(matches!(GrindrError::from(error), GrindrError::Connect(_)));
	}

	fn client_with(timeouts: Timeouts) -> GrindrClient {
		GrindrClient::from_setup(ClientSetup {
			device: DeviceInfo::generate(),
			session: None,
			timeouts,
		})
		.unwrap()
	}

	async fn upload_error(upload: Duration, path: &str) -> GrindrError {
		client_with(Timeouts {
			upload,
			..Timeouts::default()
		})
		.request(Method::POST, path)
		.unauthenticated()
		.bytes("image/jpeg", vec![0; 64])
		.send()
		.await
		.unwrap_err()
	}

	#[tokio::test]
	async fn an_answer_still_arriving_at_the_call_ceiling_is_unfinished() {
		let path = format!("{MEDIA_PREFIX}72?drip=100");

		let error = upload_error(Duration::from_millis(300), &path).await;

		assert!(
			matches!(error, GrindrError::Timeout(TimeoutPhase::Unfinished)),
			"got {error:?}"
		);
	}

	#[tokio::test]
	async fn a_reply_not_begun_by_the_call_ceiling_is_unfinished() {
		let path = format!("{SLOW_READ_PREFIX}1600");

		let error = upload_error(Duration::from_millis(300), &path).await;

		assert!(
			matches!(error, GrindrError::Timeout(TimeoutPhase::Unfinished)),
			"got {error:?}"
		);
	}

	#[tokio::test]
	async fn an_api_request_without_headers_times_out_waiting_for_them() {
		let read = Duration::from_millis(300);
		let client = GrindrClient::from_setup(ClientSetup {
			device: DeviceInfo::generate(),
			session: None,
			timeouts: Timeouts {
				read,
				..Timeouts::default()
			},
		})
		.unwrap();
		let started = Instant::now();

		let error = client
			.request(Method::GET, STALLED_PATH)
			.unauthenticated()
			.send()
			.await
			.unwrap_err();

		assert!(
			matches!(error, GrindrError::Timeout(TimeoutPhase::Headers)),
			"got {error:?}"
		);
		assert!(started.elapsed() >= read);
		assert!(started.elapsed() < HOLD_BEFORE_CLOSING);
	}
}
