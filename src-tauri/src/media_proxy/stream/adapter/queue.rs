use std::collections::VecDeque;
use std::io;

use grindr::Bytes;
use tokio::sync::mpsc::error::TryRecvError;
use tokio::sync::mpsc::Receiver;

use super::super::fault::{Chunk, Fault};

#[derive(Default)]
pub struct Queue {
    rx: Option<Receiver<Chunk>>,
    pending: VecDeque<Bytes>,
    fault: Option<Fault>,
    ended: bool,
}

impl Queue {
    pub fn fed_by(rx: Receiver<Chunk>) -> Self {
        Self {
            rx: Some(rx),
            ..Self::default()
        }
    }

    pub fn ready(&mut self) -> u64 {
        while let Some(rx) = &mut self.rx {
            match rx.try_recv() {
                Ok(Ok(bytes)) => {
                    if !bytes.is_empty() {
                        self.pending.push_back(bytes);
                    }
                }
                Ok(Err(fault)) => {
                    self.fault = Some(fault);
                    break;
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    self.ended = true;
                    break;
                }
            }
        }
        self.pending.iter().map(|bytes| bytes.len() as u64).sum()
    }

    pub fn pull(&mut self) -> io::Result<Option<Bytes>> {
        if let Some(bytes) = self.pending.pop_front() {
            return Ok(Some(bytes));
        }
        if let Some(fault) = &self.fault {
            return Err(fault.clone().into());
        }
        if self.ended {
            return Ok(None);
        }
        let Some(rx) = &mut self.rx else {
            return Ok(None);
        };
        loop {
            match rx.blocking_recv() {
                Some(Ok(bytes)) if bytes.is_empty() => continue,
                Some(Ok(bytes)) => return Ok(Some(bytes)),
                Some(Err(fault)) => {
                    self.fault = Some(fault.clone());
                    return Err(fault.into());
                }
                None => {
                    self.ended = true;
                    return Ok(None);
                }
            }
        }
    }

    pub fn give_back(&mut self, bytes: Bytes) {
        self.pending.push_front(bytes);
    }

    pub fn close(&mut self) {
        self.rx = None;
        self.pending.clear();
    }
}
