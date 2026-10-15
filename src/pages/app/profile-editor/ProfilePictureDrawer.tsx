import { AlertTriangle, ImageIcon, Loader2, Plus } from "lucide-react";
import { CameraPlusFilled } from "../../../components/icons/FilledIcons";
import {
	DRAWER_PRIMARY_BUTTON_CLASS,
	DrawerActionButton,
	DrawerActionTile,
	DrawerBody,
	DrawerEmptyState,
	DrawerFooter,
	DrawerGrid,
	DrawerHeader,
	DrawerMediaTile,
} from "../chat/drawerUi";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "../../../components/ui/bottom-sheet";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { getThumbImageUrl } from "../../../utils/media";
import { MEDIA_MODERATION_STATE } from "./profileEditorUtils";

export type ProfilePoolImage = {
	mediaHash: string;
	type: number;
	state: number | null;
	takenOnGrindr?: boolean;
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
	onClose: () => void;
	isDesktop: boolean;
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
	onClose,
	isDesktop,
}: ProfilePictureDrawerProps) {
	const { t } = useTranslation();
	const uploadInputRef = useRef<HTMLInputElement | null>(null);
	const [confirmDeleteHash, setConfirmDeleteHash] = useState<string | null>(null);
	const [selectedHashes, setSelectedHashes] = useState<Set<string>>(new Set());

	const onPickFile = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const file = event.target.files?.[0] ?? null;
			event.target.value = "";
			if (!file) return;
			onUploadFile(file);
		},
		[onUploadFile],
	);

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
		<BottomSheet
			onClose={isSelecting ? () => {} : onClose}
			isProcessing={isSelecting}
			isDesktop={isDesktop}
			bg="bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]"
			panelClassName="px-4"
		>
			<DrawerHeader title={t("profile_photo_drawer.title")} className="mb-1" />

			<input type="file" ref={uploadInputRef} onChange={onPickFile} accept="image/*" className="hidden" />

			<p className="mb-3 text-xs text-[var(--text-muted)]">
				{t("profile_photo_drawer.description")}
			</p>

			<div className="mb-3 flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3.5 py-3">
				<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
				<p className="text-xs leading-relaxed text-amber-400">
					{t("profile_photo_drawer.nudity_notice")}
				</p>
			</div>

			<DrawerBody
				isLoading={isLoading}
				error={error}
				onRetry={onRetry}
				retryLabel={t("profile_photo_drawer.retry")}
				empty={visibleImages.length === 0 ? (
					<DrawerEmptyState
						icon={<ImageIcon className="h-5 w-5" />}
						title={t("profile_photo_drawer.empty")}
						hint={t("profile_photo_drawer.empty_hint", { defaultValue: "Upload a photo from your device to add it to your profile." })}
					>
						<DrawerActionButton
							icon={<CameraPlusFilled className="h-4 w-4" />}
							label={t("profile_photo_drawer.upload")}
							onClick={() => uploadInputRef.current?.click()}
							disabled={isSelecting}
						/>
					</DrawerEmptyState>
				) : undefined}
			>
				<DrawerGrid isDesktop={isDesktop}>
					{/* Upload as the first tile, like the chat drawer. */}
					<DrawerActionTile
						icon={<CameraPlusFilled />}
						label={t("profile_photo_drawer.upload")}
						onClick={() => uploadInputRef.current?.click()}
						disabled={isSelecting || hasSelection}
					/>
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
						const statusLabel = isPending
							? t("profile_editor.sections.pictures.pending_moderation")
							: isRejected
								? t("profile_editor.sections.pictures.rejected")
								: null;

						return (
							<DrawerMediaTile
								key={image.mediaHash}
								src={getThumbImageUrl(image.mediaHash, "320x320")}
								alt={t("profile_photo_drawer.image_alt")}
								mediaClassName={isRejected ? "opacity-50 grayscale" : ""}
								takenOnGrindr={image.takenOnGrindr}
								selected={isSelected}
								muted={isMutedByCapacity}
								busy={isSelecting || isDeleting}
								onSelect={isClickable ? () => toggleSelection(image.mediaHash) : undefined}
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
		</BottomSheet>
	);
}
