use std::io::{self, Read};
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::task::{ready, Context, Poll};

use bytes::Bytes;
use http_body::{Body, Frame, SizeHint};
use tokio::runtime::Handle;
use tokio::sync::{mpsc, oneshot, watch};

use super::BodySource;

const CHUNK_SIZE: usize = 64 * 1024;
const QUEUED_CHUNKS: usize = 2;

pub(crate) const SOURCE_ENDED_EARLY: &str = "the body source ended early";
pub(crate) const SOURCE_RAN_LONG: &str =
	"the body source is longer than its size";

#[must_use = "the body fails once this is dropped"]
pub(crate) struct AbandonOnDrop {
	_sender: watch::Sender<()>,
	source_error: oneshot::Receiver<io::Error>,
}

impl AbandonOnDrop {
	pub(crate) fn into_source_error(mut self) -> Option<io::Error> {
		self.source_error.try_recv().ok()
	}
}

#[derive(Clone)]
struct Abandonment(watch::Receiver<()>);

impl Abandonment {
	fn has_happened(&self) -> bool {
		self.0.has_changed().is_err()
	}

	async fn happened(&mut self) {
		while self.0.changed().await.is_ok() {}
	}
}

pub(crate) struct StreamedBody {
	chunks: mpsc::Receiver<Bytes>,
	unsent: u64,
	sent: Arc<AtomicU64>,
	abandonment: Abandonment,
}

impl StreamedBody {
	pub(crate) fn open(
		source: Arc<dyn BodySource>,
		sent: Arc<AtomicU64>,
	) -> (Self, AbandonOnDrop) {
		let (sender, chunks) = mpsc::channel(QUEUED_CHUNKS);
		let (abandonment_sender, abandonment) = watch::channel(());
		let abandonment = Abandonment(abandonment);
		let (source_error_sender, source_error) = oneshot::channel();
		let unsent = source.size();
		let pump = Pump {
			source,
			size: unsent,
			chunks: sender,
			abandonment: abandonment.clone(),
			runtime: Handle::current(),
			source_error: source_error_sender,
		};
		tokio::task::spawn_blocking(move || pump.run());
		let body = Self {
			chunks,
			unsent,
			sent,
			abandonment,
		};
		(
			body,
			AbandonOnDrop {
				_sender: abandonment_sender,
				source_error,
			},
		)
	}
}

impl Body for StreamedBody {
	type Data = Bytes;
	type Error = http2::Error;

	fn poll_frame(
		self: Pin<&mut Self>,
		cx: &mut Context<'_>,
	) -> Poll<Option<Result<Frame<Bytes>, http2::Error>>> {
		let body = self.get_mut();
		if body.unsent == 0 {
			return Poll::Ready(None);
		}
		if body.abandonment.has_happened() {
			return Poll::Ready(Some(Err(http2::Reason::CANCEL.into())));
		}
		let frame = match ready!(body.chunks.poll_recv(cx)) {
			Some(chunk) => {
				body.unsent -= chunk.len() as u64;
				body.sent.fetch_add(chunk.len() as u64, Ordering::Relaxed);
				Ok(Frame::data(chunk))
			}
			None => Err(http2::Reason::CANCEL.into()),
		};
		Poll::Ready(Some(frame))
	}

	fn is_end_stream(&self) -> bool {
		self.unsent == 0
	}

	fn size_hint(&self) -> SizeHint {
		SizeHint::with_exact(self.unsent)
	}
}

struct Pump {
	source: Arc<dyn BodySource>,
	size: u64,
	chunks: mpsc::Sender<Bytes>,
	abandonment: Abandonment,
	runtime: Handle,
	source_error: oneshot::Sender<io::Error>,
}

fn read_chunk(reader: &mut dyn Read) -> io::Result<Bytes> {
	let mut chunk = vec![0; CHUNK_SIZE];
	loop {
		match reader.read(&mut chunk) {
			Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
			read => {
				chunk.truncate(read?);
				return Ok(chunk.into());
			}
		}
	}
}

impl Pump {
	fn deliver(&mut self, chunk: Bytes) -> bool {
		let Self {
			chunks,
			abandonment,
			runtime,
			..
		} = self;
		runtime.block_on(async {
			tokio::select! {
				biased;
				() = abandonment.happened() => false,
				sent = chunks.send(chunk) => sent.is_ok(),
			}
		})
	}

	fn run(mut self) {
		if let Err(error) = self.forward() {
			let _ = self.source_error.send(error);
		}
	}

	fn forward(&mut self) -> io::Result<()> {
		let mut reader = self.source.open()?;
		let mut unread = self.size;
		let mut held = None;
		loop {
			let chunk = read_chunk(&mut reader)?;
			let Some(left) = unread.checked_sub(chunk.len() as u64) else {
				return Err(io::Error::new(
					io::ErrorKind::InvalidData,
					SOURCE_RAN_LONG,
				));
			};
			unread = left;
			let delivered = held.take().is_none_or(|held| self.deliver(held));
			if !delivered {
				return Ok(());
			}
			if chunk.is_empty() {
				return match unread {
					0 => Ok(()),
					_ => Err(io::Error::new(
						io::ErrorKind::UnexpectedEof,
						SOURCE_ENDED_EARLY,
					)),
				};
			}
			held = Some(chunk);
		}
	}
}

