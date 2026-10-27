use std::sync::atomic::Ordering;
use std::sync::Arc;

use tokio::sync::mpsc::Receiver;
use tokio::sync::Semaphore;

use super::super::scripted::{rig, Scripted, Step};
use super::*;

fn drained(rx: &mut Receiver<Chunk>) -> Vec<Chunk> {
    let mut got = Vec::new();
    while let Ok(chunk) = rx.try_recv() {
        got.push(chunk);
    }
    got
}

#[tokio::test]
async fn a_whole_body_from_zero_within_the_cap_is_teed_for_the_cache() {
    let mut rig = rig(
        Scripted::of([Step::Chunk(b"hello"), Step::Chunk(b"world")]),
        8,
    );
    rig.pump.tee = tee_capacity(Placement {
        length: 10,
        origin: 0,
        drop: 0,
    });

    let outcome = run(rig.pump).await;

    assert_eq!(
        outcome,
        Outcome::Finished(Some(Bytes::from_static(b"helloworld")))
    );
    assert_eq!(
        drained(&mut rig.rx),
        [
            Ok(Bytes::from_static(b"hello")),
            Ok(Bytes::from_static(b"world"))
        ]
    );
}

#[test]
fn nothing_is_teed_from_an_offset_after_a_drop_unsized_or_beyond_the_cap() {
    let cap = MAX_MEDIA_BYTES as u64;

    assert_eq!(
        tee_capacity(Placement {
            length: 10,
            origin: 0,
            drop: 0
        }),
        Some(10)
    );
    assert_eq!(
        tee_capacity(Placement {
            length: cap,
            origin: 0,
            drop: 0
        }),
        Some(MAX_MEDIA_BYTES)
    );
    assert_eq!(
        tee_capacity(Placement {
            length: 10,
            origin: 4,
            drop: 0
        }),
        None
    );
    assert_eq!(
        tee_capacity(Placement {
            length: 10,
            origin: 0,
            drop: 4
        }),
        None
    );
    assert_eq!(
        tee_capacity(Placement {
            length: 0,
            origin: 0,
            drop: 0
        }),
        None
    );
    assert_eq!(
        tee_capacity(Placement {
            length: cap + 1,
            origin: 0,
            drop: 0
        }),
        None
    );
}

#[tokio::test]
async fn a_body_that_does_not_match_its_length_is_not_cached() {
    let mut short = rig(Scripted::of([Step::Chunk(b"hello")]), 8);
    short.pump.tee = Some(10);
    let mut long = rig(
        Scripted::of([Step::Chunk(b"hello"), Step::Chunk(b"world")]),
        8,
    );
    long.pump.tee = Some(7);

    assert_eq!(run(short.pump).await, Outcome::Finished(None));
    assert_eq!(run(long.pump).await, Outcome::Finished(None));
}

#[tokio::test]
async fn a_pump_nobody_drains_is_abandoned_after_idling() {
    let source = Scripted::of([Step::Chunk(b"a"), Step::Chunk(b"b"), Step::Chunk(b"c")]);
    let dropped = source.drop_flag();
    let mut rig = rig(source, 2);
    let id = rig.pump.id;

    let outcome = run(rig.pump).await;

    assert_eq!(outcome, Outcome::Abandoned);
    assert!(
        dropped.load(Ordering::SeqCst),
        "the upstream must be dropped"
    );
    assert!(
        !unregister_stream(id),
        "the pump must unregister its stream"
    );
    assert_eq!(
        drained(&mut rig.rx),
        [Ok(Bytes::from_static(b"a")), Err(Fault::Abandoned)]
    );
}

#[tokio::test]
async fn closing_the_stream_cancels_the_pump_without_a_send() {
    let source = Scripted::of([Step::Forever]);
    let dropped = source.drop_flag();
    let mut rig = rig(source, 8);
    rig.cancel.send(()).unwrap();

    let outcome = run(rig.pump).await;

    assert_eq!(outcome, Outcome::Cancelled);
    assert!(dropped.load(Ordering::SeqCst));
    assert!(drained(&mut rig.rx).is_empty());
}

#[tokio::test]
async fn a_consumer_that_went_away_ends_the_pump() {
    let rig = rig(Scripted::of([Step::Chunk(b"a"), Step::Forever]), 8);
    drop(rig.rx);

    assert_eq!(run(rig.pump).await, Outcome::Cancelled);
}

#[tokio::test]
async fn a_pump_holds_its_permit_only_while_it_runs() {
    let fetches = Arc::new(Semaphore::new(1));
    let mut rig = rig(Scripted::of([Step::Chunk(b"a")]), 8);
    rig.pump.permit = Some(Arc::clone(&fetches).acquire_owned().await.unwrap());
    assert_eq!(fetches.available_permits(), 0);

    run(rig.pump).await;

    assert_eq!(fetches.available_permits(), 1);
}

#[tokio::test]
async fn an_upstream_fault_reaches_the_stream_after_the_bytes_before_it() {
    let mut rig = rig(
        Scripted::of([
            Step::Chunk(b"ab"),
            Step::Fault(Fault::Upstream("reset".to_owned())),
        ]),
        8,
    );

    let outcome = run(rig.pump).await;

    assert_eq!(outcome, Outcome::Faulted);
    assert_eq!(
        drained(&mut rig.rx),
        [
            Ok(Bytes::from_static(b"ab")),
            Err(Fault::Upstream("reset".to_owned()))
        ]
    );
    assert!(rig.rx.is_closed());
}

#[tokio::test]
async fn a_cached_source_is_sent_in_pieces_and_never_faults() {
    let mut source = Source::Cached(Bytes::from(vec![7u8; CACHED_PIECE + 1]));

    let first = source.next().await.unwrap().unwrap();
    let second = source.next().await.unwrap().unwrap();

    assert_eq!(first.len(), CACHED_PIECE);
    assert_eq!(second.len(), 1);
    assert_eq!(source.next().await.unwrap(), None);
}
