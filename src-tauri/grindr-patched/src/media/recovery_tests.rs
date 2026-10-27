use std::future::Future;
use std::time::{Duration, Instant};

use futures_util::future::join_all;
use wreq::Method;

use super::relay::{
	Cdn, DRIP_PATH, DRIP_PIECES, EMPTY_PATH, HELD_PATH, OK_BODY, OK_PATH,
	REDIRECT_PATH, STALLED_BODY_PATH,
};
use super::tests::{client_with, request};
use super::{MediaFetcher, StreamRequest};
use crate::client::Timeouts;
use crate::device::DeviceInfo;
use crate::{GrindrClient, GrindrError, TimeoutPhase};

const DEADLINE: Duration = Duration::from_millis(500);
const API_PATH: &str = "/v3/ping";

fn client() -> GrindrClient {
	client_with(Timeouts {
		media: DEADLINE,
		..Timeouts::default()
	})
}

async fn fetch(
	client: &GrindrClient,
	url: &str,
) -> Result<Vec<u8>, GrindrError> {
	let response = client.fetch_media(request(url)).await?;
	assert_eq!(response.status, 200);
	Ok(response.body.to_vec())
}

async fn drain(
	client: &GrindrClient,
	url: &str,
) -> Result<Vec<u8>, GrindrError> {
	let mut stream = client
		.stream_media(StreamRequest {
			url,
			range: None,
			fetcher: MediaFetcher::ImageLoader,
		})
		.await?;
	let mut body = Vec::new();
	while let Some(chunk) = stream.chunk().await? {
		body.extend_from_slice(&chunk);
	}
	Ok(body)
}

fn assert_header_timeout(result: Result<Vec<u8>, GrindrError>) {
	match result {
		Err(GrindrError::Timeout(TimeoutPhase::Headers)) => {}
		other => panic!("expected a header timeout, got {other:?}"),
	}
}

#[tokio::test]
async fn a_fetch_stuck_on_a_pooled_connection_is_retried_on_a_new_one() {
	let cdn = Cdn::start().await;
	let client = client();
	let url = cdn.url(OK_PATH);
	assert_eq!(fetch(&client, &url).await.unwrap(), OK_BODY);
	cdn.mute(0);
	let started = Instant::now();

	let body = fetch(&client, &url).await.unwrap();

	assert_eq!(body, OK_BODY);
	assert!(started.elapsed() >= DEADLINE);
	assert_eq!(cdn.accepted(), 2);
	assert_eq!(cdn.served(OK_PATH), [0, 1]);
	assert_eq!(client.media_retirements(), 1);
}

#[tokio::test]
async fn a_stream_stuck_on_a_pooled_connection_is_retried_on_a_new_one() {
	let cdn = Cdn::start().await;
	let client = client();
	let url = cdn.url(OK_PATH);
	fetch(&client, &url).await.unwrap();
	cdn.mute(0);

	let body = drain(&client, &url).await.unwrap();

	assert_eq!(body, OK_BODY);
	assert_eq!(cdn.accepted(), 2);
	assert_eq!(cdn.served(OK_PATH), [0, 1]);
}

async fn assert_moving_traffic_keeps_the_connection(
	cdn: &Cdn,
	client: &GrindrClient,
	moving: impl Future<Output = Result<Vec<u8>, GrindrError>>,
) {
	fetch(client, &cdn.url(OK_PATH)).await.unwrap();
	let held = async {
		tokio::time::sleep(DEADLINE / 5).await;
		(fetch(client, &cdn.url(HELD_PATH)).await, Instant::now())
	};
	let moving = async { (moving.await, Instant::now()) };

	let ((held, held_at), (moved, moved_at)) = tokio::join!(held, moving);

	assert_header_timeout(held);
	moved.unwrap();
	assert!(moved_at > held_at, "the traffic ended before the deadline");
	assert_eq!(cdn.served(HELD_PATH), [0]);
	assert_eq!(cdn.accepted(), 1);
	assert_eq!(client.media_retirements(), 0);
}

#[tokio::test]
async fn a_slow_answer_beside_a_dripping_fetch_keeps_the_connection() {
	let cdn = Cdn::start().await;
	let client = client();
	let url = cdn.url(DRIP_PATH);

	assert_moving_traffic_keeps_the_connection(&cdn, &client, async {
		let body = fetch(&client, &url).await?;
		assert_eq!(body.len(), usize::from(DRIP_PIECES));
		Ok(body)
	})
	.await;
}

