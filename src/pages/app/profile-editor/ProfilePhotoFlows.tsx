import { useTranslation } from "react-i18next";
import { useDesktopBreakpoint } from "../../../hooks/useDesktopBreakpoint";
import { MediaEditSheet } from "../chat/MediaEditSheet";
import { ProfilePictureDrawer } from "./ProfilePictureDrawer";
import { MAX_PROFILE_PHOTOS } from "./profileEditorUtils";
import type { ProfileEditorState } from "./useProfileEditor";

/** The sheets behind the photo slots: the picture pool drawer and, once a
 * file is picked there, the edit sheet every upload goes through — here
 * with the profile's second step, the square thumbnail. */
export function ProfilePhotoFlows({ photos }: { photos: ProfileEditorState["photos"] }) {
	const { t } = useTranslation();
	const isDesktop = useDesktopBreakpoint();

	return (
		<>
			{photos.pendingFile ? (
				<MediaEditSheet
					files={[photos.pendingFile]}
					photoLabel={t("profile_editor.photo_upload.title")}
					videoLabel={t("profile_editor.photo_upload.title")}
					confirmLabel={t("profile_editor.photo_upload.confirm")}
					showLooping={false}
					thumbnailStep={{
						editHint: t("profile_editor.photo_upload.crop_hint", { defaultValue: "Crop your photo" }),
						thumbnailHint: t("profile_editor.photo_upload.thumbnail_hint", { defaultValue: "Choose the thumbnail shown in the grid" }),
						backLabel: t("profile_editor.photo_upload.back", { defaultValue: "Back" }),
					}}
					isDesktop={isDesktop}
					onConfirmFile={photos.setPendingEdit}
					onDone={photos.finishPendingEdit}
				/>
			) : null}
			{photos.isDrawerOpen && !photos.pendingFile ? (
				<ProfilePictureDrawer
					images={photos.poolImages}
					isLoading={photos.isPoolLoading}
					error={photos.poolError}
					onRetry={() => void photos.loadPoolImages()}
					usedHashes={photos.hashes}
					remainingSlots={Math.max(0, MAX_PROFILE_PHOTOS - photos.hashes.length)}
					isSelecting={photos.isSaving}
					onAddSelectedImages={photos.handleAddSelectedImages}
					deletingHash={photos.deletingPoolHash}
					onDeleteImage={photos.handleDeletePoolImage}
					onUploadFile={photos.handleDrawerUploadFile}
					uploadTiles={photos.uploadTiles}
					onClose={() => photos.setIsDrawerOpen(false)}
					closeRef={photos.drawerCloseRef}
					isDesktop={isDesktop}
				/>
			) : null}
		</>
	);
}
