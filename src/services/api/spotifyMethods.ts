import type { RestFetcher } from "../../types/chat-service";
import { assertSuccess, parseJsonSafe } from "../apiHelpers";

export function createSpotifyMethods(fetchRest: RestFetcher, t: (key: string) => string) {
	return {
		/**
		 * Fetches the Spotify track ids a profile has pinned as favourites.
		 * (Backend endpoint is WIP — tolerate a missing/empty payload.)
		 */
		async getSpotifyFavoriteSongIds(profileId: string): Promise<string[]> {
			const response = await fetchRest(`/v4/spotify/favorites/${encodeURIComponent(profileId)}`);
			await assertSuccess(response, t("profile_details.spotify.load_failed"));
			const payload = await parseJsonSafe(response);

			if (typeof payload !== "object" || payload === null) {
				return [];
			}
			const songIds = (payload as { songIds?: unknown }).songIds;
			if (!Array.isArray(songIds)) {
				return [];
			}
			return songIds.filter((id): id is string => typeof id === "string");
		},
	};
}
