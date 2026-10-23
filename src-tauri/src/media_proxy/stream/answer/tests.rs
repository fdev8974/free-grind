use super::*;

fn head(status: u16, content_length: Option<u64>, content_range: Option<&str>) -> Head {
    Head {
        status,
        content_length,
        content_range: content_range.map(str::to_owned),
    }
}

#[test]
fn a_partial_answer_streams_from_its_content_range_origin() {
    let answered = answer(
        &head(206, Some(90), Some("bytes 10-99/100")),
        &Requested::From(10),
    );

    assert_eq!(
        answered,
        Answer::Stream {
            status: 206,
            content_range: Some("bytes 10-99/100".to_owned()),
            placement: Placement {
                length: 100,
                origin: 10,
                drop: 0,
            },
        }
    );
}

#[test]
fn a_full_answer_to_a_seek_is_dropped_up_to_the_requested_byte() {
    let seek = Answer::Stream {
        status: 206,
        content_range: Some("bytes 10-99/100".to_owned()),
        placement: Placement {
            length: 100,
            origin: 0,
            drop: 10,
        },
    };

    assert_eq!(
        answer(&head(200, Some(100), None), &Requested::From(10)),
        seek
    );
    assert_eq!(
        answer(
            &head(200, Some(100), None),
            &Requested::Closed {
                first: 10,
                last: 20
            }
        ),
        seek,
        "a closed range is answered like its first byte"
    );
}

#[test]
fn a_full_answer_from_zero_streams_as_it_is() {
    for requested in [Requested::Whole, Requested::From(0), Requested::Suffix(5)] {
        assert_eq!(
            answer(&head(200, Some(100), None), &requested),
            Answer::Stream {
                status: 200,
                content_range: None,
                placement: Placement {
                    length: 100,
                    origin: 0,
                    drop: 0,
                },
            },
            "{requested:?}"
        );
    }
}

#[test]
fn a_full_answer_of_unknown_length_streams_unsized_from_zero() {
    assert_eq!(
        answer(&head(200, None, None), &Requested::Whole),
        Answer::Stream {
            status: 200,
            content_range: None,
            placement: Placement {
                length: 0,
                origin: 0,
                drop: 0,
            },
        }
    );
}

#[test]
fn a_full_answer_of_unknown_length_poisons_a_seek() {
    assert_eq!(
        answer(&head(200, None, None), &Requested::From(5)),
        Answer::Poison
    );
}

#[test]
fn a_seek_past_the_end_of_a_full_answer_is_unsatisfiable() {
    assert_eq!(
        answer(&head(200, Some(100), None), &Requested::From(100)),
        Answer::Refuse {
            status: 416,
            at: 100
        }
    );
}

#[test]
fn a_partial_answer_without_a_readable_content_range_is_refused() {
    for content_range in [None, Some("bytes */100"), Some("bytes 10-99/*"), Some("x")] {
        assert_eq!(
            answer(&head(206, Some(90), content_range), &Requested::From(10)),
            Answer::Refuse {
                status: 502,
                at: 10
            },
            "{content_range:?}"
        );
    }
}

#[test]
fn a_partial_answer_starting_past_the_requested_byte_is_refused() {
    assert_eq!(
        answer(
            &head(206, Some(80), Some("bytes 20-99/100")),
            &Requested::From(10)
        ),
        Answer::Refuse {
            status: 502,
            at: 10
        }
    );
}

#[test]
fn every_other_status_is_refused_at_the_requested_byte() {
    for status in [403, 404, 416, 500, 503] {
        assert_eq!(
            answer(&head(status, None, None), &Requested::From(7)),
            Answer::Refuse { status, at: 7 },
            "{status}"
        );
    }
}

#[test]
fn an_undeliverable_status_is_refused_as_a_bad_gateway() {
    for status in [101, 302, 307, 600] {
        assert_eq!(
            answer(&head(status, None, None), &Requested::Whole),
            Answer::Refuse { status: 502, at: 0 },
            "{status}"
        );
    }
}

#[test]
fn a_cached_body_is_a_full_answer_of_its_length() {
    let head = Head::of_cached(10);

    assert_eq!(head.status, 200);
    assert_eq!(head.content_length, Some(10));
    assert_eq!(head.content_range, None);
}

#[test]
fn a_partial_answer_starting_before_the_requested_byte_is_streamed_from_it() {
    assert_eq!(
        answer(
            &head(206, Some(100), Some("bytes 0-99/100")),
            &Requested::From(10)
        ),
        Answer::Stream {
            status: 206,
            content_range: Some("bytes 10-99/100".to_owned()),
            placement: Placement {
                length: 100,
                origin: 0,
                drop: 0,
            },
        }
    );
}
