//! Cuts a video down to a window of at most `max_ms`, and rebuilds it as a
//! new MP4 with freshly built sample tables, its `moov` first:
//!
//! - `trim` copies the window's samples as they are (no re-encoding). The
//!   samples start at the last keyframe at or before the requested start,
//!   since decoding has to begin there, and an edit list skips what comes
//!   before the start, so playback begins exactly where it was picked.
//! - `decode_window` hands the window's encoded video to the webview, which
//!   re-encodes it (landscape → portrait, see src/services/videoReencode.ts),
//!   and `mux` puts the result together with the original sound, copied as is.
//!
//! Only video and sound tracks are kept, and only what playback needs of
//! them: track/media headers (the display matrix included), the handler, the
//! media header and `dinf`, and the sample descriptions, copied verbatim so
//! any codec goes through. Everything else, metadata included, is left out.

use std::io::{self, Read, Seek, SeekFrom, Write};

use serde::Serialize;

use super::boxes::{be_u16, be_u32, be_u64, children, find, find_path, handler_type, read_at, Located, Span};
use super::probe;

/// Sample tables are read whole; this bounds what a hostile file can make
/// us allocate (16 MiB of `stsz` is four million samples).
const MAX_TABLE_BYTES: u64 = 16 * 1024 * 1024;
const TIMESCALE_AT: (usize, usize) = (12, 20);
const MVHD_DURATION: (usize, usize) = (16, 24);
const TKHD_DURATION: (usize, usize) = (20, 28);
const MDHD_DURATION: (usize, usize) = (16, 24);
const TKHD_TRACK_ID: (usize, usize) = (12, 20);
const TKHD_MATRIX: (usize, usize) = (40, 52);
/// A visual sample entry's fixed fields before its child boxes.
const VISUAL_ENTRY_LEN: usize = 78;
const ENCODED_TIMESCALE: u32 = 90_000;
const DEFAULT_FTYP: &[u8] = b"isom\0\0\x02\0isomiso2avc1mp41";

/// Anything `trim`/`mux` read samples from.
pub trait Source: Read + Seek {}
impl<T: Read + Seek> Source for T {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Trim {
    pub start_ms: u64,
    pub max_ms: u64,
}

/// What the editor needs: the video's length, its keyframes (where a cut can
/// start), and its size as shown, rotation applied.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimPoints {
    pub duration_ms: u64,
    pub keyframes_ms: Vec<u64>,
    pub width: u32,
    pub height: u32,
}

/// The window's encoded video, for a `VideoDecoder`: `codec` and
/// `description` are its WebCodecs config, `rotation` the display matrix's
/// quarter turns in degrees clockwise.
#[derive(Debug, Clone)]
pub struct DecodeWindow {
    pub codec: String,
    pub description: Vec<u8>,
    pub coded_width: u32,
    pub coded_height: u32,
    pub rotation: u16,
    pub samples: Vec<WindowSample>,
}

/// `timestamp_us` is the presentation time from the window's first frame.
#[derive(Debug, Clone, Copy)]
pub struct WindowSample {
    pub offset: u64,
    pub size: u32,
    pub timestamp_us: i64,
    pub duration_us: u64,
    pub key: bool,
}

/// The webview's re-encoded video: H.264 chunks in decode order, stored back
/// to back, with `avcc` as their decoder configuration.
#[derive(Debug, Clone)]
pub struct Encoded {
    pub width: u32,
    pub height: u32,
    pub avcc: Vec<u8>,
    pub chunks: Vec<EncodedChunk>,
}

#[derive(Debug, Clone, Copy)]
pub struct EncodedChunk {
    pub size: u32,
    pub timestamp_us: i64,
    pub key: bool,
}

#[derive(Debug, Clone, Copy)]
struct Timing {
    dts: u64,
    duration: u32,
    cts: i64,
    sync: bool,
}

#[derive(Debug, Clone, Copy)]
struct Sample {
    timing: Timing,
    offset: u64,
    size: u32,
}

struct Track {
    handler: [u8; 4],
    timescale: u32,
    tkhd: Vec<u8>,
    mdhd: Vec<u8>,
    hdlr: Vec<u8>,
    media_boxes: Vec<Vec<u8>>,
    stsd: Vec<u8>,
    samples: Vec<Sample>,
}

struct Movie {
    ftyp: Vec<u8>,
    mvhd: Vec<u8>,
    timescale: u32,
    tracks: Vec<Track>,
}

impl Movie {
    fn video(&self) -> Option<&Track> {
        self.tracks.iter().find(|track| &track.handler == b"vide")
    }
}

/// The video window: its samples and where they start and end, in the video
/// track's timescale; `lead` is how far past `start` the picked start lies,
/// which the edit list skips.
struct Window<'a> {
    samples: &'a [Sample],
    start: u64,
    lead: u64,
    end: u64,
}

struct Kept<'a> {
    track: &'a Track,
    samples: &'a [Sample],
    /// Which of the sources passed to `write_movie` holds the samples.
    source: usize,
    /// How much of the start to skip when playing, in the track's timescale.
    skip: u64,
}

impl Kept<'_> {
    fn media_duration(&self) -> u64 {
        self.samples.iter().map(|sample| u64::from(sample.timing.duration)).sum()
    }

    /// What plays: the media without the skipped start.
    fn shown_duration(&self) -> u64 {
        self.media_duration().saturating_sub(self.skip)
    }

    fn payload_len(&self) -> u64 {
        self.samples.iter().map(|sample| u64::from(sample.size)).sum()
    }
}

/// The trim points of the first video track, read from the `moov` box alone:
/// the reader may hold just that box, not the media.
pub fn trim_points<R: Read + Seek>(reader: &mut R) -> io::Result<Option<TrimPoints>> {
    let Some(shown) = probe::probe(reader)? else {
        return Ok(None);
    };
    let end = reader.seek(SeekFrom::End(0))?;
    let Some(moov) = find(reader, Span { start: 0, end }, b"moov")? else {
        return Ok(None);
    };
    for trak in children(reader, moov.body)?.into_iter().filter(|child| child.is(b"trak")) {
        let Some(mdia) = find(reader, trak.body, b"mdia")? else {
            continue;
        };
        if handler_type(reader, mdia.body)? != Some(*b"vide") {
            continue;
        }
        let Some((timescale, timings)) = track_timing(reader, mdia)? else {
            return Ok(None);
        };
        let to_ms = |ticks: u64| (u128::from(ticks) * 1000 / u128::from(timescale)) as u64;
        let total: u64 = timings.iter().map(|timing| u64::from(timing.duration)).sum();
        return Ok(Some(TrimPoints {
            duration_ms: to_ms(total),
            keyframes_ms: timings
                .iter()
                .filter(|timing| timing.sync)
                .map(|timing| to_ms(timing.dts))
                .collect(),
            width: shown.width,
            height: shown.height,
        }));
    }
    Ok(None)
}

