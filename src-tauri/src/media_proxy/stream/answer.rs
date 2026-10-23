#[cfg(test)]
mod tests;

use grindr::MediaStream;

use super::super::requested::Requested;
use super::super::response::deliverable_status;

pub struct Head {
    pub status: u16,
    pub content_length: Option<u64>,
    pub content_range: Option<String>,
}

impl Head {
    pub fn of_stream(stream: &MediaStream) -> Self {
        Self {
            status: stream.status,
            content_length: stream.content_length,
            content_range: stream.content_range.clone(),
        }
    }

    pub fn of_cached(len: usize) -> Self {
        Self {
            status: 200,
            content_length: Some(len as u64),
            content_range: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Placement {
    pub length: u64,
    pub origin: u64,
    pub drop: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Answer {
    Stream {
        status: u16,
        content_range: Option<String>,
        placement: Placement,
    },
    Refuse {
        status: u16,
        at: u64,
    },
    Poison,
}

pub fn answer(head: &Head, requested: &Requested) -> Answer {
    let at = requested.start();
    match head.status {
        206 => partial(head.content_range.as_deref(), at),
        200 => full(head.content_length, at),
        status => Answer::Refuse {
            status: deliverable_status(status)
                .filter(|status| !status.is_informational())
                .map_or(502, |status| status.as_u16()),
            at,
        },
    }
}

fn partial(content_range: Option<&str>, at: u64) -> Answer {
    match content_range.and_then(parse_content_range) {
        Some((origin, length)) if origin <= at && at < length => Answer::Stream {
            status: 206,
            content_range: Some(span(at, length)),
            placement: Placement {
                length,
                origin,
                drop: 0,
            },
        },
        _ => Answer::Refuse { status: 502, at },
    }
}

fn full(content_length: Option<u64>, at: u64) -> Answer {
    if at == 0 {
        return Answer::Stream {
            status: 200,
            content_range: None,
            placement: Placement {
                length: content_length.unwrap_or(0),
                origin: 0,
                drop: 0,
            },
        };
    }
    match content_length {
        Some(length) if at < length => Answer::Stream {
            status: 206,
            content_range: Some(span(at, length)),
            placement: Placement {
                length,
                origin: 0,
                drop: at,
            },
        },
        Some(_) => Answer::Refuse { status: 416, at },
        None => Answer::Poison,
    }
}

fn span(at: u64, length: u64) -> String {
    format!("bytes {at}-{}/{length}", length - 1)
}

fn parse_content_range(value: &str) -> Option<(u64, u64)> {
    let (span, length) = value.strip_prefix("bytes ")?.split_once('/')?;
    let (first, _) = span.split_once('-')?;
    Some((first.parse().ok()?, length.parse().ok()?))
}
