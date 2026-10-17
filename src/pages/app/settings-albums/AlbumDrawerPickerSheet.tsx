import { Loader2, Plus } from "lucide-react";
import { ImagesFilled } from "../../../components/icons/FilledIcons";
import {
	DRAWER_PRIMARY_BUTTON_CLASS,
	DrawerActionButton,
	DrawerActionTile,
	DrawerBody,
	DrawerEmptyState,
	DrawerFooter,
	DrawerGrid,
	DrawerHeader,
	DrawerMediaPreview,
	DrawerMediaTile,
	useDrawerMediaPreview,
} from "../chat/drawerUi";
import { useCallback, useState, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { BottomSheet } from "../../../components/ui/bottom-sheet";
import { getCachedMediaUri, getDrawerMediaKey } from "../../../services/mediaStore";
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
	remainingSlots: number;
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
	remainingSlots,
	isDesktop,
	closeRef,
}: AlbumDrawerPickerSheetProps) {
	const { t } = useTranslation();
	const { preview: drawerPreview, bind: bindPreview, consumeClick: consumePreviewClick } = useDrawerMediaPreview();
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

	const toggleSelection = useCallback((id: number) => {
		setSelectedIds((prev) => {
			if (prev.has(id)) {
				const next = new Set(prev);
				next.delete(id);
				return next;
			}
			if (prev.size >= remainingSlots) {
				toast.error(t("settings_albums.error_album_full", {
					defaultValue: "Album is full (max {{max}} items).",
					max: remainingSlots + prev.size,
				}));
				return prev;
			}
			const next = new Set(prev);
			next.add(id);
			return next;
		});
	}, [remainingSlots, t]);

	// New uploads land in the drawer and get picked right away, as far as
	// the album still has room.
	const reloadMedia = useCallback(async () => { await onLoadMedia(); }, [onLoadMedia]);
	const selectUploaded = useCallback((uploaded: { mediaId: number }[]) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			for (const { mediaId } of uploaded) {
				if (next.size >= remainingSlots) break;
				next.add(mediaId);
			}
			return next;
		});
	}, [remainingSlots]);
	// Videos too: the page uploads those to the album directly, since the
	// by-id endpoint doesn't add them (see SettingsAlbumsPage handleAddFromDrawer).
	const upload = useDrawerUploadQueue({ onReloadMedia: reloadMedia, onUploaded: selectUploaded });
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
				isLoading={isLoading && media.length === 0}
				error={media.length === 0 ? error : null}
				onRetry={() => void onLoadMedia()}
				empty={media.length === 0 ? (
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
					{/* Add actions as the first tiles, like the chat drawer. */}
					{upload.actions.map((action) => (
						<DrawerActionTile key={action.key} icon={action.icon} label={action.label} onClick={action.onClick} disabled={isBusy} />
					))}
					{media.map((item) => {
						const isVideo = item.contentType.startsWith("video/");
						const mediaSrc = getCachedMediaUri(getDrawerMediaKey(item.id)) ?? item.url;
						return (
							<DrawerMediaTile
								key={item.id}
								src={mediaSrc}
								isVideo={isVideo}
								takenOnGrindr={item.takenOnGrindr}
								alt={t("chat_drawer.media_alt")}
								selected={selectedIds.has(item.id)}
								onSelect={() => toggleSelection(item.id)}
								previewProps={bindPreview({ src: mediaSrc, isVideo })}
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
								? t("settings_albums.uploading")
								: `${t("settings_albums.add_to_album_button", { defaultValue: "Add to Album" })} (${selectedIds.size})`}
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
