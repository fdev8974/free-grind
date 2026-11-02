import { Crop, Play, RectangleVertical } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
	MAX_CHAT_VIDEO_MS,
	cropWidthFraction,
	editBasis,
	isLandscape,
	loadTrimPoints,
	setVideoEdit,
	type PortraitMode,
	type TrimPoints,
} from "../../../services/videoEdit";
import { MAX_CHAT_MEDIA_BYTES } from "../../../services/stagedVideoUpload";
import { canReencode, estimateUploadBytes } from "../../../services/videoReencode";
import { MediaToolButton, MediaToolDivider } from "./drawerUi";
import { useFilmstrip } from "./useFilmstrip";

const MIN_MS = 1000;
const FILMSTRIP_FRAMES = 8;
/** How far labels may reach past the filmstrip's ends (none: it fills its track). */
const STRIP_INSET = 0;
const LABEL_GAP = 8;
/** The white edge of what gets sent, as the photo crop draws it; rounded like the sheet cards. */
const FRAME_CLASS = "pointer-events-none absolute inset-0 rounded-[20px] border-[3px] border-white/60";
const PLAY_BUTTON_CLASS =
	"absolute inset-0 m-auto flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm";
const CROP_CORNERS = [
	"left-1.5 top-1.5 rounded-tl-[11px] border-l-2 border-t-2",
	"right-1.5 top-1.5 rounded-tr-[11px] border-r-2 border-t-2",
	"bottom-1.5 left-1.5 rounded-bl-[11px] border-b-2 border-l-2",
	"bottom-1.5 right-1.5 rounded-br-[11px] border-b-2 border-r-2",
];

function formatTime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

type Drag = { kind: "start" | "end" | "move"; pointerId: number; grabMs: number };
/** A swipe on the zoomed timeline outside the selection; a tap jumps the selection there. */
type Pan = { pointerId: number; downX: number; viewStart: number; atMs: number; moved: boolean };

/** At most this many times the longest pick is shown at once, so the selection stays wide. */
const ZOOM = 3;
/** How close to the strip's ends a drag starts scrolling the timeline, in px. */
const EDGE_ZONE = 32;
/** The fastest edge scroll, in shown widths per second. */
const EDGE_SPEED = 0.8;

/**
 * The video step of the attachment, drawer and album sheets: a preview, a
 * filmstrip whose handles pick the part to send (at most `maxMs`, at least a
 * second, anywhere: the cut skips to the start with an edit list), and for a landscape video the choice of how it turns upright:
 * black bars, or a 9:16 frame dragged over the picture like the photo crop.
 * The pick is registered against `file` (see videoEdit) for the upload.
 */
