// Direct Spotify Web API client. Talks to accounts.spotify.com / api.spotify.com
// via the Tauri HTTP plugin (same reason as mediaStore/saveMedia: bypasses the
// webview's CORS, which the Spotify token endpoint does not allow).
//
// Uses the Client Credentials grant — that's enough for the public catalogue
// endpoints we need (GET /v1/tracks). No user login / Authorization Code flow.
import { fetch } from "@tauri-apps/plugin-http";
import {
	SPOTIFY_API_BASE,
	SPOTIFY_CLIENT_ID,
	SPOTIFY_CLIENT_SECRET,
	SPOTIFY_TOKEN_URL,
	SPOTIFY_TRACKS_BATCH_SIZE,
} from "../config/spotify-config";
import { appLog } from "../utils/logger";

export type SpotifyTrack = {
	id: string;
	name: string;
	artists: string[];
	albumName: string | null;
	/** Smallest album cover that's still usable as a thumbnail, or null. */
	albumImageUrl: string | null;
	/** 30s preview mp3, when Spotify provides one. */
	previewUrl: string | null;
	/** Opens the track in the Spotify app / web player. */
	externalUrl: string | null;
	durationMs: number | null;
};

type CachedToken = { accessToken: string; expiresAt: number };

let cachedToken: CachedToken | null = null;
let tokenInFlight: Promise<string> | null = null;

// Resolved tracks are immutable catalogue data — cache them for the session so
// re-opening a profile (or two profiles sharing a song) doesn't re-hit Spotify.
const trackCache = new Map<string, SpotifyTrack>();

function base64(input: string): string {
	// btoa is available in the webview; inputs are ASCII client id/secret.
	return btoa(input);
}

async function fetchAccessToken(): Promise<string> {
	if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
		throw new Error("Spotify credentials are not configured");
	}

	const response = await fetch(SPOTIFY_TOKEN_URL, {
		method: "POST",
		headers: {
			Authorization: `Basic ${base64(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`)}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: "grant_type=client_credentials",
	});

	if (!response.ok) {
		throw new Error(`Spotify token request failed (${response.status})`);
	}

	const payload = (await response.json()) as { access_token?: string; expires_in?: number };
	if (!payload.access_token) {
		throw new Error("Spotify token response had no access_token");
	}

	const expiresInMs = (payload.expires_in ?? 3600) * 1000;
	// Refresh a minute early to avoid using a token that expires mid-request.
	cachedToken = { accessToken: payload.access_token, expiresAt: Date.now() + expiresInMs - 60_000 };
	return payload.access_token;
}

async function getAccessToken(): Promise<string> {
	if (cachedToken && cachedToken.expiresAt > Date.now()) {
		return cachedToken.accessToken;
	}
	if (!tokenInFlight) {
		tokenInFlight = fetchAccessToken().finally(() => {
			tokenInFlight = null;
		});
	}
	return tokenInFlight;
}

function parseTrack(raw: unknown): SpotifyTrack | null {
	if (typeof raw !== "object" || raw === null) {
		return null;
	}
	const t = raw as {
		id?: unknown;
		name?: unknown;
		artists?: Array<{ name?: unknown }>;
		album?: { name?: unknown; images?: Array<{ url?: unknown }> };
		preview_url?: unknown;
		external_urls?: { spotify?: unknown };
		duration_ms?: unknown;
	};
	if (typeof t.id !== "string") {
		return null;
	}

	const artists = Array.isArray(t.artists)
		? t.artists.map((a) => (typeof a?.name === "string" ? a.name : null)).filter((n): n is string => !!n)
		: [];

	const images = Array.isArray(t.album?.images) ? t.album.images : [];
	// Spotify returns images largest-first; the last is the small thumbnail.
	const albumImageUrl =
		images.length > 0 && typeof images[images.length - 1]?.url === "string"
			? (images[images.length - 1].url as string)
			: null;

	return {
		id: t.id,
		name: typeof t.name === "string" ? t.name : t.id,
		artists,
		albumName: typeof t.album?.name === "string" ? t.album.name : null,
		albumImageUrl,
		previewUrl: typeof t.preview_url === "string" ? t.preview_url : null,
		externalUrl: typeof t.external_urls?.spotify === "string" ? t.external_urls.spotify : null,
		durationMs: typeof t.duration_ms === "number" ? t.duration_ms : null,
	};
}

async function fetchTrackBatch(ids: string[]): Promise<void> {
	const token = await getAccessToken();
	const query = new URLSearchParams({ ids: ids.join(",") });
	const response = await fetch(`${SPOTIFY_API_BASE}/tracks?${query.toString()}`, {
		method: "GET",
		headers: { Authorization: `Bearer ${token}` },
	});

	if (response.status === 401) {
		// Token went stale between mint and use — drop it so the retry re-mints.
		cachedToken = null;
	}
	if (!response.ok) {
		throw new Error(`Spotify tracks request failed (${response.status})`);
	}

	const payload = (await response.json()) as { tracks?: unknown[] };
	for (const raw of payload.tracks ?? []) {
		const track = parseTrack(raw);
		if (track) {
			trackCache.set(track.id, track);
		}
	}
}

/**
 * Resolves Spotify track metadata for the given track ids, preserving input
 * order and skipping ids Spotify can't resolve. Results are cached per session.
 */
export async function getSpotifyTracks(ids: string[]): Promise<SpotifyTrack[]> {
	const unique = Array.from(new Set(ids.filter((id) => id.trim().length > 0)));
	const missing = unique.filter((id) => !trackCache.has(id));

	for (let i = 0; i < missing.length; i += SPOTIFY_TRACKS_BATCH_SIZE) {
		const batch = missing.slice(i, i + SPOTIFY_TRACKS_BATCH_SIZE);
		try {
			await fetchTrackBatch(batch);
		} catch (error) {
			appLog.warn("[spotify] failed to fetch track batch", error);
			throw error;
		}
	}

	return ids
		.map((id) => trackCache.get(id))
		.filter((track): track is SpotifyTrack => track !== undefined);
}
