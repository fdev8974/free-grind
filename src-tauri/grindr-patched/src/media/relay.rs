use std::cell::Cell;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::{TcpListener, TcpStream};

use crate::testserver::RedirectedBaseUrl;

pub(crate) const OK_PATH: &str = "/media/ok";
pub(crate) const HELD_PATH: &str = "/media/held";
pub(crate) const DRIP_PATH: &str = "/media/drip";
pub(crate) const STALLED_BODY_PATH: &str = "/media/stalled-body";
pub(crate) const EMPTY_PATH: &str = "/media/empty";
pub(crate) const REDIRECT_PATH: &str = "/media/redirect";
pub(crate) const OK_BODY: &[u8] = b"media";
const DRIP_PAUSE: Duration = Duration::from_millis(50);
pub(crate) const DRIP_PIECES: u8 = 40;
const HOLD: Duration = Duration::from_secs(30);

thread_local! {
	static MEDIA_OVER_HTTP2: Cell<bool> = const { Cell::new(false) };
}

pub(crate) fn media_over_http2() -> bool {
	MEDIA_OVER_HTTP2.get()
}

struct MediaOverHttp2;

impl MediaOverHttp2 {
	fn on_this_thread() -> Self {
		MEDIA_OVER_HTTP2.set(true);
		Self
	}
}

impl Drop for MediaOverHttp2 {
	fn drop(&mut self) {
		MEDIA_OVER_HTTP2.set(false);
	}
}

#[derive(Default)]
struct Origin {
	served: Mutex<Vec<(SocketAddr, String)>>,
	location: Mutex<Option<String>>,
}

impl Origin {
	async fn serve(self: Arc<Self>, listener: TcpListener) {
		while let Ok((socket, peer)) = listener.accept().await {
			tokio::spawn(Arc::clone(&self).serve_connection(socket, peer));
		}
	}

	async fn serve_connection(
		self: Arc<Self>,
		socket: TcpStream,
		peer: SocketAddr,
	) {
		let Ok(mut connection) = http2::server::handshake(socket).await else {
			return;
		};
		while let Some(Ok((request, respond))) = connection.accept().await {
			let path = request.uri().path().to_owned();
			self.served.lock().unwrap().push((peer, path.clone()));
			let location = self.location.lock().unwrap().clone();
			tokio::spawn(answer(path, location, respond));
		}
	}
}

async fn answer(
	path: String,
	location: Option<String>,
	mut respond: http2::server::SendResponse<Bytes>,
) {
	if let Some(location) = location.filter(|_| path == REDIRECT_PATH) {
		let mut redirect = http::Response::default();
		*redirect.status_mut() = wreq::StatusCode::FOUND;
		redirect.headers_mut().insert(
			wreq::header::LOCATION,
			location.parse().expect("a header-safe location"),
		);
		let _ = respond.send_response(redirect, true);
		return;
	}
	if path == HELD_PATH {
		tokio::time::sleep(HOLD).await;
		return;
	}
	if path == EMPTY_PATH {
		let _ = respond.send_response(Default::default(), true);
		return;
	}
	let Ok(mut body) = respond.send_response(Default::default(), false) else {
		return;
	};
	match path.as_str() {
		DRIP_PATH => {
			for piece in 0..DRIP_PIECES {
				tokio::time::sleep(DRIP_PAUSE).await;
				let last = piece + 1 == DRIP_PIECES;
				if body.send_data(Bytes::from(vec![piece]), last).is_err() {
					return;
				}
			}
		}
		STALLED_BODY_PATH => {
			let _ = body.send_data(Bytes::from_static(b"part"), false);
			tokio::time::sleep(HOLD).await;
		}
		_ => {
			let _ = body.send_data(Bytes::from_static(OK_BODY), true);
		}
	}
}

struct Link {
	muted: Arc<AtomicBool>,
	upstream: SocketAddr,
}

