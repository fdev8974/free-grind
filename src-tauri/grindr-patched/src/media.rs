use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use bytes::{BufMut, Bytes, BytesMut};
use wreq::redirect::Policy;
use wreq::{Method, Url};

use crate::client::build_media_client;
use crate::error::{GrindrError, TimeoutPhase};
use crate::headers::GrindrHeaders;
use crate::rest::{Fingerprint, InnerClient};

#[cfg(test)]
mod deadline_tests;
mod liveness;
#[cfg(test)]
mod recovery_tests;
#[cfg(test)]
pub(crate) mod relay;
mod stream;
#[cfg(test)]
mod tests;

use liveness::{Attempt, Progress};
pub(crate) use liveness::{CountConnections, MediaLiveness};
pub use stream::{MediaStream, StreamRequest};

pub(crate) const MEDIA_TIMEOUT: Duration = Duration::from_secs(20);
pub(crate) const MEDIA_BODY_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_REDIRECTS: usize = 5;

/// Which of the app's two HTTP stacks a fetch imitates.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum MediaFetcher {
	/// The image loader, used for photos and chat images.
	#[default]
	ImageLoader,
	/// `android.media.MediaPlayer`, used for album video.
	MediaPlayer,
}

/// Argument of [`GrindrClient::fetch_media`](crate::GrindrClient::fetch_media).
#[derive(Debug, Clone, Copy)]
pub struct MediaRequest<'a> {
	/// Absolute `https` url on a Grindr CDN.
	pub url: &'a str,
	/// `Range` header value, forwarded verbatim.
	pub range: Option<&'a str>,
	/// Body size ceiling. A larger response fails instead of being buffered.
	pub max_bytes: usize,
	/// Which header set to send.
	pub fetcher: MediaFetcher,
}

/// Result of [`GrindrClient::fetch_media`](crate::GrindrClient::fetch_media).
#[derive(Debug, Clone)]
pub struct MediaResponse {
	/// HTTP status.
	pub status: u16,
	/// `Content-Type` header.
	pub content_type: Option<String>,
	/// `Content-Range` header.
	pub content_range: Option<String>,
	/// `Accept-Ranges` header.
	pub accept_ranges: Option<String>,
	/// Decompressed body. Size it from `len()`, not `Content-Length`.
	pub body: Bytes,
}

fn is_cdn_host(host: &str) -> bool {
	host == "cdns.grindr.com" || host.ends_with(".cloudfront.net")
}

fn is_media_host(url: &Url) -> bool {
	url.scheme() == "https" && url.host_str().is_some_and(is_cdn_host)
}

#[cfg(not(test))]
fn is_allowed(url: &Url) -> bool {
	is_media_host(url)
}

#[cfg(test)]
fn is_allowed(url: &Url) -> bool {
	is_media_host(url)
		|| url.scheme() == "http"
			&& matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
}

fn header(response: &wreq::Response, name: &str) -> Option<String> {
	response
		.headers()
		.get(name)
		.and_then(|value| value.to_str().ok())
		.map(str::to_owned)
}

struct Target<'a> {
	url: &'a str,
	range: Option<&'a str>,
	fetcher: MediaFetcher,
}

enum Sent {
	Answered(wreq::Response, Progress),
	Stalled(Attempt),
}

impl InnerClient {
	async fn media_request(
		&self,
		target: &Target<'_>,
	) -> Result<(wreq::RequestBuilder, Attempt), GrindrError> {
		let url = Url::parse(target.url).map_err(|e| {
			GrindrError::InvalidRequest(format!(
				"media url {:?}: {e}",
				target.url
			))
		})?;
		if !is_allowed(&url) {
			return Err(GrindrError::InvalidRequest(format!(
				"media url is not on a Grindr CDN: {:?}",
				target.url
			)));
		}

		let fp = self.fingerprint().await;
		let host = url.host_str().unwrap_or_default().to_owned();
		let headers = match target.fetcher {
			MediaFetcher::ImageLoader => {
				GrindrHeaders::build_media(&fp.user_agent, target.range)?
			}
			MediaFetcher::MediaPlayer => {
				GrindrHeaders::build_platform_media(&fp.device, target.range)?
			}
		};

		let mut request = fp.media_http.request(Method::GET, url);
		for (name, value) in headers.items {
			request = request.header(name, value);
		}
		let attempt = self.media_liveness.begin(&host, fp);
		let redirected = attempt.redirect_marker();
		let request = request.redirect(Policy::custom(move |hop| {
			if hop.previous().len() > MAX_REDIRECTS || !is_allowed(hop.url()) {
				hop.stop()
			} else {
				redirected.store(true, Ordering::SeqCst);
				hop.follow()
			}
		}));
		Ok((request, attempt))
	}

