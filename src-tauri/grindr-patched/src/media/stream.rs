use bytes::Bytes;

use super::{header, MediaFetcher, Progress, Target};
use crate::error::GrindrError;
use crate::rest::InnerClient;

#[cfg(test)]
mod deadline_tests;
#[cfg(test)]
mod tests;

/// Argument of [`GrindrClient::stream_media`](crate::GrindrClient::stream_media).
#[derive(Debug, Clone, Copy)]
pub struct StreamRequest<'a> {
	/// Absolute `https` url on a Grindr CDN.
	pub url: &'a str,
	/// `Range` header value, forwarded verbatim.
	pub range: Option<&'a str>,
	/// Which header set to send.
	pub fetcher: MediaFetcher,
}

/// Result of [`GrindrClient::stream_media`](crate::GrindrClient::stream_media).
#[derive(Debug)]
pub struct MediaStream {
	/// HTTP status.
	pub status: u16,
	/// `Content-Type` header.
	pub content_type: Option<String>,
	/// `Content-Length` header; dropped when the body is decoded.
	pub content_length: Option<u64>,
	/// `Content-Range` header.
	pub content_range: Option<String>,
	/// `Accept-Ranges` header.
	pub accept_ranges: Option<String>,
	response: wreq::Response,
	progress: Progress,
}

impl MediaStream {
	/// Next piece of the decompressed body, `None` once it has ended. A pause
	/// longer than the read timeout between two pieces is an error.
	pub async fn chunk(&mut self) -> Result<Option<Bytes>, GrindrError> {
		let chunk = self.response.chunk().await?;
		if chunk.is_some() {
			self.progress.record();
		}
		Ok(chunk)
	}
}

impl InnerClient {
	pub(crate) async fn stream_media(
		&self,
		request: StreamRequest<'_>,
	) -> Result<MediaStream, GrindrError> {
		let (response, progress) = self
			.send_media(Target {
				url: request.url,
				range: request.range,
				fetcher: request.fetcher,
			})
			.await?;
		Ok(MediaStream {
			status: response.status().as_u16(),
			content_type: header(&response, "content-type"),
			content_length: response.content_length(),
			content_range: header(&response, "content-range"),
			accept_ranges: header(&response, "accept-ranges"),
			response,
			progress,
		})
	}
}
