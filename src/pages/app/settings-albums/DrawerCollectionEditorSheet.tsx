import { Check, Loader2 } from "lucide-react";
import { CameraPlusFilled } from "../../../components/icons/FilledIcons";
import {
	DRAWER_PRIMARY_BUTTON_CLASS,
	DrawerActionTile,
	DrawerBody,
	DrawerFooter,
	DrawerGrid,
	DrawerHeader,
	DrawerMediaPreview,
	DrawerMediaTile,
	useDrawerMediaPreview,
} from "../chat/drawerUi";
import { useCallback, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { BottomSheet } from "../../../components/ui/bottom-sheet";
import { useApiFunctions } from "../../../hooks/useApiFunctions";
import * as chatDb from "../../../services/chatDb";
import type { StoredDrawerCollection } from "../../../services/chatDb";
import { getCachedMediaUri, getDrawerMediaKey } from "../../../services/mediaStore";
import { appLog } from "../../../utils/logger";
import type { DrawerMedia } from "../chat/ChatDrawerPanel";
import { buildBinaryUpload, getVideoDurationSeconds } from "../chat/chatUtils";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

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
	const service = useApiFunctions();
	const [name, setName] = useState(collection?.name ?? "");
	// Insertion order of the Set is the send order. Not filtered against the
	// drawer here — it may still be loading; missing ids are pruned on save.
	const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set(collection?.mediaIds ?? []));
	const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const uploadInputRef = useRef<HTMLInputElement | null>(null);
	const isUploading = uploadProgress != null;
	const isBusy = isUploading || isSaving;

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
	const onPickFiles = useCallback(
		async (event: ChangeEvent<HTMLInputElement>) => {
			const files = Array.from(event.target.files ?? []);
			event.target.value = "";
			const valid = files.filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"));
			if (valid.length < files.length) {
				toast.error(t("chat_drawer.invalid_file_type"));
			}
			if (valid.length === 0) return;

			const uploadedIds: number[] = [];
			setUploadProgress({ done: 0, total: valid.length });
			for (const [index, file] of valid.entries()) {
				const isVideo = file.type.startsWith("video/");
				if (file.size > MAX_UPLOAD_BYTES) {
					toast.error(t("chat.attachments.too_large"));
					setUploadProgress({ done: index + 1, total: valid.length });
					continue;
				}
				try {
					const durationSeconds = isVideo ? await getVideoDurationSeconds(file) : undefined;
					const uploaded = await service.uploadChatMedia({
						multipart: await buildBinaryUpload(file),
						options: {
							looping: false,
							takenOnGrindr: false,
							...(durationSeconds != null ? { durationSeconds } : {}),
						},
					});
					await service.addMediaToDrawer(uploaded.mediaId);
					uploadedIds.push(uploaded.mediaId);
				} catch (uploadError) {
					appLog.error("[DrawerCollectionEditorSheet] upload failed", uploadError);
					toast.error(
						uploadError instanceof Error ? uploadError.message : t("chat.errors.upload_media_failed"),
					);
				}
				setUploadProgress({ done: index + 1, total: valid.length });
			}

			try {
				if (uploadedIds.length > 0) await onReloadMedia();
			} finally {
				setSelectedIds((prev) => new Set([...prev, ...uploadedIds]));
				setUploadProgress(null);
			}
		},
		[service, onReloadMedia, t],
	);

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
		} catch (saveError) {
			appLog.error("[DrawerCollectionEditorSheet] failed to save collection", saveError);
			toast.error(t("settings_albums.collections_save_failed"));
		} finally {
			setIsSaving(false);
		}
	}, [name, selectedIds, orderedSelection, isLoading, error, collection, onSaved, t]);

	return (
		<BottomSheet
			onClose={isBusy ? () => {} : onClose}
			isProcessing={isBusy}
			isDesktop={isDesktop}
			bg="bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]"
			panelClassName="px-4"
		>
			<DrawerHeader title={collection ? t("settings_albums.collections_edit") : t("settings_albums.collections_new")} />

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

			<input type="file" ref={uploadInputRef} onChange={(e) => void onPickFiles(e)} accept="image/*,video/*" multiple className="hidden" />

			<DrawerBody
				className="max-h-[50vh]"
				isLoading={isLoading && media.length === 0}
				error={media.length === 0 ? error : null}
				onRetry={() => void onReloadMedia()}
			>
				<DrawerGrid isDesktop={isDesktop}>
					{/* Upload as the first tile, like the chat drawer. */}
					<DrawerActionTile
						icon={uploadProgress ? <Loader2 className="animate-spin" /> : <CameraPlusFilled />}
						label={uploadProgress
							? `${uploadProgress.done}/${uploadProgress.total}`
							: t("chat_drawer.upload_photo")}
						onClick={() => uploadInputRef.current?.click()}
						disabled={isBusy}
					/>
					{media.map((item) => {
						const isVideo = item.contentType.startsWith("video/");
						const position = orderedSelection.indexOf(item.id) + 1;
						const mediaSrc = getCachedMediaUri(getDrawerMediaKey(item.id)) ?? item.url;
						return (
							<DrawerMediaTile
								key={item.id}
								src={mediaSrc}
								isVideo={isVideo}
								alt={t("chat_drawer.media_alt")}
								selected={position > 0}
								selectedContent={<span className="text-lg font-bold text-white drop-shadow">{position}</span>}
								onSelect={isBusy ? undefined : () => toggleSelection(item.id)}
								previewProps={bindPreview({ src: mediaSrc, isVideo })}
								consumePreviewClick={consumePreviewClick}
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
			<DrawerMediaPreview media={drawerPreview} />
		</BottomSheet>
	);
}
