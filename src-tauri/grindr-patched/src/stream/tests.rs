use std::io::{self, Read};
use std::sync::Arc;
use std::time::{Duration, Instant};

use wreq::Method;

use super::body::{SOURCE_ENDED_EARLY, SOURCE_RAN_LONG};
use super::test_source::AlphabetSource;
use super::BodySource;
use crate::auth::{Credentials, Session, SessionKind, SessionToken};
use crate::client::{ClientSetup, Timeouts};
use crate::testserver::{
	self, QueuedReplies, Recorded, ACCEPTING_PATH, HOLD_BEFORE_CLOSING,
	REFRESHED_PROFILE_ID, SILENT_PATH, SLOW_READ_PREFIX, STALLED_PATH,
};
use crate::{DeviceInfo, GrindrClient, GrindrError, TimeoutPhase};

pub(super) struct SignedIn {
	pub client: GrindrClient,
	device_id: String,
}

pub(super) fn sign_in(timeouts: Timeouts) -> SignedIn {
	let device = DeviceInfo::generate();
	let device_id = device.device_id.clone();
	let session = Session {
		credentials: Credentials {
			email: "user@example.com".to_owned(),
			profile_id: Some(REFRESHED_PROFILE_ID.to_owned()),
			auth_token: "atok".to_owned(),
			kind: SessionKind::Email,
			third_party_user_id: None,
		},
		token: Some(SessionToken {
			session_id: "sid".to_owned(),
			expires_at: u64::MAX,
			restriction: None,
		}),
	};
	let client = GrindrClient::from_setup(ClientSetup {
		device,
		session: Some(session),
		timeouts,
	})
	.unwrap();
	SignedIn { client, device_id }
}

impl SignedIn {
	fn requests_to(&self, path: &str) -> Vec<Recorded> {
		testserver::requests_from(&self.device_id)
			.into_iter()
			.filter(|r| r.path == path)
			.collect()
	}

	async fn stream(
		&self,
		path: &str,
		source: &Arc<AlphabetSource>,
	) -> Result<crate::RawResponse, GrindrError> {
		self.client
			.request(Method::POST, path)
			.stream("video/mp4", Arc::clone(source))
			.send()
			.await
	}
}

fn http_message<T: std::fmt::Debug>(result: Result<T, GrindrError>) -> String {
	match result {
		Err(GrindrError::Http(message)) => message,
		other => panic!("expected an Http error, got {other:?}"),
	}
}

fn timeout_phase<T: std::fmt::Debug>(
	result: Result<T, GrindrError>,
) -> TimeoutPhase {
	match result {
		Err(GrindrError::Timeout(phase)) => phase,
		other => panic!("expected a timeout, got {other:?}"),
	}
}

fn header_names(request: &Recorded) -> Vec<&str> {
	request
		.headers
		.iter()
		.map(|(name, _)| name.as_str())
		.collect()
}

#[tokio::test]
async fn a_streamed_body_is_sent_like_a_bytes_body() {
	let signed_in = sign_in(Timeouts::default());
	let source = Arc::new(AlphabetSource::exact(300 * 1024 + 5));

	signed_in
		.client
		.request(Method::POST, ACCEPTING_PATH)
		.bytes("video/mp4", source.content())
		.send()
		.await
		.unwrap();
	signed_in.stream(ACCEPTING_PATH, &source).await.unwrap();

	let [bytes, streamed] = &signed_in.requests_to(ACCEPTING_PATH)[..] else {
		panic!("expected two uploads");
	};
	assert_eq!(header_names(streamed), header_names(bytes));
	assert_eq!(streamed.headers, bytes.headers);
	assert_eq!(streamed.body, bytes.body);
	assert!(!header_names(streamed).contains(&"transfer-encoding"));
}

struct Unopenable;

impl BodySource for Unopenable {
	fn size(&self) -> u64 {
		1
	}

