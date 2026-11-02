/**
 * sentMediaEchoes.ts — keeps a sent photo/video's bubble steady when its
 * optimistic stand-in is swapped for the server's message (and that again
 * for later copies of it, from the socket or the local db): the bubble keeps
 * the stand-in's React key, so it isn't remounted, and a video keeps the
 * still it showed while uploading until its own first frame is there.
 */

// A still is kept this long after sending; by then the video has loaded.
const POSTER_LIFETIME_MS = 2 * 60 * 1000;

interface SentMediaEcho {
	/** The optimistic message's id, used as the bubble's key from then on. */
	key: string;
	/** The upload's still (an object URL), until it's let go. */
	poster?: string;
}

const echoes = new Map<string, SentMediaEcho>();

/** Ties the server's message `messageId` to the optimistic one it replaced. */
export function rememberSentMedia(messageId: string, key: string, poster?: string): void {
	echoes.set(messageId, { key, poster });
	if (!poster) return;
	window.setTimeout(() => {
		const echo = echoes.get(messageId);
		if (echo?.poster === poster) echoes.set(messageId, { key: echo.key });
		URL.revokeObjectURL(poster);
	}, POSTER_LIFETIME_MS);
}

export function sentMediaEcho(messageId: string): SentMediaEcho | undefined {
	return echoes.get(messageId);
}
