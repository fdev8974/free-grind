//! A staged video as a request body, read from disk while it is sent (ported
//! from open-grind). The strip patches are applied on the way out, and the
//! body yields exactly the size it promised or fails.

use std::fs::File;
use std::io::{self, Cursor, Read, Take};
use std::path::PathBuf;
use std::sync::Arc;

use grindr::BodySource;

use super::form::Framing;
use crate::media::video::strip::{Patch, PatchedReader};

const FILE_CHANGED: &str = "That file changed while it was uploading";
/// How often `FileBody::progress` hears of the bytes read, at most.
const PROGRESS_EVERY: u64 = 256 * 1024;

/// Told how many bytes of the body have been read so far (and so handed to
/// the connection), every `PROGRESS_EVERY` of them and once at the end.
pub type Progress = Arc<dyn Fn(u64) + Send + Sync>;

pub struct FileBody {
    pub path: PathBuf,
    pub framing: Framing,
    pub content_len: u64,
    pub patches: Arc<[Patch]>,
    pub progress: Option<Progress>,
}

impl BodySource for FileBody {
    fn size(&self) -> u64 {
        self.framing.size(self.content_len)
    }

    fn open(&self) -> io::Result<Box<dyn Read + Send>> {
        let file = File::open(&self.path)?;
        let content = ExactReader {
            inner: PatchedReader::new(file.take(self.content_len), Arc::clone(&self.patches)),
            read: 0,
            expected: self.content_len,
        };
        let body = Cursor::new(self.framing.head.clone())
            .chain(content)
            .chain(Cursor::new(self.framing.tail.clone()));
        Ok(match &self.progress {
            Some(progress) => Box::new(Counted {
                inner: body,
                read: 0,
                told: 0,
                progress: Arc::clone(progress),
            }),
            None => Box::new(body),
        })
    }
}

struct Counted<R> {
    inner: R,
    read: u64,
    told: u64,
    progress: Progress,
}

impl<R: Read> Read for Counted<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let read = self.inner.read(buf)?;
        self.read += read as u64;
        if read == 0 || self.read - self.told >= PROGRESS_EVERY {
            self.told = self.read;
            (self.progress)(self.read);
        }
        Ok(read)
    }
}

/// Fails instead of ending early when the file shrank since it was planned;
/// a file that grew is already cut by the `Take`.
struct ExactReader {
    inner: PatchedReader<Take<File>>,
    read: u64,
    expected: u64,
}

impl Read for ExactReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let read = self.inner.read(buf)?;
        if read == 0 && self.read != self.expected {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, FILE_CHANGED));
        }
        self.read += read as u64;
        Ok(read)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use crate::media::video::boxes::Span;
    use crate::media::video::strip::Fill;
    use crate::upload::form::FormPart;

    const CONTENT: &[u8] = b"a tiny clip pretending to be an mp4";

    static NEXT: AtomicUsize = AtomicUsize::new(0);

    struct TempFile(PathBuf);

    impl TempFile {
        fn new(bytes: &[u8]) -> Self {
            let path = std::env::temp_dir().join(format!(
                "fg-stream-{}-{}.mp4",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::write(&path, bytes).expect("write");
            Self(path)
        }
    }

    impl Drop for TempFile {
        fn drop(&mut self) {
            std::fs::remove_file(&self.0).ok();
        }
    }

    fn body(file: &TempFile, content_len: u64, patches: Vec<Patch>) -> FileBody {
        FileBody {
            path: file.0.clone(),
            framing: Framing::new(&FormPart {
                name: "content",
                filename: "",
                content_type: "video/mp4",
            }),
            content_len,
            patches: Arc::from(patches),
            progress: None,
        }
    }

    fn sent(source: &FileBody) -> io::Result<Vec<u8>> {
        let mut framed = Vec::new();
        source.open()?.read_to_end(&mut framed)?;
        Ok(framed)
    }

    fn content_of<'a>(source: &FileBody, framed: &'a [u8]) -> &'a [u8] {
        let head = source.framing.head.len();
        &framed[head..framed.len() - source.framing.tail.len()]
    }

    #[test]
    fn the_stream_yields_exactly_the_size_it_promised() {
        let file = TempFile::new(CONTENT);
        let source = body(&file, CONTENT.len() as u64, Vec::new());

        let framed = sent(&source).expect("read");

        assert_eq!(framed.len() as u64, source.size());
        assert_eq!(content_of(&source, &framed), CONTENT);
        assert!(framed.ends_with(&source.framing.tail));
    }

    #[test]
    fn a_strip_plan_changes_the_bytes_that_are_sent() {
        let file = TempFile::new(CONTENT);
        let source = body(
            &file,
            CONTENT.len() as u64,
            vec![Patch {
                span: Span { start: 2, end: 6 },
                fill: Fill::Zeros,
            }],
        );
        let mut stripped = CONTENT.to_vec();
        stripped[2..6].fill(0);

        let framed = sent(&source).expect("read");

        assert_eq!(content_of(&source, &framed), stripped);
    }

    #[test]
    fn a_reopened_stream_starts_over() {
        let file = TempFile::new(CONTENT);
        let source = body(&file, CONTENT.len() as u64, Vec::new());

        assert_eq!(sent(&source).expect("first"), sent(&source).expect("second"));
    }

    #[test]
    fn a_file_that_shrank_fails_instead_of_sending_a_short_body() {
        let file = TempFile::new(CONTENT);
        let source = body(&file, CONTENT.len() as u64 + 16, Vec::new());

        let failed = sent(&source).expect_err("short");

        assert_eq!(failed.kind(), io::ErrorKind::UnexpectedEof);
        assert_eq!(failed.to_string(), FILE_CHANGED);
    }

    #[test]
    fn a_file_that_grew_is_cut_to_the_promised_size() {
        let file = TempFile::new(CONTENT);
        let source = body(&file, CONTENT.len() as u64 - 4, Vec::new());

        let framed = sent(&source).expect("read");

        assert_eq!(framed.len() as u64, source.size());
        assert_eq!(content_of(&source, &framed), &CONTENT[..CONTENT.len() - 4]);
    }
}
