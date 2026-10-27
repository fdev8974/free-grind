//! In-process stand-in for the Grindr API, so the client's whole request path
//! can be exercised without touching the network.
//!
//! One server is shared by every test. Tests stay independent by filtering
//! [`requests_from`] on their own generated device id.

use std::cell::Cell;
use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::pin::Pin;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use crate::captcha::{CaptchaAction, CaptchaTokenProvider};

/// Header `{"alg":"HS256","typ":"JWT"}` . payload `{"exp":9999999999}` . sig
const JWT: &str =
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjk5OTk5OTk5OTl9.sig";

pub(crate) const REFRESHED_PROFILE_ID: &str = "42";

pub(crate) struct FixedCaptcha;

impl CaptchaTokenProvider for FixedCaptcha {
	fn token(
		&self,
		action: CaptchaAction,
	) -> Pin<Box<dyn Future<Output = Option<String>> + Send + '_>> {
		assert_eq!(action, CaptchaAction::DeviceKeyRegistration);
		Box::pin(async { Some("captcha-xyz".to_owned()) })
	}
}

pub(crate) const CHALLENGE: &str = "chal-123";

#[derive(Clone)]
pub(crate) struct Recorded {
	pub method: String,
	pub path: String,
	pub headers: Vec<(String, String)>,
	pub body: String,
}

impl Recorded {
	pub fn header(&self, name: &str) -> Option<&str> {
		self.headers
			.iter()
			.find(|(n, _)| n == name)
			.map(|(_, v)| v.as_str())
	}
}

fn recordings() -> &'static Mutex<Vec<Recorded>> {
	static RECORDINGS: OnceLock<Mutex<Vec<Recorded>>> = OnceLock::new();
	RECORDINGS.get_or_init(Mutex::default)
}

/// Requests to one exact path, for callers with no `l-device-info` to filter on.
pub(crate) fn requests_to(path: &str) -> Vec<Recorded> {
	recordings()
		.lock()
		.unwrap()
		.iter()
		.filter(|r| r.path == path)
		.cloned()
		.collect()
}

/// Requests made by one device, in the order the server saw them.
pub(crate) fn requests_from(device_id: &str) -> Vec<Recorded> {
	recordings()
		.lock()
		.unwrap()
		.iter()
		.filter(|r| {
			r.header("l-device-info")
				.is_some_and(|v| v.starts_with(device_id))
		})
		.cloned()
		.collect()
}

thread_local! {
	static REDIRECTED_BASE_URL: Cell<Option<&'static str>> =
		const { Cell::new(None) };
}

pub(crate) struct RedirectedBaseUrl;

impl RedirectedBaseUrl {
	pub(crate) fn on_this_thread(base_url: String) -> Self {
		REDIRECTED_BASE_URL.set(Some(base_url.leak()));
		Self
	}

	pub(crate) fn by_name() -> Self {
		let port = base_url().rsplit(':').next().expect("a port").to_owned();
		Self::on_this_thread(format!("http://localhost:{port}"))
	}
}

impl Drop for RedirectedBaseUrl {
	fn drop(&mut self) {
		REDIRECTED_BASE_URL.set(None);
	}
}

pub(crate) fn base_url() -> &'static str {
	if let Some(redirected) = REDIRECTED_BASE_URL.get() {
		return redirected;
	}
	static BASE: OnceLock<String> = OnceLock::new();
	BASE.get_or_init(|| {
		let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
		let addr = listener.local_addr().expect("local addr");
		std::thread::spawn(move || {
			for stream in listener.incoming().flatten() {
				std::thread::spawn(move || serve(stream));
			}
		});
		format!("http://{addr}")
	})
}

