import { Check, Loader2 } from "lucide-react";
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
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { BottomSheet } from "../../../components/ui/bottom-sheet";
import * as chatDb from "../../../services/chatDb";
import type { StoredDrawerCollection } from "../../../services/chatDb";
import { getCachedMediaUri, getDrawerMediaKey } from "../../../services/mediaStore";
import { appLog } from "../../../utils/logger";
import type { DrawerMedia } from "../chat/ChatDrawerPanel";
import { useDrawerMediaDelete } from "../chat/useDrawerMediaDelete";
import { useDrawerUploadQueue } from "../chat/useDrawerUploadQueue";

interface DrawerCollectionEditorSheetProps {
	/** Null when creating a new collection. */
	collection: StoredDrawerCollection | null;
	media: DrawerMedia[];
	isLoading: boolean;
	error: string | null;
	/** Refetches the drawer, bypassing the page's already-loaded short-circuit. */
	onReloadMedia: () => Promise<void>;
	onClose: () => void;
	onSaved: (collections: StoredDrawerCollection[]) => void;
	isDesktop: boolean;
}

export function DrawerCollectionEditorSheet({
	collection,
	media,
	isLoading,
	error,
	onReloadMedia,
	onClose,
	onSaved,
	isDesktop,
}: DrawerCollectionEditorSheetProps) {
	const { t } = useTranslation();
	const { preview: drawerPreview, bind: bindPreview, consumeClick: consumePreviewClick } = useDrawerMediaPreview();
	const [name, setName] = useState(collection?.name ?? "");
	// Insertion order of the Set is the send order. Not filtered against the
	// drawer here — it may still be loading; missing ids are pruned on save.
	const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set(collection?.mediaIds ?? []));
	const [isSaving, setIsSaving] = useState(false);

	// Only ids still in the drawer — a collection can outlive some of its media.
	const orderedSelection = Array.from(selectedIds).filter((id) => media.some((m) => m.id === id));

	const toggleSelection = useCallback((id: number) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	// New uploads land in the drawer (collections only reference drawer
	// media) and get appended to the collection being edited.
	const appendUploaded = useCallback((uploaded: { mediaId: number }[]) => {
		setSelectedIds((prev) => new Set([...prev, ...uploaded.map((item) => item.mediaId)]));
	}, []);
	const upload = useDrawerUploadQueue({ onReloadMedia, onUploaded: appendUploaded });
	const isBusy = upload.isUploading || isSaving;

	// Deleting removes the media from the drawer itself, so every collection
	// using it loses it too (removed from them by useDrawerMediaDelete).
	const removeDeleted = useCallback(async (mediaId: number) => {
		setSelectedIds((prev) => {
			if (!prev.has(mediaId)) return prev;
			const next = new Set(prev);
			next.delete(mediaId);
			return next;
		});
		await onReloadMedia();
	}, [onReloadMedia]);
	const deletion = useDrawerMediaDelete({ onDeleted: removeDeleted });

	const sheetCloseRef = useRef<(() => void) | null>(null);
	const handleSave = useCallback(async () => {
		const trimmed = name.trim();
		// Prune deleted drawer media only when the drawer actually loaded, so a
		// failed fetch can't wipe a collection.
		const drawerLoaded = !isLoading && !error;
		const mediaIds = drawerLoaded ? orderedSelection : Array.from(selectedIds);
		if (!trimmed || mediaIds.length === 0) return;
		setIsSaving(true);
		try {
			const collections = await chatDb.upsertDrawerCollection({
				id: collection?.id ?? crypto.randomUUID(),
				name: trimmed,
				mediaIds,
			});
			onSaved(collections);
			sheetCloseRef.current?.();
		} catch (saveError) {
			appLog.error("[DrawerCollectionEditorSheet] failed to save collection", saveError);
			toast.error(t("settings_albums.collections_save_failed"));
		} finally {
			setIsSaving(false);
		}
	}, [name, selectedIds, orderedSelection, isLoading, error, collection, onSaved, t]);

	return (
		<BottomSheet
			// isProcessing blocks user closes while busy; onClose stays real so the
			// post-save close (sheetCloseRef) still unmounts.
			onClose={onClose}
			closeRef={sheetCloseRef}
			isProcessing={isBusy}
			isDesktop={isDesktop}
			bg="bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]"
			panelClassName="px-4"
		>
			<DrawerHeader
				title={upload.stepTitle ?? (collection ? t("settings_albums.collections_edit") : t("settings_albums.collections_new"))}
				onClose={upload.step ? upload.stop : undefined}
			/>

			{upload.inputs}

			{upload.step ?? (
			<>
			<input
				type="text"
				value={name}
				onChange={(e) => setName(e.target.value)}
				placeholder={t("settings_albums.collections_name_placeholder")}
				className="input-field mb-2 w-full !min-h-0 !py-2 !px-3 text-sm"
				maxLength={100}
				disabled={isBusy}
			/>
			<p className="mb-3 text-xs text-[var(--text-muted)]">{t("settings_albums.collections_editor_hint")}</p>

			<DrawerBody
				className="max-h-[50vh]"
				isLoading={isLoading && media.length === 0}
				error={media.length === 0 ? error : null}
				onRetry={() => void onReloadMedia()}
				empty={media.length === 0 ? (
					<DrawerEmptyState
						icon={<ImagesFilled className="h-5 w-5" />}
						title={t("chat_drawer.empty", { defaultValue: "Your drawer is empty." })}
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
						const position = orderedSelection.indexOf(item.id) + 1;
						const mediaSrc = getCachedMediaUri(getDrawerMediaKey(item.id)) ?? item.url;
						return (
							<DrawerMediaTile
								key={item.id}
								src={mediaSrc}
								isVideo={isVideo}
								takenOnGrindr={item.takenOnGrindr}
								alt={t("chat_drawer.media_alt")}
								selected={position > 0}
								selectedContent={<span className="text-lg font-bold text-white drop-shadow">{position}</span>}
								onSelect={isBusy ? undefined : () => toggleSelection(item.id)}
								previewProps={bindPreview({ src: mediaSrc, isVideo })}
								consumePreviewClick={consumePreviewClick}
								busy={deletion.deletingId === item.id}
								// Hidden on selected tiles, so it can't be hit while setting the order.
								onDelete={position > 0 || isBusy ? undefined : () => deletion.requestDelete(item.id)}
								isDeleting={deletion.deletingId === item.id}
								deleteLabel={t("chat_drawer.delete_media")}
							/>
						);
					})}
				</DrawerGrid>
			</DrawerBody>

			<DrawerFooter>
				<button
					type="button"
					onClick={() => void handleSave()}
					disabled={isBusy || !name.trim() || orderedSelection.length === 0}
					className={DRAWER_PRIMARY_BUTTON_CLASS}
				>
					{isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
					<span>{t("settings_albums.collections_save", { count: orderedSelection.length })}</span>
				</button>
			</DrawerFooter>
			</>
			)}
			<DrawerMediaPreview media={drawerPreview} />
			{deletion.dialog}
		</BottomSheet>
	);
}
