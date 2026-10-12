use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use serde::de::DeserializeOwned;
use serde::Serialize;
use tokio::time::Instant;
use wreq::header::{HeaderName, HeaderValue};
use wreq::Method;

use crate::auth::{self, AuthState, Authorization};
use crate::client::CALL_TIMEOUT;
use crate::error::{GrindrError, TimeoutPhase};
use crate::headers::GrindrHeaders;
use crate::rest::{
	apply_required_device_info, base_url, parse_json, raw_or_blocked,
	validate_path, BodyHeaders, Fingerprint, InnerClient, RawResponse,
	RequiredDeviceInfo, ACCEPT_ENCODING, JSON_CONTENT_TYPE,
};
use crate::signing::{signing_reject, SigningReject};
use crate::stream::{BodySource, StreamedRequest};

/// A request to the API, sent with the session unless
/// [`unauthenticated`](Self::unauthenticated).
#[must_use = "a request does nothing until it is sent"]
pub struct RequestBuilder {
	inner: Arc<InnerClient>,
	auth: Arc<AuthState>,
	method: Method,
	path: String,
	body: Result<Body, GrindrError>,
	unauthenticated: bool,
}

pub(crate) enum Body {
	Empty,
	Json(Bytes),
	Bytes {
		content_type: HeaderValue,
		bytes: Bytes,
	},
	Signed {
		content_type: HeaderValue,
		bytes: Bytes,
	},
	Stream {
		content_type: HeaderValue,
		source: Arc<dyn BodySource>,
	},
}

pub(crate) struct Request<'a> {
	pub method: Method,
	pub path: &'a str,
	pub body: Body,
	pub required_device_info: Option<RequiredDeviceInfo>,
	pub extra_headers: Vec<(HeaderName, HeaderValue)>,
}

#[derive(Clone, Copy)]
pub(crate) enum Access<'a> {
	Anonymous,
	Session(&'a AuthState),
}

pub(crate) struct Answer {
	pub status: u16,
	pub body: Bytes,
}

impl RequestBuilder {
	pub(crate) fn new(
		inner: Arc<InnerClient>,
		auth: Arc<AuthState>,
		method: Method,
		path: &str,
	) -> Self {
		Self {
			inner,
			auth,
			method,
			path: path.to_owned(),
			body: Ok(Body::Empty),
			unauthenticated: false,
		}
	}

	/// Sends `body` serialized as JSON; `None` is sent as `null`.
	pub fn json<T: Serialize + ?Sized>(mut self, body: &T) -> Self {
		self.body = Body::json(body);
		self
	}

	/// Sends `body` as it is, with a 120 s timeout.
	pub fn bytes(mut self, content_type: &str, body: impl Into<Bytes>) -> Self {
		self.body =
			parse_content_type(content_type).map(|content_type| Body::Bytes {
				content_type,
				bytes: body.into(),
			});
		self
	}

	/// Like [`bytes`](Self::bytes), signed with the device key.
	pub fn signed_bytes(
		mut self,
		content_type: &str,
		body: impl Into<Bytes>,
	) -> Self {
		self.body =
			parse_content_type(content_type).map(|content_type| Body::Signed {
				content_type,
				bytes: body.into(),
			});
		self
	}

	/// Sends `source` while reading it; a stall timeout replaces the total one.
	pub fn stream(
		mut self,
		content_type: &str,
		source: impl BodySource + 'static,
	) -> Self {
		self.body =
			parse_content_type(content_type).map(|content_type| Body::Stream {
				content_type,
				source: Arc::new(source),
			});
		self
	}

	/// Sends the request without the session.
	pub fn unauthenticated(mut self) -> Self {
		self.unauthenticated = true;
		self
	}

	/// Sends the request and returns the response, whatever its status.
	pub async fn send(self) -> Result<RawResponse, GrindrError> {
		let access = if self.unauthenticated {
			Access::Anonymous
		} else {
			Access::Session(&self.auth)
		};
		let request = Request::new(self.method, &self.path, self.body?);
		self.inner.send(access, &request).await
	}
}

fn parse_content_type(content_type: &str) -> Result<HeaderValue, GrindrError> {
	HeaderValue::from_str(content_type).map_err(|_| {
		GrindrError::InvalidRequest(format!(
			"invalid content type {content_type:?}"
		))
	})
}

impl Body {
	pub(crate) fn json<T: Serialize + ?Sized>(
		body: &T,
	) -> Result<Self, GrindrError> {
		serde_json::to_value(body)
			.and_then(|value| serde_json::to_vec(&value))
			.map(|bytes| Self::Json(bytes.into()))
			.map_err(|e| GrindrError::InvalidRequest(e.to_string()))
	}
}

impl<'a> Request<'a> {
	pub(crate) fn new(method: Method, path: &'a str, body: Body) -> Self {
		Self {
			method,
			path,
			body,
			required_device_info: None,
			extra_headers: Vec::new(),
		}
	}
}