#[cfg(test)]
mod tests {
	use std::future::poll_fn;

	use super::*;
	use crate::stream::test_source::AlphabetSource;

	struct OpenBody {
		body: StreamedBody,
		sent: Arc<AtomicU64>,
		abandon_on_drop: AbandonOnDrop,
	}

	fn body_of(source: &Arc<AlphabetSource>) -> OpenBody {
		let sent = Arc::new(AtomicU64::new(0));
		let (body, abandon_on_drop) = StreamedBody::open(
			Arc::clone(source) as Arc<dyn BodySource>,
			Arc::clone(&sent),
		);
		OpenBody {
			body,
			sent,
			abandon_on_drop,
		}
	}

	async fn next_data(
		body: &mut StreamedBody,
	) -> Option<Result<Bytes, http2::Error>> {
		poll_fn(|cx| Pin::new(&mut *body).poll_frame(cx))
			.await
			.map(|frame| frame.map(|frame| frame.into_data().expect("data")))
	}

	async fn first_error(body: &mut StreamedBody) -> http2::Error {
		loop {
			if let Err(error) = next_data(body)
				.await
				.expect("the body ended without an error")
			{
				return error;
			}
		}
	}

	#[test]
	fn a_streamed_body_is_send_and_sync() {
		fn assert_send_sync<T: Send + Sync>() {}
		assert_send_sync::<StreamedBody>();
	}

	#[tokio::test]
	async fn the_last_frame_ends_the_stream_with_an_exact_size_hint() {
		let source = Arc::new(AlphabetSource::exact(3 * CHUNK_SIZE as u64 + 7));
		let OpenBody {
			mut body,
			sent,
			abandon_on_drop: _abandon_on_drop,
		} = body_of(&source);
		let expected = source.content();
		assert_eq!(body.size_hint().exact(), Some(expected.len() as u64));

		let mut received = Vec::new();
		while let Some(data) = next_data(&mut body).await {
			let data = data.unwrap();
			assert!(!data.is_empty(), "no frame may be empty");
			received.extend_from_slice(&data);
			assert_eq!(
				body.size_hint().exact(),
				Some(expected.len() as u64 - received.len() as u64)
			);
			assert_eq!(body.is_end_stream(), received.len() == expected.len());
		}

		assert_eq!(received, expected);
		assert_eq!(sent.load(Ordering::SeqCst), expected.len() as u64);
	}

	#[tokio::test]
	async fn a_short_source_fails_instead_of_truncating() {
		let source = Arc::new(AlphabetSource {
			yields: 1000,
			..AlphabetSource::exact(1001)
		});
		let OpenBody {
			mut body,
			abandon_on_drop: _abandon_on_drop,
			..
		} = body_of(&source);

		let error = first_error(&mut body).await;

		assert_eq!(error.reason(), Some(http2::Reason::CANCEL));
		assert!(!body.is_end_stream());
	}

	#[tokio::test]
	async fn a_long_source_fails_before_its_last_bytes_are_sent() {
		let chunk = CHUNK_SIZE as u64;
		for (size, yields) in [(1000, 1001), (2 * chunk, 2 * chunk + 1)] {
			let source = Arc::new(AlphabetSource {
				yields,
				..AlphabetSource::exact(size)
			});
			let OpenBody {
				mut body,
				sent,
				abandon_on_drop: _abandon_on_drop,
			} = body_of(&source);

			let error = first_error(&mut body).await;

			assert_eq!(error.reason(), Some(http2::Reason::CANCEL));
			assert!(!body.is_end_stream());
			assert!(sent.load(Ordering::SeqCst) < size);
		}
	}

	#[tokio::test]
	async fn the_pump_exits_when_the_body_is_dropped() {
		let source = Arc::new(AlphabetSource::exact(1 << 40));
		let OpenBody {
			mut body,
			abandon_on_drop: _abandon_on_drop,
			..
		} = body_of(&source);
		next_data(&mut body).await.unwrap().unwrap();

		drop(body);

		source.all_readers_closed().await;
	}

	#[tokio::test]
	async fn an_abandoned_body_fails_and_closes_the_source_while_unread() {
		let source = Arc::new(AlphabetSource::exact(1 << 40));
		let OpenBody {
			mut body,
			abandon_on_drop,
			..
		} = body_of(&source);
		next_data(&mut body).await.unwrap().unwrap();

		drop(abandon_on_drop);

		source.all_readers_closed().await;
		let error = next_data(&mut body)
			.await
			.expect("an abandoned body must not end cleanly")
			.unwrap_err();
		assert_eq!(error.reason(), Some(http2::Reason::CANCEL));
		assert!(!body.is_end_stream());
	}
}