/// Writes the window to `out`, its samples copied as they are; `None` when
/// the file can't be cut (no video track, fragmented, or tables that don't
/// add up).
pub fn trim<R: Read + Seek, W: Write>(reader: &mut R, trim: Trim, out: &mut W) -> io::Result<Option<()>> {
    let Some(movie) = read_movie(reader)? else {
        return Ok(None);
    };
    let Some(video) = movie.video() else {
        return Ok(None);
    };
    let Some(window) = window(video, trim) else {
        return Ok(None);
    };
    let mut kept = vec![Kept {
        track: video,
        samples: window.samples,
        source: 0,
        skip: window.lead,
    }];
    kept.extend(sound_in(&movie, video, &window, 0));
    let mut sources: [&mut dyn Source; 1] = [reader];
    write_movie(&mut sources, &movie, &kept, false, out)
}

/// The window's encoded video and how to decode it; `None` when it can't be
/// cut or its codec isn't one the webview is told how to configure.
pub fn decode_window<R: Read + Seek>(reader: &mut R, trim: Trim) -> io::Result<Option<DecodeWindow>> {
    let Some(movie) = read_movie(reader)? else {
        return Ok(None);
    };
    let Some(video) = movie.video() else {
        return Ok(None);
    };
    let Some(window) = window(video, trim) else {
        return Ok(None);
    };
    let Some((codec, description, coded_width, coded_height)) = decoder_config(&video.stsd) else {
        return Ok(None);
    };
    let first_shown = first_shown(window.samples).unwrap_or(0);
    let to_us = |ticks: i64| (i128::from(ticks) * 1_000_000 / i128::from(video.timescale)) as i64;
    let samples = window
        .samples
        .iter()
        .map(|sample| WindowSample {
            offset: sample.offset,
            size: sample.size,
            timestamp_us: to_us((sample.timing.dts - window.start) as i64 + sample.timing.cts - first_shown),
            duration_us: to_us(i64::from(sample.timing.duration)) as u64,
            key: sample.timing.sync,
        })
        .collect();
    Ok(Some(DecodeWindow {
        codec,
        description,
        coded_width,
        coded_height,
        rotation: rotation(&video.tkhd),
        samples,
    }))
}

/// Writes `encoded` (read from `encoded_reader`) as the video, together with
/// the original's sound inside the same window, copied as is.
pub fn mux<R: Read + Seek, E: Read + Seek, W: Write>(
    original: &mut R,
    encoded_reader: &mut E,
    trim: Trim,
    encoded: &Encoded,
    out: &mut W,
) -> io::Result<Option<()>> {
    let Some(movie) = read_movie(original)? else {
        return Ok(None);
    };
    let Some(video) = movie.video() else {
        return Ok(None);
    };
    let Some(window) = window(video, trim) else {
        return Ok(None);
    };
    let Some(reencoded) = encoded_track(encoded) else {
        return Ok(None);
    };
    // The re-encoded frames start at the window's first one too.
    let skip = (u128::from(window.lead) * u128::from(ENCODED_TIMESCALE) / u128::from(video.timescale)) as u64;
    let mut kept = vec![Kept {
        track: &reencoded,
        samples: &reencoded.samples,
        source: 1,
        skip,
    }];
    kept.extend(sound_in(&movie, video, &window, 0));
    let mut sources: [&mut dyn Source; 2] = [original, encoded_reader];
    write_movie(&mut sources, &movie, &kept, true, out)
}

fn read_movie<R: Read + Seek>(reader: &mut R) -> io::Result<Option<Movie>> {
    let file_size = reader.seek(SeekFrom::End(0))?;
    let whole = Span {
        start: 0,
        end: file_size,
    };
    let Some(moov) = find(reader, whole, b"moov")? else {
        return Ok(None);
    };
    let Some(mvhd) = find(reader, moov.body, b"mvhd")? else {
        return Ok(None);
    };
    let mvhd = read_body(reader, mvhd)?;
    let Some(timescale) = field(&mvhd, TIMESCALE_AT).filter(|timescale| *timescale != 0) else {
        return Ok(None);
    };
    let mut tracks = Vec::new();
    for trak in children(reader, moov.body)?.into_iter().filter(|child| child.is(b"trak")) {
        match read_track(reader, trak, file_size)? {
            TrackRead::Track(track) => tracks.push(track),
            TrackRead::Skipped => {}
            TrackRead::Unreadable => return Ok(None),
        }
    }
    let ftyp = match find(reader, whole, b"ftyp")? {
        Some(ftyp) => boxed(b"ftyp", &read_body(reader, ftyp)?),
        None => boxed(b"ftyp", DEFAULT_FTYP),
    };
    Ok(Some(Movie {
        ftyp,
        mvhd,
        timescale,
        tracks,
    }))
}

/// From the last keyframe at or before the start, the samples up to `max_ms`
/// past the start. Keyframes are compared in milliseconds rounded as
/// `trim_points` rounds them, so a start on one lands on it.
fn window(video: &Track, trim: Trim) -> Option<Window<'_>> {
    let ticks = |ms: u64| (u128::from(ms) * u128::from(video.timescale) / 1000) as u64;
    let to_ms = |ticks: u64| (u128::from(ticks) * 1000 / u128::from(video.timescale)) as u64;
    let first = video
        .samples
        .iter()
        .rposition(|sample| sample.timing.sync && to_ms(sample.timing.dts) <= trim.start_ms)
        .or_else(|| video.samples.iter().position(|sample| sample.timing.sync))?;
    let start = video.samples[first].timing.dts;
    let lead = if to_ms(start) == trim.start_ms { 0 } else { ticks(trim.start_ms).saturating_sub(start) };
    let max = lead + ticks(trim.max_ms);
    let count = video.samples[first..]
        .iter()
        .take_while(|sample| sample.timing.dts + u64::from(sample.timing.duration) - start <= max)
        .count();
    if count == 0 {
        return None;
    }
    let samples = &video.samples[first..first + count];
    let last = samples[count - 1].timing;
    let end = last.dts + u64::from(last.duration);
    if end - start <= lead {
        return None;
    }
    Some(Window {
        samples,
        start,
        lead,
        end,
    })
}

/// Each sound track's samples inside the window.
fn sound_in<'a>(movie: &'a Movie, video: &Track, window: &Window<'_>, source: usize) -> Vec<Kept<'a>> {
    let mut kept = Vec::new();
    for track in movie.tracks.iter().filter(|track| &track.handler == b"soun") {
        // Compares times across timescales without rounding: a/b ≥ c/d.
        let (scale, own) = (u128::from(video.timescale), u128::from(track.timescale));
        let after_start = |sample: &Sample| u128::from(sample.timing.dts) * scale >= u128::from(window.start) * own;
        let before_end = |sample: &Sample| {
            u128::from(sample.timing.dts + u64::from(sample.timing.duration)) * scale <= u128::from(window.end) * own
        };
        let Some(from) = track.samples.iter().position(after_start) else {
            continue;
        };
        let count = track.samples[from..].iter().take_while(|sample| before_end(sample)).count();
        if count > 0 {
            let shown_from = (u128::from(window.start + window.lead) * own / scale) as u64;
            kept.push(Kept {
                track,
                samples: &track.samples[from..from + count],
                source,
                skip: shown_from.saturating_sub(track.samples[from].timing.dts),
            });
        }
    }
    kept
}

