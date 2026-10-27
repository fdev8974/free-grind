use std::time::{Duration, Instant};

use super::tests::{client_with, counting, dripping, request};
use crate::client::Timeouts;
use crate::testserver::{
	self, RedirectedBaseUrl, HOLD_BEFORE_CLOSING, STALLED_PATH,
};
use crate::{GrindrError, TimeoutPhase};

fn timeout_phase(error: &GrindrError) -> TimeoutPhase {
	match error {
		GrindrError::Timeout(phase) => *phase,
		other => panic!("expected a timeout, got {other:?}"),
	}
}

#[tokio::test]
async fn a_slow_body_that_keeps_moving_outlives_the_header_deadline() {
	let media = Duration::from_millis(300);
	let client = client_with(Timeouts {
		media,
		..Timeouts::default()
	});
	let url = dripping(72, Duration::from_millis(100));
	let started = Instant::now();

	let fetched = client.fetch_media(request(&url)).await.unwrap();

	assert_eq!(fetched.body.as_ref(), counting(72).as_slice());
	assert!(
		started.elapsed() > media,
		"the body ended before the deadline"
	);
}

#[tokio::test]
async fn headers_that_never_come_fail_at_the_header_deadline() {
	let media = Duration::from_millis(300);
	let client = client_with(Timeouts {
		media,
		..Timeouts::default()
	});
	let _named = RedirectedBaseUrl::by_name();
	let url = format!("{}{STALLED_PATH}", testserver::base_url());
	let started = Instant::now();

	let error = client.fetch_media(request(&url)).await.unwrap_err();

	assert_eq!(timeout_phase(&error), TimeoutPhase::Headers);
	assert!(started.elapsed() >= media);
	assert!(started.elapsed() < HOLD_BEFORE_CLOSING);
	assert_eq!(client.media_retirements(), 0);
}

#[tokio::test]
async fn a_body_that_stalls_longer_than_the_read_timeout_fails() {
	let client = client_with(Timeouts {
		read: Duration::from_millis(200),
		..Timeouts::default()
	});
	let url = dripping(40, Duration::from_millis(800));

	let error = client.fetch_media(request(&url)).await.unwrap_err();

	assert_eq!(timeout_phase(&error), TimeoutPhase::Receiving);
}

#[tokio::test]
async fn a_trickling_body_stops_at_the_body_ceiling() {
	let media_body = Duration::from_millis(300);
	let client = client_with(Timeouts {
		media_body,
		..Timeouts::default()
	});
	let url = dripping(72, Duration::from_millis(100));
	let started = Instant::now();

	let error = client.fetch_media(request(&url)).await.unwrap_err();

	assert_eq!(timeout_phase(&error), TimeoutPhase::Unfinished);
	assert!(started.elapsed() < Duration::from_millis(700));
}
