//! Reads Matroska (`.mkv`) and WebM files far enough to re-encode them: the
//! length and size the editor shows, and the video track's frames for the
//! webview's `VideoDecoder` (see `trim::decode_window`). Nothing here writes
//! Matroska; an edited video always goes out as MP4 (`trim::mux_encoded`).
//!
//! Only element headers are read while scanning, the frames themselves are
//! left where they are and read by offset later.

use std::io::{self, Read, Seek, SeekFrom};

use super::boxes::read_up_to;
use super::trim::{av1_codec, hevc_codec, DecodeWindow, Trim, TrimPoints, WindowSample};

const EBML: u32 = 0x1A45_DFA3;
const SEGMENT: u32 = 0x1853_8067;
const INFO: u32 = 0x1549_A966;
const TIMESTAMP_SCALE: u32 = 0x2A_D7B1;
const DURATION: u32 = 0x4489;
const TRACKS: u32 = 0x1654_AE6B;
const TRACK_ENTRY: u32 = 0xAE;
const TRACK_NUMBER: u32 = 0xD7;
const TRACK_TYPE: u32 = 0x83;
const CODEC_ID: u32 = 0x86;
const CODEC_PRIVATE: u32 = 0x63A2;
const DEFAULT_DURATION: u32 = 0x23_E383;
const VIDEO: u32 = 0xE0;
const PIXEL_WIDTH: u32 = 0xB0;
const PIXEL_HEIGHT: u32 = 0xBA;
const DISPLAY_WIDTH: u32 = 0x54B0;
const DISPLAY_HEIGHT: u32 = 0x54BA;
const CLUSTER: u32 = 0x1F43_B675;
const CLUSTER_TIMESTAMP: u32 = 0xE7;
const SIMPLE_BLOCK: u32 = 0xA3;
const BLOCK_GROUP: u32 = 0xA0;
const BLOCK: u32 = 0xA1;
const REFERENCE_BLOCK: u32 = 0xFB;
/// Top-level elements that end a cluster of unknown size.
const TOP_LEVEL: [u32; 8] = [
    CLUSTER,
    INFO,
    TRACKS,
    0x1C53_BB6B, // Cues
    0x1254_C367, // Tags
    0x1043_A770, // Chapters
    0x1941_A469, // Attachments
    0x114D_9B74, // SeekHead
];
const VIDEO_TRACK: u64 = 1;
/// Header elements beyond this aren't read into memory.
const MAX_ELEMENT_BYTES: u64 = 16 * 1024 * 1024;

/// Whether `head` starts like a Matroska or WebM file.
pub fn is_matroska(head: &[u8]) -> bool {
    head.starts_with(&EBML.to_be_bytes())
}

#[derive(Debug, Clone, Copy)]
struct Element {
    id: u32,
    data: u64,
    /// `None` for an element of unknown size (live recordings write those).
    end: Option<u64>,
}

#[derive(Debug, Clone, Default)]
struct VideoTrack {
    number: u64,
    codec_id: String,
    private: Vec<u8>,
    default_duration_ns: Option<u64>,
    pixel_width: u32,
    pixel_height: u32,
    display_width: Option<u32>,
    display_height: Option<u32>,
}

#[derive(Debug, Clone)]
struct Header {
    timestamp_scale: u64,
    duration_ns: Option<f64>,
    video: VideoTrack,
    /// Where the segment's children start and end.
    segment: (u64, u64),
}

#[derive(Debug, Clone, Copy)]
struct Frame {
    offset: u64,
    size: u32,
    pts_ns: i64,
    key: bool,
}

