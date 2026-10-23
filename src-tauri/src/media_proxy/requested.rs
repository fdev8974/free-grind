#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Requested {
    Whole,
    From(u64),
    Closed { first: u64, last: u64 },
    Suffix(u64),
}

impl Requested {
    pub fn parse(range: Option<&str>) -> Self {
        let Some(spec) = range.and_then(|value| value.strip_prefix("bytes=")) else {
            return Self::Whole;
        };
        let Some((start, end)) = spec.split_once('-').filter(|_| !spec.contains(',')) else {
            return Self::Whole;
        };
        if start.is_empty() {
            return end.parse().map_or(Self::Whole, Self::Suffix);
        }
        let Ok(first) = start.parse() else {
            return Self::Whole;
        };
        if end.is_empty() {
            return Self::From(first);
        }
        match end.parse() {
            Ok(last) if last >= first => Self::Closed { first, last },
            _ => Self::Whole,
        }
    }

    pub fn start(self) -> u64 {
        match self {
            Self::Whole | Self::Suffix(_) => 0,
            Self::From(first) | Self::Closed { first, .. } => first,
        }
    }
}

pub fn upstream_range(requested: &Requested) -> Option<String> {
    match requested.start() {
        0 => None,
        first => Some(format!("bytes={first}-")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_open_ended_range_is_a_seek_from_its_first_byte() {
        assert_eq!(Requested::parse(Some("bytes=4-")), Requested::From(4));
        assert_eq!(Requested::parse(Some("bytes=0-")), Requested::From(0));
    }

    #[test]
    fn a_closed_range_keeps_both_ends() {
        assert_eq!(
            Requested::parse(Some("bytes=2-5")),
            Requested::Closed { first: 2, last: 5 }
        );
    }

    #[test]
    fn a_suffix_range_is_the_length_of_the_tail() {
        assert_eq!(Requested::parse(Some("bytes=-3")), Requested::Suffix(3));
    }

    #[test]
    fn anything_unparseable_is_the_whole_resource() {
        for range in [
            None,
            Some("bytes=5-2"),
            Some("bytes=a-b"),
            Some("bytes=0-1,3-4"),
            Some("bytes="),
            Some("seconds=1-2"),
            Some("nonsense"),
            Some("bytes=99999999999999999999-"),
        ] {
            assert_eq!(Requested::parse(range), Requested::Whole, "{range:?}");
        }
    }

    #[test]
    fn the_start_is_zero_unless_a_first_byte_was_named() {
        assert_eq!(Requested::Whole.start(), 0);
        assert_eq!(Requested::Suffix(3).start(), 0);
        assert_eq!(Requested::From(7).start(), 7);
        assert_eq!(Requested::Closed { first: 7, last: 9 }.start(), 7);
    }

    #[test]
    fn only_a_seek_past_zero_goes_upstream_and_always_open_ended() {
        assert_eq!(
            upstream_range(&Requested::From(10)).as_deref(),
            Some("bytes=10-")
        );
        assert_eq!(
            upstream_range(&Requested::Closed {
                first: 10,
                last: 20
            })
            .as_deref(),
            Some("bytes=10-")
        );
        for requested in [
            Requested::Whole,
            Requested::From(0),
            Requested::Suffix(3),
            Requested::Closed { first: 0, last: 5 },
        ] {
            assert_eq!(upstream_range(&requested), None, "{requested:?}");
        }
    }
}
