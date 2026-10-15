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
	useDrawerAddActions,
	useDrawerMediaPreview,
} from "../chat/drawerUi";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { BottomSheet } from "../../../components/ui/bottom-sheet";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { useApiFunctions } from "../../../hooks/useApiFunctions";
import * as chatDb from "../../../services/chatDb";
import type { StoredDrawerCollection } from "../../../services/chatDb";
import { getCachedMediaUri, getDrawerMediaKey } from "../../../services/mediaStore";
import { appLog } from "../../../utils/logger";
import type { DrawerMedia } from "../chat/ChatDrawerPanel";
import { DrawerAddMediaStep } from "../chat/DrawerAddMediaStep";
import { buildBinaryUpload, getVideoDurationSeconds } from "../chat/chatUtils";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

type PreparedUpload = { file: File; takenOnGrindr: boolean; looping: boolean };

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
	// Files picked for upload still waiting for their add step, and the ones
	// already confirmed in this round.
	const [pendingFiles, setPendingFiles] = useState<File[]>([]);
	const [pendingTotal, setPendingTotal] = useState(0);
	const preparedRef = useRef<PreparedUpload[]>([]);
	const pendingFile = pendingFiles[0] ?? null;
	const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
	const [deletingId, setDeletingId] = useState<number | null>(null);
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
	const uploadPrepared = useCallback(
		async (batch: PreparedUpload[]) => {
			const uploadedIds: number[] = [];
			setUploadProgress({ done: 0, total: batch.length });
			for (const [index, { file, takenOnGrindr, looping }] of batch.entries()) {
				const isVideo = file.type.startsWith("video/");
				if (file.size > MAX_UPLOAD_BYTES) {
					toast.error(t("chat.attachments.too_large"));
					setUploadProgress({ done: index + 1, total: batch.length });
					continue;
				}
				try {
					const durationSeconds = isVideo ? await getVideoDurationSeconds(file) : undefined;
					const uploaded = await service.uploadChatMedia({
						multipart: await buildBinaryUpload(file),
						options: {
							looping: isVideo ? looping : false,
							takenOnGrindr: isVideo ? false : takenOnGrindr,
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
				setUploadProgress({ done: index + 1, total: batch.length });
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

	// Picked files go through the same add step as the chat drawer (crop,
	// taken on Grindr, looping), one after another, then upload together.
	const onPickFiles = useCallback(
		(files: File[]) => {
			const valid = files.filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"));
			if (valid.length < files.length) {
				toast.error(t("chat_drawer.invalid_file_type"));
			}
			if (valid.length === 0) return;
			preparedRef.current = [];
			setPendingFiles(valid);
			setPendingTotal(valid.length);
		},
		[t],
	);

	const { actions: addActions, inputs: addInputs } = useDrawerAddActions({
		onFiles: onPickFiles,
		multiple: true,
		busy: isUploading,
		uploadLabel: uploadProgress ? `${uploadProgress.done}/${uploadProgress.total}` : undefined,
	});

	// Moves to the next picked file; `prepared` is null when this one was skipped.
	// After the last one, everything confirmed so far is uploaded.
	const finishAddStep = useCallback(
		(prepared: PreparedUpload | null, stop = false) => {
			if (prepared) preparedRef.current.push(prepared);
			const rest = stop ? [] : pendingFiles.slice(1);
			setPendingFiles(rest);
			if (rest.length > 0) return;
			const batch = preparedRef.current;
			preparedRef.current = [];
			if (batch.length > 0) void uploadPrepared(batch);
		},
		[pendingFiles, uploadPrepared],
	);

	// Deleting removes the media from the drawer itself, so every collection
	// using it loses it too (collections skip missing ids).
	const confirmDeleteMedia = useCallback(async () => {
		if (confirmDeleteId == null) return;
		const mediaId = confirmDeleteId;
		setDeletingId(mediaId);
		try {
			await service.deleteDrawerMedia(mediaId);
			void chatDb.deleteMediaFile(getDrawerMediaKey(mediaId));
			setSelectedIds((prev) => {
				if (!prev.has(mediaId)) return prev;
				const next = new Set(prev);
				next.delete(mediaId);
				return next;
			});
			await onReloadMedia();
		} catch (deleteError) {
			appLog.error("[DrawerCollectionEditorSheet] failed to delete drawer media", deleteError);
			toast.error(deleteError instanceof Error ? deleteError.message : t("chat.errors.delete_failed"));
		} finally {
			setDeletingId(null);
			setConfirmDeleteId(null);
		}
	}, [confirmDeleteId, service, onReloadMedia, t]);

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
			<DrawerHeader
				title={pendingFile
					? `${pendingFile.type.startsWith("video/")
						? t("chat_drawer.add_video", { defaultValue: "Add video" })
						: t("chat_drawer.add_photo")}${pendingTotal > 1 ? ` (${pendingTotal - pendingFiles.length + 1}/${pendingTotal})` : ""}`
					: collection ? t("settings_albums.collections_edit") : t("settings_albums.collections_new")}
				// While adding files, X stops there: the rest is skipped, the ones already confirmed still upload.
				onClose={pendingFile ? () => finishAddStep(null, true) : undefined}
			/>

			{addInputs}

			{pendingFile ? (
				<DrawerAddMediaStep
					key={pendingTotal - pendingFiles.length}
					file={pendingFile}
					isAdding={false}
					onCancel={() => finishAddStep(null)}
					onConfirm={(file, takenOnGrindr, looping) => finishAddStep({ file, takenOnGrindr, looping })}
				/>
			) : (
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
							{addActions.map((action) => (
								<DrawerActionButton key={action.key} icon={action.icon} label={action.label} onClick={action.onClick} disabled={isBusy} />
							))}
						</div>
					</DrawerEmptyState>
				) : undefined}
			>
				<DrawerGrid isDesktop={isDesktop}>
					{/* Add actions as the first tiles, like the chat drawer. */}
					{addActions.map((action) => (
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
								alt={t("chat_drawer.media_alt")}
								selected={position > 0}
								selectedContent={<span className="text-lg font-bold text-white drop-shadow">{position}</span>}
								onSelect={isBusy ? undefined : () => toggleSelection(item.id)}
								previewProps={bindPreview({ src: mediaSrc, isVideo })}
								consumePreviewClick={consumePreviewClick}
								busy={deletingId === item.id}
								// Hidden on selected tiles, so it can't be hit while setting the order.
								onDelete={position > 0 || isBusy ? undefined : () => setConfirmDeleteId(item.id)}
								isDeleting={deletingId === item.id}
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
			<ConfirmDialog
				isOpen={confirmDeleteId != null}
				title={t("chat_drawer.delete_confirm_title")}
				message={t("settings_albums.collections_delete_media_message", { defaultValue: "This removes it from your drawer and from every collection that uses it." })}
				confirmLabel={t("chat_drawer.delete_confirm_label")}
				cancelLabel={t("chat.actions.cancel")}
				onConfirm={() => void confirmDeleteMedia()}
				onCancel={() => { if (deletingId == null) setConfirmDeleteId(null); }}
				isProcessing={deletingId != null}
				confirmTone="danger"
			/>
		</BottomSheet>
	);
}