/// The re-encoded video as a track: chunks come in decode order, so their
/// decode times are their presentation times sorted, and the difference
/// becomes the composition offset.
fn encoded_track(encoded: &Encoded) -> Option<Track> {
    if encoded.chunks.is_empty() || !encoded.chunks[0].key {
        return None;
    }
    let to_ticks = |us: i64| (i128::from(us) * i128::from(ENCODED_TIMESCALE) / 1_000_000) as i64;
    let presented: Vec<i64> = encoded.chunks.iter().map(|chunk| to_ticks(chunk.timestamp_us)).collect();
    let mut decoded = presented.clone();
    decoded.sort_unstable();
    let base = decoded[0];
    let mut samples = Vec::with_capacity(encoded.chunks.len());
    let mut offset = 0u64;
    for (index, chunk) in encoded.chunks.iter().enumerate() {
        let dts = decoded[index] - base;
        let duration = match decoded.get(index + 1) {
            Some(next) => next - decoded[index],
            None => samples.last().map_or(3000, |last: &Sample| i64::from(last.timing.duration)),
        };
        samples.push(Sample {
            timing: Timing {
                dts: u64::try_from(dts).ok()?,
                duration: u32::try_from(duration).ok()?,
                cts: presented[index] - decoded[index],
                sync: chunk.key,
            },
            offset,
            size: chunk.size,
        });
        offset += u64::from(chunk.size);
    }
    Some(Track {
        handler: *b"vide",
        timescale: ENCODED_TIMESCALE,
        tkhd: visual_tkhd(encoded.width, encoded.height),
        mdhd: mdhd(ENCODED_TIMESCALE),
        hdlr: hdlr(b"vide", b"VideoHandler"),
        media_boxes: vec![full_box(b"vmhd", 0, 1, &[0; 8]), self_contained_dinf()],
        stsd: avc1_stsd(encoded),
        samples,
    })
}

enum TrackRead {
    Track(Track),
    Skipped,
    Unreadable,
}

fn read_track<R: Read + Seek>(reader: &mut R, trak: Located, file_size: u64) -> io::Result<TrackRead> {
    let Some(mdia) = find(reader, trak.body, b"mdia")? else {
        return Ok(TrackRead::Skipped);
    };
    let Some(handler) = handler_type(reader, mdia.body)? else {
        return Ok(TrackRead::Skipped);
    };
    if !matches!(&handler, b"vide" | b"soun") {
        return Ok(TrackRead::Skipped);
    }
    let (Some(tkhd), Some(mdhd), Some(hdlr), Some(minf)) = (
        find(reader, trak.body, b"tkhd")?,
        find(reader, mdia.body, b"mdhd")?,
        find(reader, mdia.body, b"hdlr")?,
        find(reader, mdia.body, b"minf")?,
    ) else {
        return Ok(TrackRead::Unreadable);
    };
    let Some(stbl) = find(reader, minf.body, b"stbl")? else {
        return Ok(TrackRead::Unreadable);
    };
    let mut media_boxes = Vec::new();
    for child in children(reader, minf.body)? {
        if !child.is(b"stbl") {
            media_boxes.push(read_whole(reader, child)?);
        }
    }
    let tables = children(reader, stbl.body)?;
    let Some(stsd) = tables.iter().find(|table| table.is(b"stsd")) else {
        return Ok(TrackRead::Unreadable);
    };
    let stsd = read_whole(reader, *stsd)?;
    let Some((timescale, timings)) = track_timing(reader, mdia)? else {
        return Ok(TrackRead::Unreadable);
    };
    let Some(samples) = sample_layout(reader, &tables, &timings, file_size)? else {
        return Ok(TrackRead::Unreadable);
    };
    Ok(TrackRead::Track(Track {
        handler,
        timescale,
        tkhd: read_body(reader, tkhd)?,
        mdhd: read_body(reader, mdhd)?,
        hdlr: read_whole(reader, hdlr)?,
        media_boxes,
        stsd,
        samples,
    }))
}

/// Decode times, durations, composition offsets and keyframes from
/// `stts`/`ctts`/`stss`; `None` when they're missing or don't line up.
fn track_timing<R: Read + Seek>(reader: &mut R, mdia: Located) -> io::Result<Option<(u32, Vec<Timing>)>> {
    let Some(mdhd) = find(reader, mdia.body, b"mdhd")? else {
        return Ok(None);
    };
    let Some(timescale) = field(&read_body(reader, mdhd)?, TIMESCALE_AT).filter(|timescale| *timescale != 0) else {
        return Ok(None);
    };
    let Some(stbl) = find_path(reader, mdia.body, &[*b"minf", *b"stbl"])? else {
        return Ok(None);
    };
    let tables = children(reader, stbl.body)?;
    let Some(stts) = table(reader, &tables, b"stts")? else {
        return Ok(None);
    };
    let ctts = table(reader, &tables, b"ctts")?;
    let stss = table(reader, &tables, b"stss")?;
    Ok(timings_from(&stts, ctts.as_deref(), stss.as_deref()).map(|timings| (timescale, timings)))
}

fn timings_from(stts: &[u8], ctts: Option<&[u8]>, stss: Option<&[u8]>) -> Option<Vec<Timing>> {
    let mut timings = Vec::new();
    let mut dts = 0u64;
    for entry in entries(stts, 4, 8)? {
        let (count, delta) = (be_u32(entry, 0)?, be_u32(entry, 4)?);
        if timings.len() as u64 + u64::from(count) > MAX_TABLE_BYTES {
            return None;
        }
        for _ in 0..count {
            timings.push(Timing {
                dts,
                duration: delta,
                cts: 0,
                sync: true,
            });
            dts += u64::from(delta);
        }
    }
    if let Some(ctts) = ctts {
        let signed = ctts.first() == Some(&1);
        let mut index = 0usize;
        for entry in entries(ctts, 4, 8)? {
            let (count, raw) = (be_u32(entry, 0)?, be_u32(entry, 4)?);
            let offset = if signed { i64::from(raw as i32) } else { i64::from(raw) };
            for _ in 0..count {
                timings.get_mut(index)?.cts = offset;
                index += 1;
            }
        }
    }
    if let Some(stss) = stss {
        timings.iter_mut().for_each(|timing| timing.sync = false);
        for entry in entries(stss, 4, 4)? {
            let number = be_u32(entry, 0)? as usize;
            timings.get_mut(number.checked_sub(1)?)?.sync = true;
        }
    }
    Some(timings)
}

/// Where each sample sits in the file, from `stsz`, `stsc` and `stco`/`co64`.
fn sample_layout<R: Read + Seek>(
    reader: &mut R,
    tables: &[Located],
    timings: &[Timing],
    file_size: u64,
) -> io::Result<Option<Vec<Sample>>> {
    let Some(stsz) = table(reader, tables, b"stsz")? else {
        return Ok(None);
    };
    let (chunk_offsets, stride) = match table(reader, tables, b"co64")? {
        Some(co64) => (co64, 8),
        None => match table(reader, tables, b"stco")? {
            Some(stco) => (stco, 4),
            None => return Ok(None),
        },
    };
    let Some(stsc) = table(reader, tables, b"stsc")? else {
        return Ok(None);
    };
    Ok(layout_from(&stsz, &stsc, &chunk_offsets, stride, timings, file_size))
}

