#[cfg(test)]
mod tests;

use std::future::Future;
use std::time::Duration;

use grindr::{Bytes, MediaStream};
use tokio::sync::mpsc::Sender;
use tokio::sync::{oneshot, OwnedSemaphorePermit};

use super::super::registry::unregister_stream;
use super::super::upstream::without_url;
use super::super::MAX_MEDIA_BYTES;
use super::answer::Placement;
use super::fault::{Chunk, Fault};

pub const IDLE: Duration = Duration::from_secs(60);
const CACHED_PIECE: usize = 256 * 1024;

pub trait Chunks: Send {
    fn next(&mut self) -> impl Future<Output = Result<Option<Bytes>, Fault>> + Send;
}

pub enum Source {
    Live(Box<MediaStream>),
    Cached(Bytes),
}

impl Chunks for Source {
    async fn next(&mut self) -> Result<Option<Bytes>, Fault> {
        match self {
            Self::Live(stream) => stream
                .chunk()
                .await
                .map_err(|error| Fault::Upstream(without_url(error.to_string()))),
            Self::Cached(body) => {
                Ok((!body.is_empty()).then(|| body.split_to(body.len().min(CACHED_PIECE))))
            }
        }
    }
}

pub struct Pump<C> {
    pub id: u64,
    pub source: C,
    pub tx: Sender<Chunk>,
    pub cancel: oneshot::Receiver<()>,
    pub permit: Option<OwnedSemaphorePermit>,
    pub tee: Option<usize>,
    pub idle: Duration,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Finished(Option<Bytes>),
    Cancelled,
    Abandoned,
    Faulted,
}

pub fn tee_capacity(placement: Placement) -> Option<usize> {
    let length = placement.length;
    let from_zero = placement.origin == 0 && placement.drop == 0;
    let sized_within_cap = length > 0 && length <= MAX_MEDIA_BYTES as u64;
    (from_zero && sized_within_cap).then_some(length as usize)
}

struct Tee {
    whole: Vec<u8>,
    expected: usize,
}

impl Tee {
    fn keep(&mut self, bytes: &[u8]) -> bool {
        if self.whole.len() + bytes.len() > self.expected {
            return false;
        }
        self.whole.extend_from_slice(bytes);
        true
    }

    fn finished(self) -> Option<Bytes> {
        (self.whole.len() == self.expected).then(|| Bytes::from(self.whole))
    }
}

pub async fn run<C: Chunks>(pump: Pump<C>) -> Outcome {
    let Pump {
        id,
        mut source,
        tx,
        mut cancel,
        permit,
        tee,
        idle,
    } = pump;
    let _permit = permit;
    let Ok(last_word) = tx.clone().reserve_owned().await else {
        return Outcome::Cancelled;
    };
    let mut tee = tee.map(|expected| Tee {
        whole: Vec::with_capacity(expected),
        expected,
    });
    loop {
        let next = tokio::select! {
            _ = &mut cancel => return Outcome::Cancelled,
            next = source.next() => next,
        };
        let bytes = match next {
            Ok(Some(bytes)) => bytes,
            Ok(None) => return Outcome::Finished(tee.and_then(Tee::finished)),
            Err(fault) => {
                last_word.send(Err(fault));
                return Outcome::Faulted;
            }
        };
        if tee.as_mut().is_some_and(|tee| !tee.keep(&bytes)) {
            tee = None;
        }
        match tokio::time::timeout(idle, tx.send(Ok(bytes))).await {
            Ok(Ok(())) => {}
            Ok(Err(_)) => return Outcome::Cancelled,
            Err(_) => {
                drop(source);
                last_word.send(Err(Fault::Abandoned));
                unregister_stream(id);
                return Outcome::Abandoned;
            }
        }
    }
}
