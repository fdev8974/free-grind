import { usePreferences } from "../contexts/PreferencesContext";

/** How a profile photo should be shown under the user's NSFW settings. */
export type ProfilePhotoPrivacy = "show" | "blur" | "hide";

/** Where the photo is shown: the Grid has its own blur toggle on top of the
 * app-wide ones; "off" opts out entirely (e.g. editing your own photos). */
export type ProfilePhotoPrivacyScope = "grid" | "app" | "off";

/** Blur for a photo inside an overflow-hidden box; the scale hides the
 * soft, see-through edge the blur leaves. */
export const PRIVACY_BLUR_CLASS = "blur-md scale-110";

/** Animates blurring and revealing. Keep it on the element whether or not it's
 * blurred — added only alongside the blur, the reveal would jump. */
export const PRIVACY_BLUR_TRANSITION_CLASS = "transition duration-300 ease-out";

/** Unblurs a blurred photo while it, or its `group/reveal` ancestor (a grid
 * tile, a list row, whose overlays may cover the photo), is hovered. Hover
 * variants only apply on devices with a real pointer, so touch screens keep
 * the blur. */
export const PRIVACY_HOVER_REVEAL_CLASS =
	"hover:blur-none hover:scale-100 group-hover/reveal:blur-none group-hover/reveal:scale-100";

/** The media blur settings in effect: safe-for-work mode blurs all of it,
 * whatever the single toggles say (the settings page hides them then). */
export function useMediaBlur(): { chat: boolean; album: boolean; rightNow: boolean } {
	const { hideProfilePictures, blurIncomingMedia, blurAlbumMedia, blurRightNowMedia } = usePreferences();
	return {
		chat: hideProfilePictures || blurIncomingMedia,
		album: hideProfilePictures || blurAlbumMedia,
		rightNow: hideProfilePictures || blurRightNowMedia,
	};
}

/** Safe-for-work mode (hide) wins over blur. */
export function useProfilePhotoPrivacy(scope: ProfilePhotoPrivacyScope = "app"): ProfilePhotoPrivacy {
	const { hideProfilePictures, blurProfilePictures, blurGridProfilePictures } = usePreferences();
	if (scope === "off") return "show";
	if (hideProfilePictures) return "hide";
	if (blurProfilePictures || (scope === "grid" && blurGridProfilePictures)) return "blur";
	return "show";
}