fn layout_from(
    stsz: &[u8],
    stsc: &[u8],
    chunk_offsets: &[u8],
    stride: usize,
    timings: &[Timing],
    file_size: u64,
) -> Option<Vec<Sample>> {
    let (fixed, count) = (be_u32(stsz, 4)?, be_u32(stsz, 8)?);
    if count as usize != timings.len() {
        return None;
    }
    let sizes: Vec<u32> = if fixed != 0 {
        vec![fixed; count as usize]
    } else {
        stsz.get(12..12 + count as usize * 4)?
            .chunks_exact(4)
            .filter_map(|size| be_u32(size, 0))
            .collect()
    };
    let runs = entries(stsc, 4, 12)?;
    // Several sample descriptions would need their chunks kept apart.
    if runs.iter().any(|run| be_u32(run, 8) != Some(1)) {
        return None;
    }
    let chunks = entries(chunk_offsets, 4, stride)?;

    let mut samples = Vec::with_capacity(sizes.len());
    let mut run = 0usize;
    let mut per_chunk = 0usize;
    for (index, chunk) in chunks.iter().enumerate() {
        while let Some(next) = runs.get(run) {
            if be_u32(next, 0)? as usize > index + 1 {
                break;
            }
            per_chunk = be_u32(next, 4)? as usize;
            run += 1;
        }
        let mut offset = if stride == 8 { be_u64(chunk, 0)? } else { u64::from(be_u32(chunk, 0)?) };
        for _ in 0..per_chunk {
            let index = samples.len();
            let (Some(&size), Some(&timing)) = (sizes.get(index), timings.get(index)) else {
                break;
            };
            if offset + u64::from(size) > file_size {
                return None;
            }
            samples.push(Sample { timing, offset, size });
            offset += u64::from(size);
        }
    }
    (samples.len() == timings.len()).then_some(samples)
}

/// Writes ftyp, moov and mdat. `renumber` gives the tracks ids 1, 2, … (a
/// re-encoded track has none of its own to keep).
fn write_movie<W: Write>(
    sources: &mut [&mut dyn Source],
    movie: &Movie,
    kept: &[Kept<'_>],
    renumber: bool,
    out: &mut W,
) -> io::Result<Option<()>> {
    let payload: u64 = kept.iter().map(Kept::payload_len).sum();
    let mdat_header = if payload + 8 > u64::from(u32::MAX) { 16 } else { 8 };
    let layout = |offsets: &[u64], wide: bool| build_moov(movie, kept, offsets, wide, renumber);
    let placeholder = vec![0; kept.len()];
    let Some(widest) = layout(&placeholder, true) else {
        return Ok(None);
    };
    let wide = (movie.ftyp.len() + widest.len()) as u64 + mdat_header + payload > u64::from(u32::MAX);
    let Some(sized) = layout(&placeholder, wide) else {
        return Ok(None);
    };
    let mut at = (movie.ftyp.len() + sized.len()) as u64 + mdat_header;
    let offsets: Vec<u64> = kept
        .iter()
        .map(|track| {
            let offset = at;
            at += track.payload_len();
            offset
        })
        .collect();
    let Some(moov) = layout(&offsets, wide) else {
        return Ok(None);
    };

    out.write_all(&movie.ftyp)?;
    out.write_all(&moov)?;
    if mdat_header == 16 {
        out.write_all(&1u32.to_be_bytes())?;
        out.write_all(b"mdat")?;
        out.write_all(&(payload + 16).to_be_bytes())?;
    } else {
        out.write_all(&((payload + 8) as u32).to_be_bytes())?;
        out.write_all(b"mdat")?;
    }
    for track in kept {
        let Some(source) = sources.get_mut(track.source) else {
            return Ok(None);
        };
        copy_samples(&mut **source, track.samples, out)?;
    }
    Ok(Some(()))
}

fn build_moov(movie: &Movie, kept: &[Kept<'_>], offsets: &[u64], wide: bool, renumber: bool) -> Option<Vec<u8>> {
    let movie_duration = |track: &Kept<'_>| {
        (u128::from(track.shown_duration()) * u128::from(movie.timescale) / u128::from(track.track.timescale)) as u64
    };
    let longest = kept.iter().map(movie_duration).max()?;
    let mut mvhd = movie.mvhd.clone();
    patch_duration(&mut mvhd, MVHD_DURATION, longest)?;
    if renumber {
        // next_track_ID is mvhd's last field.
        let at = mvhd.len().checked_sub(4)?;
        mvhd[at..].copy_from_slice(&(kept.len() as u32 + 1).to_be_bytes());
    }
    let mut body = boxed(b"mvhd", &mvhd);
    for (index, (track, &offset)) in kept.iter().zip(offsets).enumerate() {
        let track_id = renumber.then_some(index as u32 + 1);
        body.extend(build_trak(track, movie_duration(track), offset, wide, track_id)?);
    }
    Some(boxed(b"moov", &body))
}

fn build_trak(
    kept: &Kept<'_>,
    movie_duration: u64,
    chunk_offset: u64,
    wide: bool,
    track_id: Option<u32>,
) -> Option<Vec<u8>> {
    let track = kept.track;
    let samples = kept.samples;
    let mut tkhd = track.tkhd.clone();
    patch_duration(&mut tkhd, TKHD_DURATION, movie_duration)?;
    if let Some(track_id) = track_id {
        patch_field(&mut tkhd, TKHD_TRACK_ID, track_id)?;
    }
    let mut mdhd = track.mdhd.clone();
    patch_duration(&mut mdhd, MDHD_DURATION, kept.media_duration())?;

    let mut stbl = track.stsd.clone();
    stbl.extend(run_table(b"stts", 0, samples.iter().map(|sample| sample.timing.duration)));
    if samples.iter().any(|sample| sample.timing.cts != 0) {
        let signed = samples.iter().any(|sample| sample.timing.cts < 0);
        stbl.extend(run_table(
            b"ctts",
            u8::from(signed),
            samples.iter().map(|sample| sample.timing.cts as i32 as u32),
        ));
    }
    if samples.iter().any(|sample| !sample.timing.sync) {
        let synced: Vec<u32> = (1..=samples.len() as u32)
            .filter(|number| samples[*number as usize - 1].timing.sync)
            .collect();
        stbl.extend(word_table(b"stss", &[], synced.len(), &synced));
    }
    // One chunk holding every sample of the track.
    stbl.extend(word_table(b"stsc", &[], 1, &[1, samples.len() as u32, 1]));
    let sizes: Vec<u32> = samples.iter().map(|sample| sample.size).collect();
    stbl.extend(word_table(b"stsz", &0u32.to_be_bytes(), sizes.len(), &sizes));
    if wide {
        let mut co64 = vec![0, 0, 0, 0];
        co64.extend_from_slice(&1u32.to_be_bytes());
        co64.extend_from_slice(&chunk_offset.to_be_bytes());
        stbl.extend(boxed(b"co64", &co64));
    } else {
        stbl.extend(word_table(b"stco", &[], 1, &[u32::try_from(chunk_offset).ok()?]));
    }

    let mut minf = Vec::new();
    for media_box in &track.media_boxes {
        minf.extend_from_slice(media_box);
    }
    minf.extend(boxed(b"stbl", &stbl));
    let mut mdia = boxed(b"mdhd", &mdhd);
    mdia.extend_from_slice(&track.hdlr);
    mdia.extend(boxed(b"minf", &minf));

    let mut trak = boxed(b"tkhd", &tkhd);
    if let Some(edts) = edit_list(samples, movie_duration, kept.skip) {
        trak.extend(edts);
    }
    trak.extend(boxed(b"mdia", &mdia));
    Some(boxed(b"trak", &trak))
}

/// The earliest presentation time in the window, from its first sample.
fn first_shown(samples: &[Sample]) -> Option<i64> {
    let start = samples.first()?.timing.dts;
    samples
        .iter()
        .map(|sample| (sample.timing.dts - start) as i64 + sample.timing.cts)
        .min()
}

/// Where playback starts in the media: past the skipped start, and with
/// composition offsets past time 0, where the first frame isn't shown yet
/// (so the video doesn't open on an empty frame).
fn edit_list(samples: &[Sample], movie_duration: u64, skip: u64) -> Option<Vec<u8>> {
    let first = u64::try_from(first_shown(samples)?).ok()?;
    let media_time = u32::try_from(first + skip).ok().filter(|time| *time != 0)?;
    let mut elst = vec![0, 0, 0, 0];
    elst.extend_from_slice(&1u32.to_be_bytes());
    elst.extend_from_slice(&u32::try_from(movie_duration).unwrap_or(u32::MAX).to_be_bytes());
    elst.extend_from_slice(&media_time.to_be_bytes());
    elst.extend_from_slice(&0x0001_0000u32.to_be_bytes());
    Some(boxed(b"edts", &boxed(b"elst", &elst)))
}

fn copy_samples<W: Write>(reader: &mut dyn Source, samples: &[Sample], out: &mut W) -> io::Result<()> {
    let mut index = 0;
    while index < samples.len() {
        let start = samples[index].offset;
        let mut end = start + u64::from(samples[index].size);
        index += 1;
        // Samples stored back to back are copied in one go.
        while samples.get(index).is_some_and(|sample| sample.offset == end) {
            end += u64::from(samples[index].size);
            index += 1;
        }
        reader.seek(SeekFrom::Start(start))?;
        let copied = io::copy(&mut Read::take(&mut *reader, end - start), out)?;
        if copied != end - start {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "The video ended early"));
        }
    }
    Ok(())
}

