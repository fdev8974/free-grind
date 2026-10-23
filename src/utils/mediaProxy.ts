import { convertFileSrc, isTauri } from "@tauri-apps/api/core";

/**
 * The Rust media proxy (src-tauri/src/media_proxy, ported from open-grind):
 * `<img>`/`<video>`/`<audio>` load Grindr CDN and GIPHY files through it, so
 * the CDN sees grindr.rs's TLS fingerprint and the official app's image
 * loader / MediaPlayer headers instead of the WebView's. It also caches,
 * collapses duplicate requests and streams video with range support.
 *
 * Only for element sources: the proxy sends no CORS headers, so `fetch()`
 * and canvas reads of a proxied URL fail — keep those on the original URL.
 */
const MEDIA_SCHEME = "fgmedia";

/** Which of the official app's HTTP stacks the fetch imitates. */
const FETCHER_TAG = { image: "i", video: "v" } as const;

export type ProxiedAs = keyof typeof FETCHER_TAG;

// grindr.rs's media allowlist; anything else would be refused by the proxy.
const GIPHY_HOSTS = new Set([
	"api.giphy.com",
	"media.giphy.com",
	"media0.giphy.com",
	"media1.giphy.com",
	"media2.giphy.com",
	"media3.giphy.com",
	"media4.giphy.com",
]);

function isProxiedHost(hostname: string): boolean {
	return hostname === "cdns.grindr.com" || hostname.endsWith(".cloudfront.net") || GIPHY_HOSTS.has(hostname);
}

function isProxiable(url: string): boolean {
	if (!url.startsWith("https://")) return false;
	try {
		return isProxiedHost(new URL(url).hostname);
	} catch {
		return false;
	}
}

function toBase64Url(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Set by the native side (media_proxy_flag in src-tauri/src/lib.rs) before
// any script runs; an OTA bundle on an older binary without the proxy
// doesn't see it and loads media directly.
const proxyAvailable = (() => {
	try {
		return isTauri() && (window as { __FG_MEDIA_PROXY__?: boolean }).__FG_MEDIA_PROXY__ === true;
	} catch {
		return false;
	}
})();

/**
 * The proxied form of a Grindr CDN / GIPHY url; anything else (data:, blob:,
 * bundled assets, other hosts, an already proxied url) comes back unchanged.
 * Pass `as: "video"` for video and audio, which the app plays through
 * MediaPlayer with its own headers.
 */
export function proxyMediaUrl(url: string, options?: { as?: ProxiedAs }): string;
export function proxyMediaUrl(url: string | null | undefined, options?: { as?: ProxiedAs }): string | null | undefined;
export function proxyMediaUrl(url: string | null | undefined, { as = "image" }: { as?: ProxiedAs } = {}): string | null | undefined {
	if (typeof url !== "string" || !proxyAvailable || !isProxiable(url)) return url;
	return convertFileSrc(`${FETCHER_TAG[as]}${toBase64Url(url)}`, MEDIA_SCHEME);
}