	fn open(&self) -> io::Result<Box<dyn Read + Send>> {
		Err(io::Error::other("unopenable"))
	}
}

#[tokio::test]
async fn a_failing_source_fails_the_request_with_its_error() {
	let signed_in = sign_in(Timeouts::default());
	let short = AlphabetSource {
		yields: 1000,
		..AlphabetSource::exact(1001)
	};
	let long = AlphabetSource {
		yields: 1001,
		..AlphabetSource::exact(1000)
	};
	let send = |source: Arc<dyn BodySource>| {
		signed_in
			.client
			.request(Method::POST, ACCEPTING_PATH)
			.stream("video/mp4", source)
			.send()
	};

	let unopenable = http_message(send(Arc::new(Unopenable)).await);
	let short = http_message(send(Arc::new(short)).await);
	let long = http_message(send(Arc::new(long)).await);

	assert!(unopenable.ends_with("unopenable"), "{unopenable}");
	assert!(short.ends_with(SOURCE_ENDED_EARLY), "{short}");
	assert!(long.ends_with(SOURCE_RAN_LONG), "{long}");
}

#[tokio::test]
async fn a_401_retry_reopens_the_source_and_resends_everything() {
	let signed_in = sign_in(Timeouts::default());
	let source = Arc::new(AlphabetSource::exact(200 * 1024));
	testserver::queue_replies(QueuedReplies {
		device_id: &signed_in.device_id,
		path: ACCEPTING_PATH,
		replies: vec![(
			"401 Unauthorized",
			r#"{"code":401,"message":"unauthorized"}"#.to_owned(),
		)],
	});

	signed_in.stream(ACCEPTING_PATH, &source).await.unwrap();

	assert_eq!(source.opens(), 2);
	let [rejected, retried] = &signed_in.requests_to(ACCEPTING_PATH)[..] else {
		panic!("expected the upload and its retry");
	};
	assert_eq!(retried.body.as_bytes(), source.content());
	assert_eq!(rejected.body, retried.body);
}

#[tokio::test]
async fn a_steady_upload_longer_than_the_read_timeout_succeeds() {
	let read = Duration::from_millis(200);
	let slow_read = Duration::from_millis(600);
	let signed_in = sign_in(Timeouts {
		read,
		..Timeouts::default()
	});
	let source = Arc::new(AlphabetSource::exact(64 * 1024));
	let path = format!("{SLOW_READ_PREFIX}{}", slow_read.as_millis());
	let started = Instant::now();

	let response = signed_in.stream(&path, &source).await.unwrap();

	assert_eq!(response.status, 200);
	assert!(started.elapsed() >= slow_read && slow_read > read);
}

#[tokio::test]
async fn a_stalled_body_fails_within_the_stall_timeout() {
	let stall = Duration::from_millis(300);
	let signed_in = sign_in(Timeouts {
		stall,
		..Timeouts::default()
	});
	let source = Arc::new(AlphabetSource::exact(256 * 1024 * 1024));
	let started = Instant::now();

	let result = signed_in.stream(STALLED_PATH, &source).await;

	assert_eq!(timeout_phase(result), TimeoutPhase::Sending);
	let elapsed = started.elapsed();
	assert!(
		elapsed >= stall && elapsed < HOLD_BEFORE_CLOSING,
		"{elapsed:?}"
	);
}

#[tokio::test]
async fn a_silent_server_fails_within_the_response_deadline() {
	let read = Duration::from_millis(100);
	let signed_in = sign_in(Timeouts {
		read,
		..Timeouts::default()
	});
	let source = Arc::new(AlphabetSource::exact(1024));
	let started = Instant::now();

	let result = signed_in.stream(SILENT_PATH, &source).await;

	assert_eq!(timeout_phase(result), TimeoutPhase::Headers);
	let elapsed = started.elapsed();
	assert!(
		elapsed >= read && elapsed < HOLD_BEFORE_CLOSING,
		"{elapsed:?}"
	);
}
