/**
 * videoReencode.ts — re-encodes a video into what the official app plays
 * everywhere: H.264 (Baseline) video with AAC-LC sound, in MP4. Used for any
 * video that isn't that already (HEVC, VP8/VP9/AV1, sound in another codec,
 * Matroska/WebM), and for landscape ones, which the official app can't show:
 * those are drawn onto a 9:16 canvas (centered on black, or the picked
 * full-height crop).
 *
 * Video: Rust hands over the window's encoded frames (video_decode_window,
 * MP4 or Matroska), WebCodecs decodes them, frames outside the picked part
 * are dropped and the rest drawn and encoded, on the platform's (usually
 * hardware) codecs; they stay GPU-side as VideoFrames. Sound: the engine
 * decodes the file's sound track (decodeAudioData, any container it plays)
 * and AudioEncoder turns the picked part into AAC.
 *
 * Rust then writes the MP4 (upload_staged_chat_video with `edit.reencoded`,
 * see media/video/trim.rs); without re-encoded sound it copies the
 * original's, played from the picked start.
 */

import { decode } from "@msgpack/msgpack";
import { Channel, invoke } from "@tauri-apps/api/core";
import { z } from "zod";

import { ApiFunctionError } from "./apiHelpers";
import {
	appendStaged,
	bytesToBase64,
	createStaged,
	discardStaged,
	type UploadPhase,
	type UploadProgress,
} from "./stagedVideoUpload";
import { appLog } from "../utils/logger";
import { loadTrimPoints, type PortraitMode, type TrimPoints, type VideoEdit } from "./videoEdit";

const OUTPUT_WIDTH = 720;
const OUTPUT_HEIGHT = 1280;
const BITRATE = 4_000_000;
const KEYFRAME_EVERY_US = 2_000_000;
const BATCH_BYTES = 4 * 1024 * 1024;
const FLUSH_BYTES = 2 * 1024 * 1024;
// Frames in flight before the pipeline waits for the codecs to catch up.
const MAX_QUEUED = 8;
// Baseline level 3.1 covers 720×1280 at 30 fps (3.0 stops at 720×576);
// Constrained Baseline first, plain Baseline and Main 3.1 as fallbacks.
const ENCODER_CODECS = ["avc1.42E01F", "avc1.42001F", "avc1.4D401F"];
const AUDIO_CODEC = "mp4a.40.2";
const AUDIO_SAMPLE_RATE = 48_000;
const AUDIO_BITRATE = 128_000;
// AudioData handed to the encoder at a time, in frames.
const AUDIO_BLOCK = 4096;
// decodeAudioData holds the whole sound track decoded; past this, the
// original sound is copied (MP4) or left out (Matroska) instead.
const MAX_AUDIO_SOURCE_BYTES = 512 * 1024 * 1024;

/** The device can't re-encode this video (send it as it is, if it can go). */
export class ReencodeUnsupportedError extends Error {
	constructor(reason: string) {
		super(`Video can't be re-encoded here: ${reason}`);
		this.name = "ReencodeUnsupportedError";
	}
}

export interface ReencodedAudio {
	sampleRate: number;
	channels: number;
	/** The encoder's AudioSpecificConfig, base64. */
	config: string;
	chunks: { size: number; timestampUs: number; key: boolean }[];
}

export interface ReencodedVideo {
	stagedId: string;
	width: number;
	height: number;
	/** The encoder's avcC, base64. */
	avcc: string;
	chunks: { size: number; timestampUs: number; key: boolean }[];
	/** Staged after the video's chunks; null when the original's is copied. */
	audio: ReencodedAudio | null;
}

