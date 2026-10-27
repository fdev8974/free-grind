//! Strips identifying metadata from an MP4/MOV in place, without remuxing,
//! ported from open-grind. Every box outside a small allow-list (`udta`,
//! `meta`, `uuid`/XMP, …) is renamed to `free` and zeroed, non-audio/video
//! tracks (GPS/text/timecode) are freed along with their samples in `mdat`,
//! and the movie/track/media creation and modification times become the
//! upload time. The file keeps its size and every offset stays valid.

use std::io::{self, Cursor, Read, Seek, SeekFrom};
use std::ops::Range;
use std::time::{SystemTime, UNIX_EPOCH};

use super::boxes::{be_u32, be_u64, children, find, find_path, handler_type, header, read_at, Located, Span};

/// Seconds between 1904-01-01 (the QuickTime epoch) and 1970-01-01.
const MOVIE_EPOCH_OFFSET: u64 = 2_082_844_800;
const MAX_TABLE_BYTES: u64 = 8 * 1024 * 1024;
const FREE: &[u8; 4] = b"free";
const STSZ: Layout = Layout {
    count_at: 8,
    stride: 4,
};
const STCO: Layout = Layout {
    count_at: 4,
    stride: 4,
};
const CO64: Layout = Layout {
    count_at: 4,
    stride: 8,
};
const STSC: Layout = Layout {
    count_at: 4,
    stride: 12,
};

