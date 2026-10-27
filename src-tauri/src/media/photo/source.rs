use std::io::Cursor;

use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};

const MAX_DECODED_BYTES: u64 = 256 * 1024 * 1024;
const MAX_PIXELS: u64 = 64 * 1024 * 1024;

const JPEG_MAGIC: &[u8] = &[0xFF, 0xD8, 0xFF];
const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n";
const GIF_MAGIC: &[u8] = b"GIF8";
const BMP_MAGIC: &[u8] = b"BM";
const TIFF_LITTLE_MAGIC: &[u8] = b"II\x2a\x00";
const TIFF_BIG_MAGIC: &[u8] = b"MM\x00\x2a";
const RIFF_MAGIC: &[u8] = b"RIFF";
const WEBP_MAGIC: &[u8] = b"WEBP";
const BOX_TYPE: &[u8] = b"ftyp";
const HEIF_BRANDS: [&[u8]; 10] = [
    b"heic", b"heix", b"heim", b"heis", b"hevc", b"hevx", b"hevm", b"hevs", b"mif1", b"msf1",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    Jpeg,
    Png,
    Webp,
    Gif,
    Bmp,
    Tiff,
    Heif,
}

pub struct Source {
    pub image: DynamicImage,
    pub orientation: Orientation,
    pub icc: Option<Vec<u8>>,
}

/// Recognizes a photo by its magic bytes, never by the caller's MIME type.
/// `None` covers video and everything else.
pub fn sniff(bytes: &[u8]) -> Option<Format> {
    if bytes.starts_with(JPEG_MAGIC) {
        Some(Format::Jpeg)
    } else if bytes.starts_with(PNG_MAGIC) {
        Some(Format::Png)
    } else if bytes.starts_with(GIF_MAGIC) {
        Some(Format::Gif)
    } else if bytes.starts_with(BMP_MAGIC) {
        Some(Format::Bmp)
    } else if bytes.starts_with(TIFF_LITTLE_MAGIC) || bytes.starts_with(TIFF_BIG_MAGIC) {
        Some(Format::Tiff)
    } else if bytes.starts_with(RIFF_MAGIC) && bytes.get(8..12) == Some(WEBP_MAGIC) {
        Some(Format::Webp)
    } else if bytes.get(4..8) == Some(BOX_TYPE)
        && matches!(bytes.get(8..12), Some(brand) if HEIF_BRANDS.contains(&brand))
    {
        Some(Format::Heif)
    } else {
        None
    }
}

pub fn decode(format: Format, bytes: &[u8]) -> Option<Source> {
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format.decoded_by_image()?);
    let mut limits = Limits::no_limits();
    limits.max_alloc = Some(MAX_DECODED_BYTES);
    reader.limits(limits);

    let mut decoder = reader.into_decoder().ok()?;
    let (width, height) = decoder.dimensions();
    if u64::from(width) * u64::from(height) > MAX_PIXELS {
        return None;
    }
    let orientation = decoder.orientation().ok()?;
    let icc = decoder.icc_profile().ok().flatten();
    let image = DynamicImage::from_decoder(decoder).ok()?;

    Some(Source {
        image,
        orientation,
        icc,
    })
}

impl Format {
    fn decoded_by_image(self) -> Option<ImageFormat> {
        match self {
            Format::Jpeg => Some(ImageFormat::Jpeg),
            Format::Png => Some(ImageFormat::Png),
            Format::Webp => Some(ImageFormat::WebP),
            Format::Gif => Some(ImageFormat::Gif),
            Format::Bmp => Some(ImageFormat::Bmp),
            Format::Tiff => Some(ImageFormat::Tiff),
            // image-rs can't read HEIF; see `super::heif`.
            Format::Heif => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use image::codecs::jpeg::JpegEncoder;
    use image::ImageEncoder;

    use super::*;

    fn boxed(brand: &[u8]) -> Vec<u8> {
        let mut bytes = vec![0, 0, 0, 0x18];
        bytes.extend_from_slice(b"ftyp");
        bytes.extend_from_slice(brand);
        bytes
    }

    fn jpeg(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        JpegEncoder::new_with_quality(&mut bytes, 90)
            .write_image(
                &vec![128; (width * height * 3) as usize],
                width,
                height,
                image::ExtendedColorType::Rgb8,
            )
            .expect("encode");
        bytes
    }

    #[test]
    fn every_supported_format_is_recognized_by_its_magic() {
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0]), Some(Format::Jpeg));
        assert_eq!(sniff(b"\x89PNG\r\n\x1a\n\0\0"), Some(Format::Png));
        assert_eq!(sniff(b"GIF89a..."), Some(Format::Gif));
        assert_eq!(sniff(b"BM\0\0\0\0"), Some(Format::Bmp));
        assert_eq!(sniff(b"II\x2a\x00rest"), Some(Format::Tiff));
        assert_eq!(sniff(b"MM\x00\x2arest"), Some(Format::Tiff));
        assert_eq!(sniff(b"RIFF\0\0\0\0WEBPVP8 "), Some(Format::Webp));
        assert_eq!(sniff(&boxed(b"heic")), Some(Format::Heif));
        assert_eq!(sniff(&boxed(b"mif1")), Some(Format::Heif));
    }

    #[test]
    fn video_and_other_containers_are_not_photos() {
        assert_eq!(sniff(&boxed(b"isom")), None);
        assert_eq!(sniff(&boxed(b"qt  ")), None);
        assert_eq!(sniff(b"RIFF\0\0\0\0AVI LIST"), None);
        assert_eq!(sniff(b"\x1a\x45\xdf\xa3webm"), None);
    }

    #[test]
    fn a_file_shorter_than_any_magic_never_panics() {
        for length in 0..12 {
            let _ = sniff(&boxed(b"heic")[..length]);
            let _ = sniff(&jpeg(2, 2)[..length]);
        }
    }

    #[test]
    fn a_truncated_photo_is_refused_rather_than_half_decoded() {
        let whole = jpeg(64, 64);

        assert!(decode(Format::Jpeg, &whole[..whole.len() / 3]).is_none());
        assert!(decode(Format::Jpeg, &[]).is_none());
        assert!(decode(Format::Heif, &boxed(b"heic")).is_none());
    }

    #[test]
    fn a_photo_claiming_absurd_dimensions_is_refused_before_it_allocates() {
        let mut bomb = jpeg(8, 8);
        let sof = bomb
            .windows(2)
            .position(|pair| pair == [0xFF, 0xC0])
            .expect("SOF marker");
        bomb[sof + 5..sof + 9].copy_from_slice(&[0xFF, 0xFF, 0xFF, 0xFF]);

        assert!(decode(Format::Jpeg, &bomb).is_none());
    }
}