fn serve(mut stream: TcpStream) {
	let mut reader = BufReader::new(stream.try_clone().expect("clone stream"));

	let mut request_line = String::new();
	if reader.read_line(&mut request_line).unwrap_or(0) == 0 {
		return;
	}
	let mut parts = request_line.split_whitespace();
	let method = parts.next().unwrap_or_default().to_owned();
	let path = parts.next().unwrap_or_default().to_owned();

	let mut headers: Vec<(String, String)> = Vec::new();
	loop {
		let mut line = String::new();
		if reader.read_line(&mut line).unwrap_or(0) == 0 {
			break;
		}
		let line = line.trim_end();
		if line.is_empty() {
			break;
		}
		if let Some((name, value)) = line.split_once(':') {
			headers.push((
				name.trim().to_ascii_lowercase(),
				value.trim().to_owned(),
			));
		}
	}

	let length: usize = headers
		.iter()
		.find(|(n, _)| n == "content-length")
		.and_then(|(_, v)| v.parse().ok())
		.unwrap_or(0);
	if path == STALLED_PATH {
		std::thread::sleep(HOLD_BEFORE_CLOSING);
		return;
	}
	let Some(body) = read_body(&mut reader, &path, length) else {
		return;
	};
	if path == SILENT_PATH {
		std::thread::sleep(HOLD_BEFORE_CLOSING);
		return;
	}

	let reply = match path.strip_prefix(MEDIA_PREFIX) {
		Some(rest) => media_reply(rest, &headers),
		None => {
			let (status, payload) = respond(&path, &headers);
			Reply {
				status,
				content_type: "application/json",
				extra: Vec::new(),
				body: payload.into_bytes(),
				pace: None,
			}
		}
	};
	recordings().lock().unwrap().push(Recorded {
		method,
		path,
		headers,
		body: String::from_utf8_lossy(&body).into_owned(),
	});

	let mut head = format!(
		"HTTP/1.1 {}\r\ncontent-type: {}\r\ncontent-length: {}\r\n\
		 connection: close\r\n",
		reply.status,
		reply.content_type,
		reply.body.len()
	);
	for (name, value) in &reply.extra {
		head.push_str(&format!("{name}: {value}\r\n"));
	}
	head.push_str("\r\n");
	let _ = stream.write_all(head.as_bytes());
	write_body(&mut stream, &reply);
	let _ = stream.flush();
}

pub(crate) const DRIP_PIECES: usize = 8;

fn write_body(stream: &mut TcpStream, reply: &Reply) {
	let Some(pause) = reply.pace else {
		let _ = stream.write_all(&reply.body);
		return;
	};
	let piece = reply.body.len().div_ceil(DRIP_PIECES).max(1);
	for (index, chunk) in reply.body.chunks(piece).enumerate() {
		if index > 0 {
			std::thread::sleep(pause);
		}
		if stream
			.write_all(chunk)
			.and_then(|()| stream.flush())
			.is_err()
		{
			return;
		}
	}
}

pub(crate) const SLOW_READ_PREFIX: &str = "/slow-read/";

const SLOW_READ_CHUNKS: u32 = 8;

fn read_body(
	reader: &mut impl Read,
	path: &str,
	length: usize,
) -> Option<Vec<u8>> {
	let mut body = vec![0u8; length];
	let pause = path
		.strip_prefix(SLOW_READ_PREFIX)
		.and_then(|millis| millis.parse::<u64>().ok())
		.map(|millis| Duration::from_millis(millis) / SLOW_READ_CHUNKS);
	match pause {
		None => reader.read_exact(&mut body).ok()?,
		Some(pause) => {
			let chunk_len = length.div_ceil(SLOW_READ_CHUNKS as usize).max(1);
			for chunk in body.chunks_mut(chunk_len) {
				std::thread::sleep(pause);
				reader.read_exact(chunk).ok()?;
			}
		}
	}
	Some(body)
}

