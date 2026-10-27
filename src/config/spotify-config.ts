// Spotify Web API credentials. Follows the same env-var-with-fallback pattern
// as giphy-config.ts — override in a local .env with VITE_SPOTIFY_* so the
// baked-in defaults aren't the only thing shipping.
//
// Accepts either separate id/secret vars or a single "id:secret" API key
// (VITE_SPOTIFY_API_KEY), matching the credential format pasted into setup.

const apiKey = import.meta.env.VITE_SPOTIFY_API_KEY as string | undefined;
const [apiKeyId, apiKeySecret] = (apiKey ?? "9302e16d54b84b3e977dcf0ba54914e6:deab2de106024378a664f79f41a2e439").split(":");

export const SPOTIFY_CLIENT_ID =
	(import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined) ?? apiKeyId ?? "";

export const SPOTIFY_CLIENT_SECRET =
	(import.meta.env.VITE_SPOTIFY_CLIENT_SECRET as string | undefined) ?? apiKeySecret ?? "";

export const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
export const SPOTIFY_API_BASE = "https://api.spotify.com/v1";

// Spotify's /v1/tracks endpoint accepts at most 50 ids per request.
export const SPOTIFY_TRACKS_BATCH_SIZE = 50;