const batchSchema = z.object({
	codec: z.string(),
	description: z.instanceof(Uint8Array),
	codedWidth: z.number(),
	codedHeight: z.number(),
	rotation: z.number(),
	// Older binaries cut at the keyframe and had no lead.
	leadUs: z.number().default(0),
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

/**
 * The size the video goes out at: 720×1280 when it's turned upright, else
 * its own (as shown) scaled down to fit 720×1280, in even pixels as H.264
 * wants them.
 */
function outputSize(edit: VideoEdit): { width: number; height: number } {
	if (edit.portrait) return { width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT };
	const scale = Math.min(1, OUTPUT_WIDTH / edit.width, OUTPUT_HEIGHT / edit.height);
	const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
	return { width: even(edit.width), height: even(edit.height) };
}

async function pickEncoderConfig(width: number, height: number): Promise<VideoEncoderConfig | null> {
	for (const codec of ENCODER_CODECS) {
		const config: VideoEncoderConfig = {
			codec,
			width,
			height,
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
 * Draws `frame` turned upright onto the `width`×`height` canvas: fitted on
 * black (`pad`, or no `portrait` at all), or scaled to the full height and
 * shifted so the picked 9:16 frame fills it (`crop`). Rotating around the
 * frame's center keeps both independent of it.
 */
function drawPortrait(
	context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
	frame: CanvasImageSource,
	frameWidth: number,
	frameHeight: number,
	rotation: number,
	portrait: PortraitMode | null,
	width = OUTPUT_WIDTH,
	height = OUTPUT_HEIGHT,
) {
	const sideways = rotation === 90 || rotation === 270;
	const shownWidth = sideways ? frameHeight : frameWidth;
	const shownHeight = sideways ? frameWidth : frameHeight;
	let scale = Math.min(width / shownWidth, height / shownHeight);
	let centerX = width / 2;
	if (portrait?.mode === "crop") {
		scale = height / shownHeight;
		const cropWidth = Math.min(shownWidth, (shownHeight * 9) / 16);
		const cropCenter = Math.min(Math.max(portrait.left, 0), 1) * shownWidth + cropWidth / 2;
		centerX = width / 2 + (shownWidth / 2 - Math.min(cropCenter, shownWidth - cropWidth / 2)) * scale;
	}
	context.fillStyle = "#000";
	context.fillRect(0, 0, width, height);
	context.save();
	context.translate(centerX, height / 2);
	context.rotate((rotation * Math.PI) / 180);
	const drawnWidth = frameWidth * scale;
	const drawnHeight = frameHeight * scale;
	context.drawImage(frame, -drawnWidth / 2, -drawnHeight / 2, drawnWidth, drawnHeight);
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

function makeCanvas(width: number, height: number): {
	canvas: OffscreenCanvas | HTMLCanvasElement;
	context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
} | null {
	if (typeof OffscreenCanvas !== "undefined") {
		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext("2d");
		return context ? { canvas, context } : null;
	}
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	return context ? { canvas, context } : null;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 4));

/** Whether this webview can encode AAC (Linux' WebKit, for one, can't). */
async function aacConfig(channels: number): Promise<AudioEncoderConfig | null> {
	if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return null;
	const config: AudioEncoderConfig = {
		codec: AUDIO_CODEC,
		sampleRate: AUDIO_SAMPLE_RATE,
		numberOfChannels: channels,
		bitrate: AUDIO_BITRATE,
	};
	const support = await AudioEncoder.isConfigSupported(config).catch(() => null);
	return support?.supported ? config : null;
}

/** The file's sound, decoded at 48 kHz; null when it has none the engine plays. */
async function decodeSound(file: File): Promise<AudioBuffer | null> {
	if (file.size > MAX_AUDIO_SOURCE_BYTES || typeof OfflineAudioContext === "undefined") return null;
	try {
		const context = new OfflineAudioContext(1, 1, AUDIO_SAMPLE_RATE);
		return await context.decodeAudioData(await file.arrayBuffer());
	} catch {
		return null;
	}
}

/**
 * The picked part of the file's sound as AAC-LC frames (at most stereo),
 * with their bytes; null when there's no sound or no AAC encoder.
 */
async function encodeSound(
	file: File,
	edit: VideoEdit,
): Promise<{ audio: Omit<ReencodedAudio, "config"> & { config: Uint8Array }; data: Uint8Array[] } | null> {
	const sound = await decodeSound(file);
	if (!sound || sound.length === 0) return null;
	const channels = Math.min(sound.numberOfChannels, 2);
	const config = await aacConfig(channels);
	if (!config) return null;

	const from = Math.min(sound.length, Math.round((edit.startMs / 1000) * sound.sampleRate));
	const to = Math.min(sound.length, from + Math.round((edit.maxMs / 1000) * sound.sampleRate));
	if (to <= from) return null;

	let failure: unknown = null;
	let description: Uint8Array | null = null;
	const chunks: ReencodedAudio["chunks"] = [];
	const data: Uint8Array[] = [];
	const encoder = new AudioEncoder({
		output: (chunk, metadata) => {
			const bytes = new Uint8Array(chunk.byteLength);
			chunk.copyTo(bytes);
			const config = metadata?.decoderConfig?.description;
			if (config && !description) description = toBytes(config);
			chunks.push({ size: bytes.length, timestampUs: chunk.timestamp, key: true });
			data.push(bytes);
		},
		error: (error) => {
			failure ??= error;
		},
	});
	try {
		encoder.configure(config);
		const planes = Array.from({ length: channels }, (_, channel) => sound.getChannelData(channel));
		for (let at = from; at < to && !failure; at += AUDIO_BLOCK) {
			const frames = Math.min(AUDIO_BLOCK, to - at);
			const block = new Float32Array(frames * channels);
			planes.forEach((plane, channel) => block.set(plane.subarray(at, at + frames), channel * frames));
			const audioData = new AudioData({
				format: "f32-planar",
				sampleRate: sound.sampleRate,
				numberOfFrames: frames,
				numberOfChannels: channels,
				timestamp: Math.round(((at - from) / sound.sampleRate) * 1_000_000),
				data: block,
			});
			encoder.encode(audioData);
			audioData.close();
			while (!failure && encoder.encodeQueueSize > MAX_QUEUED) await settle();
		}
		await encoder.flush();
		if (failure) throw failure;
	} catch (error) {
		appLog.warn("[videoReencode] sound not re-encoded", error);
		return null;
	} finally {
		if (encoder.state !== "closed") encoder.close();
	}
	// Set in the encoder's callback, which TypeScript doesn't follow.
	const specificConfig = description as Uint8Array | null;
	if (!specificConfig || chunks.length === 0) return null;
	return { audio: { sampleRate: AUDIO_SAMPLE_RATE, channels, config: specificConfig, chunks }, data };
}

/**
 * Re-encodes the edit's part of the staged video to H.264 (720×1280 upright
 * for a landscape one, else its own size up to that) and its sound to AAC,
 * staged for upload_staged_*_video. `file` is the same video, for its sound.
 * Throws ReencodeUnsupportedError when this device can't decode or encode
 * the picture.
 */
export async function reencodeVideo(
	stagedId: string,
	file: File,
	edit: VideoEdit,
	onProgress?: (fraction: number) => void,
): Promise<ReencodedVideo> {
	if (!canReencode()) throw new ReencodeUnsupportedError("no WebCodecs");
	const first = await readBatch(stagedId, edit, 0);
	if (!first) throw new ReencodeUnsupportedError("codec not supported");
	const decoderConfig: VideoDecoderConfig = {
		codec: first.codec,
		...(first.description.length > 0 ? { description: first.description } : {}),
		codedWidth: first.codedWidth,
		codedHeight: first.codedHeight,
	};
	const decodable = await VideoDecoder.isConfigSupported(decoderConfig).catch(() => null);
	if (!decodable?.supported) throw new ReencodeUnsupportedError(`can't decode ${first.codec}`);
	const size = outputSize(edit);
	const encoderConfig = await pickEncoderConfig(size.width, size.height);
	if (!encoderConfig) throw new ReencodeUnsupportedError("no H.264 encoder");
	const drawing = makeCanvas(size.width, size.height);
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
	const stage = (data: Uint8Array) => {
		pending.push(data);
		pendingBytes += data.length;
		if (pendingBytes >= FLUSH_BYTES) flushPending();
	};

	const encoder = new VideoEncoder({
		output: (chunk, metadata) => {
			const data = new Uint8Array(chunk.byteLength);
			chunk.copyTo(data);
			const description = metadata?.decoderConfig?.description;
			if (description && !avcc) avcc = toBytes(description);
			chunks.push({ size: data.length, timestampUs: chunk.timestamp, key: chunk.type === "key" });
			stage(data);
		},
		error: (error) => {
			failure ??= error;
		},
	});
	encoder.configure(encoderConfig);

	// Only the picked part is kept, timed from its start; the frames before
	// it are decoded just to get there.
	const keepFrom = first.leadUs;
	const keepUntil = first.leadUs + edit.maxMs * 1000;
	let lastKeyUs = Number.NEGATIVE_INFINITY;
	const decoder = new VideoDecoder({
		output: (frame) => {
			try {
				if (frame.timestamp < keepFrom || frame.timestamp >= keepUntil) return;
				const timestamp = frame.timestamp - keepFrom;
				drawPortrait(
					drawing.context,
					frame,
					frame.displayWidth,
					frame.displayHeight,
					first.rotation,
					edit.portrait,
					size.width,
					size.height,
				);
				const drawn = new VideoFrame(drawing.canvas, {
					timestamp,
					...(frame.duration != null ? { duration: frame.duration } : {}),
				});
				const keyFrame = timestamp - lastKeyUs >= KEYFRAME_EVERY_US;
				if (keyFrame) lastKeyUs = timestamp;
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
		// The sound is decoded while the picture is; both are staged once done.
		const sound = encodeSound(file, edit);
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
		if (!avcc || chunks.length === 0) throw new ReencodeUnsupportedError("the encoder produced nothing");
		const encodedSound = await sound;
		if (encodedSound) encodedSound.data.forEach(stage);
		else appLog.warn("[videoReencode] sound kept as it is (or there is none)");
		flushPending();
		await writes;
		return {
			stagedId: outputId,
			width: size.width,
			height: size.height,
			avcc: bytesToBase64(avcc),
			chunks,
			audio: encodedSound
				? { ...encodedSound.audio, config: bytesToBase64(encodedSound.audio.config) }
				: null,
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

// What a file carries besides its media (headers, sample tables), on top.
const CONTAINER_OVERHEAD = 64 * 1024;

/**
 * About how large the upload of `file` with `edit` will be, before any of it
 * is made: a re-encoding at its bitrates (with some room), a lossless cut
 * from the media bytes Rust counted per second (see TrimPoints), from its
 * keyframe on. Whole seconds make it a little generous, never short.
 */
export function estimateUploadBytes(points: TrimPoints, edit: VideoEdit | null, fileSize: number): number {
	if (!edit) return fileSize;
	if ((edit.portrait || edit.transcode) && canReencode()) {
		const seconds = edit.maxMs / 1000;
		return Math.round(((BITRATE + AUDIO_BITRATE) / 8) * seconds * 1.05) + CONTAINER_OVERHEAD;
	}
	const index = points.bytesBySecond;
	if (index.length < 2) {
		return Math.round(fileSize * Math.min(1, edit.maxMs / Math.max(1, points.durationMs)));
	}
	const keyframe = points.keyframesMs.reduce((latest, at) => (at <= edit.startMs ? at : latest), 0);
	const from = Math.min(index.length - 1, Math.floor(keyframe / 1000));
	const to = Math.min(index.length - 1, Math.ceil((edit.startMs + edit.maxMs) / 1000));
	return Math.round((index[to] - index[from]) * 1.01) + CONTAINER_OVERHEAD;
}

/**
 * Throws `tooLargeMessage` (as an ApiFunctionError, shown as it is) when the
 * upload would come out over `maxBytes`, so it's refused before anything is
 * staged or sent.
 */
export async function assertUploadFits(
	file: File,
	edit: VideoEdit | null | undefined,
	maxBytes: number,
	tooLargeMessage: string,
): Promise<void> {
	const points = await loadTrimPoints(file);
	const estimate = points ? estimateUploadBytes(points, edit ?? null, file.size) : file.size;
	if (estimate > maxBytes) throw new ApiFunctionError(tooLargeMessage, 413, null);
}

/**
 * Turns an upload's phases into one percentage for `onProgress`: each phase
 * takes its share of the scale (re-encoding a large one, when the video is
 * re-encoded at all), and never goes backwards. `channel()` is what
 * upload_staged_*_video takes as `onProgress`, for its writing and sending.
 */
export function uploadProgressReporter(
	edit: VideoEdit | null | undefined,
	onProgress?: (progress: UploadProgress) => void,
) {
	const converts = !!edit && (edit.portrait !== null || edit.transcode) && canReencode();
	const bands: Record<UploadPhase, [number, number]> = converts
		? { preparing: [0, 8], converting: [8, 55], finishing: [55, 60], uploading: [60, 99] }
		: { preparing: [0, 15], converting: [15, 15], finishing: [15, 20], uploading: [20, 99] };
	let shown = 0;
	const report = (phase: UploadPhase, fraction: number) => {
		const [from, to] = bands[phase];
		shown = Math.max(shown, from + (to - from) * Math.min(1, Math.max(0, fraction)));
		onProgress?.({ phase, percent: shown });
	};
	report.channel = () => {
		const channel = new Channel<{ phase: "editing" | "uploading"; sent: number; total: number }>();
		channel.onmessage = (message) => {
			if (message.phase === "editing") report("finishing", 0.5);
			else report("uploading", message.total > 0 ? message.sent / message.total : 0);
		};
		return channel;
	};
	return report;
}

/** What upload_staged_*_video takes as `edit`. */
export interface StagedEdit {
	startMs: number;
	maxMs: number;
	reencoded: ReencodedVideo | null;
}

/**
 * A video this device can neither re-encode nor send as it is (Matroska);
 * an ApiFunctionError so the upload passes its message on as it is.
 */
export class VideoNotSendableError extends ApiFunctionError {
	constructor(message: string) {
		super(message, 0, null);
		this.name = "VideoNotSendableError";
	}
}

/**
 * Turns `edit` into the upload's cut, re-encoding the staged video first
 * when it's landscape or not H.264 with AAC. Where this device can't, an MP4
 * goes on as it is (`onLandscapeKept` runs for a landscape one), and a
 * Matroska file can't go at all (VideoNotSendableError with
 * `notSendableMessage`). Null when nothing needs cutting.
 */
export async function stagedEdit(
	stagedId: string,
	file: File,
	edit: VideoEdit | null | undefined,
	options: {
		onLandscapeKept?: () => void;
		notSendableMessage: string;
		/** How far the re-encoding is, 0…1. */
		onConverting?: (fraction: number) => void;
	},
): Promise<StagedEdit | null> {
	if (!edit) return null;
	let reencoded: ReencodedVideo | null = null;
	if (edit.portrait || edit.transcode) {
		try {
			options.onConverting?.(0);
			reencoded = await reencodeVideo(stagedId, file, edit, options.onConverting);
		} catch (error) {
			if (!(error instanceof ReencodeUnsupportedError)) throw error;
			if (edit.matroska) throw new VideoNotSendableError(options.notSendableMessage);
			appLog.warn("[videoReencode] video sent as it is", error);
			if (edit.portrait) options.onLandscapeKept?.();
		}
	}
	return edit.trim || reencoded ? { startMs: edit.startMs, maxMs: edit.maxMs, reencoded } : null;
}
