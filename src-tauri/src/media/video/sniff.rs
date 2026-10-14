const BOX_TYPE: &[u8] = b"ftyp";
const VIDEO_BRANDS: [&[u8]; 5] = [b"qt  ", b"avc1", b"M4V ", b"f4v ", b"mmp4"];
const VIDEO_BRAND_PREFIXES: [&[u8]; 3] = [b"iso", b"mp4", b"3g"];

/// An MP4/MOV/3GP file, recognized by the major brand of its `ftyp` box.
pub fn is_video(head: &[u8]) -> bool {
    let Some(brand) = head.get(8..12) else {
        return false;
    };
    head.get(4..8) == Some(BOX_TYPE)
        && (VIDEO_BRANDS.contains(&brand)
            || VIDEO_BRAND_PREFIXES
                .iter()
                .any(|prefix| brand.starts_with(prefix)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::video::boxes::test_support::boxed;

    fn file_type(brand: &[u8; 4]) -> Vec<u8> {
        let mut body = brand.to_vec();
        body.extend_from_slice(&[0u8; 4]);
        boxed(b"ftyp", &body)
    }

    #[test]
    fn mp4_quicktime_and_3gp_are_video() {
        for brand in [b"isom", b"mp42", b"avc1", b"qt  ", b"3gp4", b"3g2a"] {
            assert!(is_video(&file_type(brand)), "{brand:?}");
        }
    }

    #[test]
    fn heif_photos_and_misplaced_brands_are_not_video() {
        assert!(!is_video(&file_type(b"heic")));
        assert!(!is_video(&file_type(b"mif1")));
        assert!(!is_video(&file_type(b"avif")));
        assert!(!is_video(&boxed(b"moov", b"isom\0\0\0\0")));
        assert!(!is_video(b""));
    }
}