impl InnerClient {
	pub(crate) async fn request_no_auth<TReq, TResp>(
		&self,
		method: Method,
		path: &str,
		body: Option<&TReq>,
		required_device_info: RequiredDeviceInfo,
	) -> Result<TResp, GrindrError>
	where
		TReq: Serialize + ?Sized,
		TResp: DeserializeOwned,
	{
		let body = match body {
			Some(body) => Body::json(body)?,
			None => Body::Empty,
		};
		let mut request = Request::new(method, path, body);
		request.required_device_info = Some(required_device_info);
		parse_json(self.anonymous(&request).await?)
	}

	async fn anonymous(
		&self,
		request: &Request<'_>,
	) -> Result<RawResponse, GrindrError> {
		let answer = self.attempt(request, None).await?;
		raw_or_blocked(answer.status, answer.body.to_vec())
	}

	pub(crate) async fn send(
		&self,
		access: Access<'_>,
		request: &Request<'_>,
	) -> Result<RawResponse, GrindrError> {
		validate_path(request.path)?;
		if let Body::Signed { .. } = request.body {
			let Access::Session(auth) = access else {
				return Err(GrindrError::InvalidRequest(
					"a signed body needs the session".to_owned(),
				));
			};
			self.ensure_device_key(auth).await?;
		}
		self.exchange(access, request).await
	}

	pub(crate) async fn exchange(
		&self,
		access: Access<'_>,
		request: &Request<'_>,
	) -> Result<RawResponse, GrindrError> {
		let Access::Session(auth) = access else {
			return self.anonymous(request).await;
		};
		let signed = matches!(request.body, Body::Signed { .. });
		let mut authorization = auth::authorize(self, auth).await?;
		let mut refreshed = false;
		let mut resigned = false;
		loop {
			let answer = self.attempt(request, Some(&authorization)).await?;
			if answer.status == 401 && !refreshed {
				refreshed = true;
				if auth::refresh_after_unauthorized(
					self,
					auth,
					&authorization.session_id,
				)
				.await
				{
					authorization = auth::reauthorize_same_profile(
						self,
						auth,
						&authorization,
					)
					.await?;
					continue;
				}
			}
			if signed && !(200..300).contains(&answer.status) {
				match signing_reject(&answer.body) {
					Some(SigningReject::Retryable) if !resigned => {
						resigned = true;
						authorization = auth::reauthorize_same_profile(
							self,
							auth,
							&authorization,
						)
						.await?;
						continue;
					}
					Some(SigningReject::Fatal) => self.clear_signing().await,
					_ => {}
				}
			}
			return raw_or_blocked(answer.status, answer.body.to_vec());
		}
	}

	async fn attempt(
		&self,
		request: &Request<'_>,
		authorization: Option<&Authorization>,
	) -> Result<Answer, GrindrError> {
		let fp = self.fingerprint().await;
		let header = authorization.map(Authorization::header);
		let mut headers = GrindrHeaders::build(
			&fp.device,
			&fp.user_agent,
			header.as_deref(),
			authorization.map(|_| "[FREE]"),
		)?;
		headers.items.extend_from_slice(&request.extra_headers);
		let builder = apply_required_device_info(
			fp.http.request(
				request.method.clone(),
				format!("{}{}", base_url(), request.path),
			),
			request.required_device_info,
		);

		let builder = match &request.body {
			Body::Stream {
				content_type,
				source,
			} => {
				return self
					.send_streamed(StreamedRequest {
						request: builder,
						headers: &headers.items,
						content_type,
						source,
					})
					.await;
			}
			Body::Signed {
				content_type,
				bytes,
			} => {
				self.signed_bytes(&fp, builder, &headers, content_type, bytes)
					.await?
			}
			Body::Json(bytes) => Self::apply_headers_then_bytes(
				builder,
				&headers.items,
				&HeaderValue::from_static(JSON_CONTENT_TYPE),
				bytes,
			),
			Body::Bytes {
				content_type,
				bytes,
			} => Self::apply_headers_then_bytes(
				builder,
				&headers.items,
				content_type,
				bytes,
			),
			Body::Empty => Self::apply_headers_then_body(
				builder,
				&headers.items,
				|builder| builder,
			),
		};
		let ceiling = self.ceiling(&request.body);
		let started = Instant::now();
		let past_ceiling = |error: wreq::Error| match GrindrError::from(error) {
			GrindrError::Timeout(_) if started.elapsed() >= ceiling => {
				GrindrError::Timeout(TimeoutPhase::Unfinished)
			}
			error => error,
		};
		let response = self
			.apply_timeouts(builder, &request.body)
			.send()
			.await
			.map_err(past_ceiling)?;
		self.note_server_date(response.headers());
		Ok(Answer {
			status: response.status().as_u16(),
			body: response.bytes().await.map_err(past_ceiling)?,
		})
	}