#[derive(Debug, Clone, PartialEq, Eq)]
enum Fill {
    Zeros,
    Bytes(Vec<u8>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Patch {
    span: Span,
    fill: Fill,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Level {
    Moov,
    Trak,
    Mdia,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Action {
    Keep,
    Blank,
    Free,
    Times,
    Descend(Level),
    Track,
}

pub fn movie_time(at: SystemTime) -> u64 {
    at.duration_since(UNIX_EPOCH)
        .map(|since| since.as_secs())
        .unwrap_or_default()
        .saturating_add(MOVIE_EPOCH_OFFSET)
}

/// The stripped file, or `None` when it has no movie box or a track whose
/// samples can't be located — refused rather than uploaded half-stripped.
pub fn strip(mut bytes: Vec<u8>, uploaded_at: u64) -> Option<Vec<u8>> {
    let patches = plan(&mut Cursor::new(bytes.as_slice()), uploaded_at).ok()??;
    apply(&mut bytes, &patches);
    Some(bytes)
}

fn apply(bytes: &mut [u8], patches: &[Patch]) {
    let len = bytes.len() as u64;
    for patch in patches {
        let start = patch.span.start.min(len) as usize;
        let end = patch.span.end.min(len) as usize;
        let target = &mut bytes[start..end];
        match &patch.fill {
            Fill::Zeros => target.fill(0),
            Fill::Bytes(fill) => {
                let n = target.len().min(fill.len());
                target[..n].copy_from_slice(&fill[..n]);
            }
        }
    }
}

fn plan<R: Read + Seek>(reader: &mut R, uploaded_at: u64) -> io::Result<Option<Vec<Patch>>> {
    let end = reader.seek(SeekFrom::End(0))?;
    let mut planner = Planner {
        reader,
        uploaded_at,
        file_size: end,
        patches: Vec::new(),
        unstrippable: false,
    };
    let mut at = 0;
    let mut movie = false;
    while at < end {
        let span = Span { start: at, end };
        let Some(child) = header(planner.reader, span)? else {
            if !movie {
                return Ok(None);
            }
            // Unparseable trailer after the movie: blank it as one free box.
            planner.free_span(span);
            break;
        };
        match top_action(&child.box_type) {
            Action::Descend(level) => {
                movie = true;
                planner.walk(child.body, level)?;
            }
            Action::Blank => planner.zero(child.body),
            Action::Free => planner.free(child),
            _ => {}
        }
        at = child.body.end;
    }
    if !movie || planner.unstrippable {
        return Ok(None);
    }
    Ok(Some(planner.finish()))
}

fn top_action(box_type: &[u8; 4]) -> Action {
    match box_type {
        b"moov" => Action::Descend(Level::Moov),
        b"ftyp" | b"mdat" | b"moof" | b"mfra" | b"sidx" | b"styp" | b"ssix" => Action::Keep,
        b"free" | b"skip" | b"wide" => Action::Blank,
        _ => Action::Free,
    }
}

fn action(level: Level, box_type: &[u8; 4]) -> Action {
    match level {
        Level::Moov => match box_type {
            b"mvhd" => Action::Times,
            b"trak" => Action::Track,
            b"mvex" | b"iods" | b"pssh" => Action::Keep,
            _ => Action::Free,
        },
        Level::Trak => match box_type {
            b"tkhd" => Action::Times,
            b"mdia" => Action::Descend(Level::Mdia),
            b"edts" | b"tref" | b"tapt" | b"load" | b"txas" | b"clip" | b"matt" | b"imap" => {
                Action::Keep
            }
            _ => Action::Free,
        },
        Level::Mdia => match box_type {
            b"mdhd" => Action::Times,
            b"hdlr" | b"minf" | b"elng" => Action::Keep,
            _ => Action::Free,
        },
    }
}

struct Planner<'a, R> {
    reader: &'a mut R,
    uploaded_at: u64,
    file_size: u64,
    patches: Vec<Patch>,
    unstrippable: bool,
}

impl<R: Read + Seek> Planner<'_, R> {
    fn finish(mut self) -> Vec<Patch> {
        self.patches.sort_by_key(|patch| patch.span.start);
        self.patches
    }

    fn zero(&mut self, span: Span) {
        if span.size() > 0 {
            self.patches.push(Patch {
                span,
                fill: Fill::Zeros,
            });
        }
    }

    fn write(&mut self, at: u64, bytes: Vec<u8>) {
        self.patches.push(Patch {
            span: Span {
                start: at,
                end: at + bytes.len() as u64,
            },
            fill: Fill::Bytes(bytes),
        });
    }

    fn free(&mut self, located: Located) {
        self.write(located.start + 4, FREE.to_vec());
        self.zero(Span {
            start: located.payload_start(),
            end: located.body.end,
        });
    }

    fn free_span(&mut self, span: Span) {
        let size = span.size();
        if size < 8 {
            self.zero(span);
            return;
        }
        let declared = u32::try_from(size).unwrap_or_default();
        let mut head = declared.to_be_bytes().to_vec();
        head.extend_from_slice(FREE);
        self.write(span.start, head);
        self.zero(Span {
            start: span.start + 8,
            end: span.end,
        });
    }

    fn walk(&mut self, within: Span, level: Level) -> io::Result<()> {
        let mut at = within.start;
        while at < within.end {
            let rest = Span {
                start: at,
                end: within.end,
            };
            let Some(child) = header(self.reader, rest)? else {
                self.free_span(rest);
                return Ok(());
            };
            match action(level, &child.box_type) {
                Action::Times => self.times(child)?,
                Action::Descend(inner) => self.walk(child.body, inner)?,
                Action::Track => self.track(child)?,
                Action::Free => self.free(child),
                Action::Blank => self.zero(child.body),
                Action::Keep => {}
            }
            at = child.body.end;
        }
        Ok(())
    }

    /// Overwrites creation + modification time (the two fields after
    /// version/flags; 64-bit in a version-1 header).
    fn times(&mut self, located: Located) -> io::Result<()> {
        if located.body.size() == 0 {
            return Ok(());
        }
        let mut version = [0u8; 1];
        read_at(self.reader, located.body.start, &mut version)?;
        let wide = version[0] == 1;
        let field = if wide { 8 } else { 4 };
        let at = located.body.start + 4;
        if at + 2 * field > located.body.end {
            return Ok(());
        }
        let stamp = if wide {
            self.uploaded_at.to_be_bytes().to_vec()
        } else {
            u32::try_from(self.uploaded_at)
                .unwrap_or(u32::MAX)
                .to_be_bytes()
                .to_vec()
        };
        self.write(at, stamp.repeat(2));
        Ok(())
    }

    fn track(&mut self, trak: Located) -> io::Result<()> {
        if self.is_media(trak.body)? {
            return self.walk(trak.body, Level::Trak);
        }
        let Some(ranges) = self.sample_ranges(trak.body)? else {
            self.unstrippable = true;
            return Ok(());
        };
        for span in ranges {
            self.zero(span);
        }
        self.free(trak);
        Ok(())
    }

    fn is_media(&mut self, trak: Span) -> io::Result<bool> {
        let Some(mdia) = find(self.reader, trak, b"mdia")? else {
            return Ok(false);
        };
        let handler = handler_type(self.reader, mdia.body)?;
        Ok(matches!(handler.as_ref(), Some(b"vide" | b"soun")))
    }

    fn sample_ranges(&mut self, trak: Span) -> io::Result<Option<Vec<Span>>> {
        let Some(stbl) = find_path(self.reader, trak, &[*b"mdia", *b"minf", *b"stbl"])? else {
            return Ok(Some(Vec::new()));
        };
        let tables = children(self.reader, stbl.body)?;
        let Some(sample_tables) = self.sample_tables(&tables)? else {
            return Ok(None);
        };
        Ok(sample_tables.chunk_spans(self.file_size))
    }

    fn sample_tables(&mut self, tables: &[Located]) -> io::Result<Option<SampleTables>> {
        let Some(sizes) = self.sample_sizes(tables)? else {
            return Ok(None);
        };
        let Some(chunk_offsets) = self.chunk_offsets(tables)? else {
            return Ok(None);
        };
        let Some(runs) = self.entries(tables, b"stsc", STSC)? else {
            return Ok(None);
        };
        Ok(Some(SampleTables {
            sizes,
            chunk_offsets,
            runs,
        }))
    }

    fn sample_sizes(&mut self, tables: &[Located]) -> io::Result<Option<SampleSizes>> {
        let Some(stsz) = self.table(tables, b"stsz")? else {
            return Ok(None);
        };
        let (Some(fixed), Some(count)) = (be_u32(&stsz, 4), be_u32(&stsz, 8)) else {
            return Ok(None);
        };
        if fixed == 0 {
            return Ok(Entries::new(stsz, STSZ).map(SampleSizes::Listed));
        }
        let (size, count) = (u64::from(fixed), u64::from(count));
        if count.saturating_mul(size) > self.file_size {
            return Ok(None);
        }
        Ok(Some(SampleSizes::Fixed { size, count }))
    }

    fn chunk_offsets(&mut self, tables: &[Located]) -> io::Result<Option<Entries>> {
        if let Some(co64) = self.table(tables, b"co64")? {
            return Ok(Entries::new(co64, CO64));
        }
        self.entries(tables, b"stco", STCO)
    }

    fn entries(
        &mut self,
        tables: &[Located],
        box_type: &[u8; 4],
        layout: Layout,
    ) -> io::Result<Option<Entries>> {
        Ok(self
            .table(tables, box_type)?
            .and_then(|bytes| Entries::new(bytes, layout)))
    }

    fn table(&mut self, tables: &[Located], box_type: &[u8; 4]) -> io::Result<Option<Vec<u8>>> {
        let Some(found) = tables.iter().find(|table| table.is(box_type)) else {
            return Ok(None);
        };
        let size = found.body.size();
        if !(8..=MAX_TABLE_BYTES).contains(&size) {
            return Ok(None);
        }
        let mut bytes = vec![0u8; size as usize];
        read_at(self.reader, found.body.start, &mut bytes)?;
        Ok(Some(bytes))
    }
}

#[derive(Debug, Clone, Copy)]
struct Layout {
    count_at: usize,
    stride: usize,
}

struct Entries {
    bytes: Vec<u8>,
    start: usize,
    stride: usize,
    count: usize,
}

impl Entries {
    fn new(bytes: Vec<u8>, layout: Layout) -> Option<Self> {
        let count = be_u32(&bytes, layout.count_at)? as usize;
        let start = layout.count_at + 4;
        let room = bytes.len().checked_sub(start)? / layout.stride;
        (count <= room).then_some(Self {
            bytes,
            start,
            stride: layout.stride,
            count,
        })
    }

    fn entry(&self, index: usize) -> Option<&[u8]> {
        if index >= self.count {
            return None;
        }
        let at = self.start + index * self.stride;
        self.bytes.get(at..at + self.stride)
    }
}

enum SampleSizes {
    Fixed { size: u64, count: u64 },
    Listed(Entries),
}

impl SampleSizes {
    fn count(&self) -> u64 {
        match self {
            Self::Fixed { count, .. } => *count,
            Self::Listed(entries) => entries.count as u64,
        }
    }

    fn total(&self, samples: Range<u64>) -> Option<u64> {
        match self {
            Self::Fixed { size, .. } => {
                Some(size.saturating_mul(samples.end.saturating_sub(samples.start)))
            }
            Self::Listed(entries) => samples
                .map(|index| {
                    let entry = entries.entry(usize::try_from(index).ok()?)?;
                    be_u32(entry, 0).map(u64::from)
                })
                .sum(),
        }
    }
}

struct SampleTables {
    sizes: SampleSizes,
    chunk_offsets: Entries,
    runs: Entries,
}

impl SampleTables {
    /// Byte ranges in the file holding this track's samples, from the
    /// chunk offsets (`stco`/`co64`), samples-per-chunk runs (`stsc`) and
    /// sample sizes (`stsz`). `None` when any range runs past the file.
    fn chunk_spans(&self, file_size: u64) -> Option<Vec<Span>> {
        let mut spans = Vec::new();
        let mut sample = 0u64;
        let mut per_chunk = 0u64;
        let mut run = 0usize;
        for index in 0..self.chunk_offsets.count {
            while let Some(next) = self.runs.entry(run) {
                if be_u32(next, 0)? as usize > index + 1 {
                    break;
                }
                per_chunk = u64::from(be_u32(next, 4)?);
                run += 1;
            }
            let next_sample = sample.saturating_add(per_chunk).min(self.sizes.count());
            let total = self.sizes.total(sample..next_sample)?;
            sample = next_sample;
            let start = self.chunk_offset(index)?;
            let end = start.saturating_add(total);
            if end > file_size {
                return None;
            }
            if total > 0 {
                spans.push(Span { start, end });
            }
        }
        Some(coalesced(spans))
    }

    fn chunk_offset(&self, index: usize) -> Option<u64> {
        let entry = self.chunk_offsets.entry(index)?;
        if self.chunk_offsets.stride == CO64.stride {
            return be_u64(entry, 0);
        }
        be_u32(entry, 0).map(u64::from)
    }
}

fn coalesced(mut spans: Vec<Span>) -> Vec<Span> {
    spans.sort_unstable_by_key(|span| span.start);
    spans.dedup_by(|next, kept| {
        if next.start > kept.end {
            return false;
        }
        kept.end = kept.end.max(next.end);
        true
    });
    spans
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::video::boxes::test_support::boxed;

    const UPLOADED_AT: u64 = 3_900_000_000;
    const GPS: &[u8] = b"+37.7752-122.4197/";
    const SECRET_SAMPLE: &[u8] = b"SECRET-GPS-TEXT-SAMPLE";

    fn contains(haystack: &[u8], needle: &[u8]) -> bool {
        haystack.windows(needle.len()).any(|window| window == needle)
    }

    fn hdlr(handler: &[u8; 4]) -> Vec<u8> {
        let mut body = vec![0u8; 8];
        body.extend_from_slice(handler);
        body.extend_from_slice(&[0u8; 12]);
        boxed(b"hdlr", &body)
    }

    fn table(words: &[u32]) -> Vec<u8> {
        words.iter().flat_map(|word| word.to_be_bytes()).collect()
    }

    /// version 0 header: version/flags, creation, modification, then filler.
    fn timed(box_type: &[u8; 4]) -> Vec<u8> {
        let mut body = vec![0u8; 4];
        body.extend_from_slice(&0x0BAD_F00Du32.to_be_bytes());
        body.extend_from_slice(&0x0DEF_ACEDu32.to_be_bytes());
        body.extend_from_slice(&[0u8; 12]);
        boxed(box_type, &body)
    }

    /// ftyp, moov { mvhd, udta(GPS), video trak, text trak → sample }, mdat.
    /// The text track's single sample sits at `sample_at` inside mdat.
    fn movie(sample_offset: Option<u32>) -> Vec<u8> {
        let ftyp = boxed(b"ftyp", b"isom\0\0\0\0isom");
        let udta = boxed(b"udta", &boxed(b"\xa9xyz", GPS));
        let video = boxed(
            b"trak",
            &[
                timed(b"tkhd"),
                boxed(
                    b"mdia",
                    &[timed(b"mdhd"), hdlr(b"vide"), boxed(b"minf", b"")].concat(),
                ),
            ]
            .concat(),
        );
        let text_track = |offset: u32| {
            let stbl = [
                boxed(b"stsz", &table(&[0, 0, 1, SECRET_SAMPLE.len() as u32])),
                boxed(b"stco", &table(&[0, 1, offset])),
                boxed(b"stsc", &table(&[0, 1, 1, 1, 1])),
            ]
            .concat();
            boxed(
                b"trak",
                &[
                    timed(b"tkhd"),
                    boxed(
                        b"mdia",
                        &[hdlr(b"text"), boxed(b"minf", &boxed(b"stbl", &stbl))].concat(),
                    ),
                ]
                .concat(),
            )
        };
        // Lay out once to learn where mdat's payload lands, then for real.
        let moov_with = |offset: u32| {
            boxed(
                b"moov",
                &[timed(b"mvhd"), udta.clone(), video.clone(), text_track(offset)].concat(),
            )
        };
        let probe = [ftyp.clone(), moov_with(0)].concat();
        let offset = sample_offset.unwrap_or(probe.len() as u32 + 8);
        let mdat = boxed(b"mdat", &[SECRET_SAMPLE, b"VIDEO-FRAMES"].concat());
        [ftyp, moov_with(offset), mdat].concat()
    }

    #[test]
    fn the_planted_location_and_text_track_samples_are_gone() {
        let original = movie(None);
        assert!(contains(&original, GPS));
        assert!(contains(&original, SECRET_SAMPLE));

        let stripped = strip(original.clone(), UPLOADED_AT).expect("strippable");

        assert_eq!(stripped.len(), original.len());
        assert!(!contains(&stripped, GPS));
        assert!(!contains(&stripped, SECRET_SAMPLE));
        assert!(contains(&stripped, b"VIDEO-FRAMES"));
        assert!(contains(&stripped, b"vide"));
        assert!(!contains(&stripped, b"text"));
        assert!(stripped.starts_with(&original[..20]));
    }

    #[test]
    fn creation_and_modification_times_become_the_upload_time() {
        let stripped = strip(movie(None), UPLOADED_AT).expect("strippable");
        let stamp = (UPLOADED_AT as u32).to_be_bytes();

        assert!(!contains(&stripped, &0x0BAD_F00Du32.to_be_bytes()));
        assert!(!contains(&stripped, &0x0DEF_ACEDu32.to_be_bytes()));
        assert!(contains(&stripped, &[stamp, stamp].concat()));
    }

    #[test]
    fn a_sample_past_the_end_of_the_file_refuses_the_strip() {
        assert!(strip(movie(Some(u32::MAX - 64)), UPLOADED_AT).is_none());
    }

    #[test]
    fn a_file_without_a_movie_box_is_refused() {
        let bytes = [boxed(b"ftyp", b"isom\0\0\0\0"), boxed(b"mdat", b"frames")].concat();

        assert!(strip(bytes, UPLOADED_AT).is_none());
        assert!(strip(Vec::new(), UPLOADED_AT).is_none());
    }

    #[test]
    fn a_raw_trailer_after_the_movie_is_blanked() {
        let mut bytes = movie(None);
        let trailer_at = bytes.len();
        bytes.extend_from_slice(&[0xEE; 3]);
        bytes.extend_from_slice(b"TRAILING-SECRET");

        let stripped = strip(bytes, UPLOADED_AT).expect("strippable");

        assert!(!contains(&stripped, b"TRAILING-SECRET"));
        assert_eq!(&stripped[trailer_at + 4..trailer_at + 8], b"free");
    }

    #[test]
    fn the_movie_time_of_the_unix_epoch_is_the_offset() {
        assert_eq!(movie_time(UNIX_EPOCH), MOVIE_EPOCH_OFFSET);
    }
}
