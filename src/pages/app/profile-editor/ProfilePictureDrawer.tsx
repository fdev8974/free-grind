import { ImageIcon, Inbox, Loader2, Plus, Upload } from "lucide-react";
import { TriangleAlertFilled } from "../../../components/icons/FilledIcons";
import {
	DRAWER_PRIMARY_BUTTON_CLASS,
	DrawerActionButton,
	DrawerActionBar,
	DrawerBody,
	DrawerEmptyState,
	DrawerFooter,
	DrawerGrid,
	DrawerHeader,
	DrawerMediaPreview,
	DrawerMediaTile,
	useDrawerAddActions,
	useDrawerMediaPreview,
} from "../chat/drawerUi";
import { useCallback, useState, type MutableRefObject, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "../../../components/ui/bottom-sheet";
import { SheetActionList, afterSheetClose } from "../../../components/ui/action-sheet";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { getProfileImageUrl, getThumbImageUrl } from "../../../utils/media";
import { MEDIA_MODERATION_STATE } from "./profileEditorUtils";

export type ProfilePoolImage = {
	mediaHash: string;
	type: number;
	state: number | null;
};

interface ProfilePictureDrawerProps {
	images: ProfilePoolImage[];
	isLoading: boolean;
	error: string | null;
	onRetry: () => void;
	usedHashes: string[];
	remainingSlots: number;
	isSelecting: boolean;
	onAddSelectedImages: (hashes: string[]) => void | Promise<void>;
	deletingHash: string | null;
	onDeleteImage: (hash: string) => void | Promise<void>;
	onUploadFile: (file: File) => void;
	/** Set: "Add media" asks first, from the device or the chat drawer (like the album editor). */
	onAddFromDrawer?: () => void;
	/** Placeholder tiles of a running upload (see useUploadTiles). */
	uploadTiles?: ReactNode[];
	onClose: () => void;
	isDesktop: boolean;
	/** Animated close for the parent to call once adding photos succeeded. */
	closeRef?: MutableRefObject<(() => void) | null>;
}

export function ProfilePictureDrawer({
	images,
	isLoading,
	error,
	onRetry,
	usedHashes,
	remainingSlots,
	isSelecting,
	onAddSelectedImages,
	deletingHash,
	onDeleteImage,
	onUploadFile,
	uploadTiles = [],
	onAddFromDrawer,
	onClose,
	isDesktop,
	closeRef,
}: ProfilePictureDrawerProps) {
	const { t } = useTranslation();
	const [confirmDeleteHash, setConfirmDeleteHash] = useState<string | null>(null);
	const [selectedHashes, setSelectedHashes] = useState<Set<string>>(new Set());
	const { preview: imagePreview, bind: bindPreview, consumeClick: consumePreviewClick } = useDrawerMediaPreview();

	// Same take photo / upload actions as the other drawers; profile pictures
	// are photos only, one at a time (the editor's crop step follows).
	const onPickFiles = useCallback(
		(files: File[]) => {
			if (files[0]) onUploadFile(files[0]);
		},
		[onUploadFile],
	);
	const { actions: deviceActions, inputs: addInputs } = useDrawerAddActions({ onFiles: onPickFiles, allowVideo: false });
	// "Add media" picks from the device or the chat drawer; its device pick
	// stays the action's own, clicked from the choice synchronously so it
	// still counts as a user gesture.
	const [isAddChoiceOpen, setIsAddChoiceOpen] = useState(false);
	const uploadFromDevice = deviceActions.find((action) => action.key === "upload")?.onClick;
	const addActions = onAddFromDrawer
		? deviceActions.map((action) => (action.key === "upload" ? { ...action, onClick: () => setIsAddChoiceOpen(true) } : action))
		: deviceActions;

	const toggleSelection = useCallback(
		(hash: string) => {
			setSelectedHashes((prev) => {
				const next = new Set(prev);
				if (next.has(hash)) {
					next.delete(hash);
				} else {
					if (next.size >= remainingSlots) return prev;
					next.add(hash);
				}
				return next;
			});
		},
		[remainingSlots],
	);

	const handleAddSelected = useCallback(async () => {
		if (selectedHashes.size === 0) return;
		await onAddSelectedImages(Array.from(selectedHashes));
		setSelectedHashes(new Set());
	}, [selectedHashes, onAddSelectedImages]);

	const handleDeleteClick = useCallback((_event: React.MouseEvent<HTMLButtonElement>, hash: string) => {
		setConfirmDeleteHash(hash);
	}, []);

	const confirmDelete = useCallback(async () => {
		if (!confirmDeleteHash) return;
		await onDeleteImage(confirmDeleteHash);
		setSelectedHashes((prev) => {
			if (!prev.has(confirmDeleteHash)) return prev;
			const next = new Set(prev);
			next.delete(confirmDeleteHash);
			return next;
		});
		setConfirmDeleteHash(null);
	}, [confirmDeleteHash, onDeleteImage]);

	const cancelDelete = useCallback(() => {
		if (deletingHash != null) return;
		setConfirmDeleteHash(null);
	}, [deletingHash]);

	const usedSet = new Set(usedHashes);
	const visibleImages = images.filter((image) => !usedSet.has(image.mediaHash));
	const hasSelection = selectedHashes.size > 0;

	return (
		<>
			<BottomSheet
				// isProcessing blocks user closes while busy; onClose stays real for closeRef.
				onClose={onClose}
				closeRef={closeRef}
				isProcessing={isSelecting}
				expandable
				isDesktop={isDesktop}
				bg="bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]"
				panelClassName="px-4"
			>
				<DrawerHeader title={t("profile_photo_drawer.title")} description={t("profile_photo_drawer.description")} className="mb-3" />

				{addInputs}

				<div className="mb-3 flex items-center gap-3 rounded-2xl ink-tint-8 p-3">
					<div className="shrink-0 rounded-xl bg-amber-500/15 p-2 text-amber-400">
						<TriangleAlertFilled className="h-4 w-4" />
					</div>
					<p className="min-w-0 flex-1 text-xs leading-relaxed text-[var(--text-muted)]">
						{t("profile_photo_drawer.nudity_notice")}
					</p>
				</div>

				<DrawerBody
					isDesktop={isDesktop}
					isLoading={isLoading}
					error={error}
					onRetry={onRetry}
					retryLabel={t("profile_photo_drawer.retry")}
					empty={visibleImages.length === 0 && uploadTiles.length === 0 ? (
						<DrawerEmptyState
							icon={<ImageIcon className="h-5 w-5" />}
							title={t("profile_photo_drawer.empty")}
							hint={t("profile_photo_drawer.empty_hint", { defaultValue: "Take a photo or upload one from your device to add it to your profile." })}
						>
							<div className="grid w-full max-w-xs grid-cols-2 gap-2">
								{addActions.map((action) => (
									<DrawerActionButton key={action.key} icon={action.icon} label={action.label} onClick={action.onClick} disabled={isSelecting} />
								))}
							</div>
						</DrawerEmptyState>
					) : undefined}
				>
					<DrawerGrid isDesktop={isDesktop}>
						{/* Add actions as the grid's first row, like the chat drawer. */}
						<DrawerActionBar actions={addActions} disabled={isSelecting || hasSelection} />
						{uploadTiles}
						{visibleImages.map((image) => {
							const isPending = image.state === MEDIA_MODERATION_STATE.PENDING;
							const isRejected = image.state === MEDIA_MODERATION_STATE.REJECTED;
							const isDeleting = deletingHash === image.mediaHash;
							const isSelected = selectedHashes.has(image.mediaHash);
							// Once the selection has hit the number of free profile slots,
							// picking anything else would just be rejected by toggleSelection
							// — mute those tiles the same way the chat drawer dims media that
							// can't be added to the current selection (e.g. image/video mix).
							const isMutedByCapacity = !isSelected && selectedHashes.size >= remainingSlots;
							const isClickable = !isSelecting && !isDeleting && !isMutedByCapacity;
							const thumbUrl = getThumbImageUrl(image.mediaHash, "320x320");
							const statusLabel = isPending
								? t("profile_editor.sections.pictures.pending_moderation")
								: isRejected
									? t("profile_editor.sections.pictures.rejected")
									: null;

							return (
								<DrawerMediaTile
									key={image.mediaHash}
									src={thumbUrl}
									alt={t("profile_photo_drawer.image_alt")}
									mediaClassName={isRejected ? "opacity-50 grayscale" : ""}
									selected={isSelected}
									muted={isMutedByCapacity}
									busy={isSelecting || isDeleting}
									onSelect={isClickable ? () => toggleSelection(image.mediaHash) : undefined}
									// Hold to peek, like the other drawers: the full photo, the thumbnail until it loaded.
									previewProps={bindPreview({ src: getProfileImageUrl(image.mediaHash, "1024x1024"), isVideo: false, placeholderSrc: thumbUrl })}
									consumePreviewClick={consumePreviewClick}
									onDelete={(event) => handleDeleteClick(event, image.mediaHash)}
									isDeleting={isDeleting}
									deleteLabel={t("profile_photo_drawer.delete_image")}
								>
									{statusLabel ? (
										<span className="absolute bottom-1 right-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
											{statusLabel}
										</span>
									) : null}
								</DrawerMediaTile>
							);
						})}
					</DrawerGrid>
				</DrawerBody>

				{hasSelection ? (
					<DrawerFooter>
						<button
							type="button"
							onClick={() => void handleAddSelected()}
							disabled={isSelecting}
							className={DRAWER_PRIMARY_BUTTON_CLASS}
						>
							{isSelecting ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Plus className="h-4 w-4" />
							)}
							<span>
								{isSelecting
									? t("profile_photo_drawer.adding")
									: t("profile_photo_drawer.add_selected", { count: selectedHashes.size })}
							</span>
						</button>
					</DrawerFooter>
				) : null}

				<ConfirmDialog
					isOpen={confirmDeleteHash != null}
					title={t("profile_photo_drawer.delete_confirm_title")}
					message={t("profile_photo_drawer.delete_confirm_message")}
					confirmLabel={t("profile_photo_drawer.delete_confirm_label")}
					cancelLabel={t("chat.actions.cancel")}
					onConfirm={confirmDelete}
					onCancel={cancelDelete}
					isProcessing={confirmDeleteHash != null && deletingHash === confirmDeleteHash}
					confirmTone="danger"
				/>
				<DrawerMediaPreview media={imagePreview} />
			</BottomSheet>

			{isAddChoiceOpen && onAddFromDrawer && (
				<SheetActionList
					title={t("chat_drawer.add_media", { defaultValue: "Add media" })}
					onClose={() => setIsAddChoiceOpen(false)}
					isDesktop={isDesktop}
					actions={[
						{
							key: "upload",
							icon: Upload,
							iconClassName: "bg-sky-500/15 text-sky-400",
							label: t("settings_albums.add_upload", { defaultValue: "Upload from device" }),
							description: t("profile_photo_drawer.add_upload_desc", { defaultValue: "Photos stored on this device" }),
							onSelect: () => uploadFromDevice?.(),
						},
						{
							key: "drawer",
							icon: Inbox,
							iconClassName: "bg-violet-500/15 text-violet-400",
							label: t("settings_albums.add_from_drawer", { defaultValue: "Add from Drawer" }),
							description: t("profile_photo_drawer.add_drawer_desc", { defaultValue: "Photos saved in your chat drawer" }),
							// Once this sheet has popped its history entry.
							onSelect: () => afterSheetClose(onAddFromDrawer),
						},
					]}
				/>
			)}
		</>
	);
}
