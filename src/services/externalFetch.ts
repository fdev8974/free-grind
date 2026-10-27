import { invoke } from "@tauri-apps/api/core";
import { decode } from "@msgpack/msgpack";
import z from "zod";

/**
 * GETs a third-party URL the official app talks to (the GIPHY API) through
 * Rust's `fetch_external`: Grindr's TLS fingerprint and a bare OkHttp
 * client's headers instead of the WebView's. Only hosts grindr.rs allows
 * (Grindr CDNs, GIPHY) get through.
 */
export async function fetchExternal(url: string, range?: string): Promise<{ status: number; body: Uint8Array }> {
	const packed = await invoke("fetch_external", { url, ...(range && { range }) }).then((res) => {
		// Windows may hand back a plain number[] instead of an ArrayBuffer.
		if (res instanceof ArrayBuffer) return res;
		if (Array.isArray(res)) return new Uint8Array(res as number[]).buffer as ArrayBuffer;
		return z.instanceof(ArrayBuffer).parse(res);
	});
	return z.object({ status: z.number(), body: z.instanceof(Uint8Array) }).parse(decode(packed));
}

/** `encodeURIComponent` plus the `!'()~` OkHttp's query encoder escapes too. */
export function okHttpQueryComponent(value: string): string {
	return encodeURIComponent(value).replace(
		/[!'()~]/g,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}
