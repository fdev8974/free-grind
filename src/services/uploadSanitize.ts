/**
 * uploadSanitize.ts — runs a picked photo/video through the Rust upload
 * normalization (src-tauri/src/media, ported from Open Grind) before it is
 * uploaded anywhere:
 * - photos leave as a metadata-free JPEG, upright, sRGB, at most 1024px on
 *   the long edge and ~1 MB — what the official Android client sends;
 * - videos keep their streams but lose EXIF-like boxes (GPS, device model,
 *   XMP, text/GPS tracks) and get the upload time as their timestamps.
 * Anything that isn't a photo or a video is refused instead of uploaded.
 */

import { decode } from "@msgpack/msgpack";
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

import i18n from "../i18n";
import { ApiFunctionError } from "./apiHelpers";

const sanitizedSchema = z.object({
	body: z.instanceof(Uint8Array),
	contentType: z.string(),
});

const MEDIA_ERROR_MESSAGES: Record<string, string> = {
	not_media: "Only photos and videos can be uploaded.",
	unreadable: "This photo can't be read. It may be damaged or in an unsupported format.",
	too_large: "This photo is too large to upload (max. 64 MB).",
	heic_unsupported: "HEIC photos aren't supported on this device. Please convert it to JPEG first.",
	video_unstrippable: "This video's metadata can't be removed safely, so it wasn't uploaded.",
};

function mediaErrorCode(error: unknown): string | null {
	if (error && typeof error === "object" && (error as { kind?: unknown }).kind === "Media") {
		const code = (error as { message?: unknown }).message;
		return typeof code === "string" ? code : null;
	}
	return null;
}

function toUploadError(error: unknown): ApiFunctionError {
	const code = mediaErrorCode(error);
	if (code && code in MEDIA_ERROR_MESSAGES) {
		const message = i18n.t(`api.errors.media_${code}`, { defaultValue: MEDIA_ERROR_MESSAGES[code] });
		return new ApiFunctionError(message, 0, error);
	}
	const message = error instanceof Error ? error.message : String(code ?? error);
	return new ApiFunctionError(message, 0, error);
}

async function sanitizeBytes(bytes: Uint8Array): Promise<{ body: Uint8Array; contentType: string }> {
	const packed = await invoke<ArrayBuffer | number[]>("sanitize_upload_media", bytes);
	// Tauri delivers ArrayBuffer on most platforms, a plain number[] on Windows.
	const buffer = packed instanceof ArrayBuffer ? packed : new Uint8Array(packed).buffer;
	return sanitizedSchema.parse(decode(buffer));
}

/**
 * Lets the webview decode what Rust can't (HEIC outside Android; WebKit on
 * Apple platforms handles it) and hands back a lossless PNG of it, already
 * upright. The PNG then goes through the normal pipeline.
 */
async function decodeInWebview(file: Blob): Promise<Uint8Array | null> {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		return null;
	}
	try {
		const canvas = document.createElement("canvas");
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		ctx.drawImage(bitmap, 0, 0);
		const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
		return png ? new Uint8Array(await png.arrayBuffer()) : null;
	} finally {
		bitmap.close();
	}
}

function renamed(name: string, contentType: string): string {
	const extension = contentType === "image/jpeg" ? "jpg" : contentType === "video/mp4" ? "mp4" : null;
	if (!extension) return name;
	const base = name.replace(/\.[^./]*$/, "") || "upload";
	return `${base}.${extension}`;
}

/** The normalized file to upload in place of `file`; throws an ApiFunctionError with a user-facing message. */
export async function sanitizeUploadFile(file: File): Promise<File> {
	let result: { body: Uint8Array; contentType: string };
	try {
		result = await sanitizeBytes(new Uint8Array(await file.arrayBuffer()));
	} catch (error) {
		if (mediaErrorCode(error) !== "heic_unsupported") throw toUploadError(error);
		const png = await decodeInWebview(file);
		if (!png) throw toUploadError(error);
		try {
			result = await sanitizeBytes(png);
		} catch (retryError) {
			throw toUploadError(retryError);
		}
	}
	// msgpack decodes into a view over a plain ArrayBuffer, never a shared one.
	return new File([result.body as Uint8Array<ArrayBuffer>], renamed(file.name, result.contentType), {
		type: result.contentType,
		lastModified: Date.now(),
	});
}
