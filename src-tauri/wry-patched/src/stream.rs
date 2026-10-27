// Copyright 2020-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use std::{
  collections::HashMap,
  io,
  sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex, MutexGuard, PoisonError,
  },
};

use once_cell::sync::Lazy;

/// Response header naming the [`register_stream`] id whose stream becomes the body.
pub const STREAM_HEADER: &str = "x-wry-stream";

/// A response body with `java.io.InputStream` semantics.
pub trait ResponseStream: Send {
  fn available(&mut self) -> io::Result<u64>;
  fn skip(&mut self, n: u64) -> io::Result<u64>;
  /// `Ok(0)` is end of stream.
  fn read(&mut self, buf: &mut [u8]) -> io::Result<usize>;
  /// Must not block.
  fn close(&mut self);
}

type Entry = Arc<Mutex<Box<dyn ResponseStream>>>;

static STREAMS: Lazy<Mutex<HashMap<u64, Entry>>> = Lazy::new(Default::default);
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn streams() -> MutexGuard<'static, HashMap<u64, Entry>> {
  STREAMS.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn register_stream(stream: Box<dyn ResponseStream>) -> u64 {
  let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
  streams().insert(id, Arc::new(Mutex::new(stream)));
  id
}

pub fn unregister_stream(id: u64) -> bool {
  let Some(entry) = streams().remove(&id) else {
    return false;
  };
  let closed = entry.try_lock().map(|mut stream| stream.close()).is_ok();
  if !closed {
    std::thread::spawn(move || {
      if let Ok(mut stream) = entry.lock() {
        stream.close();
      }
    });
  }
  true
}

pub fn with_stream<T>(
  id: u64,
  body: impl FnOnce(&mut dyn ResponseStream) -> io::Result<T>,
) -> io::Result<T> {
  let entry = streams()
    .get(&id)
    .cloned()
    .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "unknown stream"))?;
  let mut stream = entry
    .lock()
    .map_err(|_| io::Error::other("stream poisoned"))?;
  body(&mut **stream)
}
