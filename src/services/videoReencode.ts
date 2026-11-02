/**
 * videoReencode.ts — turns a landscape video portrait for the official app,
 * which can't show landscape: the window's frames are decoded with WebCodecs,
 * drawn onto a 9:16 canvas (centered on black, or the picked full-height
 * crop), and encoded to H.264. Both run on the
 * platform's (usually hardware) codecs; JavaScript only moves frames along,
 * and they stay GPU-side as VideoFrames.
 *
 * Rust hands over the window's encoded frames (video_decode_window) and puts
 * the result together with the original sound, copied as is
 * (upload_staged_chat_video with `edit.reencoded`, see media/video/trim.rs).
 */

import { decode } from "@msgpack/msgpack";
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

import { appendStaged, bytesToBase64, createStaged, discardStaged } from "./stagedVideoUpload";
import { appLog } from "../utils/logger";
import type { PortraitMode, VideoEdit } from "./videoEdit";

const OUTPUT_WIDTH = 720;
const OUTPUT_HEIGHT = 1280;
const BITRATE = 4_000_000;
const KEYFRAME_EVERY_US = 2_000_000;
const BATCH_BYTES = 4 * 1024 * 1024;
const FLUSH_BYTES = 2 * 1024 * 1024;
// Frames in flight before the pipeline waits for the codecs to catch up.
const MAX_QUEUED = 8;
// Level 4.0 covers 720×1280 at 30 fps; High first, Baseline as the last resort.
const ENCODER_CODECS = ["avc1.640028", "avc1.4D4028", "avc1.42E028"];

/** The device can't re-encode this video; send it as it is (with a warning). */
export class ReencodeUnsupportedError extends Error {
	constructor(reason: string) {
		super(`Video can't be re-encoded here: ${reason}`);
		this.name = "ReencodeUnsupportedError";
	}
}

export interface ReencodedVideo {
	stagedId: string;
	width: number;
	height: number;
	/** The encoder's avcC, base64. */
	avcc: string;
	chunks: { size: number; timestampUs: number; key: boolean }[];
}

const batchSchema = z.object({
	codec: z.string(),
	description: z.instanceof(Uint8Array),
	codedWidth: z.number(),
	codedHeight: z.number(),
	rotation: z.number(),
	total: z.number(),
	samples: z.array(
		z.object({
			data: z.instanceof(Uint8Array),
			timestampUs: z.number(),
			durationUs: z.number(),
			key: z.boolean(),
		}),
	),
});

type Batch = z.infer<typeof batchSchema>;

/** Whether this webview has the WebCodecs pieces re-encoding needs. */
export function canReencode(): boolean {
	return (
		typeof VideoDecoder !== "undefined" &&
		typeof VideoEncoder !== "undefined" &&
		typeof VideoFrame !== "undefined" &&
		typeof EncodedVideoChunk !== "undefined"
	);
}

async function readBatch(stagedId: string, edit: VideoEdit, from: number): Promise<Batch | null> {
	const packed = await invoke<ArrayBuffer | number[]>("video_decode_window", {
		stagedId,
		startMs: edit.startMs,
		maxMs: edit.maxMs,
		from,
		maxBytes: BATCH_BYTES,
	});
	// Tauri delivers ArrayBuffer on most platforms, a plain number[] on Windows.
	const buffer = packed instanceof ArrayBuffer ? packed : new Uint8Array(packed).buffer;
	const unpacked = decode(buffer);
	return unpacked == null ? null : batchSchema.parse(unpacked);
}

async function pickEncoderConfig(): Promise<VideoEncoderConfig | null> {
	for (const codec of ENCODER_CODECS) {
		const config: VideoEncoderConfig = {
			codec,
			width: OUTPUT_WIDTH,
			height: OUTPUT_HEIGHT,
			bitrate: BITRATE,
			framerate: 30,
			avc: { format: "avc" },
		};
		const support = await VideoEncoder.isConfigSupported(config).catch(() => null);
		if (support?.supported) return config;
	}
	return null;
}

function toBytes(source: AllowSharedBufferSource): Uint8Array {
	if (source instanceof ArrayBuffer || source instanceof SharedArrayBuffer) {
		return new Uint8Array(source.slice(0));
	}
	return new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
}

/**
 * Draws `frame` turned upright onto the canvas: fitted on black (`pad`), or
 * scaled to the full height and shifted so the picked 9:16 frame fills it
 * (`crop`). Rotating around the frame's center keeps both independent of it.
 */