/// The WebCodecs `codec` string, `description` and coded size of the first
/// sample entry, for H.264 and HEVC.
fn decoder_config(stsd: &[u8]) -> Option<(String, Vec<u8>, u32, u32)> {
    // stsd: header 8, version/flags 4, entry count 4, then the first entry.
    let entry = stsd.get(16..)?;
    let entry_size = be_u32(entry, 0)? as usize;
    let entry = entry.get(..entry_size)?;
    let format: [u8; 4] = entry.get(4..8)?.try_into().ok()?;
    let fields = entry.get(8..)?;
    let coded_width = u32::from(be_u16(fields, 24)?);
    let coded_height = u32::from(be_u16(fields, 26)?);
    let child = |box_type: &[u8; 4]| child_box(fields.get(VISUAL_ENTRY_LEN..)?, box_type);
    match &format {
        b"avc1" | b"avc3" => {
            let avcc = child(b"avcC")?;
            let codec = format!("avc1.{:02X}{:02X}{:02X}", avcc.get(1)?, avcc.get(2)?, avcc.get(3)?);
            Some((codec, avcc.to_vec(), coded_width, coded_height))
        }
        b"hvc1" | b"hev1" => {
            let hvcc = child(b"hvcC")?;
            Some((hevc_codec(&format, hvcc)?, hvcc.to_vec(), coded_width, coded_height))
        }
        _ => None,
    }
}

/// `hvc1.<space><profile>.<compat, bit-reversed>.<tier><level>.<constraints>`
/// as in ISO/IEC 14496-15 Annex E.
fn hevc_codec(format: &[u8; 4], hvcc: &[u8]) -> Option<String> {
    let first = *hvcc.get(1)?;
    let space = ["", "A", "B", "C"][usize::from(first >> 6)];
    let tier = if first & 0x20 != 0 { "H" } else { "L" };
    let profile = first & 0x1f;
    let compat = be_u32(hvcc, 2)?.reverse_bits();
    let constraints = hvcc.get(6..12)?;
    let used = constraints.iter().rposition(|byte| *byte != 0).map_or(0, |last| last + 1);
    let level = hvcc.get(12)?;
    let mut codec = format!(
        "{}.{space}{profile}.{compat:X}.{tier}{level}",
        String::from_utf8_lossy(format)
    );
    for byte in &constraints[..used] {
        codec.push_str(&format!(".{byte:X}"));
    }
    Some(codec)
}

/// The body of the child box `box_type` among `children`.
fn child_box<'a>(mut children: &'a [u8], box_type: &[u8; 4]) -> Option<&'a [u8]> {
    while children.len() >= 8 {
        let size = be_u32(children, 0)? as usize;
        if size < 8 || size > children.len() {
            return None;
        }
        if &children[4..8] == box_type {
            return children.get(8..size);
        }
        children = &children[size..];
    }
    None
}

/// The display matrix as clockwise quarter turns, in degrees.
fn rotation(tkhd: &[u8]) -> u16 {
    let at = if tkhd.first() == Some(&1) { TKHD_MATRIX.1 } else { TKHD_MATRIX.0 };
    let cell = |index: usize| be_u32(tkhd, at + index * 4).map(|value| value as i32);
    match (cell(0), cell(1), cell(3), cell(4)) {
        (Some(0), Some(b), Some(c), Some(0)) if b > 0 && c < 0 => 90,
        (Some(a), Some(0), Some(0), Some(d)) if a < 0 && d < 0 => 180,
        (Some(0), Some(b), Some(c), Some(0)) if b < 0 && c > 0 => 270,
        _ => 0,
    }
}

fn visual_tkhd(width: u32, height: u32) -> Vec<u8> {
    let mut body = vec![0, 0, 0, 3]; // enabled, in movie
    body.extend_from_slice(&[0; 8]); // creation, modification
    body.extend_from_slice(&1u32.to_be_bytes()); // track id, renumbered
    body.extend_from_slice(&[0; 4]); // reserved
    body.extend_from_slice(&[0; 4]); // duration, patched
    body.extend_from_slice(&[0; 8]); // reserved
    body.extend_from_slice(&[0; 8]); // layer, alternate group, volume, reserved
    for cell in [0x0001_0000u32, 0, 0, 0, 0x0001_0000, 0, 0, 0, 0x4000_0000] {
        body.extend_from_slice(&cell.to_be_bytes());
    }
    body.extend_from_slice(&(width << 16).to_be_bytes());
    body.extend_from_slice(&(height << 16).to_be_bytes());
    body
}

fn mdhd(timescale: u32) -> Vec<u8> {
    let mut body = vec![0u8; 12];
    body.extend_from_slice(&timescale.to_be_bytes());
    body.extend_from_slice(&[0; 4]); // duration, patched
    body.extend_from_slice(&0x55c4u16.to_be_bytes()); // "und"
    body.extend_from_slice(&[0; 2]);
    body
}

fn hdlr(handler: &[u8; 4], name: &[u8]) -> Vec<u8> {
    let mut body = vec![0u8; 4];
    body.extend_from_slice(handler);
    body.extend_from_slice(&[0; 12]);
    body.extend_from_slice(name);
    body.push(0);
    full_box(b"hdlr", 0, 0, &body)
}