#[tokio::test]
async fn a_slow_answer_beside_a_dripping_stream_keeps_the_connection() {
	let cdn = Cdn::start().await;
	let client = client();
	let url = cdn.url(DRIP_PATH);

	assert_moving_traffic_keeps_the_connection(&cdn, &client, async {
		let body = drain(&client, &url).await?;
		assert_eq!(body.len(), usize::from(DRIP_PIECES));
		Ok(body)
	})
	.await;
}

#[tokio::test]
async fn a_slow_answer_beside_answered_requests_keeps_the_connection() {
	let cdn = Cdn::start().await;
	let client = client();
	let url = cdn.url(EMPTY_PATH);

	assert_moving_traffic_keeps_the_connection(&cdn, &client, async {
		let started = Instant::now();
		while started.elapsed() < DEADLINE * 2 {
			assert!(fetch(&client, &url).await?.is_empty());
			tokio::time::sleep(DEADLINE / 10).await;
		}
		Ok(Vec::new())
	})
	.await;
}

#[tokio::test]
async fn a_new_connection_that_never_answers_is_not_replaced() {
	let cdn = Cdn::start().await;
	let client = client();
	cdn.mute_everything();
	let started = Instant::now();

	let result = fetch(&client, &cdn.url(OK_PATH)).await;

	assert_header_timeout(result);
	assert!(started.elapsed() < DEADLINE * 2, "the fetch was retried");
	assert_eq!(cdn.accepted(), 1);
	assert_eq!(client.media_retirements(), 0);
}

#[tokio::test]
async fn a_network_where_nothing_answers_costs_one_extra_connection() {
	let cdn = Cdn::start().await;
	let client = client();
	let url = cdn.url(OK_PATH);
	cdn.mute_everything();
	let until = Instant::now() + DEADLINE * 5;
	let mut fetches = 0;

	while Instant::now() < until {
		assert_header_timeout(fetch(&client, &url).await);
		fetches += 1;
	}

	assert!(fetches >= 3, "only {fetches} fetches ran");
	assert_eq!(cdn.accepted(), 2);
	assert_eq!(client.media_retirements(), 1);
}

#[tokio::test]
async fn a_burst_stuck_on_one_connection_replaces_it_once() {
	let cdn = Cdn::start().await;
	let client = client();
	let url = cdn.url(OK_PATH);
	fetch(&client, &url).await.unwrap();
	cdn.mute(0);

	let bodies = join_all((0..10).map(|_| fetch(&client, &url))).await;

	for body in bodies {
		assert_eq!(body.unwrap(), OK_BODY);
	}
	assert_eq!(cdn.accepted(), 2);
	assert_eq!(client.media_retirements(), 1);
	assert_eq!(cdn.served(OK_PATH), [vec![0], vec![1; 10]].concat());
}

#[tokio::test]
async fn a_body_that_stalls_keeps_the_connection() {
	let cdn = Cdn::start().await;
	let client = client_with(Timeouts {
		media: DEADLINE,
		media_body: Duration::from_millis(400),
		..Timeouts::default()
	});

	let stalled = fetch(&client, &cdn.url(STALLED_BODY_PATH)).await;
	let after = fetch(&client, &cdn.url(OK_PATH)).await.unwrap();

	assert!(
		matches!(stalled, Err(GrindrError::Timeout(TimeoutPhase::Unfinished))),
		"got {stalled:?}"
	);
	assert_eq!(after, OK_BODY);
	assert_eq!(cdn.served(STALLED_BODY_PATH), [0]);
	assert_eq!(cdn.served(OK_PATH), [0]);
	assert_eq!(cdn.accepted(), 1);
	assert_eq!(client.media_retirements(), 0);
}

#[tokio::test]
async fn replacing_the_media_connection_leaves_the_api_connection_alone() {
	let cdn = Cdn::start().await;
	let client = client();
	let http2 = wreq::Client::builder().http2_only().build().unwrap();
	client.replace_http_client(http2).await;
	let api = async || client.request(Method::GET, API_PATH).send().await;
	let url = cdn.url(OK_PATH);
	assert_eq!(api().await.unwrap().status, 200);
	fetch(&client, &url).await.unwrap();
	assert_eq!(cdn.served(OK_PATH), [1]);
	cdn.mute(1);

	fetch(&client, &url).await.unwrap();
	let after = api().await.unwrap();

	assert_eq!(after.status, 200);
	assert_eq!(client.media_retirements(), 1);
	assert_eq!(cdn.accepted(), 3);
	assert_eq!(cdn.served(API_PATH), [0, 0]);
}