function drawPortrait(
	context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
	frame: CanvasImageSource,
	frameWidth: number,
	frameHeight: number,
	rotation: number,
	portrait: PortraitMode,
) {
	const sideways = rotation === 90 || rotation === 270;
	const shownWidth = sideways ? frameHeight : frameWidth;
	const shownHeight = sideways ? frameWidth : frameHeight;
	let scale = Math.min(OUTPUT_WIDTH / shownWidth, OUTPUT_HEIGHT / shownHeight);
	let centerX = OUTPUT_WIDTH / 2;
	if (portrait.mode === "crop") {
		scale = OUTPUT_HEIGHT / shownHeight;
		const cropWidth = Math.min(shownWidth, (shownHeight * 9) / 16);
		const cropCenter = Math.min(Math.max(portrait.left, 0), 1) * shownWidth + cropWidth / 2;
		centerX = OUTPUT_WIDTH / 2 + (shownWidth / 2 - Math.min(cropCenter, shownWidth - cropWidth / 2)) * scale;
	}
	context.fillStyle = "#000";
	context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
	context.save();
	context.translate(centerX, OUTPUT_HEIGHT / 2);
	context.rotate((rotation * Math.PI) / 180);
	const width = frameWidth * scale;
	const height = frameHeight * scale;
	context.drawImage(frame, -width / 2, -height / 2, width, height);
	context.restore();
}

/**
 * A still of what `edit` sends, for the chat bubble while it uploads: the
 * first frame of the picked part, upright as it will be (see drawPortrait).
 * Null when the webview can't seek or draw the video.
 */
export async function editPoster(file: File, edit: VideoEdit): Promise<string | null> {
	const video = document.createElement("video");
	video.muted = true;
	video.playsInline = true;
	video.preload = "auto";
	const src = URL.createObjectURL(file);
	video.src = src;
	const settled = (event: "loadeddata" | "seeked") =>
		new Promise<void>((resolve, reject) => {
			const timer = window.setTimeout(() => reject(new Error("timed out")), 3000);
			video.addEventListener(event, () => { window.clearTimeout(timer); resolve(); }, { once: true });
			video.addEventListener("error", () => { window.clearTimeout(timer); reject(video.error); }, { once: true });
		});
	try {
		await settled("loadeddata");
		const seeked = settled("seeked");
		video.currentTime = edit.startMs / 1000 + 0.001;
		await seeked;
		// The element is drawn upright already, so no rotation here.
		const upright = edit.portrait !== null && canReencode();
		const canvas = document.createElement("canvas");
		canvas.width = upright ? OUTPUT_WIDTH : video.videoWidth;
		canvas.height = upright ? OUTPUT_HEIGHT : video.videoHeight;
		const context = canvas.getContext("2d");
		if (!context || canvas.width === 0) return null;
		if (upright && edit.portrait) drawPortrait(context, video, video.videoWidth, video.videoHeight, 0, edit.portrait);
		else context.drawImage(video, 0, 0, canvas.width, canvas.height);
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
		return blob ? URL.createObjectURL(blob) : null;
	} catch {
		return null;
	} finally {
		video.removeAttribute("src");
		video.load();
		URL.revokeObjectURL(src);
	}
}

function makeCanvas(): {
	canvas: OffscreenCanvas | HTMLCanvasElement;
	context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
} | null {
	if (typeof OffscreenCanvas !== "undefined") {
		const canvas = new OffscreenCanvas(OUTPUT_WIDTH, OUTPUT_HEIGHT);
		const context = canvas.getContext("2d");
		return context ? { canvas, context } : null;
	}
	const canvas = document.createElement("canvas");
	canvas.width = OUTPUT_WIDTH;
	canvas.height = OUTPUT_HEIGHT;
	const context = canvas.getContext("2d");
	return context ? { canvas, context } : null;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 4));

/**
 * Re-encodes the edit's window of the staged video to a 720×1280 portrait
 * H.264 stream, staged for upload_staged_chat_video. Throws
 * ReencodeUnsupportedError when this device can't decode or encode it.
 */
