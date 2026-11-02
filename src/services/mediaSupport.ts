/**
 * mediaSupport.ts — which video formats this device can send, found out at
 * runtime from what its engine actually does (WebView2 / Android WebView /
 * WKWebView / WebKitGTK, whose codecs on Linux come from the installed
 * GStreamer plugins). Sending works as videoEdit.ts / videoReencode.ts
 * describe: H.264 + AAC in MP4/MOV/3GP goes as it is, anything else is
 * re-encoded to H.264 + AAC where the codecs allow, else an MP4 goes
 * unconverted and a Matroska/WebM file can't go.
 */

/** How a format goes out: re-encoded/direct as wanted, unconverted, or not at all. */
export type SendSupport = "direct" | "converted" | "as_is" | "unsupported";

export interface FormatSupport {
	key: "h264" | "hevc" | "vp9" | "av1" | "matroska_h264" | "sound";
	send: SendSupport;
	/** Whether the editor can show it (preview, filmstrip). */
	preview: boolean;
}

export interface MediaSupport {
	formats: FormatSupport[];
	/** H.264 Baseline 720×1280 encoding, which turning landscape upright needs. */
	canEncodeH264: boolean;
	platform: "linux" | "macos" | "windows" | "android" | "ios" | "other";
}

const DECODE_TESTS = {
	h264: "avc1.640028",
	hevc: "hvc1.1.6.L93.B0",
	vp9: "vp09.00.10.08",
	av1: "av01.0.08M.08",
} as const;

async function canDecode(codec: string): Promise<boolean> {
	if (typeof VideoDecoder === "undefined") return false;
	const support = await VideoDecoder.isConfigSupported({ codec, codedWidth: 1280, codedHeight: 720 }).catch(() => null);
	return support?.supported === true;
}

async function canEncodeH264(): Promise<boolean> {
	if (typeof VideoEncoder === "undefined") return false;
	for (const codec of ["avc1.42E01F", "avc1.42001F", "avc1.4D401F"]) {
		const support = await VideoEncoder.isConfigSupported({ codec, width: 720, height: 1280, bitrate: 4_000_000 }).catch(
			() => null,
		);
		if (support?.supported) return true;
	}
	return false;
}

async function canEncodeAac(): Promise<boolean> {
	if (typeof AudioEncoder === "undefined") return false;
	const support = await AudioEncoder.isConfigSupported({
		codec: "mp4a.40.2",
		sampleRate: 48_000,
		numberOfChannels: 2,
		bitrate: 128_000,
	}).catch(() => null);
	return support?.supported === true;
}

function canPlay(type: string): boolean {
	return document.createElement("video").canPlayType(type) !== "";
}

function platform(): MediaSupport["platform"] {
	const agent = navigator.userAgent;
	if (/Android/i.test(agent)) return "android";
	if (/iPhone|iPad|iPod/i.test(agent)) return "ios";
	if (/Mac OS X/i.test(agent)) return "macos";
	if (/Windows/i.test(agent)) return "windows";
	if (/Linux/i.test(agent)) return "linux";
	return "other";
}

let cached: Promise<MediaSupport> | null = null;

/** What this device can do with each format; worked out once per session. */
export function loadMediaSupport(): Promise<MediaSupport> {
	cached ??= (async () => {
		const [h264, hevc, vp9, av1, encodeH264, encodeAac] = await Promise.all([
			canDecode(DECODE_TESTS.h264),
			canDecode(DECODE_TESTS.hevc),
			canDecode(DECODE_TESTS.vp9),
			canDecode(DECODE_TESTS.av1),
			canEncodeH264(),
			canEncodeAac(),
		]);
		const convert = (decodes: boolean, otherwise: SendSupport): SendSupport =>
			decodes && encodeH264 ? "converted" : otherwise;
		const formats: FormatSupport[] = [
			{
				key: "h264",
				send: "direct",
				preview: canPlay('video/mp4; codecs="avc1.42E01E"') || canPlay("video/quicktime"),
			},
			{ key: "hevc", send: convert(hevc, "as_is"), preview: canPlay('video/mp4; codecs="hvc1.1.6.L93.B0"') },
			{ key: "vp9", send: convert(vp9, "unsupported"), preview: canPlay('video/webm; codecs="vp9"') },
			{
				key: "av1",
				send: convert(av1, "unsupported"),
				preview: canPlay('video/webm; codecs="av01.0.08M.08"') || canPlay('video/mp4; codecs="av01.0.08M.08"'),
			},
			{
				key: "matroska_h264",
				send: convert(h264, "unsupported"),
				preview: canPlay("video/x-matroska") || canPlay('video/x-matroska; codecs="avc1.42E01E"'),
			},
			{ key: "sound", send: encodeAac ? "converted" : "as_is", preview: true },
		];
		return { formats, canEncodeH264: encodeH264, platform: platform() };
	})();
	return cached;
}
