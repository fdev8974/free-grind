use std::time::{Duration, Instant};

use super::StreamRequest;
use crate::media::tests::{counting, dripping, media_url, signed_in_client};
use crate::media::{MediaFetcher, MediaRequest, MediaStream};
use crate::testserver::{self, DRIP_PIECES, MEDIA_PREFIX};
use crate::GrindrError;

pub(super) fn request(url: &str) -> StreamRequest<'_> {
	StreamRequest {
		url,
		range: None,
		fetcher: MediaFetcher::ImageLoader,
	}
}

pub(super) async fn drain(
	stream: &mut MediaStream,
) -> Result<Vec<u8>, GrindrError> {
	let mut body = Vec::new();
	while let Some(chunk) = stream.chunk().await? {
		body.extend_from_slice(&chunk);
	}
	Ok(body)
}

#[tokio::test]
async fn chunks_arrive_progressively_before_the_body_ends() {
	let pause = Duration::from_millis(100);
	let whole_drip = pause * (DRIP_PIECES as u32 - 1);
	let url = dripping(80, pause);
	let started = Instant::now();

	let mut stream = signed_in_client()
		.stream_media(request(&url))
		.await
		.unwrap();
	let first = stream.chunk().await.unwrap().expect("a first chunk");
	let first_at = started.elapsed();
	let rest = drain(&mut stream).await.unwrap();

	assert!(first.len() < 80, "{} bytes came at once", first.len());
	assert!(first_at < whole_drip, "the first chunk waited {first_at:?}");
	assert!(started.elapsed() >= whole_drip, "the server did not drip");
	assert_eq!([first.to_vec(), rest].concat(), counting(80));
}

#[tokio::test]
async fn an_open_ended_range_is_forwarded_and_the_206_fields_are_surfaced() {
	let url = media_url(96);

	let mut stream = signed_in_client()
		.stream_media(StreamRequest {
			range: Some("bytes=10-"),
			..request(&url)
		})
		.await
		.unwrap();

	assert_eq!(stream.status, 206);
	assert_eq!(stream.content_type.as_deref(), Some("video/mp4"));
	assert_eq!(stream.content_length, Some(86));
	assert_eq!(stream.content_range.as_deref(), Some("bytes 10-95/96"));
	assert_eq!(stream.accept_ranges.as_deref(), Some("bytes"));
	assert_eq!(drain(&mut stream).await.unwrap(), counting(96)[10..]);

	let recorded = testserver::requests_to(&format!("{MEDIA_PREFIX}96"));
	let fetch = recorded.first().expect("the media request was made");
	assert_eq!(fetch.header("range"), Some("bytes=10-"));
	assert_eq!(fetch.header("accept-encoding"), None);
}

#[tokio::test]
async fn a_range_less_stream_sends_no_range_header() {
	let url = media_url(48);

	let mut stream = signed_in_client()
		.stream_media(request(&url))
		.await
		.unwrap();

	assert_eq!(stream.status, 200);
	assert_eq!(stream.content_length, Some(48));
	assert_eq!(stream.content_range, None);
	assert_eq!(drain(&mut stream).await.unwrap(), counting(48));

	let recorded = testserver::requests_to(&format!("{MEDIA_PREFIX}48"));
	let fetch = recorded.first().expect("the media request was made");
	assert_eq!(fetch.header("range"), None);
	assert_eq!(fetch.header("accept-encoding"), Some("gzip"));
}

#[tokio::test]
async fn a_stream_sends_exactly_the_headers_a_fetch_sends() {
	let url = media_url(56);
	let client = signed_in_client();

	client
		.fetch_media(MediaRequest {
			url: &url,
			range: None,
			max_bytes: 56,
			fetcher: MediaFetcher::MediaPlayer,
		})
		.await
		.unwrap();
	client
		.stream_media(StreamRequest {
			fetcher: MediaFetcher::MediaPlayer,
			..request(&url)
		})
		.await
		.unwrap();

	let recorded = testserver::requests_to(&format!("{MEDIA_PREFIX}56"));
	let [fetched, streamed] = &recorded[..] else {
		panic!("expected a fetch and a stream, got {}", recorded.len());
	};
	assert_eq!(streamed.method, fetched.method);
	assert_eq!(streamed.headers, fetched.headers);
}

#[tokio::test]
async fn a_stream_follows_a_redirect_only_while_it_stays_on_a_cdn() {
	let allowed = format!(
		"{}{MEDIA_PREFIX}redirect?to={}",
		testserver::base_url(),
		media_url(24)
	);
	let mut stream = signed_in_client()
		.stream_media(request(&allowed))
		.await
		.unwrap();
	assert_eq!(stream.status, 200);
	assert_eq!(drain(&mut stream).await.unwrap(), counting(24));

	let elsewhere = format!(
		"{}{MEDIA_PREFIX}redirect?to=https://evil.test/x.jpg",
		testserver::base_url()
	);
	let mut stream = signed_in_client()
		.stream_media(request(&elsewhere))
		.await
		.unwrap();
	assert_eq!(stream.status, 302, "the redirect must be handed back");
	assert_eq!(stream.content_length, Some(0));
	assert_eq!(stream.chunk().await.unwrap(), None);
}

#[tokio::test]
async fn a_non_success_status_comes_back_as_an_ordinary_stream() {
	let url = format!("{}/nowhere", testserver::base_url());

	let mut stream = signed_in_client()
		.stream_media(request(&url))
		.await
		.unwrap();

	assert_eq!(stream.status, 404);
	assert_eq!(stream.content_type.as_deref(), Some("application/json"));
	assert!(!drain(&mut stream).await.unwrap().is_empty());
}

#[tokio::test]
async fn a_stream_off_the_cdns_never_reaches_the_network() {
	for url in [
		"https://evil.test/x.mp4",
		"http://cdns.grindr.com/x",
		"nope",
	] {
		let err = signed_in_client()
			.stream_media(request(url))
			.await
			.unwrap_err();
		assert!(
			matches!(err, GrindrError::InvalidRequest(_)),
			"{url} gave {err:?}"
		);
	}
}
