use std::io;

use grindr::Bytes;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Fault {
    Upstream(String),
    Abandoned,
}

impl From<Fault> for io::Error {
    fn from(fault: Fault) -> Self {
        match fault {
            Fault::Upstream(detail) => io::Error::other(detail),
            Fault::Abandoned => io::Error::new(io::ErrorKind::TimedOut, "abandoned after idling"),
        }
    }
}

pub type Chunk = Result<Bytes, Fault>;
