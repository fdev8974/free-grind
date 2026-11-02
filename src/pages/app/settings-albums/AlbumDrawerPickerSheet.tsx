import { Loader2, Plus } from "lucide-react";
import { ImagesFilled } from "../../../components/icons/FilledIcons";
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
	DRAWER_TILE_LOADING,
	DrawerMediaTile,
	useDrawerMediaPreview,
} from "../chat/drawerUi";
import { useCallback, useMemo, useState, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "../../../components/ui/bottom-sheet";
import { getDrawerMediaKey, getDrawerMediaSrc } from "../../../services/mediaStore";
import type { DrawerMedia } from "../chat/ChatDrawerPanel";
import { useDrawerMediaDelete } from "../chat/useDrawerMediaDelete";
import { useDrawerUploadQueue } from "../chat/useDrawerUploadQueue";

interface AlbumDrawerPickerSheetProps {
	media: DrawerMedia[];
	isLoading: boolean;
	error: string | null;
	onLoadMedia: () => void | Promise<void>;
	onClose: () => void;
	onConfirm: (mediaIds: number[]) => void | Promise<void>;
	isSubmitting: boolean;
	/** Instead of "Add to Album (n)" on the confirm button. */
	confirmLabel?: string;
	/** Instead of "Uploading" on the confirm button while submitting. */
	submittingLabel?: string;
	/** False takes photos only: no video uploads into the drawer from here. */
	allowVideo?: boolean;
	/** Free items in the album; Infinity without a limit. */
	remainingSlots: number;
	/** Free videos in the album (the plan's videos per album); Infinity without a limit. */
	remainingVideoSlots: number;
	isDesktop: boolean;
	/** Animated close for the parent to call once the confirm action succeeded. */
	closeRef?: MutableRefObject<(() => void) | null>;
}

export function AlbumDrawerPickerSheet({
	media,
	isLoading,
	error,
	onLoadMedia,
	onClose,
	onConfirm,
	isSubmitting,
	confirmLabel,
	submittingLabel,
	allowVideo = true,
	remainingSlots,
	remainingVideoSlots,
	isDesktop,
	closeRef,
}: AlbumDrawerPickerSheetProps) {
	const { t } = useTranslation();
	const { preview: drawerPreview, bind: bindPreview, consumeClick: consumePreviewClick } = useDrawerMediaPreview();
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

	// What the album still has room for, given a selection: once that's used
	// up, the media it has no room for are muted (as the chat drawer mutes
	// what can't join its selection), so they can't be picked.
	const videoIds = useMemo(
		() => new Set(media.filter((item) => item.contentType.startsWith("video/")).map((item) => item.id)),
		[media],
	);
	const canAdd = useCallback(
		(selection: Set<number>, isVideo: boolean) =>
			selection.size < remainingSlots
			&& (!isVideo || [...selection].filter((id) => videoIds.has(id)).length < remainingVideoSlots),
		[remainingSlots, remainingVideoSlots, videoIds],
	);

	const toggleSelection = useCallback((id: number, isVideo: boolean) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else if (canAdd(prev, isVideo)) next.add(id);
			return next;
		});
	}, [canAdd]);

	// New uploads land in the drawer and get picked right away, as far as
	// the album still has room.
	const reloadMedia = useCallback(async () => { await onLoadMedia(); }, [onLoadMedia]);
	const selectUploaded = useCallback((uploaded: { mediaId: number; isVideo: boolean }[]) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			for (const { mediaId, isVideo } of uploaded) {
				if (canAdd(next, isVideo)) next.add(mediaId);
			}
			return next;
		});
	}, [canAdd]);
	// Videos too: the page uploads those to the album directly, since the
	// by-id endpoint doesn't add them (see AlbumEditorSheet handleAddFromDrawer).
	const upload = useDrawerUploadQueue({ onReloadMedia: reloadMedia, onUploaded: selectUploaded, allowVideo });
	const isBusy = upload.isUploading || isSubmitting;

	const removeDeleted = useCallback(async (mediaId: number) => {
		setSelectedIds((prev) => {
			if (!prev.has(mediaId)) return prev;
			const next = new Set(prev);
			next.delete(mediaId);
			return next;
		});
		await onLoadMedia();
	}, [onLoadMedia]);
	const deletion = useDrawerMediaDelete({ onDeleted: removeDeleted });

	const handleConfirm = useCallback(async () => {
		if (selectedIds.size === 0) return;
		await onConfirm([...selectedIds]);
	}, [selectedIds, onConfirm]);

	return (
		<BottomSheet
			// isProcessing blocks user closes while busy; onClose stays real for closeRef.
			onClose={onClose}
			closeRef={closeRef}
			isProcessing={isBusy}
			// The add-media step (crop) needs its natural height.
			expandable={!upload.step}
			isDesktop={isDesktop}
			bg="bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]"
			panelClassName="px-4"
		>
			<DrawerHeader
				title={upload.stepTitle ?? t("settings_albums.drawer_picker_title", { defaultValue: "Select media" })}
				onClose={upload.step ? upload.stop : undefined}
			/>

			{upload.inputs}

			{upload.step ?? (
			<>
			<DrawerBody
				isDesktop={isDesktop}
				isLoading={isLoading && media.length === 0 && !upload.isUploading}
				error={media.length === 0 ? error : null}
				onRetry={() => void onLoadMedia()}
				empty={media.length === 0 && !upload.isUploading ? (
					<DrawerEmptyState
						icon={<ImagesFilled className="h-5 w-5" />}
						title={t("settings_albums.drawer_empty", { defaultValue: "No media in your drawer yet." })}
						hint={t("chat_drawer.empty_hint", { defaultValue: "Take a photo or video, or upload one from your device." })}
					>
						<div className="grid w-full max-w-sm grid-cols-3 gap-2">
							{upload.actions.map((action) => (
								<DrawerActionButton key={action.key} icon={action.icon} label={action.label} onClick={action.onClick} disabled={isBusy} />
							))}
						</div>
					</DrawerEmptyState>
				) : undefined}
			>
				<DrawerGrid isDesktop={isDesktop}>
					{/* Add actions as the grid's first row, like the chat drawer. */}
					<DrawerActionBar actions={upload.actions} disabled={isBusy} />
					{upload.uploadTiles}
					{media.map((item) => {
						const isVideo = item.contentType.startsWith("video/");
						const mediaSrc = getDrawerMediaSrc(item);
						const isSelected = selectedIds.has(item.id);
						return (
							<DrawerMediaTile
								key={item.id}
								src={mediaSrc ?? item.url}
								isVideo={isVideo}
								posterKey={getDrawerMediaKey(item.id)}
								placeholder={mediaSrc == null ? DRAWER_TILE_LOADING : undefined}
								takenOnGrindr={item.takenOnGrindr}
								alt={t("chat_drawer.media_alt")}
								selected={isSelected}
								muted={!isSelected && !canAdd(selectedIds, isVideo)}
								onSelect={() => toggleSelection(item.id, isVideo)}
								previewProps={bindPreview({ src: mediaSrc ?? item.url, isVideo })}
								consumePreviewClick={consumePreviewClick}
								busy={deletion.deletingId === item.id}
								// Hidden on selected tiles, like in the collection editor.
								onDelete={selectedIds.has(item.id) || isBusy ? undefined : () => deletion.requestDelete(item.id)}
								isDeleting={deletion.deletingId === item.id}
								deleteLabel={t("chat_drawer.delete_media")}
							/>
						);
					})}
				</DrawerGrid>
			</DrawerBody>

			{selectedIds.size > 0 ? (
				<DrawerFooter>
					<button
						type="button"
						onClick={() => void handleConfirm()}
						disabled={isSubmitting}
						className={DRAWER_PRIMARY_BUTTON_CLASS}
					>
						{isSubmitting ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Plus className="h-4 w-4" />
						)}
						<span>
							{isSubmitting
								? submittingLabel ?? t("settings_albums.uploading")
								: confirmLabel ?? `${t("settings_albums.add_to_album_button", { defaultValue: "Add to Album" })} (${selectedIds.size})`}
						</span>
					</button>
				</DrawerFooter>
			) : null}
			</>
			)}
			<DrawerMediaPreview media={drawerPreview} />
			{deletion.dialog}
		</BottomSheet>
	);
}