/// The editor's view of a Matroska file from its first bytes (which hold
/// the segment's info and tracks ahead of the first cluster). Keyframes
/// aren't listed: a Matroska video is always re-encoded, so any start goes.
/// `duration_ms` is 0 when the file doesn't say (the webview measures then).
pub fn trim_points<R: Read + Seek>(reader: &mut R) -> io::Result<Option<TrimPoints>> {
    let Some(header) = read_header(reader)? else {
        return Ok(None);
    };
    let video = &header.video;
    Ok(Some(TrimPoints {
        duration_ms: header.duration_ns.map_or(0, |ns| (ns / 1_000_000.0) as u64),
        keyframes_ms: Vec::new(),
        width: video.display_width.unwrap_or(video.pixel_width),
        height: video.display_height.unwrap_or(video.pixel_height),
        compatible: false,
        container: "matroska",
        bytes_by_second: Vec::new(),
    }))
}

/// The video frames from the last keyframe at or before the start up to the
/// first keyframe at or past its end, timed from that first keyframe; frames
/// in there that fall outside the picked part are left to the webview
/// (`lead_us`), which decodes them anyway to get to the ones it keeps.
pub fn decode_window<R: Read + Seek>(reader: &mut R, trim: Trim) -> io::Result<Option<DecodeWindow>> {
    let Some(header) = read_header(reader)? else {
        return Ok(None);
    };
    let Some((codec, description)) = decoder_config(&header.video) else {
        return Ok(None);
    };
    let Some(frames) = video_frames(reader, &header)? else {
        return Ok(None);
    };
    let start_ns = i64::try_from(trim.start_ms).unwrap_or(i64::MAX).saturating_mul(1_000_000);
    let end_ns = start_ns.saturating_add(i64::try_from(trim.max_ms).unwrap_or(i64::MAX).saturating_mul(1_000_000));
    let Some(first) = frames
        .iter()
        .rposition(|frame| frame.key && frame.pts_ns <= start_ns)
        .or_else(|| frames.iter().position(|frame| frame.key))
    else {
        return Ok(None);
    };
    let last = frames[first + 1..]
        .iter()
        .position(|frame| frame.key && frame.pts_ns >= end_ns)
        .map_or(frames.len(), |past| first + 1 + past);
    let base = frames[first].pts_ns;
    let frame_ns = header.video.default_duration_ns.unwrap_or(33_333_333);
    let samples: Vec<WindowSample> = frames[first..last]
        .iter()
        .map(|frame| WindowSample {
            offset: frame.offset,
            size: frame.size,
            timestamp_us: (frame.pts_ns - base) / 1000,
            duration_us: frame_ns / 1000,
            key: frame.key,
        })
        .collect();
    Ok(Some(DecodeWindow {
        codec,
        description,
        coded_width: header.video.pixel_width,
        coded_height: header.video.pixel_height,
        rotation: 0,
        lead_us: (start_ns - base).max(0) / 1000,
        samples,
    }))
}

/// The WebCodecs `codec` string and `description` for the video track.
fn decoder_config(video: &VideoTrack) -> Option<(String, Vec<u8>)> {
    match video.codec_id.as_str() {
        "V_MPEG4/ISO/AVC" => {
            let avcc = &video.private;
            let codec = format!("avc1.{:02X}{:02X}{:02X}", avcc.get(1)?, avcc.get(2)?, avcc.get(3)?);
            Some((codec, avcc.clone()))
        }
        "V_MPEGH/ISO/HEVC" => Some((hevc_codec(b"hvc1", &video.private)?, video.private.clone())),
        "V_VP8" => Some(("vp8".into(), Vec::new())),
        // Profile 0, 8-bit: what nearly every VP9 file is; the decoder reads
        // the rest from the frames.
        "V_VP9" => Some(("vp09.00.10.08".into(), Vec::new())),
        "V_AV1" => Some((av1_codec(&video.private)?, video.private.clone())),
        _ => None,
    }
}

