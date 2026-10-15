import { Loader2, Plus } from "lucide-react";
import { ImagesFilled } from "../../../components/icons/FilledIcons";
import {
	DRAWER_PRIMARY_BUTTON_CLASS,
	DrawerBody,
	DrawerEmptyState,
	DrawerFooter,
	DrawerGrid,
	DrawerHeader,
	DrawerMediaPreview,
	DrawerMediaTile,
	useDrawerMediaPreview,
} from "../chat/drawerUi";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { BottomSheet } from "../../../components/ui/bottom-sheet";
import type { DrawerMedia } from "../chat/ChatDrawerPanel";

interface AlbumDrawerPickerSheetProps {
	media: DrawerMedia[];
	isLoading: boolean;
	error: string | null;
	onLoadMedia: () => void;
	onClose: () => void;
	onConfirm: (mediaIds: number[]) => void | Promise<void>;
	isSubmitting: boolean;
	remainingSlots: number;
	isDesktop: boolean;
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
}: AlbumDrawerPickerSheetProps) {
	const { t } = useTranslation();
	const { preview: drawerPreview, bind: bindPreview, consumeClick: consumePreviewClick } = useDrawerMediaPreview();
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

	// The album-content-by-id endpoint only accepts images — adding a
	// drawer video fails server-side, so videos aren't offered here at all.
	const imageMedia = useMemo(
		() => media.filter((item) => item.contentType.startsWith("image/")),
		[media],
	);

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

	const handleConfirm = useCallback(async () => {
		if (selectedIds.size === 0) return;
		await onConfirm([...selectedIds]);
	}, [selectedIds, onConfirm]);

	return (
		<BottomSheet
			onClose={isSubmitting ? () => {} : onClose}
			isProcessing={isSubmitting}
			isDesktop={isDesktop}
			bg="bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]"
			panelClassName="px-4"
		>
			<DrawerHeader title={t("settings_albums.drawer_picker_title", { defaultValue: "Select media" })} />

			<DrawerBody
				isLoading={isLoading}
				error={error}
				onRetry={onLoadMedia}
				empty={imageMedia.length === 0 ? (
					<DrawerEmptyState
						icon={<ImagesFilled className="h-5 w-5" />}
						title={t("settings_albums.drawer_empty", { defaultValue: "No media in your drawer yet." })}
						hint={t("chat_drawer.empty_hint", { defaultValue: "Take a photo or video, or upload one from your device." })}
					/>
				) : undefined}
			>
				<DrawerGrid isDesktop={isDesktop}>
					{imageMedia.map((item) => (
						<DrawerMediaTile
							key={item.id}
							src={item.url}
							alt={t("chat_drawer.media_alt")}
							selected={selectedIds.has(item.id)}
							onSelect={() => toggleSelection(item.id)}
							previewProps={bindPreview({ src: item.url, isVideo: false })}
							consumePreviewClick={consumePreviewClick}
						/>
					))}
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
			<DrawerMediaPreview media={drawerPreview} />
		</BottomSheet>
	);
}
