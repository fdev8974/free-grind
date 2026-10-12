use std::io::Read;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use std::time::Duration;

use wreq::header::{HeaderName, HeaderValue};

mod body;
#[cfg(test)]
mod h2_tests;
#[cfg(test)]
pub(crate) mod test_source;
#[cfg(test)]
mod tests;
mod watchdog;

use body::StreamedBody;
use watchdog::WatchedUpload;

use crate::client::CALL_TIMEOUT;
use crate::error::{GrindrError, TimeoutPhase};
use crate::request::Answer;
use crate::rest::{BodyHeaders, InnerClient};

const NO_DEADLINE: Duration = Duration::from_secs(24 * 60 * 60);

/// A request body read while it is sent.
pub trait BodySource: Send + Sync {
	/// Exact number of bytes every reader yields.
	fn size(&self) -> u64;
	/// Opens a reader at the first byte, on a blocking thread, per attempt.
	fn open(&self) -> std::io::Result<Box<dyn Read + Send>>;
}

impl<T: BodySource + ?Sized> BodySource for Arc<T> {
	fn size(&self) -> u64 {
		(**self).size()
	}

	fn open(&self) -> std::io::Result<Box<dyn Read + Send>> {
		(**self).open()
	}
}

pub(crate) struct StreamedRequest<'a> {
	pub request: wreq::RequestBuilder,
	pub headers: &'a [(HeaderName, HeaderValue)],
	pub content_type: &'a HeaderValue,
	pub source: &'a Arc<dyn BodySource>,
}

impl InnerClient {
	pub(crate) async fn send_streamed(
		&self,
		streamed: StreamedRequest<'_>,
	) -> Result<Answer, GrindrError> {
		let size = streamed.source.size();
		let sent = Arc::new(AtomicU64::new(0));
		let (body, abandon_on_drop) =
			StreamedBody::open(Arc::clone(streamed.source), Arc::clone(&sent));
		let request = InnerClient::apply_headers_then_body(
			streamed.request,
			streamed.headers,
			|request| {
				BodyHeaders {
					content_type: streamed.content_type,
					length: size,
				}
				.apply(request)
				.body(wreq::Body::wrap(body))
			},
		);
		let sending = WatchedUpload {
			sent,
			total: size,
			timeouts: self.timeouts,
		}
		.guard(request.read_timeout(NO_DEADLINE).send());
		let response = match sending.await {
			Ok(response) => response,
			Err(error) => {
				return Err(match abandon_on_drop.into_source_error() {
					Some(source_error) => GrindrError::Http(format!(
						"request body source failed: {source_error}"
					)),
					None => error,
				})
			}
		};
		self.note_server_date(response.headers());
		let status = response.status().as_u16();
		let body = tokio::time::timeout(CALL_TIMEOUT, response.bytes())
			.await
			.map_err(|_| GrindrError::Timeout(TimeoutPhase::Unfinished))??;
		Ok(Answer { status, body })
	}
}