export function VideoTrimmer({
	file,
	src,
	maxMs = MAX_CHAT_VIDEO_MS,
	previewHeight = "40dvh",
	maxBytes = MAX_CHAT_MEDIA_BYTES,
	tools,
}: {
	file: File;
	src: string;
	maxMs?: number;
	previewHeight?: string;
	/** The upload's size limit; a pick estimated over it is flagged. */
	maxBytes?: number;
	/** More tool buttons (e.g. looping), in the row with the upright choice. */
	tools?: ReactNode;
}) {
	const { t } = useTranslation();
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const stripRef = useRef<HTMLDivElement | null>(null);
	const cropAreaRef = useRef<HTMLDivElement | null>(null);
	const startLabelRef = useRef<HTMLSpanElement | null>(null);
	const lengthLabelRef = useRef<HTMLSpanElement | null>(null);
	const endLabelRef = useRef<HTMLSpanElement | null>(null);
	const playheadRef = useRef<HTMLSpanElement | null>(null);
	const dragRef = useRef<Drag | null>(null);
	const panRef = useRef<Pan | null>(null);
	// Where a drag's pointer is, for the edge scroll (see the effect below dragTo).
	const pointerXRef = useRef<number | null>(null);
	const cropDragRef = useRef<{ pointerId: number; grabX: number; downX: number } | null>(null);
	const [points, setPoints] = useState<TrimPoints | null>(null);
	const [startMs, setStartMs] = useState(0);
	const [endMs, setEndMs] = useState(0);
	const [playing, setPlaying] = useState(false);
	const [mode, setMode] = useState<PortraitMode["mode"]>("pad");
	const [cropLeft, setCropLeft] = useState(0);
	const [dragCursor, setDragCursor] = useState<"cursor-grabbing" | "cursor-ew-resize" | null>(null);
	// Where the shown part of the timeline starts (see viewMs).
	const [viewStart, setViewStart] = useState(0);

	const durationMs = points?.durationMs ?? 0;
	// A long video shows only part of itself, swiped through, rather than
	// squeezing the selection to a sliver.
	const viewMs = Number.isFinite(maxMs) && durationMs > maxMs * ZOOM ? maxMs * ZOOM : durationMs;
	const zoomed = viewMs < durationMs;
	const clampView = (at: number) => Math.max(0, Math.min(durationMs - viewMs, at));
	const landscape = points ? isLandscape(points) : false;
	const reencodes = landscape && canReencode();
	const cropWidth = points ? cropWidthFraction(points) : 1;
	// About FILMSTRIP_FRAMES frames across the shown part, however long the video.
	const slotMs = viewMs / FILMSTRIP_FRAMES;
	const thumbs = useFilmstrip(src, durationMs, slotMs, viewStart, viewStart + viewMs);
	// The whole video's filmstrip, each frame at its time; placed by the caller.
	const filmstrip = (
		<>
			{[...thumbs].map(([slot, thumb]) => (
				<img
					key={slot}
					src={thumb}
					alt=""
					draggable={false}
					className="absolute inset-y-0 h-full object-cover"
					style={{
						left: `${((slot * slotMs) / durationMs) * 100}%`,
						// A pixel over, so neighbours meet without a hairline gap.
						width: `calc(${(slotMs / durationMs) * 100}% + 1px)`,
					}}
				/>
			))}
		</>
	);

	useEffect(() => {
		let cancelled = false;
		setPoints(null);
		void loadTrimPoints(file).then((loaded) => {
			if (cancelled) return;
			setPoints(loaded);
			setStartMs(0);
			setEndMs(loaded ? Math.min(loaded.durationMs, maxMs) : 0);
			setViewStart(0);
			setMode("pad");
			setCropLeft(loaded ? (1 - cropWidthFraction(loaded)) / 2 : 0);
		});
		return () => {
			cancelled = true;
		};
	}, [file, maxMs]);

	useEffect(() => {
		if (!points) {
			setVideoEdit(file, null);
			return;
		}
		const trim = startMs > 0 || endMs < points.durationMs - 50;
		const portrait: PortraitMode | null = !landscape
			? null
			: mode === "crop" && reencodes
				? { mode: "crop", left: cropLeft }
				: { mode: "pad" };
		// Whole milliseconds: the upload takes them as integers.
		const start = Math.round(startMs);
		const basis = editBasis(points);
		const edit = { startMs: start, maxMs: Math.round(endMs) - start, trim, portrait, ...basis };
		setVideoEdit(file, trim || portrait || basis.transcode ? edit : null);
	}, [file, points, startMs, endMs, landscape, reencodes, mode, cropLeft]);

	const seekTo = useCallback((ms: number) => {
		const video = videoRef.current;
		if (video) video.currentTime = ms / 1000;
	}, []);

	// Playback stays inside the picked part.
	const onTimeUpdate = () => {
		const video = videoRef.current;
		if (!video || !points) return;
		const at = video.currentTime * 1000;
		if (at >= endMs || at < startMs - 250) video.currentTime = startMs / 1000;
	};

	// The playhead follows every frame while playing (timeupdate only comes a
	// few times a second), moved directly rather than through state.
	useEffect(() => {
		if (!playing) return;
		let frame = 0;
		const follow = () => {
			const video = videoRef.current;
			const playhead = playheadRef.current;
			if (video && playhead && endMs > startMs) {
				const at = Math.min(Math.max(video.currentTime * 1000, startMs), endMs);
				playhead.style.left = `${((at - startMs) / (endMs - startMs)) * 100}%`;
			}
			frame = requestAnimationFrame(follow);
		};
		frame = requestAnimationFrame(follow);
		return () => cancelAnimationFrame(frame);
	}, [playing, startMs, endMs]);

	const togglePlay = () => {
		const video = videoRef.current;
		if (!video) return;
		if (video.paused) void video.play();
		else video.pause();
	};

	// The selection never leaves the shown part of the timeline: times are
	// held to it, and the view only moves when it's swiped.
	const viewEnd = viewStart + viewMs;
	const msAt = (clientX: number) => {
		const rect = stripRef.current?.getBoundingClientRect();
		if (!rect || rect.width === 0) return viewStart;
		return Math.max(viewStart, Math.min(viewEnd, viewStart + ((clientX - rect.left) / rect.width) * viewMs));
	};

	const dragTo = (drag: Drag, at: number) => {
		if (drag.kind === "start") {
			const next = Math.max(viewStart, endMs - maxMs, Math.min(at, endMs - MIN_MS));
			setStartMs(next);
			seekTo(next);
		} else if (drag.kind === "end") {
			const next = Math.min(viewEnd, startMs + maxMs, Math.max(at, startMs + MIN_MS));
			setEndMs(next);
			seekTo(next);
		} else {
			const length = endMs - startMs;
			const next = Math.max(viewStart, Math.min(viewEnd - length, at - drag.grabMs));
			setStartMs(next);
			setEndMs(next + length);
			seekTo(next);
		}
	};

	// Held at either end of the strip, a drag scrolls the timeline on under the
	// selection, which stays at that end and goes along through the video;
	// faster the further into (or past) the end the pointer is.
	const latest = useRef({ startMs, endMs, viewStart });
	latest.current = { startMs, endMs, viewStart };
	useEffect(() => {
		if (!zoomed || !dragCursor) return;
		let frame = 0;
		let last = performance.now();
		const step = (now: number) => {
			const elapsed = Math.min(now - last, 50);
			last = now;
			frame = requestAnimationFrame(step);
			const drag = dragRef.current;
			const rect = stripRef.current?.getBoundingClientRect();
			const x = pointerXRef.current;
			if (!drag || !rect || x === null) return;
			const intoLeft = rect.left + EDGE_ZONE - x;
			const intoRight = x - (rect.right - EDGE_ZONE);
			const direction = intoLeft > 0 && drag.kind !== "end" ? -1 : intoRight > 0 && drag.kind !== "start" ? 1 : 0;
			if (direction === 0) return;
			const depth = Math.min(2, Math.max(intoLeft, intoRight) / EDGE_ZONE);
			const { startMs: start, endMs: end, viewStart: view } = latest.current;
			const nextView = clampView(view + direction * depth * EDGE_SPEED * viewMs * (elapsed / 1000));
			if (nextView === view) return;
			let nextStart = start;
			let nextEnd = end;
			if (drag.kind === "move") {
				nextStart = direction < 0 ? nextView : nextView + viewMs - (end - start);
				nextEnd = nextStart + (end - start);
			} else if (drag.kind === "start") {
				nextStart = Math.max(nextView, end - maxMs);
				// At its longest the selection can't follow; the view stays with it.
				if (nextStart > nextView) return;
			} else {
				nextEnd = Math.min(nextView + viewMs, start + maxMs);
				if (nextEnd < nextView + viewMs) return;
			}
			setViewStart(nextView);
			setStartMs(nextStart);
			setEndMs(nextEnd);
			seekTo(drag.kind === "end" ? nextEnd : nextStart);
		};
		frame = requestAnimationFrame(step);
		return () => cancelAnimationFrame(frame);
	}, [zoomed, dragCursor, viewMs, maxMs, durationMs, seekTo]);

	const onStripDown = (event: PointerEvent<HTMLDivElement>) => {
		const handle = (event.target as HTMLElement).closest<HTMLElement>("[data-trim-handle]")?.dataset.trimHandle;
		const at = msAt(event.clientX);
		const inside = at >= startMs && at <= endMs;
		event.currentTarget.setPointerCapture(event.pointerId);
		videoRef.current?.pause();
		// Zoomed, outside the selection swipes the timeline; a tap there jumps (onStripUp).
		if (zoomed && !handle && !inside) {
			panRef.current = { pointerId: event.pointerId, downX: event.clientX, viewStart, atMs: at, moved: false };
			setDragCursor("cursor-grabbing");
			return;
		}
		const kind = handle === "start" || handle === "end" ? handle : "move";
		// Outside the selection it jumps there, centered on the pointer.
		const drag: Drag = { kind, pointerId: event.pointerId, grabMs: inside ? at - startMs : (endMs - startMs) / 2 };
		dragRef.current = drag;
		setDragCursor(kind === "move" ? "cursor-grabbing" : "cursor-ew-resize");
		if (kind === "move" && !inside) dragTo(drag, at);
	};

	const onStripMove = (event: PointerEvent<HTMLDivElement>) => {
		const pan = panRef.current;
		if (pan?.pointerId === event.pointerId) {
			const width = stripRef.current?.clientWidth ?? 0;
			const moved = event.clientX - pan.downX;
			if (Math.abs(moved) > 4) pan.moved = true;
			if (!pan.moved || width === 0) return;
			const view = clampView(pan.viewStart - (moved / width) * viewMs);
			setViewStart(view);
			// The edge the view moves past pushes the selection along, keeping it in view.
			const length = endMs - startMs;
			const pushed = Math.max(view, Math.min(view + viewMs - length, startMs));
			if (pushed !== startMs) {
				setStartMs(pushed);
				setEndMs(pushed + length);
				seekTo(pushed);
			}
			return;
		}
		const drag = dragRef.current;
		if (drag?.pointerId === event.pointerId) {
			pointerXRef.current = event.clientX;
			dragTo(drag, msAt(event.clientX));
		}
	};

	const onStripUp = (event: PointerEvent<HTMLDivElement>) => {
		const pan = panRef.current;
		if (pan?.pointerId === event.pointerId) {
			panRef.current = null;
			setDragCursor(null);
			if (!pan.moved && event.type === "pointerup") {
				dragTo({ kind: "move", pointerId: event.pointerId, grabMs: (endMs - startMs) / 2 }, pan.atMs);
			}
			return;
		}
		const drag = dragRef.current;
		if (drag?.pointerId !== event.pointerId) return;
		dragRef.current = null;
		pointerXRef.current = null;
		setDragCursor(null);
	};

	const onCropDown = (event: PointerEvent<HTMLDivElement>) => {
		const rect = cropAreaRef.current?.getBoundingClientRect();
		if (!rect) return;
		cropDragRef.current = {
			pointerId: event.pointerId,
			grabX: (event.clientX - rect.left) / rect.width - cropLeft,
			downX: event.clientX,
		};
		event.currentTarget.setPointerCapture(event.pointerId);
	};

	const onCropMove = (event: PointerEvent<HTMLDivElement>) => {
		const drag = cropDragRef.current;
		const rect = cropAreaRef.current?.getBoundingClientRect();
		if (drag?.pointerId !== event.pointerId || !rect) return;
		const next = (event.clientX - rect.left) / rect.width - drag.grabX;
		setCropLeft(Math.max(0, Math.min(1 - cropWidth, next)));
	};

	// A tap on the frame plays or pauses, like a tap anywhere else on the preview.
	const onCropUp = (event: PointerEvent<HTMLDivElement>) => {
		const drag = cropDragRef.current;
		if (drag?.pointerId !== event.pointerId) return;
		cropDragRef.current = null;
		if (event.type === "pointerup" && Math.abs(event.clientX - drag.downX) < 4) togglePlay();
	};

	// Where on the shown part of the timeline a time sits; `span` is a length.
	const percent = (ms: number) => `${viewMs > 0 ? ((ms - viewStart) / viewMs) * 100 : 0}%`;
	const span = (ms: number) => `${viewMs > 0 ? (ms / viewMs) * 100 : 0}%`;
	const selectedMs = endMs - startMs;
	const atLimit = durationMs > maxMs && selectedMs >= maxMs - 50;
	// What the pick will weigh as uploaded, told before anything is made.
	const estimatedBytes = points
		? estimateUploadBytes(
				points,
				{
					startMs,
					maxMs: selectedMs,
					trim: true,
					portrait: landscape ? (mode === "crop" && reencodes ? { mode: "crop", left: cropLeft } : { mode: "pad" }) : null,
					...editBasis(points),
				},
				file.size,
			)
		: 0;
	const tooLarge = estimatedBytes > maxBytes;
	const megabytes = (bytes: number) => Math.ceil(bytes / (1024 * 1024));

	// The start time sits under the frame's left edge, the end time under its
	// right edge and the length in the middle; when the frame is too narrow
	// for all three, start and end move out to its sides. Kept on the strip.
	const layoutLabels = () => {
		const strip = stripRef.current;
		const start = startLabelRef.current;
		const length = lengthLabelRef.current;
		const end = endLabelRef.current;
		if (!strip || !start || !length || !end || viewMs <= 0) return;
		const width = strip.clientWidth;
		const frameLeft = ((startMs - viewStart) / viewMs) * width;
		const frameRight = ((endMs - viewStart) / viewMs) * width;
		const lengthX = (frameLeft + frameRight) / 2 - length.offsetWidth / 2;
		const startX = Math.min(frameLeft, lengthX - LABEL_GAP - start.offsetWidth);
		const endX = Math.max(frameRight - end.offsetWidth, lengthX + length.offsetWidth + LABEL_GAP);
		const place = (label: HTMLElement, x: number) => {
			label.style.left = `${Math.max(-STRIP_INSET, Math.min(width + STRIP_INSET - label.offsetWidth, x))}px`;
		};
		place(start, startX);
		place(length, lengthX);
		place(end, endX);
	};
	const layoutLabelsRef = useRef(layoutLabels);
	layoutLabelsRef.current = layoutLabels;

	useLayoutEffect(layoutLabels);

	useEffect(() => {
		const strip = stripRef.current;
		if (!strip) return;
		const observer = new ResizeObserver(() => layoutLabelsRef.current());
		observer.observe(strip);
		return () => observer.disconnect();
	}, [points]);

	const video = (
		<video
			ref={videoRef}
			src={src}
			playsInline
			preload="auto"
			// Some videos stay blank at 0 until they're seeked; this also puts a
			// remounted element (on a Bars/Crop switch) back at the picked start.
			onLoadedMetadata={(event) => {
				event.currentTarget.currentTime = Math.max(startMs / 1000, 0.001);
			}}
			onTimeUpdate={onTimeUpdate}
			onPlay={() => setPlaying(true)}
			onPause={() => setPlaying(false)}
			onClick={togglePlay}
			className={reencodes && mode === "pad" ? "h-full w-full object-contain" : "block w-auto max-w-full"}
			style={reencodes && mode === "pad" ? undefined : { maxHeight: previewHeight }}
		/>
	);

	return (
		<div className="flex w-full flex-1 flex-col items-center gap-3">
			<div className="relative flex justify-center">
				{reencodes && mode === "pad" ? (
					// Upright on black bars, as it will be sent.
					<div className="relative overflow-hidden rounded-[20px] bg-black" style={{ height: previewHeight, aspectRatio: "9 / 16" }}>
						{video}
						<div className={FRAME_CLASS} />
					</div>
				) : (
					<div ref={cropAreaRef} className="relative overflow-hidden rounded-[20px]" style={{ clipPath: "inset(0 round 20px)" }}>
						{video}
						{!(reencodes && mode === "crop") && <div className={FRAME_CLASS} />}
						{reencodes && mode === "crop" && (
							<div
								onPointerDown={onCropDown}
								onPointerMove={onCropMove}
								onPointerUp={onCropUp}
								onPointerCancel={onCropUp}
								className="absolute inset-y-0 cursor-grab touch-none rounded-[20px] border-[3px] border-white/60 active:cursor-grabbing"
								style={{
									left: `${cropLeft * 100}%`,
									width: `${cropWidth * 100}%`,
									boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
								}}
							>
								{/* The photo crop's corner marks, following the frame's rounding. */}
								{CROP_CORNERS.map((corner) => (
									<span key={corner} className={`pointer-events-none absolute h-[18px] w-[18px] border-white ${corner}`} />
								))}
								{/* Moves with the frame; a tap on the frame plays (see onCropUp). */}
								{!playing && (
									<span className={`${PLAY_BUTTON_CLASS} pointer-events-none`}>
										<Play className="ml-0.5 h-6 w-6" />
									</span>
								)}
							</div>
						)}
					</div>
				)}
				{!playing && points && !(reencodes && mode === "crop") && (
					<button
						type="button"
						onClick={togglePlay}
						aria-label={t("chat.attachments.trim_play", { defaultValue: "Play" })}
						className={PLAY_BUTTON_CLASS}
					>
						<Play className="ml-0.5 h-6 w-6" />
					</button>
				)}
			</div>

			{points && (
				<div className="w-full pt-1">
				{/* A track as wide and rounded as the sheet's cards, filled by the
				    filmstrip; the frame sits on it, flush with its outer edge at either
				    end, and its window rounded 3px less so the corners run parallel. */}
				<div
					onPointerDown={onStripDown}
					onPointerMove={onStripMove}
					onPointerUp={onStripUp}
					onPointerCancel={onStripUp}
					className={`relative h-16 touch-none select-none rounded-[20px] [background:color-mix(in_srgb,var(--sheet-bg,var(--surface))_93%,var(--text))] ${dragCursor ?? "cursor-grab"}`}
				>
				<div ref={stripRef} className="absolute inset-0">
					<div className="absolute inset-0 overflow-hidden rounded-[20px] bg-black/40">
						{/* The whole video's filmstrip, slid to the shown part. */}
						<div className="absolute inset-y-0" style={{ left: span(-viewStart), width: span(durationMs) }}>
							{filmstrip}
						</div>
					</div>
					{/* Dimmed up to under the frame, so its rounded corners don't let
					    the bright filmstrip peek out. */}
					<div
						className="absolute inset-y-0 left-0 rounded-l-[20px] bg-black/65 backdrop-grayscale"
						style={{ width: `calc(max(0%, ${percent(startMs)}) + 20px)` }}
					/>
					<div
						className="absolute inset-y-0 right-0 rounded-r-[20px] bg-black/65 backdrop-grayscale"
						style={{ left: `calc(min(100%, ${percent(endMs)}) - 20px)` }}
					/>
					<div
						className="absolute inset-y-0 rounded-[20px] bg-[var(--accent)] p-[3px] shadow-[0_4px_14px_rgba(0,0,0,0.45),0_0_12px_color-mix(in_srgb,var(--accent)_35%,transparent)]"
						style={{ left: percent(startMs), width: span(selectedMs) }}
					>
						{/* The picked part of the filmstrip again, clipped to the window's
						    rounded corners on the frame's fill: one edge, so no seam. */}
						<div className="pointer-events-none relative h-full w-full overflow-hidden rounded-[17px]">
							<div
								className="absolute inset-y-0 bg-black/40"
								style={{
									left: `${(-startMs / selectedMs) * 100}%`,
									width: `${(durationMs / selectedMs) * 100}%`,
								}}
							>
								{filmstrip}
							</div>
							{/* The playhead, only while playing; its track is inset so the
							    bar stays clear of the window's rounded corners. */}
							<div className="absolute inset-x-2.5 inset-y-0">
								<span
									ref={playheadRef}
									className={`absolute inset-y-1 left-0 w-1 -translate-x-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.25),0_1px_4px_rgba(0,0,0,0.5)] transition-opacity duration-200 ${
										playing ? "opacity-100" : "opacity-0"
									}`}
								/>
							</div>
						</div>
						{/* Grips on the frame's sides, wider to grab than they look. */}
						{(["start", "end"] as const).map((handle) => (
							<div
								key={handle}
								data-trim-handle={handle}
								role="slider"
								aria-label={
									handle === "start"
										? t("chat.attachments.trim_start", { defaultValue: "Start" })
										: t("chat.attachments.trim_end", { defaultValue: "End" })
								}
								aria-valuenow={Math.round(handle === "start" ? startMs : endMs)}
								aria-valuemin={0}
								aria-valuemax={Math.round(durationMs)}
								className={`absolute inset-y-0 flex w-6 cursor-ew-resize items-center justify-center ${
									handle === "start" ? "-left-[10.5px]" : "-right-[10.5px]"
								}`}
							>
								<span className="flex h-7 w-2.5 items-center justify-center rounded-full bg-[var(--accent)] shadow">
									<span className="h-3.5 w-0.5 rounded-full bg-[var(--accent-contrast)]" />
								</span>
							</div>
						))}
					</div>
				</div>
				</div>
					{/* Start, length and end follow the frame (see layoutLabels). */}
					<div className="relative mt-2 h-4 text-xs tabular-nums">
						<span ref={startLabelRef} className="absolute top-0 whitespace-nowrap font-medium text-[var(--text)]">
							{formatTime(startMs)}
						</span>
						<span
							ref={lengthLabelRef}
							className={`absolute top-0 whitespace-nowrap ${tooLarge ? "font-semibold text-red-400" : "text-[var(--text-muted)]"}`}
						>
							{atLimit
								? t("chat.attachments.trim_length_max", {
										defaultValue: "{{length}} s (max.)",
										length: (selectedMs / 1000).toFixed(1),
									})
								: t("chat.attachments.trim_length", {
										defaultValue: "{{length}} s",
										length: (selectedMs / 1000).toFixed(1),
									})}
						</span>
						<span ref={endLabelRef} className="absolute top-0 whitespace-nowrap font-medium text-[var(--text)]">
							{formatTime(endMs)}
						</span>
					</div>
					{tooLarge && (
						<p className="mt-2 text-center text-xs text-red-400">
							{t("chat.attachments.trim_too_large", {
								defaultValue: "About {{size}} MB, over the {{max}} MB limit. Pick a shorter part.",
								size: megabytes(estimatedBytes),
								max: megabytes(maxBytes),
							})}
						</p>
					)}
					{zoomed && (
						// Where the shown part and the selection sit in the whole video.
						<div className="relative mt-2.5 h-1 overflow-hidden rounded-full ink-tint-8">
							<div
								className="absolute inset-y-0 rounded-full bg-[color-mix(in_srgb,var(--text)_28%,transparent)]"
								style={{ left: `${(viewStart / durationMs) * 100}%`, width: `${(viewMs / durationMs) * 100}%` }}
							/>
							<div
								className="absolute inset-y-0 rounded-full bg-[var(--accent)]"
								style={{ left: `${(startMs / durationMs) * 100}%`, width: `max(4px, ${(selectedMs / durationMs) * 100}%)` }}
							/>
						</div>
					)}
				</div>
			)}

			{(reencodes || tools) && (
				// The same round tool row as under a photo, centered in whatever
				// room the sheet has left below the timeline.
				<div className="my-auto flex items-center justify-center gap-3 pt-2">
					{reencodes && (
						<>
							<MediaToolButton
								icon={<RectangleVertical />}
								label={t("chat.attachments.portrait_pad", { defaultValue: "Bars" })}
								active={mode === "pad"}
								onClick={() => setMode("pad")}
							/>
							<MediaToolButton
								icon={<Crop />}
								label={t("chat.attachments.portrait_crop", { defaultValue: "Crop" })}
								active={mode === "crop"}
								onClick={() => setMode("crop")}
							/>
						</>
					)}
					{reencodes && tools && <MediaToolDivider />}
					{tools}
				</div>
			)}
			{landscape && !reencodes && (
				<p className="w-full text-center text-xs text-[var(--text-muted)]">
					{t("chat.attachments.landscape_unsupported", {
						defaultValue: "This device can't turn landscape videos upright, so it's sent as it is. The official app may not show it properly.",
					})}
				</p>
			)}
		</div>
	);
}
