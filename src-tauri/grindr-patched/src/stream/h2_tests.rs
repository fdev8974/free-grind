use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use wreq::Method;

use super::test_source::AlphabetSource;
use super::tests::{sign_in, SignedIn};
use crate::client::Timeouts;
use crate::signing::DeviceKey;
use crate::testserver::{RedirectedBaseUrl, REFRESHED_PROFILE_ID};

const RECEIVED_BEFORE_ABANDONING: u64 = 1024 * 1024;

struct H2Server {
	signed_in: SignedIn,
	_redirected: RedirectedBaseUrl,
}

async fn serve_http2(listener: &TcpListener) -> H2Server {
	let address = listener.local_addr().unwrap();
	let signed_in = sign_in(Timeouts::default());
	let http2 = wreq::Client::builder().http2_only().build().unwrap();
	signed_in.client.replace_http_client(http2).await;
	H2Server {
		signed_in,
		_redirected: RedirectedBaseUrl::on_this_thread(format!(
			"http://{address}"
		)),
	}
}

struct UploadReceiver {
	received: Arc<AtomicU64>,
	ended: oneshot::Sender<Option<http2::Error>>,
}

impl UploadReceiver {
	async fn serve_one(self, listener: TcpListener) {
		let (socket, _) = listener.accept().await.unwrap();
		let mut connection = http2::server::handshake(socket).await.unwrap();
		let (request, _unanswered) =
			connection.accept().await.unwrap().unwrap();
		tokio::spawn(
			async move { while connection.accept().await.is_some() {} },
		);
		let mut body = request.into_body();
		let error = loop {
			match body.data().await {
				Some(Ok(chunk)) => {
					self.received
						.fetch_add(chunk.len() as u64, Ordering::SeqCst);
					body.flow_control().release_capacity(chunk.len()).unwrap();
				}
				Some(Err(error)) => break Some(error),
				None => break None,
			}
		};
		let _ = self.ended.send(error);
	}
}

#[tokio::test]
async fn an_abandoned_attempt_resets_its_http2_stream_and_closes_the_source() {
	let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
	let server = serve_http2(&listener).await;
	let received = Arc::new(AtomicU64::new(0));
	let (ended_sender, ended) = oneshot::channel();
	tokio::spawn(
		UploadReceiver {
			received: Arc::clone(&received),
			ended: ended_sender,
		}
		.serve_one(listener),
	);
	let source = Arc::new(AlphabetSource::exact(1 << 40));
	let attempt = tokio::spawn(
		server
			.signed_in
			.client
			.request(Method::POST, "/")
			.stream("video/mp4", Arc::clone(&source))
			.send(),
	);
	tokio::time::timeout(Duration::from_secs(5), async {
		while received.load(Ordering::SeqCst) < RECEIVED_BEFORE_ABANDONING {
			tokio::time::sleep(Duration::from_millis(5)).await;
		}
	})
	.await
	.expect("the upload must reach the server");

	attempt.abort();
	let _ = attempt.await;

	let error = tokio::time::timeout(Duration::from_secs(5), ended)
		.await
		.expect("the server must stop receiving")
		.unwrap();
	assert_eq!(
		error.and_then(|error| error.reason()),
		Some(http2::Reason::CANCEL)
	);
	source.all_readers_closed().await;
}

async fn refuse_every_stream(
	listener: TcpListener,
	attempts: Arc<AtomicUsize>,
) {
	loop {
		let (socket, _) = listener.accept().await.unwrap();
		let attempts = Arc::clone(&attempts);
		tokio::spawn(async move {
			let mut connection =
				http2::server::handshake(socket).await.unwrap();
			while let Some(Ok((_, mut respond))) = connection.accept().await {
				attempts.fetch_add(1, Ordering::SeqCst);
				respond.send_reset(http2::Reason::REFUSED_STREAM);
			}
		});
	}
}

#[tokio::test]
async fn a_refused_bytes_body_is_resent_but_a_streamed_one_is_not() {
	let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
	let server = serve_http2(&listener).await;
	let attempts = Arc::new(AtomicUsize::new(0));
	tokio::spawn(refuse_every_stream(listener, Arc::clone(&attempts)));
	let client = &server.signed_in.client;
	let key = DeviceKey::generate(REFRESHED_PROFILE_ID.to_owned());
	assert!(client.restore_signing_key(key.export()).await);
	let source = Arc::new(AlphabetSource::exact(1024));
	let content = Bytes::from(source.content());
	let post = || client.request(Method::POST, "/");
	let attempts_to_send = async |request: crate::RequestBuilder| {
		request.send().await.unwrap_err();
		attempts.swap(0, Ordering::SeqCst)
	};

	assert!(attempts_to_send(post().json(&[1, 2])).await > 1);
	assert!(
		attempts_to_send(post().bytes("video/mp4", content.clone())).await > 1
	);
	assert!(
		attempts_to_send(post().signed_bytes("video/mp4", content)).await > 1
	);
	assert_eq!(
		attempts_to_send(post().stream("video/mp4", source)).await,
		1
	);
}
