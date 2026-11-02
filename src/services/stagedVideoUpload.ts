/**
 * stagedVideoUpload.ts — uploads videos the way open-grind does
 * (src-tauri/src/upload): the picked File is staged into the app cache in
 * chunks, and Rust then streams it from there with its metadata stripped on
 * the way out. No copy of the whole video sits in the webview or in IPC, so
 * large videos go through. The upload's `length` comes from the file's own
 * header, in milliseconds.
 */

import { invoke } from "@tauri-apps/api/core";

import { ApiFunctionError, mediaUploadErrorToApiFunctionError } from "./apiHelpers";
import { mediaErrorCode, toUploadError } from "./uploadSanitize";

/** Open-grind's chat media cap, also enforced Rust-side (upload::video). */
export const MAX_CHAT_MEDIA_BYTES = 120 * 1024 * 1024;

const STAGE_CHUNK_BYTES = 4 * 1024 * 1024;
// String.fromCharCode takes its bytes as arguments, so convert in slices.
const BASE64_SLICE_BYTES = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += BASE64_SLICE_BYTES) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_SLICE_BYTES));
	}
	return btoa(binary);
}

// Binaries from before streamed uploads can still receive this frontend over
// OTA, and Tauri then rejects the invoke with a plain "Command … not found".
function isMissingCommand(error: unknown): boolean {
	return typeof error === "string" && /^Command stage_media not found/.test(error);
}

/** A new, empty staged file's id, or null when this binary can't stage files. */
export async function createStaged(): Promise<string | null> {
	try {
		return await invoke<string>("stage_media");
	} catch (error) {
		if (isMissingCommand(error)) return null;
		throw error;
	}
}

/** Appends `bytes` to a staged file, in IPC-sized chunks. */
export async function appendStaged(id: string, bytes: Uint8Array): Promise<void> {
	for (let offset = 0; offset < bytes.length; offset += STAGE_CHUNK_BYTES) {
		const chunk = bytes.subarray(offset, offset + STAGE_CHUNK_BYTES);
		await invoke("append_staged_media", { id, chunk: bytesToBase64(chunk) });
	}
}

export async function discardStaged(id: string): Promise<void> {
	await invoke("discard_staged_media", { id }).catch(() => undefined);
}

/** The staged file's id, or null when this binary can't stage files. */
async function stageFile(file: File): Promise<string | null> {
	const id = await createStaged();
	if (id === null) return null;
	try {
		for (let offset = 0; offset < file.size; offset += STAGE_CHUNK_BYTES) {
			const chunk = await file.slice(offset, offset + STAGE_CHUNK_BYTES).arrayBuffer();
			await appendStaged(id, new Uint8Array(chunk));
		}
	} catch (error) {
		await discardStaged(id);
		throw error;
	}
	return id;
}

/**
 * Stages `file` and hands its id to `upload`, which invokes one of the
 * upload_staged_* commands; Rust discards the staged file once it has been
 * read, and it is discarded here too when `upload` fails before that.
 * Resolves to null when this binary predates streamed uploads, so the caller
 * can fall back to the in-memory path.
 */
export async function uploadStagedVideo<T>(
	file: File,
	upload: (stagedId: string) => Promise<T>,
	fallbackMessage: string,
	t: (key: string, options?: { defaultValue?: string }) => string,
): Promise<T | null> {
	let stagedId: string | null = null;
	try {
		stagedId = await stageFile(file);
		if (stagedId === null) return null;
		return await upload(stagedId);
	} catch (error) {
		if (stagedId !== null) await discardStaged(stagedId);
		if (error instanceof ApiFunctionError) throw error;
		if (mediaErrorCode(error) !== null) throw toUploadError(error);
		throw mediaUploadErrorToApiFunctionError(error, fallbackMessage, t);
	}
}
