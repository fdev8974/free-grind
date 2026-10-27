use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use grindr::Bytes;
use tokio::sync::mpsc::{self, Receiver};
use tokio::sync::oneshot;

use super::super::registry::register_stream;
use super::adapter::WebViewStream;
use super::fault::{Chunk, Fault};
use super::pump::{Chunks, Pump};

pub enum Step {
    Chunk(&'static [u8]),
    Fault(Fault),
    Forever,
}

pub struct Scripted {
    steps: VecDeque<Step>,
    dropped: Arc<AtomicBool>,
}

impl Scripted {
    pub fn of(steps: impl IntoIterator<Item = Step>) -> Self {
        Self {
            steps: steps.into_iter().collect(),
            dropped: Arc::default(),
        }
    }

    pub fn drop_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.dropped)
    }
}

impl Chunks for Scripted {
    async fn next(&mut self) -> Result<Option<Bytes>, Fault> {
        match self.steps.pop_front() {
            Some(Step::Chunk(bytes)) => Ok(Some(Bytes::from_static(bytes))),
            Some(Step::Fault(fault)) => Err(fault),
            Some(Step::Forever) => std::future::pending().await,
            None => Ok(None),
        }
    }
}

impl Drop for Scripted {
    fn drop(&mut self) {
        self.dropped.store(true, Ordering::SeqCst);
    }
}

pub struct Rig {
    pub pump: Pump<Scripted>,
    pub rx: Receiver<Chunk>,
    pub cancel: oneshot::Sender<()>,
}

pub fn rig(source: Scripted, slots: usize) -> Rig {
    let (tx, rx) = mpsc::channel(slots);
    let (cancel, cancelled) = oneshot::channel();
    let pump = Pump {
        id: register_stream(Box::new(WebViewStream::empty_at(0))),
        source,
        tx,
        cancel: cancelled,
        permit: None,
        tee: None,
        idle: Duration::from_millis(50),
    };
    Rig { pump, rx, cancel }
}
