use std::io::{self, Read};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use super::BodySource;

const ALPHABET: &[u8; 26] = b"abcdefghijklmnopqrstuvwxyz";

pub(crate) struct AlphabetSource {
	pub size: u64,
	pub yields: u64,
	pub opens: AtomicUsize,
	pub open_readers: Arc<AtomicUsize>,
}

impl AlphabetSource {
	pub(crate) fn exact(size: u64) -> Self {
		Self {
			size,
			yields: size,
			opens: AtomicUsize::new(0),
			open_readers: Arc::default(),
		}
	}

	pub(crate) fn content(&self) -> Vec<u8> {
		let mut content = Vec::new();
		AlphabetReader::new(self)
			.read_to_end(&mut content)
			.expect("read alphabet");
		content
	}

	pub(crate) fn opens(&self) -> usize {
		self.opens.load(Ordering::SeqCst)
	}

	pub(crate) async fn all_readers_closed(&self) {
		tokio::time::timeout(Duration::from_secs(5), async {
			while self.open_readers.load(Ordering::SeqCst) > 0 {
				tokio::time::sleep(Duration::from_millis(5)).await;
			}
		})
		.await
		.expect("every reader of the source must be closed");
	}
}

impl BodySource for AlphabetSource {
	fn size(&self) -> u64 {
		self.size
	}

	fn open(&self) -> io::Result<Box<dyn Read + Send>> {
		self.opens.fetch_add(1, Ordering::SeqCst);
		Ok(Box::new(AlphabetReader::new(self)))
	}
}

struct AlphabetReader {
	offset: u64,
	end: u64,
	open_readers: Arc<AtomicUsize>,
}

impl AlphabetReader {
	fn new(source: &AlphabetSource) -> Self {
		source.open_readers.fetch_add(1, Ordering::SeqCst);
		Self {
			offset: 0,
			end: source.yields,
			open_readers: Arc::clone(&source.open_readers),
		}
	}
}

impl Read for AlphabetReader {
	fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
		let count = (self.end - self.offset).min(buf.len() as u64) as usize;
		let mut written = 0;
		while written < count {
			let letter = ((self.offset + written as u64) % 26) as usize;
			let run = (ALPHABET.len() - letter).min(count - written);
			buf[written..written + run]
				.copy_from_slice(&ALPHABET[letter..letter + run]);
			written += run;
		}
		self.offset += count as u64;
		Ok(count)
	}
}

impl Drop for AlphabetReader {
	fn drop(&mut self) {
		self.open_readers.fetch_sub(1, Ordering::SeqCst);
	}
}