#[tokio::test]
async fn a_fetch_outliving_a_transport_reset_is_retried_without_a_retirement() {
	let cdn = Cdn::start().await;
	let client = client();
	let url = cdn.url(OK_PATH);
	fetch(&client, &url).await.unwrap();
	cdn.mute(0);

	let (body, reset) = tokio::join!(fetch(&client, &url), async {
		tokio::time::sleep(DEADLINE / 5).await;
		client.reset_transport().await
	});

	reset.unwrap();
	assert_eq!(body.unwrap(), OK_BODY);
	assert_eq!(client.media_retirements(), 0);
	assert_eq!(cdn.accepted(), 2);
	assert_eq!(cdn.served(OK_PATH), [0, 1]);
}

#[tokio::test]
async fn a_fetch_outliving_a_device_rotation_is_not_retried() {
	let cdn = Cdn::start().await;
	let client = client();
	let url = cdn.url(OK_PATH);
	fetch(&client, &url).await.unwrap();
	cdn.mute(0);

	let (result, rotated) = tokio::join!(fetch(&client, &url), async {
		tokio::time::sleep(DEADLINE / 5).await;
		client.rotate_device(DeviceInfo::generate()).await
	});

	rotated.unwrap();
	assert_header_timeout(result);
	assert_eq!(client.media_retirements(), 0);
	assert_eq!(cdn.accepted(), 1);
}

#[tokio::test]
async fn a_new_connection_the_resolver_never_sees_is_not_replaced() {
	let cdn = Cdn::start_by_address().await;
	let client = client();
	cdn.mute_everything();
	let started = Instant::now();

	let result = fetch(&client, &cdn.url(OK_PATH)).await;

	assert_header_timeout(result);
	assert!(started.elapsed() < DEADLINE * 2, "the fetch was retried");
	assert_eq!(cdn.accepted(), 1);
	assert_eq!(client.media_retirements(), 0);
}

#[tokio::test]
async fn a_pooled_connection_the_resolver_never_saw_is_still_replaced() {
	let cdn = Cdn::start_by_address().await;
	let client = client();
	let url = cdn.url(OK_PATH);
	fetch(&client, &url).await.unwrap();
	cdn.mute(0);

	let body = fetch(&client, &url).await.unwrap();

	assert_eq!(body, OK_BODY);
	assert_eq!(cdn.accepted(), 2);
	assert_eq!(cdn.served(OK_PATH), [0, 1]);
	assert_eq!(client.media_retirements(), 1);
}

#[tokio::test]
async fn a_stall_after_a_redirect_is_not_replaced() {
	let target = Cdn::start().await;
	let cdn = Cdn::start_by_address().await;
	let client = client();
	fetch(&client, &cdn.url(OK_PATH)).await.unwrap();
	target.mute_everything();
	cdn.redirect_to(&target.url(OK_PATH));

	let result = fetch(&client, &cdn.url(REDIRECT_PATH)).await;

	assert_header_timeout(result);
	assert_eq!(cdn.served(REDIRECT_PATH), [0]);
	assert_eq!(target.accepted(), 1);
	assert_eq!(client.media_retirements(), 0);
}

#[tokio::test]
async fn traffic_redirected_elsewhere_does_not_keep_a_stuck_connection() {
	let target = Cdn::start().await;
	let cdn = Cdn::start_by_address().await;
	let client = client();
	fetch(&client, &cdn.url(OK_PATH)).await.unwrap();
	cdn.redirect_to(&target.url(DRIP_PATH));
	let redirected = cdn.url(REDIRECT_PATH);
	let held = async {
		tokio::time::sleep(DEADLINE / 5).await;
		fetch(&client, &cdn.url(HELD_PATH)).await
	};

	let (held, moved) = tokio::join!(held, fetch(&client, &redirected));

	assert_header_timeout(held);
	assert_eq!(moved.unwrap().len(), usize::from(DRIP_PIECES));
	assert_eq!(cdn.served(HELD_PATH), [0, 1]);
	assert_eq!(client.media_retirements(), 1);
}
