import { useEffect, useState } from "react";

const THUMB_HEIGHT = 96;

/**
 * `count` frames spread over the video at `src`, as object URLs for the
 * trimmer's filmstrip. Drawn one by one from a hidden <video>, so they fill
 * in as they come; empty until the first one is ready, and when the webview
 * can't seek the video.
 */
export function useFilmstrip(src: string, durationMs: number, count: number): string[] {
	const [thumbs, setThumbs] = useState<string[]>([]);

	useEffect(() => {
		setThumbs([]);
		if (durationMs <= 0) return;
		let cancelled = false;
		const made: string[] = [];
		const video = document.createElement("video");
		video.muted = true;
		video.preload = "auto";
		video.playsInline = true;
		video.src = src;

		const seek = (seconds: number) =>
			new Promise<void>((resolve, reject) => {
				video.onseeked = () => resolve();
				video.onerror = () => reject(video.error);
				video.currentTime = seconds;
			});

		void (async () => {
			try {
				await new Promise<void>((resolve, reject) => {
					video.onloadeddata = () => resolve();
					video.onerror = () => reject(video.error);
				});
				const canvas = document.createElement("canvas");
				const context = canvas.getContext("2d");
				if (!context || video.videoHeight === 0) return;
				canvas.height = THUMB_HEIGHT;
				canvas.width = Math.round((video.videoWidth / video.videoHeight) * THUMB_HEIGHT);
				for (let index = 0; index < count && !cancelled; index++) {
					await seek(((index + 0.5) * durationMs) / count / 1000);
					context.drawImage(video, 0, 0, canvas.width, canvas.height);
					const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.7));
					if (!blob || cancelled) break;
					made.push(URL.createObjectURL(blob));
					setThumbs([...made]);
				}
			} catch {
				// No filmstrip; the timeline still works without one.
			}
		})();

		return () => {
			cancelled = true;
			video.removeAttribute("src");
			video.load();
			for (const url of made) URL.revokeObjectURL(url);
		};
	}, [src, durationMs, count]);

	return thumbs;
}
