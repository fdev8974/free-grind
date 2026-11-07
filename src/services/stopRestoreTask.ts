/**
 * Stops a background restore step for good (the stop button in the restore
 * status sheet): its runner quits at its next check (see
 * stoppableRestoreTask), and its queue is dropped so it doesn't resume on the
 * next start either. What's already restored stays as it is.
 */

import * as chatDb from "./chatDb";
import { dismissRestoredProfileDetails } from "./ownProfileDetails";
import { dismissRestoredProfilePhotos } from "./ownProfilePhotos";
import { discardRestoredDrawerMedia } from "./restoredDrawerMedia";
import { reportRestoreTask, requestRestoreTaskStop, type RestoreTaskId } from "./restoreStatus";

export async function stopRestoreTask(id: RestoreTaskId): Promise<void> {
	requestRestoreTaskStop(id);
	switch (id) {
		case "profile_details":
			await dismissRestoredProfileDetails();
			break;
		case "profile_photos":
			await dismissRestoredProfilePhotos();
			break;
		case "blocked_profiles":
			for (const profileId of await chatDb.listRestoredBlockedProfiles()) await chatDb.deleteRestoredBlockedProfile(profileId);
			break;
		case "favorites":
			for (const { profileId } of await chatDb.listRestoredFavoriteProfiles()) await chatDb.deleteRestoredFavoriteProfile(profileId);
			break;
		case "drawer_media":
			await discardRestoredDrawerMedia();
			break;
		case "own_albums":
			for (const { albumId } of await chatDb.listRestoredOwnAlbums()) await chatDb.deleteRestoredOwnAlbum(albumId);
			break;
	}
	reportRestoreTask(id, null);
}
