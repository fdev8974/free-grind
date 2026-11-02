import { useEffect, useRef, useState } from "react";

const THUMB_HEIGHT = 96;
// Slots drawn ahead of the shown part on either side, so a swipe finds them ready.
const AHEAD = 4;

/**
 * Frames of the video at `src` for the trimmer's filmstrip, one per `slotMs`
 * of it, keyed by slot (slot `n` shows the frame in the middle of
 * `n * slotMs`…`(n + 1) * slotMs`). Only the slots around `fromMs`…`toMs`
 * (the shown part of the timeline) are drawn, from a hidden <video>, one by
 * one so they fill in as they come, and kept while `src` and `slotMs` stay;
 * so a long video gets frames as wide as a short one's, as it's swiped
 * through. Empty when the webview can't seek the video.
 */
export function useFilmstrip(
	src: string,
	durationMs: number,
	slotMs: number,
	fromMs: number,
	toMs: number,
): ReadonlyMap<number, string> {
	const [thumbs, setThumbs] = useState<ReadonlyMap<number, string>>(new Map());
	const wantedRef = useRef<number[]>([]);
	const wakeRef = useRef<() => void>(() => {});

	const slots = slotMs > 0 ? Math.ceil(durationMs / slotMs) : 0;
	const first = Math.max(0, Math.floor(fromMs / slotMs) - AHEAD);
	const last = Math.min(slots - 1, Math.ceil(toMs / slotMs) + AHEAD);

	// The worker: one hidden <video> per src and slot size, drawing the wanted slots in turn.
	useEffect(() => {
		setThumbs(new Map());
		if (durationMs <= 0 || slotMs <= 0) return;
		let cancelled = false;
		const made = new Map<number, string>();
		const video = document.createElement("video");
		video.muted = true;
		video.preload = "auto";
		video.playsInline = true;
		video.src = src;
		let wake: (() => void) | null = null;
		wakeRef.current = () => {
			wake?.();
			wake = null;
		};

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
				while (!cancelled) {
					const slot = wantedRef.current.find((wanted) => !made.has(wanted));
					if (slot === undefined) {
						await new Promise<void>((resolve) => {
							wake = resolve;
						});
						continue;
					}
					await seek(Math.min(durationMs, (slot + 0.5) * slotMs) / 1000);
					context.drawImage(video, 0, 0, canvas.width, canvas.height);
					const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.7));
					if (!blob || cancelled) break;
					made.set(slot, URL.createObjectURL(blob));
					setThumbs(new Map(made));
				}
			} catch {
				// No filmstrip; the timeline still works without one.
			}
		})();

		return () => {
			cancelled = true;
			wakeRef.current();
			video.removeAttribute("src");
			video.load();
			for (const url of made.values()) URL.revokeObjectURL(url);
		};
	}, [src, durationMs, slotMs]);

	// The shown part's slots first, middle outwards, then those around it.
	useEffect(() => {
		if (slots === 0) return;
		const middle = (first + last) / 2;
		wantedRef.current = Array.from({ length: last - first + 1 }, (_, index) => first + index).sort(
			(a, b) => Math.abs(a - middle) - Math.abs(b - middle),
		);
		wakeRef.current();
	}, [first, last, slots]);

	return thumbs;
}