fn self_contained_dinf() -> Vec<u8> {
    let mut dref = 1u32.to_be_bytes().to_vec();
    dref.extend(full_box(b"url ", 0, 1, &[]));
    boxed(b"dinf", &full_box(b"dref", 0, 0, &dref))
}

fn avc1_stsd(encoded: &Encoded) -> Vec<u8> {
    let mut entry = vec![0u8; 6];
    entry.extend_from_slice(&1u16.to_be_bytes()); // data reference index
    entry.extend_from_slice(&[0; 16]); // pre-defined, reserved
    entry.extend_from_slice(&(encoded.width as u16).to_be_bytes());
    entry.extend_from_slice(&(encoded.height as u16).to_be_bytes());
    entry.extend_from_slice(&0x0048_0000u32.to_be_bytes()); // 72 dpi
    entry.extend_from_slice(&0x0048_0000u32.to_be_bytes());
    entry.extend_from_slice(&[0; 4]);
    entry.extend_from_slice(&1u16.to_be_bytes()); // frame count
    entry.extend_from_slice(&[0; 32]); // compressor name
    entry.extend_from_slice(&0x0018u16.to_be_bytes()); // depth
    entry.extend_from_slice(&(-1i16).to_be_bytes());
    entry.extend(boxed(b"avcC", &encoded.avcc));
    let mut body = 1u32.to_be_bytes().to_vec();
    body.extend(boxed(b"avc1", &entry));
    full_box(b"stsd", 0, 0, &body)
}

/// `(count, value)` pairs for consecutive equal values, as `stts`/`ctts`.
fn run_table(box_type: &[u8; 4], version: u8, values: impl Iterator<Item = u32>) -> Vec<u8> {
    let mut runs: Vec<(u32, u32)> = Vec::new();
    for value in values {
        match runs.last_mut() {
            Some((count, last)) if *last == value => *count += 1,
            _ => runs.push((1, value)),
        }
    }
    let mut body = (runs.len() as u32).to_be_bytes().to_vec();
    for (count, value) in runs {
        body.extend_from_slice(&count.to_be_bytes());
        body.extend_from_slice(&value.to_be_bytes());
    }
    full_box(box_type, version, 0, &body)
}

/// A full box with `prefix` fields, an entry count, then `words`.
fn word_table(box_type: &[u8; 4], prefix: &[u8], count: usize, words: &[u32]) -> Vec<u8> {
    let mut body = prefix.to_vec();
    body.extend_from_slice(&(count as u32).to_be_bytes());
    for word in words {
        body.extend_from_slice(&word.to_be_bytes());
    }
    full_box(box_type, 0, 0, &body)
}

fn full_box(box_type: &[u8; 4], version: u8, flags: u32, body: &[u8]) -> Vec<u8> {
    let mut full = flags.to_be_bytes().to_vec();
    full[0] = version;
    full.extend_from_slice(body);
    boxed(box_type, &full)
}

fn boxed(box_type: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut bytes = ((body.len() + 8) as u32).to_be_bytes().to_vec();
    bytes.extend_from_slice(box_type);
    bytes.extend_from_slice(body);
    bytes
}

/// A 32-bit field of an `mvhd`/`tkhd`/`mdhd` body at its version's spot.
fn field(body: &[u8], (v0, v1): (usize, usize)) -> Option<u32> {
    be_u32(body, if body.first() == Some(&1) { v1 } else { v0 })
}

fn patch_field(body: &mut [u8], (v0, v1): (usize, usize), value: u32) -> Option<()> {
    let at = if body.first() == Some(&1) { v1 } else { v0 };
    body.get_mut(at..at + 4)?.copy_from_slice(&value.to_be_bytes());
    Some(())
}

/// Writes a duration, 64-bit in a version 1 header and 32-bit otherwise.
fn patch_duration(body: &mut [u8], (v0, v1): (usize, usize), duration: u64) -> Option<()> {
    if body.first() == Some(&1) {
        body.get_mut(v1..v1 + 8)?.copy_from_slice(&duration.to_be_bytes());
    } else {
        let narrow = u32::try_from(duration).unwrap_or(u32::MAX);
        body.get_mut(v0..v0 + 4)?.copy_from_slice(&narrow.to_be_bytes());
    }
    Some(())
}

fn table<R: Read + Seek>(reader: &mut R, tables: &[Located], box_type: &[u8; 4]) -> io::Result<Option<Vec<u8>>> {
    let Some(found) = tables.iter().find(|table| table.is(box_type)) else {
        return Ok(None);
    };
    if !(8..=MAX_TABLE_BYTES).contains(&found.body.size()) {
        return Ok(None);
    }
    read_body(reader, *found).map(Some)
}

/// The `stride`-sized entries after a full box's count at `count_at`.
fn entries(bytes: &[u8], count_at: usize, stride: usize) -> Option<Vec<&[u8]>> {
    let count = be_u32(bytes, count_at)? as usize;
    let listed = bytes.get(count_at + 4..)?;
    if listed.len() / stride < count {
        return None;
    }
    Some(listed.chunks_exact(stride).take(count).collect())
}

fn read_body<R: Read + Seek>(reader: &mut R, located: Located) -> io::Result<Vec<u8>> {
    read_span(reader, located.body)
}

/// The box re-framed with a plain 32-bit header; `body.start` skips a
/// largesize or a `meta` version, which this keeps as content.
fn read_whole<R: Read + Seek>(reader: &mut R, located: Located) -> io::Result<Vec<u8>> {
    let mut content = read_span(
        reader,
        Span {
            start: located.start + located.header_len,
            end: located.body.start,
        },
    )?;
    content.extend(read_span(reader, located.body)?);
    Ok(boxed(&located.box_type, &content))
}