export async function reencodePortrait(
	stagedId: string,
	edit: VideoEdit,
	onProgress?: (fraction: number) => void,
): Promise<ReencodedVideo> {
	const portrait = edit.portrait;
	if (!portrait) throw new ReencodeUnsupportedError("not landscape");
	if (!canReencode()) throw new ReencodeUnsupportedError("no WebCodecs");
	const first = await readBatch(stagedId, edit, 0);
	if (!first) throw new ReencodeUnsupportedError("codec not supported");
	const decoderConfig: VideoDecoderConfig = {
		codec: first.codec,
		description: first.description,
		codedWidth: first.codedWidth,
		codedHeight: first.codedHeight,
	};
	const decodable = await VideoDecoder.isConfigSupported(decoderConfig).catch(() => null);
	if (!decodable?.supported) throw new ReencodeUnsupportedError(`can't decode ${first.codec}`);
	const encoderConfig = await pickEncoderConfig();
	if (!encoderConfig) throw new ReencodeUnsupportedError("no H.264 encoder");
	const drawing = makeCanvas();
	if (!drawing) throw new ReencodeUnsupportedError("no canvas");

	const outputId = await createStaged();
	if (outputId === null) throw new ReencodeUnsupportedError("staging unavailable");

	let failure: unknown = null;
	let avcc: Uint8Array | null = null;
	const chunks: ReencodedVideo["chunks"] = [];
	let pending: Uint8Array[] = [];
	let pendingBytes = 0;
	// Writes go out in order, one after another, while encoding goes on.
	let writes: Promise<void> = Promise.resolve();
	const flushPending = () => {
		if (pending.length === 0) return;
		const joined = new Uint8Array(pendingBytes);
		let at = 0;
		for (const part of pending) {
			joined.set(part, at);
			at += part.length;
		}
		pending = [];
		pendingBytes = 0;
		writes = writes.then(() => appendStaged(outputId, joined));
	};

	const encoder = new VideoEncoder({
		output: (chunk, metadata) => {
			const data = new Uint8Array(chunk.byteLength);
			chunk.copyTo(data);
			const description = metadata?.decoderConfig?.description;
			if (description && !avcc) avcc = toBytes(description);
			chunks.push({ size: data.length, timestampUs: chunk.timestamp, key: chunk.type === "key" });
			pending.push(data);
			pendingBytes += data.length;
			if (pendingBytes >= FLUSH_BYTES) flushPending();
		},
		error: (error) => {
			failure ??= error;
		},
	});
	encoder.configure(encoderConfig);

	let lastKeyUs = Number.NEGATIVE_INFINITY;
	const decoder = new VideoDecoder({
		output: (frame) => {
			try {
				drawPortrait(drawing.context, frame, frame.displayWidth, frame.displayHeight, first.rotation, portrait);
				const drawn = new VideoFrame(drawing.canvas, {
					timestamp: frame.timestamp,
					...(frame.duration != null ? { duration: frame.duration } : {}),
				});
				const keyFrame = frame.timestamp - lastKeyUs >= KEYFRAME_EVERY_US;
				if (keyFrame) lastKeyUs = frame.timestamp;
				encoder.encode(drawn, { keyFrame });
				drawn.close();
			} catch (error) {
				failure ??= error;
			} finally {
				frame.close();
			}
		},
		error: (error) => {
			failure ??= error;
		},
	});
	decoder.configure(decoderConfig);

	try {
		let batch: Batch | null = first;
		let from = 0;
		while (batch && batch.samples.length > 0) {
			for (const sample of batch.samples) {
				decoder.decode(
					new EncodedVideoChunk({
						type: sample.key ? "key" : "delta",
						timestamp: sample.timestampUs,
						duration: sample.durationUs,
						data: sample.data,
					}),
				);
				while (!failure && (decoder.decodeQueueSize > MAX_QUEUED || encoder.encodeQueueSize > MAX_QUEUED)) {
					await settle();
				}
				if (failure) throw failure;
			}
			from += batch.samples.length;
			onProgress?.(Math.min(1, from / batch.total));
			batch = from < batch.total ? await readBatch(stagedId, edit, from) : null;
		}
		await decoder.flush();
		await encoder.flush();
		if (failure) throw failure;
		flushPending();
		await writes;
		if (!avcc || chunks.length === 0) throw new ReencodeUnsupportedError("the encoder produced nothing");
		return {
			stagedId: outputId,
			width: OUTPUT_WIDTH,
			height: OUTPUT_HEIGHT,
			avcc: bytesToBase64(avcc),
			chunks,
		};
	} catch (error) {
		await writes.catch(() => undefined);
		await discardStaged(outputId);
		// A codec that gave up mid-way is as unsupported as one that never started.
		if (error instanceof DOMException) throw new ReencodeUnsupportedError(error.message);
		throw error;
	} finally {
		if (decoder.state !== "closed") decoder.close();
		if (encoder.state !== "closed") encoder.close();
	}
}

/** What upload_staged_*_video takes as `edit`. */
export interface StagedEdit {
	startMs: number;
	maxMs: number;
	reencoded: ReencodedVideo | null;
}

/**
 * Turns `edit` into the upload's cut, re-encoding the staged video upright
 * first when it's landscape. Where this device can't, `onLandscapeKept`
 * runs and the video goes on landscape. Null when nothing needs cutting.
 */
export async function stagedEdit(
	stagedId: string,
	edit: VideoEdit | null | undefined,
	onLandscapeKept?: () => void,
): Promise<StagedEdit | null> {
	if (!edit) return null;
	let reencoded: ReencodedVideo | null = null;
	if (edit.portrait) {
		try {
			reencoded = await reencodePortrait(stagedId, edit);
		} catch (error) {
			if (!(error instanceof ReencodeUnsupportedError)) throw error;
			appLog.warn("[videoReencode] landscape video sent as it is", error);
			onLandscapeKept?.();
		}
	}
	return edit.trim || reencoded ? { startMs: edit.startMs, maxMs: edit.maxMs, reencoded } : null;
}