fn read_header<R: Read + Seek>(reader: &mut R) -> io::Result<Option<Header>> {
    let file_end = reader.seek(SeekFrom::End(0))?;
    reader.seek(SeekFrom::Start(0))?;
    let Some(ebml) = element(reader, file_end)? else {
        return Ok(None);
    };
    if ebml.id != EBML {
        return Ok(None);
    }
    skip_to(reader, ebml.end.unwrap_or(file_end))?;
    let Some(segment) = element(reader, file_end)? else {
        return Ok(None);
    };
    if segment.id != SEGMENT {
        return Ok(None);
    }
    let segment_end = segment.end.unwrap_or(file_end).min(file_end);
    let mut timestamp_scale = 1_000_000u64;
    let mut duration = None;
    let mut video = None;
    let mut at = segment.data;
    while at < segment_end {
        reader.seek(SeekFrom::Start(at))?;
        let Some(child) = element(reader, segment_end)? else {
            break;
        };
        // Info and tracks come before the frames; the first cluster ends the search.
        if child.id == CLUSTER {
            break;
        }
        let Some(end) = child.end else {
            break;
        };
        match child.id {
            INFO => {
                let body = read_body(reader, child)?;
                for (id, value) in children(&body) {
                    match id {
                        TIMESTAMP_SCALE => timestamp_scale = uint(value).filter(|scale| *scale > 0).unwrap_or(timestamp_scale),
                        DURATION => duration = float(value),
                        _ => {}
                    }
                }
            }
            TRACKS => {
                let body = read_body(reader, child)?;
                video = children(&body)
                    .filter(|(id, _)| *id == TRACK_ENTRY)
                    .find_map(|(_, entry)| video_track(entry));
            }
            _ => {}
        }
        at = end;
    }
    let Some(video) = video else {
        return Ok(None);
    };
    Ok(Some(Header {
        timestamp_scale,
        duration_ns: duration.map(|ticks| ticks * timestamp_scale as f64),
        video,
        segment: (segment.data, segment_end),
    }))
}