#[derive(Default)]
struct Relay {
	links: Mutex<Vec<Link>>,
	mute_new: AtomicBool,
}

impl Relay {
	async fn serve(self: Arc<Self>, listener: TcpListener, origin: SocketAddr) {
		while let Ok((client, _)) = listener.accept().await {
			let Ok(server) = TcpStream::connect(origin).await else {
				return;
			};
			let muted =
				Arc::new(AtomicBool::new(self.mute_new.load(Ordering::SeqCst)));
			self.links.lock().unwrap().push(Link {
				muted: Arc::clone(&muted),
				upstream: server.local_addr().unwrap(),
			});
			let (client_read, client_write) = client.into_split();
			let (server_read, server_write) = server.into_split();
			tokio::spawn(pump(client_read, server_write, Arc::clone(&muted)));
			tokio::spawn(pump(server_read, client_write, muted));
		}
	}
}

async fn pump(
	mut from: OwnedReadHalf,
	mut to: OwnedWriteHalf,
	muted: Arc<AtomicBool>,
) {
	let mut buffer = vec![0; 64 * 1024];
	while let Ok(read) = from.read(&mut buffer).await {
		if read == 0 {
			break;
		}
		if !muted.load(Ordering::SeqCst)
			&& to.write_all(&buffer[..read]).await.is_err()
		{
			return;
		}
	}
	if muted.load(Ordering::SeqCst) {
		std::future::pending::<()>().await;
	}
	let _ = to.shutdown().await;
}

pub(crate) struct Cdn {
	base: String,
	origin: Arc<Origin>,
	relay: Arc<Relay>,
	_base_url: RedirectedBaseUrl,
	_http2: MediaOverHttp2,
}

impl Cdn {
	pub(crate) async fn start() -> Self {
		Self::start_on("localhost").await
	}

	/// A CDN reached by address, whose dials the resolver never sees.
	pub(crate) async fn start_by_address() -> Self {
		Self::start_on("127.0.0.1").await
	}

	async fn start_on(host: &str) -> Self {
		let origin_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
		let origin_address = origin_listener.local_addr().unwrap();
		let origin = Arc::new(Origin::default());
		tokio::spawn(Arc::clone(&origin).serve(origin_listener));
		let relay_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
		let port = relay_listener.local_addr().unwrap().port();
		let relay = Arc::new(Relay::default());
		tokio::spawn(Arc::clone(&relay).serve(relay_listener, origin_address));
		let base = format!("http://{host}:{port}");
		Self {
			_base_url: RedirectedBaseUrl::on_this_thread(base.clone()),
			base,
			origin,
			relay,
			_http2: MediaOverHttp2::on_this_thread(),
		}
	}

	pub(crate) fn url(&self, path: &str) -> String {
		format!("{}{path}", self.base)
	}

	pub(crate) fn redirect_to(&self, location: &str) {
		*self.origin.location.lock().unwrap() = Some(location.to_owned());
	}

	pub(crate) fn accepted(&self) -> usize {
		self.relay.links.lock().unwrap().len()
	}

	pub(crate) fn mute(&self, connection: usize) {
		self.relay.links.lock().unwrap()[connection]
			.muted
			.store(true, Ordering::SeqCst);
	}

	pub(crate) fn mute_everything(&self) {
		self.relay.mute_new.store(true, Ordering::SeqCst);
		for link in self.relay.links.lock().unwrap().iter() {
			link.muted.store(true, Ordering::SeqCst);
		}
	}

	pub(crate) fn served(&self, path: &str) -> Vec<usize> {
		let links = self.relay.links.lock().unwrap();
		self.origin
			.served
			.lock()
			.unwrap()
			.iter()
			.filter(|(_, served)| served == path)
			.map(|(peer, _)| {
				links
					.iter()
					.position(|link| link.upstream == *peer)
					.expect("every origin connection comes through the relay")
			})
			.collect()
	}
}
