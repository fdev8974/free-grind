//! Minimal ISO-BMFF (MP4/MOV) box walker, ported from open-grind.

use std::io::{self, Read, Seek, SeekFrom};

const HEADER_LEN: u64 = 8;
const LARGE_SIZE_LEN: u64 = 8;
const FULL_BOX_LEN: u64 = 4;
const HDLR_TYPE_AT: u64 = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    pub start: u64,
    pub end: u64,
}

impl Span {
    pub fn size(&self) -> u64 {
        self.end.saturating_sub(self.start)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Located {
    pub box_type: [u8; 4],
    pub start: u64,
    pub header_len: u64,
    pub body: Span,
}

impl Located {
    pub fn is(&self, box_type: &[u8; 4]) -> bool {
        &self.box_type == box_type
    }

    pub fn payload_start(&self) -> u64 {
        self.start + self.header_len
    }
}

pub fn read_at<R: Read + Seek>(reader: &mut R, at: u64, buf: &mut [u8]) -> io::Result<()> {
    reader.seek(SeekFrom::Start(at))?;
    reader.read_exact(buf)
}

/// The box starting at `within.start`, or `None` when its header is broken or
/// it claims to run past `within`.
pub fn header<R: Read + Seek>(reader: &mut R, within: Span) -> io::Result<Option<Located>> {
    let Some(raw) = raw_header(reader, within)? else {
        return Ok(None);
    };
    if raw.total > within.size() {
        return Ok(None);
    }
    Ok(Some(located(reader, within.start, raw)?))
}

pub fn children<R: Read + Seek>(reader: &mut R, within: Span) -> io::Result<Vec<Located>> {
    let mut found = Vec::new();
    walk(reader, within, |child| {
        found.push(child);
        true
    })?;
    Ok(found)
}

fn walk<R: Read + Seek>(
    reader: &mut R,
    within: Span,
    mut visit: impl FnMut(Located) -> bool,
) -> io::Result<()> {
    let mut at = within.start;
    while at < within.end {
        let Some(raw) = raw_header(
            reader,
            Span {
                start: at,
                end: within.end,
            },
        )?
        else {
            break;
        };
        let raw = raw.clamped(within.end - at);
        if !visit(located(reader, at, raw)?) {
            break;
        }
        at += raw.total;
    }
    Ok(())
}

#[derive(Debug, Clone, Copy)]
struct RawHeader {
    box_type: [u8; 4],
    header_len: u64,
    total: u64,
}

impl RawHeader {
    fn clamped(self, available: u64) -> Self {
        Self {
            total: self.total.min(available),
            ..self
        }
    }
}

fn raw_header<R: Read + Seek>(reader: &mut R, within: Span) -> io::Result<Option<RawHeader>> {
    if within.size() < HEADER_LEN {
        return Ok(None);
    }
    let mut header = [0u8; HEADER_LEN as usize];
    read_at(reader, within.start, &mut header)?;
    let (Some(declared), Some(box_type)) = (be_u32(&header, 0), array_at(&header, 4)) else {
        return Ok(None);
    };
    let (header_len, total) = match u64::from(declared) {
        0 => (HEADER_LEN, within.size()),
        1 => {
            if within.size() < HEADER_LEN + LARGE_SIZE_LEN {
                return Ok(None);
            }
            let mut large = [0u8; LARGE_SIZE_LEN as usize];
            read_at(reader, within.start + HEADER_LEN, &mut large)?;
            (HEADER_LEN + LARGE_SIZE_LEN, u64::from_be_bytes(large))
        }
        size => (HEADER_LEN, size),
    };
    if total < header_len {
        return Ok(None);
    }
    Ok(Some(RawHeader {
        box_type,
        header_len,
        total,
    }))
}

fn located<R: Read + Seek>(reader: &mut R, at: u64, raw: RawHeader) -> io::Result<Located> {
    let end = at + raw.total;
    let mut body_start = at + raw.header_len;
    // ISO `meta` is a full box (version + flags first); QuickTime's isn't.
    if &raw.box_type == b"meta" && has_version_and_flags(reader, body_start)? {
        body_start += FULL_BOX_LEN;
    }
    Ok(Located {
        box_type: raw.box_type,
        start: at,
        header_len: raw.header_len,
        body: Span {
            start: body_start.min(end),
            end,
        },
    })
}

pub fn find<R: Read + Seek>(
    reader: &mut R,
    within: Span,
    box_type: &[u8; 4],
) -> io::Result<Option<Located>> {
    let mut found = None;
    walk(reader, within, |child| {
        if !child.is(box_type) {
            return true;
        }
        found = Some(child);
        false
    })?;
    Ok(found)
}

pub fn find_path<R: Read + Seek>(
    reader: &mut R,
    within: Span,
    path: &[[u8; 4]],
) -> io::Result<Option<Located>> {
    let mut span = within;
    let mut found = None;
    for box_type in path {
        let Some(child) = find(reader, span, box_type)? else {
            return Ok(None);
        };
        span = child.body;
        found = Some(child);
    }
    Ok(found)
}

pub fn handler_type<R: Read + Seek>(reader: &mut R, mdia: Span) -> io::Result<Option<[u8; 4]>> {
    let Some(hdlr) = find(reader, mdia, b"hdlr")? else {
        return Ok(None);
    };
    if hdlr.body.size() < HDLR_TYPE_AT + 4 {
        return Ok(None);
    }
    let mut handler = [0u8; 4];
    read_at(reader, hdlr.body.start + HDLR_TYPE_AT, &mut handler)?;
    Ok(Some(handler))
}

fn read_up_to<R: Read>(reader: &mut R, buf: &mut [u8]) -> io::Result<usize> {
    let mut filled = 0;
    while filled < buf.len() {
        let read = reader.read(&mut buf[filled..])?;
        if read == 0 {
            break;
        }
        filled += read;
    }
    Ok(filled)
}

pub fn be_u32(bytes: &[u8], at: usize) -> Option<u32> {
    array_at(bytes, at).map(u32::from_be_bytes)
}

pub fn be_u64(bytes: &[u8], at: usize) -> Option<u64> {
    array_at(bytes, at).map(u64::from_be_bytes)
}

fn array_at<const N: usize>(bytes: &[u8], at: usize) -> Option<[u8; N]> {
    bytes.get(at..)?.first_chunk().copied()
}

fn has_version_and_flags<R: Read + Seek>(reader: &mut R, body_start: u64) -> io::Result<bool> {
    let mut peek = [0u8; HEADER_LEN as usize];
    reader.seek(SeekFrom::Start(body_start))?;
    let filled = read_up_to(reader, &mut peek)?;
    Ok(filled == peek.len() && !looks_like_box_type(&peek[4..]))
}

fn looks_like_box_type(bytes: &[u8]) -> bool {
    bytes.iter().all(|byte| (0x20..=0x7e).contains(byte))
}

#[cfg(test)]
pub mod test_support {
    use super::Span;

    pub fn boxed(box_type: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut bytes = ((body.len() + 8) as u32).to_be_bytes().to_vec();
        bytes.extend_from_slice(box_type);
        bytes.extend_from_slice(body);
        bytes
    }

    pub fn whole(bytes: &[u8]) -> Span {
        Span {
            start: 0,
            end: bytes.len() as u64,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::test_support::{boxed, whole};
    use super::*;

    #[test]
    fn walks_siblings_and_reports_their_bodies() {
        let mut bytes = boxed(b"ftyp", b"isom");
        bytes.extend(boxed(b"free", b""));
        bytes.extend(boxed(b"mdat", b"payload"));

        let found = children(&mut Cursor::new(&bytes), whole(&bytes)).expect("children");

        assert_eq!(
            found
                .iter()
                .map(|child| (child.box_type, child.body.size()))
                .collect::<Vec<_>>(),
            vec![(*b"ftyp", 4), (*b"free", 0), (*b"mdat", 7)]
        );
    }

    #[test]
    fn a_size_of_one_reads_the_largesize_that_follows() {
        let mut bytes = 1u32.to_be_bytes().to_vec();
        bytes.extend_from_slice(b"mdat");
        bytes.extend_from_slice(&24u64.to_be_bytes());
        bytes.extend_from_slice(b"12345678");
        bytes.extend(boxed(b"moov", b""));

        let found = children(&mut Cursor::new(&bytes), whole(&bytes)).expect("children");

        assert_eq!(found[0].body, Span { start: 16, end: 24 });
        assert_eq!(found[1].box_type, *b"moov");
    }

    #[test]
    fn an_iso_meta_box_skips_its_version_and_flags_but_a_quicktime_one_does_not() {
        let mut iso_body = vec![0u8; 4];
        iso_body.extend(boxed(b"hdlr", b"handler"));
        let iso = boxed(b"meta", &iso_body);
        let quicktime = boxed(b"meta", &boxed(b"hdlr", b"handler"));

        let iso_meta = children(&mut Cursor::new(&iso), whole(&iso)).expect("children");
        let qt_meta = children(&mut Cursor::new(&quicktime), whole(&quicktime)).expect("children");

        assert_eq!(iso_meta[0].body.start, 12);
        assert_eq!(qt_meta[0].body.start, 8);
    }

    #[test]
    fn hostile_sizes_stop_or_clamp_the_walk_without_panicking() {
        let mut short = 4u32.to_be_bytes().to_vec();
        short.extend_from_slice(b"junk");
        assert!(children(&mut Cursor::new(&short), whole(&short)).expect("walk").is_empty());

        let mut long = 999u32.to_be_bytes().to_vec();
        long.extend_from_slice(b"mdatshort");
        let found = children(&mut Cursor::new(&long), whole(&long)).expect("walk");
        assert_eq!(found[0].body, Span { start: 8, end: 13 });

        let mut huge = 1u32.to_be_bytes().to_vec();
        huge.extend_from_slice(b"mdat");
        huge.extend_from_slice(&u64::MAX.to_be_bytes());
        let found = children(&mut Cursor::new(&huge), whole(&huge)).expect("walk");
        assert_eq!(found[0].body.end, huge.len() as u64);

        let truncated_large = [0, 0, 0, 1, b'm', b'd', b'a', b't', 0, 0];
        assert!(children(&mut Cursor::new(&truncated_large[..]), whole(&truncated_large))
            .expect("walk")
            .is_empty());
    }

    #[test]
    fn reads_the_handler_type_after_the_version_and_pre_defined_fields() {
        let mut body = vec![0u8; 8];
        body.extend_from_slice(b"vide");
        body.extend_from_slice(&[0u8; 12]);
        let mdia = boxed(b"hdlr", &body);

        let found = handler_type(&mut Cursor::new(&mdia), whole(&mdia)).expect("read");

        assert_eq!(found, Some(*b"vide"));
    }
}
