/**
 * videoEdit.ts — what a chat video needs before it can be sent: the server
 * refuses videos over ~15 s ("Length …ms is out of range for VIDEO"), and the
 * official app can't show landscape ones, in chats or albums. The editor
 * (VideoTrimmer) picks the window and how a landscape video turns upright,
 * and registers that here against the File; the upload reads it back, or
 * works out the default for a file that never went through the editor (the
 * share sheet, say).
 *
 * What goes out is always MP4 with H.264 video and AAC sound. A portrait
 * video that is that already is cut losslessly Rust-side
 * (src-tauri/src/media/video/trim.rs); anything else (HEVC, other sound,
 * landscape, Matroska/WebM) is re-encoded in the webview first
 * (videoReencode.ts).
 */

import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

import { bytesToBase64 } from "./stagedVideoUpload";

/** The chat endpoint's limit, as the official app trims to. */
export const MAX_CHAT_VIDEO_MS = 15_000;

const trimPointsSchema = z.object({
	durationMs: z.number(),
	keyframesMs: z.array(z.number()),
	width: z.number(),
	height: z.number(),
	// Older binaries only knew MP4 and didn't say.
	compatible: z.boolean().default(true),
	container: z.enum(["mp4", "matroska"]).default("mp4"),
	bytesBySecond: z.array(z.number()).default([]),
});

export type TrimPoints = z.infer<typeof trimPointsSchema>;

/**
 * How a landscape video becomes portrait: centered on black bars (`pad`), or
 * cut to a full-height 9:16 frame whose left edge sits at `left` (a fraction
 * of the shown width).
 */
export type PortraitMode = { mode: "pad" } | { mode: "crop"; left: number };

/**
 * `startMs`/`maxMs`: the window to send. `trim`: that window is less than
 * the whole video, so it gets cut. `portrait`: the video is landscape and
 * gets re-encoded upright, as the mode says. `transcode`: it isn't H.264
 * with AAC sound, so it gets re-encoded either way. `matroska`: it can't go
 * out any other way. `width`/`height`: its size as shown.
 */
export interface VideoEdit {
	startMs: number;
	maxMs: number;
	trim: boolean;
	portrait: PortraitMode | null;
	transcode: boolean;
	matroska: boolean;
	width: number;
	height: number;
}

/** The parts of a VideoEdit that come from the video itself. */
export function editBasis(points: TrimPoints): Pick<VideoEdit, "transcode" | "matroska" | "width" | "height"> {
	return {
		transcode: !points.compatible,
		matroska: points.container === "matroska",
		width: points.width,
		height: points.height,
	};
}

// A `moov` box beyond this is not one we'd parse anyway.
const MAX_MOOV_BYTES = 64 * 1024 * 1024;
// A Matroska file's info and tracks come first, well within this.
const MATROSKA_HEAD_BYTES = 4 * 1024 * 1024;
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];

/** What Rust reads the trim points from: the `moov` box, or a Matroska head. */
async function readHead(file: File): Promise<Uint8Array | null> {
	const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer());
	if (EBML_MAGIC.every((byte, index) => magic[index] === byte)) {
		return new Uint8Array(await file.slice(0, MATROSKA_HEAD_BYTES).arrayBuffer());
	}
	return readMoov(file);
}

/** The length the webview's player reads, for a file that doesn't say. */
function measuredDurationMs(file: File): Promise<number> {
	return new Promise((resolve) => {
		const video = document.createElement("video");
		const url = URL.createObjectURL(file);
		const done = (ms: number) => {
			URL.revokeObjectURL(url);
			resolve(ms);
		};
		video.preload = "metadata";
		video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0);
		video.onerror = () => done(0);
		video.src = url;
	});
}

/**
 * The file's top-level `moov` box, found by reading only box headers, so a
 * large video isn't read into memory to open the editor.
 */
async function readMoov(file: File): Promise<Uint8Array | null> {
	return (await readMoovLayout(file))?.moov ?? null;
}

/**
 * The `moov` box and where it sits, with every top-level box's place
 * (`headers`, as byte ranges: a whole `ftyp`, else the header): what Rust
 * reads besides the samples, so what a sparse staging must hold.
 */
async function readMoovLayout(
	file: File,
): Promise<{ moov: Uint8Array; offset: number; headers: [number, number][] } | null> {
	const headers: [number, number][] = [];
	let offset = 0;
	while (offset + 8 <= file.size) {
		const header = new DataView(await file.slice(offset, offset + 16).arrayBuffer());
		const declared = header.getUint32(0);
		const type = String.fromCharCode(
			header.getUint8(4),
			header.getUint8(5),
			header.getUint8(6),
			header.getUint8(7),
		);
		let size = declared;
		if (declared === 1) {
			if (header.byteLength < 16) return null;
			size = Number(header.getBigUint64(8));
		} else if (declared === 0) {
			size = file.size - offset;
		}
		if (size < 8) return null;
		if (type === "moov") {
			if (size > MAX_MOOV_BYTES) return null;
			return { moov: new Uint8Array(await file.slice(offset, offset + size).arrayBuffer()), offset, headers };
		}
		headers.push([offset, offset + (type === "ftyp" ? size : Math.min(size, 16))]);
		offset += size;
	}
	return null;
}

/**
 * The byte ranges of `file` that cutting it as `edit` says reads (its box
 * headers, `moov`, and the picked part's samples), sorted and merged; null
 * when the whole file has to be staged (no cut, Matroska, or a binary that
 * can't tell).
 */