fn read_span<R: Read + Seek>(reader: &mut R, span: Span) -> io::Result<Vec<u8>> {
    if span.size() > MAX_TABLE_BYTES {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "A video header box is too large"));
    }
    let mut bytes = vec![0u8; span.size() as usize];
    read_at(reader, span.start, &mut bytes)?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    const FASTSTART: &[u8] = include_bytes!("fixtures/faststart.mp4");
    const VIDEO_SAMPLES: usize = 30;
    const AUDIO_SAMPLES: usize = 60;
    const PER_CHUNK: usize = 5;

    fn video_bytes(index: usize) -> Vec<u8> {
        vec![index as u8; 10 + index]
    }

    fn audio_bytes(index: usize) -> Vec<u8> {
        vec![0x80 | index as u8; 4]
    }

    fn mvhd_body() -> Vec<u8> {
        let mut body = vec![0u8; 12];
        body.extend_from_slice(&1000u32.to_be_bytes());
        body.extend_from_slice(&3000u32.to_be_bytes());
        body.resize(96, 0);
        body.extend_from_slice(&3u32.to_be_bytes());
        body
    }

    /// One track whose samples sit in `PER_CHUNK`-sample chunks at `chunks`.
    fn trak(handler: &[u8; 4], id: u32, delta: u32, sizes: &[u32], chunks: &[u32], sync: Option<&[u32]>) -> Vec<u8> {
        let mut tkhd = visual_tkhd(16, 16);
        patch_field(&mut tkhd, TKHD_TRACK_ID, id).unwrap();
        let stsd = if handler == b"vide" {
            parsed(FASTSTART).tracks[0].stsd.clone()
        } else {
            let mut body = 1u32.to_be_bytes().to_vec();
            body.extend(boxed(b"mp4a", &[0; 28]));
            full_box(b"stsd", 0, 0, &body)
        };
        let mut stbl = stsd;
        stbl.extend(run_table(b"stts", 0, sizes.iter().map(|_| delta)));
        if let Some(sync) = sync {
            stbl.extend(word_table(b"stss", &[], sync.len(), sync));
        }
        stbl.extend(word_table(b"stsc", &[], 1, &[1, PER_CHUNK as u32, 1]));
        stbl.extend(word_table(b"stsz", &0u32.to_be_bytes(), sizes.len(), sizes));
        stbl.extend(word_table(b"stco", &[], chunks.len(), chunks));
        let mut minf = if handler == b"vide" {
            full_box(b"vmhd", 0, 1, &[0; 8])
        } else {
            full_box(b"smhd", 0, 0, &[0; 4])
        };
        minf.extend(self_contained_dinf());
        minf.extend(boxed(b"stbl", &stbl));
        let mut mdhd = mdhd(1000);
        patch_duration(&mut mdhd, MDHD_DURATION, 3000).unwrap();
        let mut mdia = boxed(b"mdhd", &mdhd);
        mdia.extend(hdlr(handler, b"handler"));
        mdia.extend(boxed(b"minf", &minf));
        let mut body = boxed(b"tkhd", &tkhd);
        body.extend(boxed(b"mdia", &mdia));
        boxed(b"trak", &body)
    }

    /// 3 s of 10 fps video with keyframes at 0, 1 and 2 s, and 20 Hz sound,
    /// chunks interleaved in `mdat`, `moov` last.
    fn movie() -> Vec<u8> {
        let ftyp = boxed(b"ftyp", DEFAULT_FTYP);
        let mut payload = Vec::new();
        let (mut video_chunks, mut audio_chunks) = (Vec::new(), Vec::new());
        let data_start = ftyp.len() as u32 + 8;
        for chunk in 0..AUDIO_SAMPLES / PER_CHUNK {
            if chunk < VIDEO_SAMPLES / PER_CHUNK {
                video_chunks.push(data_start + payload.len() as u32);
                for index in chunk * PER_CHUNK..(chunk + 1) * PER_CHUNK {
                    payload.extend(video_bytes(index));
                }
            }
            audio_chunks.push(data_start + payload.len() as u32);
            for index in chunk * PER_CHUNK..(chunk + 1) * PER_CHUNK {
                payload.extend(audio_bytes(index));
            }
        }
        let video_sizes: Vec<u32> = (0..VIDEO_SAMPLES).map(|index| video_bytes(index).len() as u32).collect();
        let audio_sizes = vec![4u32; AUDIO_SAMPLES];
        let mut moov = boxed(b"mvhd", &mvhd_body());
        moov.extend(trak(b"vide", 1, 100, &video_sizes, &video_chunks, Some(&[1, 11, 21])));
        moov.extend(trak(b"soun", 2, 50, &audio_sizes, &audio_chunks, None));
        [ftyp, boxed(b"mdat", &payload), boxed(b"moov", &moov)].concat()
    }

    fn trimmed(bytes: &[u8], start_ms: u64, max_ms: u64) -> Option<Vec<u8>> {
        let mut out = Vec::new();
        trim(&mut Cursor::new(bytes), Trim { start_ms, max_ms }, &mut out)
            .expect("trim")
            .map(|()| out)
    }

    fn parsed(bytes: &[u8]) -> Movie {
        read_movie(&mut Cursor::new(bytes)).expect("read").expect("movie")
    }

    fn sample_data(bytes: &[u8], track: &Track) -> Vec<Vec<u8>> {
        track
            .samples
            .iter()
            .map(|sample| bytes[sample.offset as usize..(sample.offset + u64::from(sample.size)) as usize].to_vec())
            .collect()
    }

    fn sound(movie: &Movie) -> &Track {
        movie.tracks.iter().find(|track| &track.handler == b"soun").expect("sound")
    }

    /// The `elst` a track plays through: one segment of `shown` movie ticks
    /// from `media_time` in the track's own.
    fn edit(shown: u32, media_time: u32) -> Vec<u8> {
        let mut elst = vec![0, 0, 0, 0];
        for word in [1, shown, media_time, 0x0001_0000] {
            elst.extend_from_slice(&word.to_be_bytes());
        }
        boxed(b"elst", &elst)
    }

    fn contains(haystack: &[u8], needle: &[u8]) -> bool {
        haystack.windows(needle.len()).any(|window| window == needle)
    }

    #[test]
    fn the_window_starts_at_the_keyframe_before_the_start() {
        let out = trimmed(&movie(), 1500, 1000).expect("trimmed");
        let movie = parsed(&out);
        let video = movie.video().expect("video");

        // From the keyframe at 1 s to 1 s past the start at 1.5 s.
        assert_eq!(sample_data(&out, video), (10..25).map(video_bytes).collect::<Vec<_>>());
        let synced: Vec<usize> = (0..video.samples.len()).filter(|index| video.samples[*index].timing.sync).collect();
        assert_eq!(synced, vec![0, 10]);
    }

    #[test]
    fn playback_skips_to_a_start_between_keyframes() {
        let out = trimmed(&movie(), 1500, 1000).expect("trimmed");

        // Video and sound both play 1000 ms from 500 ms into what was kept.
        assert_eq!(out.windows(4).filter(|window| window == b"elst").count(), 2);
        assert!(contains(&out, &edit(1000, 500)));
    }

    #[test]
    fn a_start_on_a_keyframe_needs_no_edit() {
        let out = trimmed(&movie(), 1000, 1000).expect("trimmed");

        assert!(!contains(&out, b"elst"));
    }

    #[test]
    fn a_start_snapped_to_a_keyframe_in_whole_milliseconds_lands_on_it() {
        let sample = |dts: u64| Sample {
            timing: Timing {
                dts,
                duration: 1001,
                cts: 0,
                sync: true,
            },
            offset: 0,
            size: 1,
        };
        // At 600 ticks a second the keyframe at 1001 ticks is 1668.33 ms,
        // which the editor gets as 1668 and would turn back into 1000 ticks.
        let video = Track {
            handler: *b"vide",
            timescale: 600,
            tkhd: Vec::new(),
            mdhd: Vec::new(),
            hdlr: Vec::new(),
            media_boxes: Vec::new(),
            stsd: Vec::new(),
            samples: vec![sample(0), sample(1001)],
        };

        let window = window(&video, Trim { start_ms: 1668, max_ms: 5000 }).expect("window");

        assert_eq!(window.start, 1001);
    }

    #[test]
    fn the_sound_inside_the_window_comes_along() {
        let out = trimmed(&movie(), 1500, 1000).expect("trimmed");

        assert_eq!(sample_data(&out, sound(&parsed(&out))), (20..50).map(audio_bytes).collect::<Vec<_>>());
    }

    #[test]
    fn the_trimmed_movie_is_as_long_as_its_window() {
        let out = trimmed(&movie(), 1500, 1000).expect("trimmed");

        let probed = probe::probe(&mut Cursor::new(&out)).expect("probe").expect("probed");
        assert_eq!(probed.duration_ms, Some(1000));
        // The media still holds the skipped half second before the start.
        assert_eq!(
            trim_points(&mut Cursor::new(&out)).expect("points"),
            Some(TrimPoints {
                duration_ms: 1500,
                keyframes_ms: vec![0, 1000],
                width: 16,
                height: 16,
            })
        );
        assert!(out.starts_with(&boxed(b"ftyp", DEFAULT_FTYP)));
    }

    #[test]
    fn a_window_longer_than_the_video_keeps_all_of_it() {
        let out = trimmed(&movie(), 0, 15_000).expect("trimmed");
        let movie = parsed(&out);

        assert_eq!(
            sample_data(&out, movie.video().expect("video")),
            (0..VIDEO_SAMPLES).map(video_bytes).collect::<Vec<_>>()
        );
        assert_eq!(sound(&movie).samples.len(), AUDIO_SAMPLES);
    }

    #[test]
    fn a_window_shorter_than_a_frame_is_refused() {
        assert_eq!(trimmed(&movie(), 0, 50), None);
    }

    #[test]
    fn the_metadata_of_the_original_is_left_behind() {
        let out = trimmed(include_bytes!("fixtures/metadata.mp4"), 0, 15_000).expect("trimmed");

        for planted in [&b"PlantedMake"[..], b"PlantedModel", b"+37.7752-122.4197/", b"xmpmeta"] {
            assert!(!out.windows(planted.len()).any(|window| window == planted));
        }
    }

    #[test]
    fn a_rotated_clip_keeps_its_display_matrix() {
        let out = trimmed(include_bytes!("fixtures/rotated.mp4"), 0, 15_000).expect("trimmed");

        let probed = probe::probe(&mut Cursor::new(&out)).expect("probe").expect("probed");
        assert_eq!((probed.width, probed.height), (32, 16));
        assert_eq!(rotation(&parsed(&out).video().expect("video").tkhd), 90);
    }

    #[test]
    fn trim_points_need_only_the_movie_box() {
        let bytes = movie();
        let whole = Span {
            start: 0,
            end: bytes.len() as u64,
        };
        let moov = find(&mut Cursor::new(&bytes), whole, b"moov").unwrap().unwrap();
        let full = trim_points(&mut Cursor::new(&bytes)).expect("full");

        assert_eq!(trim_points(&mut Cursor::new(&bytes[moov.start as usize..])).expect("moov"), full);
        assert_eq!(full.expect("points").keyframes_ms, vec![0, 1000, 2000]);
    }

    #[test]
    fn the_decode_window_is_timed_from_its_first_frame() {
        let window = decode_window(&mut Cursor::new(movie()), Trim { start_ms: 1200, max_ms: 500 })
            .expect("window")
            .expect("decodable");

        assert_eq!(window.codec, "avc1.64000A");
        assert_eq!(window.rotation, 0);
        assert_eq!(
            window.samples.iter().map(|sample| sample.timestamp_us).collect::<Vec<_>>(),
            vec![0, 100_000, 200_000, 300_000, 400_000, 500_000, 600_000]
        );
        assert!(window.samples[0].key);
        assert_eq!(window.samples[0].size, video_bytes(10).len() as u32);
    }

    #[test]
    fn a_reencoded_video_is_muxed_with_the_original_sound() {
        let original = movie();
        let frames: Vec<Vec<u8>> = (0..10).map(|index| vec![0xE0 | index as u8; 7]).collect();
        let encoded = Encoded {
            width: 16,
            height: 28,
            avcc: vec![1, 0x64, 0, 0x1f, 0xff, 0xe0, 0],
            chunks: (0..10)
                .map(|index| EncodedChunk {
                    size: 7,
                    timestamp_us: index * 100_000,
                    key: index == 0,
                })
                .collect(),
        };
        let mut out = Vec::new();
        let trim = Trim { start_ms: 1000, max_ms: 1000 };
        mux(&mut Cursor::new(&original), &mut Cursor::new(frames.concat()), trim, &encoded, &mut out)
            .expect("mux")
            .expect("muxed");

        let movie = parsed(&out);
        let video = movie.video().expect("video");
        assert_eq!(sample_data(&out, video), frames);
        assert_eq!(decoder_config(&video.stsd).map(|config| config.0), Some("avc1.64001F".to_owned()));
        assert_eq!(sample_data(&out, sound(&movie)), (20..40).map(audio_bytes).collect::<Vec<_>>());
        let ids: Vec<u32> = movie.tracks.iter().map(|track| field(&track.tkhd, TKHD_TRACK_ID).unwrap()).collect();
        assert_eq!(ids, vec![1, 2]);
        let probed = probe::probe(&mut Cursor::new(&out)).expect("probe").expect("probed");
        assert_eq!((probed.width, probed.height, probed.duration_ms), (16, 28, Some(1000)));
    }

    #[test]
    fn reordered_chunks_get_decode_times_and_composition_offsets() {
        let encoded = Encoded {
            width: 16,
            height: 16,
            avcc: vec![1, 0x64, 0, 0x1f],
            chunks: [0, 300_000, 100_000, 200_000]
                .into_iter()
                .enumerate()
                .map(|(index, timestamp_us)| EncodedChunk {
                    size: 1,
                    timestamp_us,
                    key: index == 0,
                })
                .collect(),
        };
        let track = encoded_track(&encoded).expect("track");

        let timings: Vec<(u64, i64)> = track.samples.iter().map(|sample| (sample.timing.dts, sample.timing.cts)).collect();
        assert_eq!(timings, vec![(0, 0), (9000, 18_000), (18_000, -9000), (27_000, -9000)]);
    }

    #[test]
    fn an_encoding_that_does_not_open_on_a_keyframe_is_refused() {
        let encoded = Encoded {
            width: 16,
            height: 16,
            avcc: vec![1, 0x64, 0, 0x1f],
            chunks: vec![EncodedChunk {
                size: 1,
                timestamp_us: 0,
                key: false,
            }],
        };

        assert!(encoded_track(&encoded).is_none());
    }

    #[test]
    fn hevc_codec_strings_follow_the_annex() {
        let mut hvcc = vec![1, 0x01, 0x60, 0, 0, 0, 0x90, 0, 0, 0, 0, 0, 93];
        hvcc.resize(23, 0);
        assert_eq!(hevc_codec(b"hvc1", &hvcc).as_deref(), Some("hvc1.1.6.L93.90"));

        hvcc[1] = 0x22;
        hvcc[2] = 0x20;
        hvcc[6] = 0;
        assert_eq!(hevc_codec(b"hev1", &hvcc).as_deref(), Some("hev1.2.4.H93"));
    }

    #[test]
    fn display_matrices_read_as_quarter_turns() {
        let with = |cells: [u32; 4]| {
            let mut tkhd = visual_tkhd(16, 16);
            for (index, cell) in [0, 1, 3, 4].into_iter().zip(cells) {
                let at = TKHD_MATRIX.0 + index * 4;
                tkhd[at..at + 4].copy_from_slice(&cell.to_be_bytes());
            }
            rotation(&tkhd)
        };
        let (one, minus) = (0x0001_0000u32, 0xFFFF_0000u32);

        assert_eq!(with([one, 0, 0, one]), 0);
        assert_eq!(with([0, one, minus, 0]), 90);
        assert_eq!(with([minus, 0, 0, minus]), 180);
        assert_eq!(with([0, minus, one, 0]), 270);
    }
}
