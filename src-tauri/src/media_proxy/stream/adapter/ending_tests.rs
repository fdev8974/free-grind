use super::super::fault::Fault;
use super::super::tests::read_to_end;
use super::tests::{feed, wired, Wired};
use super::*;

#[test]
fn a_read_before_the_origin_is_an_error() {
    let mut wired = wired(Placement {
        length: 10,
        origin: 4,
        drop: 0,
    });
    feed(&wired.tx, b"efghij");

    let error = wired.stream.read(&mut [0u8; 2]).unwrap_err();

    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
}

#[test]
fn a_body_that_ends_early_is_an_error_not_an_eof() {
    let mut wired = wired(Placement {
        length: 10,
        origin: 0,
        drop: 0,
    });
    feed(&wired.tx, b"abcd");
    drop(wired.tx);

    let error = read_to_end(&mut wired.stream).unwrap_err();

    assert_eq!(error.kind(), io::ErrorKind::UnexpectedEof);
}

#[test]
fn an_unsized_body_ends_where_the_channel_closes() {
    let mut wired = wired(Placement {
        length: 0,
        origin: 0,
        drop: 0,
    });
    feed(&wired.tx, b"abcd");
    drop(wired.tx);

    assert_eq!(read_to_end(&mut wired.stream).unwrap(), b"abcd");
}

#[test]
fn a_fault_becomes_an_io_error_after_the_bytes_before_it_and_sticks() {
    let mut wired = wired(Placement {
        length: 10,
        origin: 0,
        drop: 0,
    });
    feed(&wired.tx, b"ab");
    wired
        .tx
        .try_send(Err(Fault::Upstream("reset".to_owned())))
        .unwrap();

    let mut buf = [0u8; 8];
    assert_eq!(wired.stream.read(&mut buf).unwrap(), 2);
    assert_eq!(
        wired.stream.read(&mut buf).unwrap_err().to_string(),
        "reset"
    );
    assert_eq!(
        wired.stream.read(&mut buf).unwrap_err().to_string(),
        "reset"
    );
}

#[test]
fn an_abandoned_stream_reads_as_a_timeout() {
    let mut wired = wired(Placement {
        length: 10,
        origin: 0,
        drop: 0,
    });
    wired.tx.try_send(Err(Fault::Abandoned)).unwrap();

    let error = wired.stream.read(&mut [0u8; 2]).unwrap_err();

    assert_eq!(error.kind(), io::ErrorKind::TimedOut);
}

#[test]
fn closing_drops_the_receiver_fires_the_cancel_and_refuses_every_call() {
    let mut wired = wired(Placement {
        length: 10,
        origin: 0,
        drop: 0,
    });
    feed(&wired.tx, b"ab");

    wired.stream.close();

    assert_eq!(wired.cancelled.try_recv(), Ok(()));
    assert!(wired.tx.is_closed());
    assert!(wired.stream.available().is_err());
    assert!(wired.stream.skip(1).is_err());
    assert!(wired.stream.read(&mut [0u8; 2]).is_err());
}

#[test]
fn dropping_the_stream_cancels_like_closing() {
    let Wired {
        stream,
        tx,
        mut cancelled,
    } = wired(Placement {
        length: 10,
        origin: 0,
        drop: 0,
    });

    drop(stream);

    assert_eq!(cancelled.try_recv(), Ok(()));
    assert!(tx.is_closed());
}

#[test]
fn an_empty_stream_advertises_one_byte_past_its_position_and_ends_at_once() {
    let mut stream = WebViewStream::empty_at(7);

    assert_eq!(stream.available().unwrap(), 8);
    assert_eq!(stream.skip(7).unwrap(), 7);
    assert_eq!(stream.read(&mut [0u8; 4]).unwrap(), 0);
    assert_eq!(stream.available().unwrap(), 0);
}

#[test]
fn an_empty_stream_at_zero_still_advertises_a_byte() {
    let mut stream = WebViewStream::empty_at(0);

    assert_eq!(stream.available().unwrap(), 1);
    assert_eq!(stream.read(&mut [0u8; 4]).unwrap(), 0);
}

#[test]
fn a_poisoned_stream_fails_its_first_available_call() {
    let mut stream = WebViewStream::poisoned();

    assert!(stream.available().is_err());
    assert!(stream.read(&mut [0u8; 4]).is_err());
}