	async fn signed_bytes(
		&self,
		fp: &Fingerprint,
		builder: wreq::RequestBuilder,
		headers: &GrindrHeaders,
		content_type: &HeaderValue,
		bytes: &Bytes,
	) -> Result<wreq::RequestBuilder, GrindrError> {
		let signature = self
			.signing
			.lock()
			.await
			.as_ref()
			.ok_or_else(|| {
				GrindrError::Auth("device key not registered".to_owned())
			})?
			.upload_headers(&fp.device.device_id, bytes, self.synced_now_ms());
		Ok(Self::apply_headers(builder, &headers.items)
			.header("x-key-id", &signature.key_id)
			.header("x-sig", &signature.signature)
			.header("x-timestamp", signature.timestamp.to_string())
			.header("x-nonce", &signature.nonce)
			.header("content-type", content_type)
			.body(bytes.clone()))
	}

	fn apply_headers(
		mut builder: wreq::RequestBuilder,
		items: &[(HeaderName, HeaderValue)],
	) -> wreq::RequestBuilder {
		for (name, value) in items {
			builder = builder.header(name.clone(), value.clone());
		}
		builder
	}

	pub(crate) fn apply_headers_then_body(
		builder: wreq::RequestBuilder,
		items: &[(HeaderName, HeaderValue)],
		apply_body: impl FnOnce(wreq::RequestBuilder) -> wreq::RequestBuilder,
	) -> wreq::RequestBuilder {
		let (encoding, others): (Vec<_>, Vec<_>) = items
			.iter()
			.cloned()
			.partition(|(name, _)| name.as_str() == ACCEPT_ENCODING);
		Self::apply_headers(
			apply_body(Self::apply_headers(builder, &others)),
			&encoding,
		)
	}

	fn apply_headers_then_bytes(
		builder: wreq::RequestBuilder,
		items: &[(HeaderName, HeaderValue)],
		content_type: &HeaderValue,
		bytes: &Bytes,
	) -> wreq::RequestBuilder {
		Self::apply_headers_then_body(builder, items, |builder| {
			BodyHeaders {
				content_type,
				length: bytes.len() as u64,
			}
			.apply(builder)
			.body(bytes.clone())
		})
	}

	fn ceiling(&self, body: &Body) -> Duration {
		match body {
			Body::Bytes { .. } | Body::Signed { .. } => self.timeouts.upload,
			_ => CALL_TIMEOUT,
		}
	}

	pub(crate) fn apply_timeouts(
		&self,
		builder: wreq::RequestBuilder,
		body: &Body,
	) -> wreq::RequestBuilder {
		let builder = builder.timeout(self.ceiling(body));
		match body {
			Body::Bytes { .. } | Body::Signed { .. } => {
				builder.read_timeout(self.timeouts.upload)
			}
			_ => builder,
		}
	}
}

#[cfg(test)]
mod tests {
	use std::collections::BTreeMap;

	use crate::stream::test_source::AlphabetSource;
	use crate::testserver::ACCEPTING_PATH;
	use crate::{DeviceInfo, GrindrClient, GrindrError, Method, RawResponse};

	fn assert_invalid(result: Result<RawResponse, GrindrError>) {
		assert!(
			matches!(result, Err(GrindrError::InvalidRequest(_))),
			"got {result:?}"
		);
	}

	#[tokio::test]
	async fn an_invalid_request_is_refused_before_anything_is_sent() {
		let device = DeviceInfo::generate();
		let device_id = device.device_id.clone();
		let client = GrindrClient::new(device, None).unwrap();
		let post = || client.request(Method::POST, ACCEPTING_PATH);
		let unserializable = BTreeMap::from([((1, 2), 3)]);

		assert_invalid(
			post()
				.unauthenticated()
				.signed_bytes("image/jpeg", vec![1])
				.send()
				.await,
		);
		assert_invalid(post().bytes("image/jpeg\n", vec![1]).send().await);
		assert_invalid(
			post()
				.stream("video/mp4\n", AlphabetSource::exact(1))
				.send()
				.await,
		);
		assert_invalid(post().json(&unserializable).send().await);
		assert_invalid(
			client
				.request(Method::GET, "evil.com")
				.unauthenticated()
				.send()
				.await,
		);

		assert!(crate::testserver::requests_from(&device_id).is_empty());
	}

	#[test]
	fn a_sent_request_is_a_static_send_future() {
		fn assert_static_send<T: Send + 'static>(_: T) {}
		let client = GrindrClient::new(DeviceInfo::generate(), None).unwrap();
		assert_static_send(client.request(Method::GET, "/").send());
	}

	#[tokio::test]
	async fn an_unauthenticated_stream_needs_no_session() {
		let client = GrindrClient::new(DeviceInfo::generate(), None).unwrap();
		let response = client
			.request(Method::POST, ACCEPTING_PATH)
			.unauthenticated()
			.stream("video/mp4", AlphabetSource::exact(1000))
			.send()
			.await
			.unwrap();
		assert_eq!(response.status, 200);
	}
}