struct Reply {
	status: &'static str,
	content_type: &'static str,
	extra: Vec<(&'static str, String)>,
	body: Vec<u8>,
	pace: Option<Duration>,
}

/// `/media/<len>` serves that many bytes and honors `Range`;
/// `/media/<len>?drip=<ms>` writes them in [`DRIP_PIECES`] pieces `<ms>` apart;
/// `/media/redirect?to=<url>` answers a `302`.
pub(crate) const MEDIA_PREFIX: &str = "/media/";

fn media_reply(rest: &str, headers: &[(String, String)]) -> Reply {
	if let Some(query) = rest.strip_prefix("redirect?to=") {
		return Reply {
			status: "302 Found",
			content_type: "text/plain",
			extra: vec![("location", query.to_owned())],
			body: Vec::new(),
			pace: None,
		};
	}

	let (length, query) = rest.split_once('?').unwrap_or((rest, ""));
	let length: usize = length.parse().unwrap_or_default();
	let pace = query
		.strip_prefix("drip=")
		.and_then(|millis| millis.parse().ok())
		.map(Duration::from_millis);
	let full: Vec<u8> = (0..length).map(|i| i as u8).collect();

	let range = headers
		.iter()
		.find(|(name, _)| name == "range")
		.and_then(|(_, value)| value.strip_prefix("bytes="))
		.and_then(|value| value.split_once('-'));
	let Some((start, end)) = range else {
		return Reply {
			status: "200 OK",
			content_type: "image/jpeg",
			extra: vec![("accept-ranges", "bytes".to_owned())],
			body: full,
			pace,
		};
	};

	let start: usize = start.parse().unwrap_or_default();
	let end: usize = end.parse().unwrap_or(length.saturating_sub(1));
	let slice =
		full[start.min(length)..=end.min(length.saturating_sub(1))].to_vec();
	Reply {
		status: "206 Partial Content",
		content_type: "video/mp4",
		extra: vec![
			("accept-ranges", "bytes".to_owned()),
			("content-range", format!("bytes {start}-{end}/{length}")),
		],
		body: slice,
		pace,
	}
}

type ReplyQueues = HashMap<(String, String), VecDeque<(&'static str, String)>>;

fn reply_queues() -> &'static Mutex<ReplyQueues> {
	static QUEUES: OnceLock<Mutex<ReplyQueues>> = OnceLock::new();
	QUEUES.get_or_init(Mutex::default)
}

pub(crate) struct QueuedReplies<'a> {
	pub device_id: &'a str,
	pub path: &'a str,
	pub replies: Vec<(&'static str, String)>,
}

pub(crate) fn queue_replies(queued: QueuedReplies) {
	reply_queues()
		.lock()
		.unwrap()
		.entry((queued.device_id.to_owned(), queued.path.to_owned()))
		.or_default()
		.extend(queued.replies);
}

struct ReplyLookup<'a> {
	device_info: &'a str,
	path: &'a str,
}

fn queued_reply(lookup: ReplyLookup) -> Option<(&'static str, String)> {
	let mut queues = reply_queues().lock().unwrap();
	let key = queues
		.keys()
		.find(|(device_id, path)| {
			path == lookup.path
				&& lookup.device_info.starts_with(device_id.as_str())
		})?
		.clone();
	queues.get_mut(&key)?.pop_front()
}

pub(crate) const LATE_UNAUTHORIZED_PREFIX: &str = "/late-401/";

pub(crate) const ACCEPTING_PATH: &str = "/accepting";

pub(crate) const STALLED_PATH: &str = "/stalled";

pub(crate) const SILENT_PATH: &str = "/silent";

pub(crate) const HOLD_BEFORE_CLOSING: Duration = Duration::from_secs(5);

fn respond(path: &str, headers: &[(String, String)]) -> (&'static str, String) {
	let path = path.split('?').next().unwrap_or(path);
	let device_info = headers
		.iter()
		.find(|(name, _)| name == "l-device-info")
		.map(|(_, value)| value.as_str())
		.unwrap_or_default();
	if let Some(millis) = path.strip_prefix(LATE_UNAUTHORIZED_PREFIX) {
		let millis = millis.parse().unwrap_or_default();
		std::thread::sleep(Duration::from_millis(millis));
	}
	if let Some(reply) = queued_reply(ReplyLookup { device_info, path }) {
		return reply;
	}
	match path {
		late if late.starts_with(LATE_UNAUTHORIZED_PREFIX) => (
			"401 Unauthorized",
			r#"{"code":401,"message":"unauthorized"}"#.to_owned(),
		),
		slow if slow.starts_with(SLOW_READ_PREFIX) => {
			("200 OK", "{}".to_owned())
		}
		ACCEPTING_PATH => ("200 OK", "{}".to_owned()),
		"/v8/sessions" | "/v9/sessions" => (
			"200 OK",
			format!(
				r#"{{"profileId":"{REFRESHED_PROFILE_ID}","sessionId":"{JWT}","authToken":"refreshed-tok"}}"#
			),
		),
		"/v1/verification/device-keys/challenge" => {
			("200 OK", format!(r#"{{"challenge":"{CHALLENGE}"}}"#))
		}
		"/v1/verification/device-keys" => ("200 OK", "{}".to_owned()),
		"/v2/verification/device-keys" => ("200 OK", "{}".to_owned()),
		"/v3/bootstrap" => ("200 OK", r#"{"ok":true}"#.to_owned()),
		_ => (
			"404 Not Found",
			r#"{"code":404,"message":"no route"}"#.to_owned(),
		),
	}
}