	async fn send_media_once(
		&self,
		target: &Target<'_>,
	) -> Result<Sent, GrindrError> {
		let (request, attempt) = self.media_request(target).await?;
		let sending = request.read_timeout(self.timeouts.read).send();
		match tokio::time::timeout(self.timeouts.media, sending).await {
			Ok(response) => {
				let response = response?;
				let host = response.url().host_str().unwrap_or_default();
				let progress = self.media_liveness.answered(&attempt, host);
				Ok(Sent::Answered(response, progress))
			}
			Err(_) => Ok(Sent::Stalled(attempt)),
		}
	}

	async fn send_media(
		&self,
		target: Target<'_>,
	) -> Result<(wreq::Response, Progress), GrindrError> {
		let stalled = match self.send_media_once(&target).await? {
			Sent::Answered(response, progress) => {
				return Ok((response, progress))
			}
			Sent::Stalled(attempt) => attempt,
		};
		let current = self.retire_if_stuck(&stalled).await;
		if stalled.resendable_on(&current) {
			match self.send_media_once(&target).await? {
				Sent::Answered(response, progress) => {
					return Ok((response, progress));
				}
				Sent::Stalled(again) => {
					self.retire_if_stuck(&again).await;
				}
			}
		}
		Err(GrindrError::Timeout(TimeoutPhase::Headers))
	}

	async fn retire_if_stuck(&self, stalled: &Attempt) -> Arc<Fingerprint> {
		let mut current = self.fingerprint.write().await;
		if self.media_liveness.retire(stalled, &current) {
			if let Ok(media_http) =
				build_media_client(self.timeouts.read, &self.media_liveness)
			{
				*current = Arc::new(current.with_media_http(media_http));
			}
		}
		Arc::clone(&current)
	}

	pub(crate) async fn fetch_media(
		&self,
		request: MediaRequest<'_>,
	) -> Result<MediaResponse, GrindrError> {
		let (mut response, progress) = self
			.send_media(Target {
				url: request.url,
				range: request.range,
				fetcher: request.fetcher,
			})
			.await?;

		let status = response.status().as_u16();
		let content_type = header(&response, "content-type");
		let content_range = header(&response, "content-range");
		let accept_ranges = header(&response, "accept-ranges");

		if response
			.content_length()
			.is_some_and(|len| len > request.max_bytes as u64)
		{
			return Err(GrindrError::MediaTooLarge {
				max_bytes: request.max_bytes,
			});
		}

		let body = tokio::time::timeout(
			self.timeouts.media_body,
			read_body(&mut response, request.max_bytes, &progress),
		)
		.await
		.map_err(|_| GrindrError::Timeout(TimeoutPhase::Unfinished))??;

		Ok(MediaResponse {
			status,
			content_type,
			content_range,
			accept_ranges,
			body,
		})
	}
}

async fn read_body(
	response: &mut wreq::Response,
	max_bytes: usize,
	progress: &Progress,
) -> Result<Bytes, GrindrError> {
	let mut body = BytesMut::new();
	while let Some(chunk) = response.chunk().await? {
		progress.record();
		if body.len() + chunk.len() > max_bytes {
			return Err(GrindrError::MediaTooLarge { max_bytes });
		}
		body.put(chunk);
	}
	Ok(body.freeze())
}