export async function stagingRanges(file: File, edit: VideoEdit | null | undefined): Promise<[number, number][] | null> {
	if (!edit?.trim || edit.matroska) return null;
	const layout = await readMoovLayout(file);
	if (!layout) return null;
	let samples: [number, number][] | null;
	try {
		samples = await invoke<[number, number][] | null>("video_needed_ranges", {
			moov: bytesToBase64(layout.moov),
			fileSize: file.size,
			startMs: edit.startMs,
			maxMs: edit.maxMs,
		});
	} catch {
		return null;
	}
	if (!samples) return null;
	const all = [...layout.headers, [layout.offset, layout.offset + layout.moov.length] as [number, number], ...samples].sort(
		(a, b) => a[0] - b[0],
	);
	const merged: [number, number][] = [];
	for (const [start, end] of all) {
		const last = merged[merged.length - 1];
		if (last && start <= last[1]) last[1] = Math.max(last[1], end);
		else merged.push([start, end]);
	}
	return merged;
}

// Cached per File: the editor and the upload both ask.
const pointsByFile = new WeakMap<File, Promise<TrimPoints | null>>();

/**
 * The video's length, keyframes and shown size, or null when it isn't a
 * video Rust can cut (or the binary predates the editor).
 */
export function loadTrimPoints(file: File): Promise<TrimPoints | null> {
	let points = pointsByFile.get(file);
	if (!points) {
		points = (async () => {
			const head = await readHead(file);
			if (!head) return null;
			try {
				const result = await invoke<unknown>("video_trim_points", head);
				if (result == null) return null;
				const parsed = trimPointsSchema.parse(result);
				if (parsed.durationMs === 0) parsed.durationMs = await measuredDurationMs(file);
				return parsed.durationMs > 0 ? parsed : null;
			} catch {
				return null;
			}
		})();
		pointsByFile.set(file, points);
	}
	return points;
}

export function isLandscape(points: Pick<TrimPoints, "width" | "height">): boolean {
	return points.width > points.height;
}

/** A full-height 9:16 frame's width, as a fraction of the shown width. */
export function cropWidthFraction(points: Pick<TrimPoints, "width" | "height">): number {
	return Math.min(1, (points.height * 9) / 16 / points.width);
}

/**
 * The edit a video needs when nobody picked one: its first `maxMs`, upright
 * on black bars when it's landscape (nothing of it gets lost), re-encoded
 * when it isn't H.264 with AAC.
 */
export function defaultVideoEdit(points: TrimPoints, maxMs = MAX_CHAT_VIDEO_MS): VideoEdit | null {
	const trim = points.durationMs > maxMs;
	const portrait: PortraitMode | null = isLandscape(points) ? { mode: "pad" } : null;
	const basis = editBasis(points);
	if (!trim && !portrait && !basis.transcode) return null;
	return { startMs: 0, maxMs: Math.min(maxMs, points.durationMs), trim, portrait, ...basis };
}

/** The longest pick that may be split into parts (8 of them at 15 s). */
export const MAX_SPLIT_MS = 2 * 60_000;

/** A split's parts shorter than this are dropped: the trimmer's shortest pick. */
const MIN_SEGMENT_MS = 1000;

/**
 * Where a video split into parts of at most `maxMs` cuts: `maxMs` long each,
 * the rest last (dropped when it's under a second).
 */
export function splitSegments(durationMs: number, maxMs = MAX_CHAT_VIDEO_MS): { startMs: number; maxMs: number }[] {
	const segments: { startMs: number; maxMs: number }[] = [];
	for (let start = 0; start < durationMs; start += maxMs) {
		const length = Math.min(maxMs, durationMs - start);
		if (length >= MIN_SEGMENT_MS || segments.length === 0) segments.push({ startMs: start, maxMs: length });
	}
	return segments;
}

/**
 * `count` stand-ins for `file`, one per part of a split: the same bytes
 * (nothing is copied), each a File of its own so it carries its own edit
 * (see setVideoEdit). Named "clip (2⁄3).mp4" and so on.
 */
export function segmentFiles(file: File, count: number): File[] {
	const dot = file.name.lastIndexOf(".");
	const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
	const extension = dot > 0 ? file.name.slice(dot) : "";
	const points = pointsByFile.get(file);
	return Array.from({ length: count }, (_, index) => {
		const segment = new File([file], `${stem} (${index + 1}⁄${count})${extension}`, {
			type: file.type,
			lastModified: file.lastModified,
		});
		// Same video, same points: the upload needn't read them again.
		if (points) pointsByFile.set(segment, points);
		return segment;
	});
}

const editsByFile = new WeakMap<File, VideoEdit>();

/** Registers the editor's pick for `file`; the upload reads it back. */
export function setVideoEdit(file: File, edit: VideoEdit | null): void {
	if (edit) editsByFile.set(file, edit);
	else editsByFile.delete(file);
}

/**
 * The editor's pick, else the default for a video at most `maxMs` long,
 * else null (send as picked).
 */
export async function resolveVideoEdit(file: File, maxMs = MAX_CHAT_VIDEO_MS): Promise<VideoEdit | null> {
	const picked = editsByFile.get(file);
	if (picked) return picked;
	const points = await loadTrimPoints(file);
	return points ? defaultVideoEdit(points, maxMs) : null;
}
