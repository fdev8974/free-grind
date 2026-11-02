import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { afterSheetClose } from "../../../components/ui/action-sheet";
import { useDesktopBreakpoint } from "../../../hooks/useDesktopBreakpoint";
import { MediaEditSheet } from "../chat/MediaEditSheet";
import { AlbumDrawerPickerSheet } from "../settings-albums/AlbumDrawerPickerSheet";
import { downloadDrawerMedia, useOwnDrawerMedia } from "../settings-albums/useOwnDrawerMedia";
import { ProfilePictureDrawer } from "./ProfilePictureDrawer";
import { MAX_PROFILE_PHOTOS } from "./profileEditorUtils";
import type { ProfileEditorState } from "./useProfileEditor";

/** The sheets behind the photo slots: the picture pool drawer, the chat
 * drawer to add a photo from, and, once a file is picked, the edit sheet
 * every upload goes through — here with the profile's second step, the
 * square thumbnail. */
export function ProfilePhotoFlows({ photos }: { photos: ProfileEditorState["photos"] }) {
	const { t } = useTranslation();
	const isDesktop = useDesktopBreakpoint();

	// A photo from the chat drawer: loaded as a file, then edited and uploaded
	// like one from the device.
	const { drawerMedia, isLoadingDrawerMedia, drawerMediaError, loadDrawerMedia } = useOwnDrawerMedia();
	const [isDrawerPickerOpen, setIsDrawerPickerOpen] = useState(false);
	const [isLoadingDrawerPhoto, setIsLoadingDrawerPhoto] = useState(false);
	const drawerPickerCloseRef = useRef<(() => void) | null>(null);
	const openDrawerPicker = () => {
		setIsDrawerPickerOpen(true);
		// Force-refresh — media added to the drawer elsewhere would be missing otherwise.
		void loadDrawerMedia(true);
	};
	const editDrawerPhoto = async (mediaIds: number[]) => {
		const item = drawerMedia.find((media) => media.id === mediaIds[0]);
		if (!item) return;
		setIsLoadingDrawerPhoto(true);
		const file = await downloadDrawerMedia(item);
		setIsLoadingDrawerPhoto(false);
		if (!file) {
			toast.error(t("profile_editor.toasts.error_upload"));
			return;
		}
		// The edit sheet opens once the picker has popped its history entry —
		// opened right away, that pop would land on the edit sheet's and close it.
		drawerPickerCloseRef.current?.();
		afterSheetClose(() => photos.handleDrawerUploadFile(file));
	};

	return (
		<>
			{photos.isDrawerOpen ? (
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
					onAddFromDrawer={openDrawerPicker}
					uploadTiles={photos.uploadTiles}
					onClose={() => photos.setIsDrawerOpen(false)}
					closeRef={photos.drawerCloseRef}
					isDesktop={isDesktop}
				/>
			) : null}
			{/* Over the picture drawer: one photo at a time, as from the device. */}
			{isDrawerPickerOpen ? (
				<AlbumDrawerPickerSheet
					media={drawerMedia}
					isLoading={isLoadingDrawerMedia}
					error={drawerMediaError}
					onLoadMedia={() => loadDrawerMedia(true)}
					onClose={() => setIsDrawerPickerOpen(false)}
					onConfirm={editDrawerPhoto}
					closeRef={drawerPickerCloseRef}
					isSubmitting={isLoadingDrawerPhoto}
					// Picks the photo; adding it happens in the edit sheet that follows.
					confirmLabel={t("profile_editor.photo_upload.select_from_drawer", { defaultValue: "Select" })}
					submittingLabel={t("profile_editor.photo_upload.select_from_drawer", { defaultValue: "Select" })}
					allowVideo={false}
					remainingSlots={1}
					remainingVideoSlots={0}
					isDesktop={isDesktop}
				/>
			) : null}
			{/* Stacked over the drawer, which stays open underneath: closing this
			    goes back to it, and the upload shows there as a placeholder. */}
			{photos.pendingFile ? (
				<MediaEditSheet
					files={[photos.pendingFile]}
					photoLabel={t("profile_editor.photo_upload.title")}
					videoLabel={t("profile_editor.photo_upload.title")}
					confirmLabel={t("profile_editor.photo_upload.confirm")}
					showLooping={false}
					thumbnailStep={{
						title: t("profile_editor.photo_upload.thumbnail_title", { defaultValue: "Select Thumbnail" }),
						backLabel: t("profile_editor.photo_upload.back", { defaultValue: "Back" }),
					}}
					isDesktop={isDesktop}
					zIndex="z-[70]"
					onConfirmFile={photos.setPendingEdit}
					onDone={photos.finishPendingEdit}
				/>
			) : null}
		</>
	);
}