fn video_track(entry: &[u8]) -> Option<VideoTrack> {
    let mut track = VideoTrack::default();
    let mut kind = None;
    for (id, value) in children(entry) {
        match id {
            TRACK_NUMBER => track.number = uint(value)?,
            TRACK_TYPE => kind = uint(value),
            CODEC_ID => track.codec_id = String::from_utf8_lossy(value).trim_end_matches('\0').to_string(),
            CODEC_PRIVATE => track.private = value.to_vec(),
            DEFAULT_DURATION => track.default_duration_ns = uint(value),
            VIDEO => {
                for (id, value) in children(value) {
                    let size = uint(value).and_then(|size| u32::try_from(size).ok());
                    match id {
                        PIXEL_WIDTH => track.pixel_width = size?,
                        PIXEL_HEIGHT => track.pixel_height = size?,
                        DISPLAY_WIDTH => track.display_width = size,
                        DISPLAY_HEIGHT => track.display_height = size,
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    (kind == Some(VIDEO_TRACK) && track.number != 0 && track.pixel_width != 0 && track.pixel_height != 0)
        .then_some(track)
}

/// Every frame of the video track in storage (decode) order; `None` when a
/// frame is laced, which video practically never is.
fn video_frames<R: Read + Seek>(reader: &mut R, header: &Header) -> io::Result<Option<Vec<Frame>>> {
    let (mut at, segment_end) = header.segment;
    let scale = i64::try_from(header.timestamp_scale).unwrap_or(1_000_000);
    let mut frames = Vec::new();
    while at < segment_end {
        reader.seek(SeekFrom::Start(at))?;
        let Some(child) = element(reader, segment_end)? else {
            break;
        };
        if child.id != CLUSTER {
            match child.end {
                Some(end) => {
                    at = end;
                    continue;
                }
                None => break,
            }
        }
        let cluster_end = child.end.unwrap_or(segment_end).min(segment_end);
        let mut cluster_ns = 0i64;
        let mut inner = child.data;
        while inner < cluster_end {
            reader.seek(SeekFrom::Start(inner))?;
            let Some(block) = element(reader, cluster_end)? else {
                break;
            };
            // An unknown-size cluster ends where the next top-level element starts.
            if child.end.is_none() && TOP_LEVEL.contains(&block.id) {
                break;
            }
            let Some(block_end) = block.end else {
                return Ok(None);
            };
            match block.id {
                CLUSTER_TIMESTAMP => {
                    let body = read_body(reader, block)?;
                    cluster_ns = uint(&body).and_then(|ticks| i64::try_from(ticks).ok()).unwrap_or(0).saturating_mul(scale);
                }
                SIMPLE_BLOCK => {
                    if let Some(frame) = block_frame(reader, block.data, block_end, header, cluster_ns, None)? {
                        frames.push(frame?);
                    }
                }
                BLOCK_GROUP => {
                    let body_at = block.data;
                    let body = read_body(reader, block)?;
                    let referenced = children(&body).any(|(id, _)| id == REFERENCE_BLOCK);
                    if let Some((offset, size)) = child_span(&body, BLOCK) {
                        let start = body_at + offset as u64;
                        if let Some(frame) =
                            block_frame(reader, start, start + size as u64, header, cluster_ns, Some(!referenced))?
                        {
                            frames.push(frame?);
                        }
                    }
                }
                _ => {}
            }
            inner = block_end;
        }
        at = cluster_end;
    }
    Ok(Some(frames))
}

/// The frame a block holds, when it's one of the video track's: `Err` (inside
/// `Some`) for a laced one. `key` overrides the SimpleBlock flag for a Block,
/// which has none.
#[allow(clippy::type_complexity)]
fn block_frame<R: Read + Seek>(
    reader: &mut R,
    start: u64,
    end: u64,
    header: &Header,
    cluster_ns: i64,
    key: Option<bool>,
) -> io::Result<Option<Result<Frame, io::Error>>> {
    reader.seek(SeekFrom::Start(start))?;
    let mut head = [0u8; 12];
    let read = read_up_to(reader, &mut head[..(end - start).min(12) as usize])?;
    let Some((track, length)) = vint(&head[..read], false) else {
        return Ok(None);
    };
    if track != header.video.number {
        return Ok(None);
    }
    let (Some(&high), Some(&low), Some(&flags)) = (head.get(length), head.get(length + 1), head.get(length + 2)) else {
        return Ok(None);
    };
    if flags & 0x06 != 0 {
        return Ok(Some(Err(io::Error::new(io::ErrorKind::InvalidData, "laced video frames"))));
    }
    let relative = i64::from(i16::from_be_bytes([high, low]));
    let scale = i64::try_from(header.timestamp_scale).unwrap_or(1_000_000);
    let offset = start + length as u64 + 3;
    let Ok(size) = u32::try_from(end.saturating_sub(offset)) else {
        return Ok(None);
    };
    Ok(Some(Ok(Frame {
        offset,
        size,
        pts_ns: cluster_ns.saturating_add(relative.saturating_mul(scale)),
        key: key.unwrap_or(flags & 0x80 != 0),
    })))
}

/// The element header at the reader's position; `None` at the end, or for
/// one that doesn't fit before `limit`.
fn element<R: Read + Seek>(reader: &mut R, limit: u64) -> io::Result<Option<Element>> {
    let start = reader.stream_position()?;
    let mut head = [0u8; 12];
    let read = read_up_to(reader, &mut head[..(limit.saturating_sub(start)).min(12) as usize])?;
    let Some((id, id_len)) = vint(&head[..read], true) else {
        return Ok(None);
    };
    let Some((size, size_len)) = vint(&head[id_len..read], false) else {
        return Ok(None);
    };
    let data = start + (id_len + size_len) as u64;
    // All value bits set: the size is unknown.
    let unknown = size == (1u64 << (7 * size_len)) - 1;
    let end = if unknown { None } else { Some(data.saturating_add(size)) };
    if end.is_some_and(|end| end > limit) {
        return Ok(None);
    }
    Ok(Some(Element {
        id: id as u32,
        data,
        end,
    }))
}

/// An EBML variable-length integer and its length; IDs keep their marker bit.
fn vint(bytes: &[u8], keep_marker: bool) -> Option<(u64, usize)> {
    let first = *bytes.first()?;
    let length = first.leading_zeros() as usize + 1;
    if length > 8 || bytes.len() < length {
        return None;
    }
    let mut value = if keep_marker { u64::from(first) } else { u64::from(first) & (0xFF >> length) };
    for byte in &bytes[1..length] {
        value = (value << 8) | u64::from(*byte);
    }
    Some((value, length))
}

/// The child elements of an in-memory element body, as `(id, data)`.
fn children(mut body: &[u8]) -> impl Iterator<Item = (u32, &[u8])> {
    std::iter::from_fn(move || {
        let (id, id_len) = vint(body, true)?;
        let (size, size_len) = vint(body.get(id_len..)?, false)?;
        let start = id_len + size_len;
        let end = start.checked_add(usize::try_from(size).ok()?)?;
        let data = body.get(start..end)?;
        body = &body[end..];
        Some((id as u32, data))
    })
}

/// Where the first `wanted` child's data sits in `body`, and its length.
fn child_span(body: &[u8], wanted: u32) -> Option<(usize, usize)> {
    let mut at = 0usize;
    while at < body.len() {
        let (id, id_len) = vint(&body[at..], true)?;
        let (size, size_len) = vint(body.get(at + id_len..)?, false)?;
        let start = at + id_len + size_len;
        let size = usize::try_from(size).ok()?;
        if start + size > body.len() {
            return None;
        }
        if id as u32 == wanted {
            return Some((start, size));
        }
        at = start + size;
    }
    None
}

fn uint(bytes: &[u8]) -> Option<u64> {
    (bytes.len() <= 8).then(|| bytes.iter().fold(0u64, |value, byte| (value << 8) | u64::from(*byte)))
}

fn float(bytes: &[u8]) -> Option<f64> {
    match bytes.len() {
        4 => Some(f64::from(f32::from_be_bytes(bytes.try_into().ok()?))),
        8 => Some(f64::from_be_bytes(bytes.try_into().ok()?)),
        _ => None,
    }
}

fn read_body<R: Read + Seek>(reader: &mut R, element: Element) -> io::Result<Vec<u8>> {
    let Some(end) = element.end else {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "an element of unknown size"));
    };
    let size = end - element.data;
    if size > MAX_ELEMENT_BYTES {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "a Matroska header element is too large"));
    }
    let mut body = vec![0u8; size as usize];
    reader.seek(SeekFrom::Start(element.data))?;
    reader.read_exact(&mut body)?;
    Ok(body)
}

fn skip_to<R: Seek>(reader: &mut R, at: u64) -> io::Result<()> {
    reader.seek(SeekFrom::Start(at)).map(|_| ())
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    /// An element with a one-byte (or wider) size.
    fn el(id: u32, body: &[u8]) -> Vec<u8> {
        let mut out = id.to_be_bytes().iter().copied().skip_while(|byte| *byte == 0).collect::<Vec<_>>();
        let size = body.len() as u64;
        if size < 0x7F {
            out.push(0x80 | size as u8);
        } else {
            out.push(0x01);
            out.extend_from_slice(&size.to_be_bytes()[1..]);
        }
        out.extend_from_slice(body);
        out
    }

    fn unknown_size(id: u32, body: &[u8]) -> Vec<u8> {
        let mut out = id.to_be_bytes().to_vec();
        out.push(0xFF);
        out.extend_from_slice(body);
        out
    }

    fn simple_block(track: u8, relative_ms: i16, key: bool, payload: &[u8]) -> Vec<u8> {
        let mut body = vec![0x80 | track];
        body.extend_from_slice(&relative_ms.to_be_bytes());
        body.push(if key { 0x80 } else { 0 });
        body.extend_from_slice(payload);
        el(SIMPLE_BLOCK, &body)
    }

    fn header(duration_ms: f64) -> Vec<u8> {
        let mut info = el(TIMESTAMP_SCALE, &1_000_000u32.to_be_bytes()[1..]);
        info.extend(el(DURATION, &duration_ms.to_be_bytes()));
        let mut video = el(PIXEL_WIDTH, &[0x07, 0x80]);
        video.extend(el(PIXEL_HEIGHT, &[0x04, 0x38]));
        let mut entry = el(TRACK_NUMBER, &[1]);
        entry.extend(el(TRACK_TYPE, &[1]));
        entry.extend(el(CODEC_ID, b"V_VP9"));
        entry.extend(el(VIDEO, &video));
        let mut audio = el(TRACK_NUMBER, &[2]);
        audio.extend(el(TRACK_TYPE, &[2]));
        audio.extend(el(CODEC_ID, b"A_OPUS"));
        let mut tracks = el(TRACK_ENTRY, &audio);
        tracks.extend(el(TRACK_ENTRY, &entry));
        let mut segment = el(INFO, &info);
        segment.extend(el(TRACKS, &tracks));
        segment
    }

    /// 3 s of 10 fps video, keyframes at 0, 1 and 2 s, with audio blocks in
    /// between, in clusters of a second; the last cluster's size unknown.
    fn movie() -> Vec<u8> {
        let mut segment = header(3000.0);
        for second in 0..3u8 {
            let mut cluster = el(CLUSTER_TIMESTAMP, &(u16::from(second) * 1000).to_be_bytes());
            for frame in 0..10u8 {
                let index = second * 10 + frame;
                cluster.extend(simple_block(1, i16::from(frame) * 100, frame == 0, &[index; 3]));
                cluster.extend(simple_block(2, i16::from(frame) * 100, true, &[0xAA; 2]));
            }
            if second == 2 {
                segment.extend(unknown_size(CLUSTER, &cluster));
            } else {
                segment.extend(el(CLUSTER, &cluster));
            }
        }
        let mut file = el(EBML, &el(0x4282, b"webm"));
        file.extend(unknown_size(SEGMENT, &segment));
        file
    }

    #[test]
    fn a_matroska_file_is_recognised() {
        assert!(is_matroska(&movie()));
        assert!(!is_matroska(b"\0\0\0\x18ftypisom"));
    }

    #[test]
    fn its_trim_points_come_from_the_header() {
        let points = trim_points(&mut Cursor::new(movie())).expect("read").expect("points");

        assert_eq!((points.duration_ms, points.width, points.height), (3000, 1920, 1080));
        assert!(!points.compatible);
        assert_eq!(points.container, "matroska");
    }

    #[test]
    fn the_header_alone_is_enough_for_trim_points() {
        let bytes = movie();
        let cut = bytes.len() / 3;

        assert!(trim_points(&mut Cursor::new(&bytes[..cut])).expect("read").is_some());
    }

    #[test]
    fn the_window_runs_from_the_keyframe_before_the_start_to_the_one_past_the_end() {
        let bytes = movie();
        let window = decode_window(&mut Cursor::new(&bytes), Trim { start_ms: 1500, max_ms: 400 })
            .expect("read")
            .expect("window");

        assert_eq!(window.codec, "vp09.00.10.08");
        assert_eq!(window.lead_us, 500_000);
        assert_eq!(window.samples.len(), 10);
        assert_eq!(window.samples[0].timestamp_us, 0);
        assert!(window.samples[0].key);
        let first = window.samples[0];
        assert_eq!(&bytes[first.offset as usize..first.offset as usize + first.size as usize], &[10, 10, 10]);
    }

    #[test]
    fn a_window_in_the_unknown_size_cluster_reaches_the_end() {
        let window = decode_window(&mut Cursor::new(movie()), Trim { start_ms: 2100, max_ms: 15_000 })
            .expect("read")
            .expect("window");

        assert_eq!(window.samples.len(), 10);
        assert_eq!(window.samples.last().map(|sample| sample.timestamp_us), Some(900_000));
    }

    #[test]
    fn variable_length_integers_read_as_ebml_says() {
        assert_eq!(vint(&[0x81], false), Some((1, 1)));
        assert_eq!(vint(&[0x40, 0x02], false), Some((2, 2)));
        assert_eq!(vint(&[0x1A, 0x45, 0xDF, 0xA3], true), Some((0x1A45_DFA3, 4)));
        assert_eq!(vint(&[0x00], false), None);
    }
}
