use tokio::sync::mpsc::{self, Sender};

use super::super::tests::read_to_end;
use super::*;

pub(super) struct Wired {
    pub(super) stream: WebViewStream,
    pub(super) tx: Sender<Chunk>,
    pub(super) cancelled: oneshot::Receiver<()>,
}

pub(super) fn wired(placement: Placement) -> Wired {
    let (tx, rx) = mpsc::channel(CHANNEL_SLOTS);
    let (cancel, cancelled) = oneshot::channel();
    Wired {
        stream: WebViewStream::streaming(rx, cancel, placement),
        tx,
        cancelled,
    }
}

pub(super) fn feed(tx: &Sender<Chunk>, bytes: &'static [u8]) {
    tx.try_send(Ok(Bytes::from_static(bytes))).unwrap();
}

#[test]
fn the_first_available_call_is_the_length_and_later_calls_are_what_is_queued() {
    let mut wired = wired(Placement {
        length: 100,
        origin: 0,
        drop: 0,
    });

    assert_eq!(wired.stream.available().unwrap(), 100);
    assert_eq!(wired.stream.available().unwrap(), 0);

    feed(&wired.tx, b"abc");
    feed(&wired.tx, b"de");
    assert_eq!(wired.stream.available().unwrap(), 5);
    let mut buf = [0u8; 4];
    wired.stream.read(&mut buf).unwrap();
    assert_eq!(wired.stream.available().unwrap(), 2);
}

#[test]
fn an_unsized_stream_only_ever_reports_what_is_queued() {
    let mut wired = wired(Placement {
        length: 0,
        origin: 0,
        drop: 0,
    });
    feed(&wired.tx, b"abcd");

    assert_eq!(wired.stream.available().unwrap(), 4);
}

#[test]
fn reads_serve_the_queued_chunks_in_order_and_split_them_to_the_buffer() {
    let mut wired = wired(Placement {
        length: 7,
        origin: 0,
        drop: 0,
    });
    feed(&wired.tx, b"abcde");
    feed(&wired.tx, b"fg");
    drop(wired.tx);

    assert_eq!(read_to_end(&mut wired.stream).unwrap(), b"abcdefg");
}

#[test]
fn a_skip_up_to_the_origin_costs_no_bytes() {
    let mut wired = wired(Placement {
        length: 10,
        origin: 4,
        drop: 0,
    });
    feed(&wired.tx, b"efghij");
    drop(wired.tx);

    assert_eq!(wired.stream.skip(4).unwrap(), 4);
    assert_eq!(read_to_end(&mut wired.stream).unwrap(), b"efghij");
}

#[test]
fn a_skip_past_the_origin_consumes_the_stream() {
    let mut wired = wired(Placement {
        length: 10,
        origin: 0,
        drop: 0,
    });
    feed(&wired.tx, b"abcdefghij");
    drop(wired.tx);

    assert_eq!(wired.stream.skip(3).unwrap(), 3);
    assert_eq!(read_to_end(&mut wired.stream).unwrap(), b"defghij");
}

#[test]
fn a_body_the_cdn_sent_from_zero_is_skipped_to_the_requested_byte() {
    let mut wired = wired(Placement {
        length: 10,
        origin: 0,
        drop: 4,
    });
    feed(&wired.tx, b"abcdefghij");
    drop(wired.tx);

    assert_eq!(wired.stream.skip(4).unwrap(), 4);
    assert_eq!(read_to_end(&mut wired.stream).unwrap(), b"efghij");
}

#[test]
fn a_body_the_cdn_started_before_the_requested_byte_is_trimmed_by_the_skip() {
    let mut wired = wired(Placement {
        length: 10,
        origin: 2,
        drop: 0,
    });
    feed(&wired.tx, b"cdefghij");
    drop(wired.tx);

    assert_eq!(wired.stream.skip(4).unwrap(), 4);
    assert_eq!(read_to_end(&mut wired.stream).unwrap(), b"efghij");
}

#[test]
fn a_skip_shorter_than_the_drop_reads_on_from_where_it_stopped() {
    let mut wired = wired(Placement {
        length: 10,
        origin: 0,
        drop: 4,
    });
    feed(&wired.tx, b"abcdefghij");
    drop(wired.tx);

    assert_eq!(wired.stream.skip(2).unwrap(), 2);
    assert_eq!(read_to_end(&mut wired.stream).unwrap(), b"cdefghij");
}

#[test]
fn a_skip_returns_zero_only_at_the_end() {
    let mut wired = wired(Placement {
        length: 3,
        origin: 0,
        drop: 0,
    });
    feed(&wired.tx, b"abc");
    drop(wired.tx);

    assert_eq!(wired.stream.skip(10).unwrap(), 3);
    assert_eq!(wired.stream.skip(10).unwrap(), 0);
}

#[test]
fn a_body_longer_than_its_length_ends_at_the_length() {
    let mut wired = wired(Placement {
        length: 5,
        origin: 0,
        drop: 0,
    });
    feed(&wired.tx, b"abcdefgh");

    assert_eq!(read_to_end(&mut wired.stream).unwrap(), b"abcde");
    assert_eq!(wired.stream.read(&mut [0u8; 3]).unwrap(), 0);
}

#[test]
fn an_empty_chunk_is_never_an_end_of_body() {
    let mut wired = wired(Placement {
        length: 4,
        origin: 0,
        drop: 0,
    });
    feed(&wired.tx, b"");
    feed(&wired.tx, b"abcd");
    drop(wired.tx);

    assert_eq!(read_to_end(&mut wired.stream).unwrap(), b"abcd");
}
