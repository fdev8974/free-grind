import {
	AlertTriangle,
	Film,
	Folder,
	GripVertical,
	Images,
	Loader2,
	Trash2,
	UserMinus,
	Users,
	Video,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import {
	DndContext,
	PointerSensor,
	TouchSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
} from "@dnd-kit/core";
import {
	SortableContext,
	arrayMove,
	rectSortingStrategy,
	useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useApiFunctions } from "../../../hooks/useApiFunctions";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { CameraFilled, ImagesFilled, InboxFilled } from "../../../components/icons/FilledIcons";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { BottomSheet, SHEET_ICON_BUTTON_CLASS, SheetClose, SheetCloseButton, SHEET_FOOTER_CLASS, sheetButtonClass } from "../../../components/ui/bottom-sheet";
import { NATIVE_SHEET_BG, afterSheetClose } from "../../../components/ui/action-sheet";
import { SheetSection, SheetTextInput } from "../../../components/ui/sheet-section";
import { ProfileImage } from "../../../components/ui/profile-image";
import { MediaUploadOverlay } from "../../../components/ui/progress-ring";
import type { Album, AlbumDetail, AlbumLimits, AlbumMedia } from "../../../types/albums";
import { getCachedMediaUri, getDrawerMediaKey } from "../../../services/mediaStore";
import { appLog } from "../../../utils/logger";
import { getThumbImageUrl, validateMediaHash } from "../../../utils/media";
import {
	DrawerAddTile,
	type DrawerAddAction,
	DrawerAddButton,
	DrawerEmptyState,
	DrawerGridSkeleton,
	DrawerHeader,
	DrawerMediaPreview,
	DrawerMediaTile,
	MediaPreviewFallback,
	drawerGridClass,
	useDrawerMediaPreview,
} from "../chat/drawerUi";
import { useUploadTiles } from "../chat/useUploadTiles";
import type { DrawerMedia } from "../chat/ChatDrawerPanel";
import { resolveVideoEdit } from "../../../services/videoEdit";
import { AlbumDrawerPickerSheet } from "./AlbumDrawerPickerSheet";
import { MediaEditSheet } from "../chat/MediaEditSheet";
import {
	buildMultipartBody,
	countAlbumMedia,
	formatMs,
	getVideodimensions,
	getVideoDurationMs,
} from "./settingsAlbumsUtils";
import { downloadDrawerMedia, useOwnDrawerMedia } from "./useOwnDrawerMedia";

type SortableAlbumMediaItemProps = {
	item: AlbumMedia;
	index: number;
	isReordering: boolean;
	isDeleting: boolean;
	onDeleteClick: () => void;
	/** From useDrawerMediaPreview, for the hold-to-peek. */
	bindPreview: ReturnType<typeof useDrawerMediaPreview>["bind"];
	consumePreviewClick: () => boolean;
};

/** An album item as a drawer tile (delete, peek), plus the grip to reorder. */
function SortableAlbumMediaItem({
	item,
	index,
	isReordering,
	isDeleting,
	onDeleteClick,
	bindPreview,
	consumePreviewClick,
}: SortableAlbumMediaItemProps) {
	const { t } = useTranslation();
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
		useSortable({ id: item.contentId });

	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
	};

	const imageUrl = item.thumbUrl || item.url || item.coverUrl || "";
	const isVideo = item.contentType?.startsWith("video/") ?? false;
	const isProcessing = item.processing;
	const isRejected = item.rejectionId != null;
	// A freshly uploaded video has no preview until the server finishes
	// processing it; its thumb URL doesn't load yet either.
	const [previewFailed, setPreviewFailed] = useState(false);
	// The album poll swaps in a fresh URL once processing is done; try that one.
	useEffect(() => setPreviewFailed(false), [imageUrl]);
	const showPreview = Boolean(imageUrl) && !isProcessing && !previewFailed;
	// The peek shows the full media: the video itself, the full-size photo.
	const peekSrc = (isVideo ? item.url : item.url || imageUrl) ?? "";

	return (
		<div ref={setNodeRef} style={style} className={isDragging ? "relative z-10 opacity-40" : undefined}>
			<DrawerMediaTile
				src={imageUrl}
				isVideo={isVideo}
				posterSrc={isVideo ? imageUrl : undefined}
				alt={t("settings_albums.media_alt", { index: index + 1 })}
				mediaClassName={isRejected ? "opacity-40 grayscale" : ""}
				// A preview that fails to load shows the tile's own "no preview";
				// this only keeps the peek from opening it.
				onMediaError={() => setPreviewFailed(true)}
				placeholder={isProcessing ? (
					<div className="flex h-full w-full items-center justify-center text-[var(--text-muted)]">
						{isVideo ? <Film className="h-7 w-7 opacity-50" /> : <Images className="h-7 w-7 opacity-50" />}
						{/* Styled like the upload before it (see useUploadTiles), the ring
						    spinning: the server doesn't say how far along it is. */}
						<MediaUploadOverlay progress={null} label={t("settings_albums.processing", { defaultValue: "Processing" })} />
					</div>
				) : !imageUrl ? (
					<MediaPreviewFallback isVideo={isVideo} />
				) : undefined}
				previewProps={showPreview && peekSrc ? bindPreview({ src: peekSrc, isVideo, placeholderSrc: isVideo ? undefined : imageUrl }) : undefined}
				consumePreviewClick={consumePreviewClick}
				busy={isDeleting}
				onDelete={isReordering ? undefined : onDeleteClick}
				isDeleting={isDeleting}
				deleteLabel={t("settings_albums.delete")}
			>
				{isRejected && (
					// Bottom left: the top corners hold delete and the grip.
					<div className="absolute bottom-1.5 left-1.5 max-w-[calc(100%-0.75rem)]">
						<span className="inline-flex max-w-full items-center gap-0.5 rounded-md bg-red-500/90 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white shadow-sm">
							<AlertTriangle className="h-2.5 w-2.5 shrink-0" />
							<span className="truncate">{t("settings_albums.rejected", { defaultValue: "Rejected" })}</span>
						</span>
					</div>
				)}

				{!isReordering && (
					<div
						{...attributes}
						{...listeners}
						// The grip drags; it mustn't also start the tile's hold-to-peek.
						onPointerDown={(event) => {
							listeners?.onPointerDown?.(event);
							event.stopPropagation();
						}}
						onClick={(event) => event.stopPropagation()}
						// Placed and drawn like the tile's corner buttons (see DrawerTileCornerButton).
						className="absolute right-1.5 top-1.5 z-[1] inline-flex h-5 w-5 cursor-grab touch-none items-center justify-center rounded-full bg-black/60 text-white active:cursor-grabbing"
					>
						<GripVertical className="h-3 w-3" />
					</div>
				)}
			</DrawerMediaTile>
		</div>
	);
}

export type ShareProfileListItem = {
	profileId: number;
	displayName: string;
	avatarUrl: string | null;
};

interface AlbumEditorSheetProps {
	album: Album;
	/** The plan's limits; fetched here when not passed in. */
	limits?: AlbumLimits | null;
	/** Already loaded details, shown right away instead of a skeleton. */
	initialDetail?: AlbumDetail;
	/** Called once the sheet has closed (unmount it then). */
	onClose: () => void;
	onRenamed?: (albumId: string, albumName: string) => void;
	/** Called after the album was deleted, once its sheet has slid out. */
	onDeleted: (albumId: string) => void;
	/** Keeps a list's cover and counts in step with edits made here. */
	onDetailChange?: (albumId: string, detail: AlbumDetail) => void;
	onSharesChange?: (albumId: string, profiles: ShareProfileListItem[]) => void;
	/** A profile was picked in the "Shared With" list; called once this sheet has closed. */
	onOpenProfile: (profileId: number) => void;
	isDesktop: boolean;
}

/**
 * Editing one of your own albums: name, shares, adding (camera, upload or
 * from the chat drawer), reordering and removing media, deleting the album.
 * Opened from the chat drawer.
 */
export function AlbumEditorSheet({
	album,
	limits: limitsProp,
	initialDetail,
	onClose,
	onRenamed,
	onDeleted,
	onDetailChange,
	onSharesChange,
	onOpenProfile,
	isDesktop,
}: AlbumEditorSheetProps) {
	const { t } = useTranslation();
	const apiFunctions = useApiFunctions();
	const { notifyAlbumUpdates } = usePreferences();
	const albumId = album.albumId;
	const [fetchedLimits, setFetchedLimits] = useState<AlbumLimits | null>(null);
	const limits = limitsProp !== undefined ? limitsProp : fetchedLimits;
	// Album videos get trimmed to the plan's length (it isn't enforced server-side).
	const maxVideoMs = limits?.maxVideoLength ?? Number.POSITIVE_INFINITY;
	const [albumName, setAlbumName] = useState(album.albumName?.trim() ?? "");
	const [editingName, setEditingName] = useState(album.albumName?.trim() ?? "");
	const [isSavingEdit, setIsSavingEdit] = useState(false);
	const [detail, setDetail] = useState<AlbumDetail | undefined>(initialDetail);
	const [isLoadingDetails, setIsLoadingDetails] = useState(false);
	// Files on their way into the album, as placeholder tiles with their progress.
	const uploadTiles = useUploadTiles();
	const isUploading = uploadTiles.isUploading;
	const { preview: mediaPreview, bind: bindPreview, consumeClick: consumePreviewClick } = useDrawerMediaPreview();
	const [editingFiles, setEditingFiles] = useState<File[] | null>(null);
	const mediaEditDoneRef = useRef<((edited: File[] | null) => void) | null>(null);
	const editedFilesRef = useRef<File[]>([]);
	const [isReordering, setIsReordering] = useState(false);
	const [deletingContentId, setDeletingContentId] = useState<string | null>(null);
	const [confirmDeleteContentId, setConfirmDeleteContentId] = useState<string | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);
	const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
	const albumSheetCloseRef = useRef<(() => void) | null>(null);
	const uploadInputRef = useRef<HTMLInputElement>(null);
	const cameraInputRef = useRef<HTMLInputElement>(null);
	const cameraVideoInputRef = useRef<HTMLInputElement>(null);

	// "Add from drawer" picker
	const { drawerMedia, isLoadingDrawerMedia, drawerMediaError, loadDrawerMedia } = useOwnDrawerMedia();
	const [isDrawerPickerOpen, setIsDrawerPickerOpen] = useState(false);
	const [isAddingFromDrawer, setIsAddingFromDrawer] = useState(false);
	const drawerPickerCloseRef = useRef<(() => void) | null>(null);

	// Shares
	const [shareProfiles, setShareProfiles] = useState<ShareProfileListItem[] | null>(null);
	const [isLoadingShares, setIsLoadingShares] = useState(false);
	const [unsharingProfileId, setUnsharingProfileId] = useState<number | null>(null);
	const [isUnsharingAll, setIsUnsharingAll] = useState(false);
	const [isConfirmUnshareAllOpen, setIsConfirmUnshareAllOpen] = useState(false);
	const [isSharesSheetOpen, setIsSharesSheetOpen] = useState(false);
	const pendingProfileIdRef = useRef<number | null>(null);

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
		useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
	);

	// Callbacks in refs, so the effects below don't re-run on a parent re-render.
	const onDetailChangeRef = useRef(onDetailChange);
	onDetailChangeRef.current = onDetailChange;
	const onSharesChangeRef = useRef(onSharesChange);
	onSharesChangeRef.current = onSharesChange;
	useEffect(() => {
		if (detail) onDetailChangeRef.current?.(albumId, detail);
	}, [albumId, detail]);
	useEffect(() => {
		if (shareProfiles) onSharesChangeRef.current?.(albumId, shareProfiles);
	}, [albumId, shareProfiles]);

	useEffect(() => {
		if (limitsProp !== undefined) return;
		let cancelled = false;
		apiFunctions.getOwnAlbumStorage()
			.then((storage) => { if (!cancelled) setFetchedLimits(storage); })
			.catch((error) => appLog.warn("[AlbumEditorSheet] failed to load album limits", error));
		return () => { cancelled = true; };
	}, [apiFunctions, limitsProp]);

	const loadDetails = useCallback(async () => {
		setIsLoadingDetails(true);
		try {
			setDetail(await apiFunctions.getOwnAlbumDetails(albumId));
		} catch (loadError) {
			toast.error(loadError instanceof Error ? loadError.message : t("settings_albums.error_load_details_fallback"));
		} finally {
			setIsLoadingDetails(false);
		}
	}, [albumId, apiFunctions, t]);

	const loadShares = useCallback(async () => {
		setIsLoadingShares(true);
		try {
			const profileIds = await apiFunctions.getAlbumShares({ albumId });
			if (profileIds.length === 0) {
				setShareProfiles([]);
				return;
			}

			// Batch-fetch profile details in chunks of 50
			const CHUNK_SIZE = 50;
			const detailsById = new Map<number, { displayName: string; avatarUrl: string | null }>();
			const chunks: number[][] = [];
			for (let i = 0; i < profileIds.length; i += CHUNK_SIZE) {
				chunks.push(profileIds.slice(i, i + CHUNK_SIZE));
			}

			await Promise.all(
				chunks.map(async (chunk) => {
					try {
						const raw = await apiFunctions.getProfilesByIds(chunk);
						const profiles =
							raw && typeof raw === "object" && Array.isArray((raw as { profiles?: unknown }).profiles)
								? (raw as { profiles: unknown[] }).profiles
								: [];
						for (const p of profiles) {
							if (!p || typeof p !== "object") continue;
							const idRaw = (p as { profileId?: unknown }).profileId;
							if (idRaw == null) continue;
							const profileId = Number(idRaw);
							if (Number.isNaN(profileId)) continue;
							const nameRaw = (p as { displayName?: unknown }).displayName;
							const displayName =
								typeof nameRaw === "string" && nameRaw.trim().length > 0
									? nameRaw.trim()
									: t("common.unknown_display_name");
							const hashRaw = (p as { profileImageMediaHash?: unknown }).profileImageMediaHash;
							const avatarUrl =
								typeof hashRaw === "string" && validateMediaHash(hashRaw)
									? getThumbImageUrl(hashRaw, "75x75")
									: null;
							detailsById.set(profileId, { displayName, avatarUrl });
						}
					} catch {
						// chunk failed — ids fall back to id-only
					}
				}),
			);

			const notFoundIds = profileIds.filter((id) => !detailsById.has(id));
			if (notFoundIds.length > 0) {
				void apiFunctions.unshareAlbum({
					albumId,
					profiles: notFoundIds.map((profileId) => ({ profileId, shareId: 0 })),
				}).catch(() => { /* silently skip */ });
			}

			setShareProfiles(
				profileIds
					.filter((profileId) => detailsById.has(profileId))
					.map((profileId) => {
						const meta = detailsById.get(profileId)!;
						return { profileId, displayName: meta.displayName, avatarUrl: meta.avatarUrl };
					}),
			);
		} catch (loadError) {
			toast.error(loadError instanceof Error ? loadError.message : t("settings_albums.error_load_shares", { defaultValue: "Failed to load album shares." }));
		} finally {
			setIsLoadingShares(false);
		}
	}, [albumId, apiFunctions, t]);

	useEffect(() => {
		if (!initialDetail) void loadDetails();
		void loadShares();
		// Once per opened album; initialDetail only seeds the first render.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [albumId]);

	// Poll album details every 3 s while it has processing items.
	// detail kept in a ref so the interval doesn't restart on every poll response.
	const detailRef = useRef(detail);
	detailRef.current = detail;
	useEffect(() => {
		let cancelled = false;
		const tick = async () => {
			if (!detailRef.current?.content.some((item) => item.processing)) return;
			try {
				const updated = await apiFunctions.getOwnAlbumDetails(albumId);
				if (!cancelled) setDetail(updated);
			} catch {
				// silently skip failed poll
			}
		};
		const id = setInterval(() => { void tick(); }, 3000);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [albumId, apiFunctions]);

	// The name field: saved when it loses focus (or on Enter); an empty or
	// failed rename falls back to the current name.
	const saveAlbumName = async () => {
		const next = editingName.trim();
		if (!next) {
			setEditingName(albumName);
			return;
		}
		if (next === albumName || isSavingEdit) return;
		setIsSavingEdit(true);
		try {
			await apiFunctions.renameOwnAlbum({ albumId, albumName: next });
			setAlbumName(next);
			setEditingName(next);
			onRenamed?.(albumId, next);
			toast.success(t("settings_albums.toast_renamed"));
		} catch (saveError) {
			setEditingName(albumName);
			toast.error(saveError instanceof Error ? saveError.message : t("settings_albums.error_rename_fallback"));
		} finally {
			setIsSavingEdit(false);
		}
	};

	const deleteAlbum = async () => {
		if (isDeleting) return;
		setIsDeleting(true);
		try {
			await apiFunctions.deleteOwnAlbum({ albumId });
			setIsConfirmDeleteOpen(false);
			// Let the sheet animate out (and pop its history entry) before the album disappears.
			albumSheetCloseRef.current?.();
			afterSheetClose(() => onDeleted(albumId));
			toast.success(t("settings_albums.toast_deleted"));
		} catch (deleteError) {
			toast.error(deleteError instanceof Error ? deleteError.message : t("settings_albums.error_delete_fallback"));
		} finally {
			setIsDeleting(false);
		}
	};

	const openDrawerPicker = () => {
		const mediaCounts = countAlbumMedia(detail);
		if (limits?.maxContentItemsPerAlbum != null && mediaCounts.total >= limits.maxContentItemsPerAlbum) {
			toast.error(t("settings_albums.error_album_full", {
				defaultValue: "Album is full (max {{max}} items).",
				max: limits.maxContentItemsPerAlbum,
			}));
			return;
		}
		setIsDrawerPickerOpen(true);
		// Force-refresh — drawer media added since a previous picker session
		// (e.g. from the chat screen) would be missing otherwise.
		void loadDrawerMedia(true);
	};

	// Applies the album's limits (free slots, size, video count and length)
	// to files about to be uploaded; toasts and drops the ones that don't fit.
	const filterAlbumUploads = async (files: File[]): Promise<File[]> => {
		const currentTotal = detail?.content.length ?? 0;
		const currentVideos = detail?.content.filter(
			(item) => item.contentType?.startsWith("video/"),
		).length ?? 0;

		let candidates = [...files];

		if (limits?.maxContentItemsPerAlbum != null) {
			const remaining = limits.maxContentItemsPerAlbum - currentTotal;
			if (remaining <= 0) {
				toast.error(t("settings_albums.error_album_full", {
					defaultValue: "Album is full (max {{max}} items).",
					max: limits.maxContentItemsPerAlbum,
				}));
				return [];
			}
			if (candidates.length > remaining) {
				toast(t("settings_albums.warning_truncated", {
					defaultValue: "Only {{remaining}} slot(s) left — uploading the first {{remaining}} file(s).",
					remaining,
				}));
				candidates = candidates.slice(0, remaining);
			}
		}

		const valid: File[] = [];
		let videoSlotsLeft = limits?.maxVideosPerAlbum != null
			? limits.maxVideosPerAlbum - currentVideos
			: Infinity;

		for (const file of candidates) {
			const isVideo = file.type.startsWith("video/");

			if (limits?.maxContentSize != null && file.size > limits.maxContentSize) {
				toast.error(t("settings_albums.error_file_too_large", {
					defaultValue: "\"{{name}}\" is too large (max {{max}}).",
					name: file.name,
					max: limits.maxContentSizeHumanReadable ?? `${Math.round(limits.maxContentSize / 1_048_576)} MiB`,
				}));
				continue;
			}

			if (isVideo) {
				if (videoSlotsLeft <= 0) {
					toast.error(t("settings_albums.error_video_limit", {
						defaultValue: "\"{{name}}\" skipped — album video limit reached (max {{max}}).",
						name: file.name,
						max: limits?.maxVideosPerAlbum,
					}));
					continue;
				}
				videoSlotsLeft -= 1;

				// A video over maxVideoLength gets trimmed to it (see uploadFilesToAlbum).
				if (limits?.minVideoLength != null) {
					const durationMs = await getVideoDurationMs(file);
					if (durationMs != null) {
						if (durationMs < limits.minVideoLength) {
							toast.error(t("settings_albums.error_video_too_short", {
								defaultValue: "\"{{name}}\" is too short (min {{min}}).",
								name: file.name,
								min: formatMs(limits.minVideoLength),
							}));
							continue;
						}
					}
				}
			}

			valid.push(file);
		}

		return valid;
	};

	// One file into the album, under its placeholder tile. Videos stream from
	// disk, cut to the editor's pick or the plan's maxVideoLength and upright
	// (see videoEdit); a binary without streaming sends them whole instead.
	// A failure is reported and drops the tile; resolves whether it went in.
	const uploadFileToAlbum = async (file: File, tileId: number): Promise<boolean> => {
		const isVideo = file.type.startsWith("video/");
		try {
			await uploadTiles.track(tileId, isVideo, async (onProgress) => {
				if (isVideo) {
					const streamed = await apiFunctions.uploadOwnAlbumVideo({
						albumId,
						file,
						isFresh: notifyAlbumUpdates,
						edit: await resolveVideoEdit(file, maxVideoMs),
						onLandscapeKept: () =>
							toast(t("chat.attachments.landscape_kept", {
								defaultValue: "This device can't turn the video upright, so it was sent in landscape. The official app may not show it properly.",
							})),
						onProgress,
						...(limits?.maxContentSize != null ? { maxBodySize: limits.maxContentSize } : {}),
					});
					if (streamed) return;
				}
				const multipart = await buildMultipartBody(file);
				const dims = isVideo ? await getVideodimensions(file) : undefined;
				await apiFunctions.uploadOwnAlbumContent({ albumId, multipart, isFresh: notifyAlbumUpdates, ...dims });
			});
			return true;
		} catch (uploadError) {
			appLog.error("[AlbumEditorSheet] upload failed", uploadError);
			toast.error(uploadError instanceof Error ? uploadError.message : t("settings_albums.error_upload_fallback"));
			uploadTiles.drop([tileId]);
			return false;
		}
	};

	// Each file shows as a tile in the grid right away; they upload one after
	// another, and the tiles go once the album has reloaded.
	const uploadFilesToAlbum = async (files: File[]): Promise<number> => {
		const ids = uploadTiles.add(files);
		let added = 0;
		try {
			for (const [index, file] of files.entries()) {
				if (await uploadFileToAlbum(file, ids[index])) added += 1;
			}
			if (added > 0) await loadDetails();
		} finally {
			uploadTiles.drop(ids);
		}
		return added;
	};

	// Like an upload from the device: the picker closes right away and the
	// picked media show as placeholder tiles in the album until it reloaded.
	// Photos go in by drawer id. Videos can't (the by-id endpoint doesn't add
	// them), so they're downloaded from the drawer and uploaded directly.
	const handleAddFromDrawer = async (mediaIds: number[]) => {
		const drawerById = new Map(drawerMedia.map((item) => [item.id, item]));
		const items = mediaIds.flatMap((id) => drawerById.get(id) ?? []);
		if (items.length === 0) return;
		// Animated close; falls back to unmounting if the sheet is already gone.
		if (drawerPickerCloseRef.current) drawerPickerCloseRef.current();
		else setIsDrawerPickerOpen(false);

		const isVideoItem = (item: DrawerMedia) => item.contentType.startsWith("video/");
		const tileIds = uploadTiles.add(items.map((item) => ({
			src: getCachedMediaUri(getDrawerMediaKey(item.id)) ?? item.url,
			isVideo: isVideoItem(item),
		})));
		const tileFor = new Map(items.map((item, index) => [item.id, tileIds[index]]));
		const images = items.filter((item) => !isVideoItem(item));
		const videos = items.filter(isVideoItem);
		setIsAddingFromDrawer(true);
		let added = 0;
		try {
			if (images.length > 0) {
				// One request for all photos; each tile shows it.
				const request = apiFunctions.addOwnAlbumContentByIds({ albumId, ids: images.map((item) => item.id), isFresh: notifyAlbumUpdates });
				try {
					await Promise.all(images.map((item) => uploadTiles.track(tileFor.get(item.id)!, false, () => request)));
					added += images.length;
				} catch (addError) {
					toast.error(addError instanceof Error ? addError.message : t("settings_albums.error_upload_fallback"));
					uploadTiles.drop(images.map((item) => tileFor.get(item.id)!));
				}
			}
			if (videos.length > 0) {
				// All downloaded first, so the album's limits see them together.
				const tileForFile = new Map<File, number>();
				for (const item of videos) {
					const file = await downloadDrawerMedia(item);
					if (file) {
						tileForFile.set(file, tileFor.get(item.id)!);
					} else {
						toast.error(t("settings_albums.error_drawer_video_download", { defaultValue: "Couldn't load a video from your drawer." }));
						uploadTiles.drop([tileFor.get(item.id)!]);
					}
				}
				const valid = await filterAlbumUploads([...tileForFile.keys()]);
				uploadTiles.drop([...tileForFile].filter(([file]) => !valid.includes(file)).map(([, id]) => id));
				for (const file of valid) {
					if (await uploadFileToAlbum(file, tileForFile.get(file)!)) added += 1;
				}
			}
			if (added > 0) {
				toast.success(t("settings_albums.toast_added_from_drawer", { count: added }));
				await loadDetails();
			}
		} finally {
			uploadTiles.drop(tileIds);
			setIsAddingFromDrawer(false);
		}
	};

	// Picked files go through the edit sheet first, all in one; resolves the
	// edited files, or null when it was closed before the last one.
	const editFiles = (files: File[]) =>
		new Promise<File[] | null>((resolve) => {
			editedFilesRef.current = [];
			mediaEditDoneRef.current = resolve;
			setEditingFiles(files);
		});
	const finishMediaEdit = (confirmed: boolean) => {
		const done = mediaEditDoneRef.current;
		mediaEditDoneRef.current = null;
		setEditingFiles(null);
		done?.(confirmed ? editedFilesRef.current : null);
	};

	const handleUploadInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(event.target.files ?? []);
		event.target.value = "";
		if (!files.length || isUploading) return;
		const filtered = await filterAlbumUploads(files);
		if (filtered.length === 0) return;
		const valid = await editFiles(filtered);
		if (!valid || valid.length === 0) return;
		// Each file's failure is reported (and its tile dropped) as it happens.
		const added = await uploadFilesToAlbum(valid);
		if (added > 0) toast.success(t("settings_albums.toast_picture_added", { count: added }));
	};

	const reorderAlbumContent = async (content: AlbumMedia[], fromIndex: number, toIndex: number) => {
		if (isReordering || fromIndex < 0 || toIndex < 0) return;
		if (toIndex >= content.length || fromIndex >= content.length) return;

		const reordered = arrayMove(content, fromIndex, toIndex);
		const contentIds = reordered.map((item) => Number.parseInt(item.contentId, 10));
		if (contentIds.some((value) => Number.isNaN(value))) {
			toast.error(t("settings_albums.error_reorder_unsupported"));
			return;
		}

		setDetail((previous) => previous && { ...previous, content: reordered });
		setIsReordering(true);
		try {
			await apiFunctions.reorderOwnAlbumContent({ albumId, contentIds });
			toast.success(t("settings_albums.toast_reordered", { defaultValue: "Order saved." }));
		} catch (reorderError) {
			// Revert on failure
			setDetail((previous) => previous && { ...previous, content });
			toast.error(reorderError instanceof Error ? reorderError.message : t("settings_albums.error_reorder_fallback"));
		} finally {
			setIsReordering(false);
		}
	};

	const handleAlbumMediaDragEnd = (content: AlbumMedia[]) => (event: DragEndEvent) => {
		const { active, over } = event;
		if (!over || active.id === over.id) return;
		const from = content.findIndex((item) => item.contentId === String(active.id));
		const to = content.findIndex((item) => item.contentId === String(over.id));
		if (from === -1 || to === -1) return;
		void reorderAlbumContent(content, from, to);
	};

	const deleteAlbumPicture = async (contentId: string) => {
		if (deletingContentId) return;
		setDeletingContentId(contentId);
		try {
			await apiFunctions.deleteOwnAlbumContent({ albumId, contentId });
			setDetail((previous) => previous && { ...previous, content: previous.content.filter((item) => item.contentId !== contentId) });
			setConfirmDeleteContentId((previous) => previous === contentId ? null : previous);
			toast.success(t("settings_albums.toast_picture_removed"));
		} catch (deleteError) {
			toast.error(deleteError instanceof Error ? deleteError.message : t("settings_albums.error_delete_content_fallback"));
		} finally {
			setDeletingContentId(null);
		}
	};

	const unshareFromProfile = async (profileId: number) => {
		if (unsharingProfileId === profileId) return;
		setUnsharingProfileId(profileId);
		try {
			await apiFunctions.unshareAlbum({ albumId, profiles: [{ profileId, shareId: 0 }] });
			setShareProfiles((prev) => (prev ?? []).filter((p) => p.profileId !== profileId));
			toast.success(t("settings_albums.toast_unshared", { defaultValue: "Album share removed." }));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t("settings_albums.error_unshare", { defaultValue: "Failed to remove share." }));
		} finally {
			setUnsharingProfileId(null);
		}
	};

	const unshareAll = async () => {
		const profiles = shareProfiles ?? [];
		if (!profiles.length || isUnsharingAll) return;
		setIsUnsharingAll(true);
		try {
			await apiFunctions.unshareAlbum({
				albumId,
				profiles: profiles.map((p) => ({ profileId: p.profileId, shareId: 0 })),
			});
			setShareProfiles([]);
			toast.success(t("settings_albums.toast_unshared_all", { defaultValue: "All shares removed." }));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t("settings_albums.error_unshare", { defaultValue: "Failed to remove share." }));
		} finally {
			setIsUnsharingAll(false);
			setIsConfirmUnshareAllOpen(false);
		}
	};

	/** "3 / 50 items · 1 / 10 videos" — parts without data are left out. */
	const formatAlbumMeta = () => {
		if (!detail) return "";
		const counts = countAlbumMedia(detail);
		const items = t("settings_albums.media_items", { defaultValue: "items" });
		const videos = t("settings_albums.media_videos", { defaultValue: "videos" });
		return [
			limits?.maxContentItemsPerAlbum != null
				? `${counts.total} / ${limits.maxContentItemsPerAlbum} ${items}`
				: counts.total > 0 ? `${counts.total} ${items}` : null,
			limits?.maxVideosPerAlbum != null
				? `${counts.videos} / ${limits.maxVideosPerAlbum} ${videos}`
				: counts.videos > 0 ? `${counts.videos} ${videos}` : null,
		].filter(Boolean).join(" · ");
	};

	const showDetailsSkeleton = isLoadingDetails && !detail;
	const albumContent = detail?.content ?? [];

	// Add actions, as in the collection editor: the add tile's sheet lists
	// them all (the device and the drawer each their own), as do the empty
	// state's buttons. File pickers are clicked synchronously, as user gestures.
	const addActions: DrawerAddAction[] = [
		{
			key: "photo",
			icon: <CameraFilled className="h-4 w-4" />,
			iconClassName: "bg-sky-500/15 text-sky-400",
			label: t("chat_drawer.take_photo"),
			description: t("chat_drawer.take_photo_desc", { defaultValue: "Take a new one with the camera" }),
			onClick: () => cameraInputRef.current?.click(),
		},
		{
			key: "video",
			icon: <Video className="h-4 w-4 fill-current" />,
			iconClassName: "bg-rose-500/15 text-rose-400",
			label: t("chat_drawer.record_video", { defaultValue: "Record video" }),
			description: t("chat_drawer.record_video_desc", { defaultValue: "Record a new one with the camera" }),
			onClick: () => cameraVideoInputRef.current?.click(),
		},
		{
			key: "upload",
			icon: <Folder className="h-4 w-4 fill-current" />,
			iconClassName: "bg-violet-500/15 text-violet-400",
			label: t("settings_albums.add_upload", { defaultValue: "Upload from device" }),
			description: t("settings_albums.add_upload_desc", { defaultValue: "Photos and videos stored on this device" }),
			onClick: () => uploadInputRef.current?.click(),
		},
		{
			key: "drawer",
			icon: <InboxFilled className="h-4 w-4" />,
			iconClassName: "bg-emerald-500/15 text-emerald-400",
			label: t("settings_albums.add_from_drawer", { defaultValue: "Add from Drawer" }),
			description: t("settings_albums.add_drawer_desc", { defaultValue: "Media saved in your chat drawer" }),
			// Once the add sheet has popped its history entry (from the empty state's button, right away).
			onClick: () => afterSheetClose(openDrawerPicker),
		},
	];
	const isAdding = isUploading || isAddingFromDrawer;

	return (
		<>
			<BottomSheet
				onClose={onClose}
				closeRef={albumSheetCloseRef}
				expandable
				isDesktop={isDesktop}
				bg={NATIVE_SHEET_BG}
				// Like the chat drawer: a min height on desktop, so the panel doesn't
				// shrink from the loading skeleton down to the empty state.
				panelClassName={isDesktop ? "min-h-[55dvh] px-4" : "px-4"}
			>
				<DrawerHeader
					className="mb-1"
					title={albumName || t("settings_albums.untitled")}
					actions={
						<>
						{/* Who can see this album; the list itself lives in a stacked sheet. */}
						<button
							type="button"
							onClick={() => {
								setIsSharesSheetOpen(true);
								void loadShares();
							}}
							// Pill rather than a round icon button, so the count is readable at a glance.
							className={`${SHEET_ICON_BUTTON_CLASS} !w-auto gap-1.5 px-3 text-xs font-semibold tabular-nums`}
							aria-label={t("settings_albums.shared_with", { defaultValue: "Shared With" })}
							title={t("settings_albums.shared_with", { defaultValue: "Shared With" })}
						>
							<Users className="h-4 w-4" />
							{isLoadingShares && !shareProfiles ? (
								<span className="h-3 w-3 animate-pulse rounded-full ink-tint-16" />
							) : (
								shareProfiles?.length ?? 0
							)}
						</button>
						<button
							type="button"
							onClick={() => setIsConfirmDeleteOpen(true)}
							disabled={isDeleting}
							className={`${SHEET_ICON_BUTTON_CLASS} hover:!text-red-400`}
							aria-label={t("settings_albums.delete")}
							title={t("settings_albums.delete")}
						>
							{isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
						</button>
						</>
					}
				/>
				<p className="mb-4 text-xs text-[var(--text-muted)]">
					{formatAlbumMeta() || `#${albumId}`}
				</p>

				<SheetSection title={t("settings_albums.name_label", { defaultValue: "Name" })} className="mb-4">
					<SheetTextInput
						value={editingName}
						onChange={setEditingName}
						onCommit={() => void saveAlbumName()}
						placeholder={t("settings_albums.new_album_placeholder")}
						maxLength={255}
						disabled={isSavingEdit}
						trailing={isSavingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
					/>
				</SheetSection>

				<input
					ref={uploadInputRef}
					type="file"
					accept="image/*,video/*"
					multiple
					onChange={(e) => void handleUploadInputChange(e)}
					className="hidden"
				/>
				{/* Camera capture, same as the chat drawer's take photo / record video. */}
				<input
					ref={cameraInputRef}
					type="file"
					accept="image/*"
					capture="environment"
					onChange={(e) => void handleUploadInputChange(e)}
					className="hidden"
				/>
				<input
					ref={cameraVideoInputRef}
					type="file"
					accept="video/*"
					capture="environment"
					onChange={(e) => void handleUploadInputChange(e)}
					className="hidden"
				/>

				<div className="-mx-4 flex min-h-0 flex-1 flex-col overflow-y-auto px-4" data-lenis-prevent>
					{showDetailsSkeleton ? (
						<DrawerGridSkeleton isDesktop={isDesktop} />
					) : (!detail || detail.content.length === 0) && !isUploading ? (
						<DrawerEmptyState
							className="my-auto"
							icon={<ImagesFilled className="h-5 w-5" />}
							title={t("settings_albums.no_media")}
							hint={t("settings_albums.no_media_hint", { defaultValue: "Take a photo or video, upload from your device, or add media from your chat drawer." })}
						>
							<DrawerAddButton
								label={t("chat_drawer.add_media", { defaultValue: "Add media" })}
								actions={addActions}
								isDesktop={isDesktop}
								disabled={isAdding}
							/>
						</DrawerEmptyState>
					) : (
						<DndContext
							sensors={sensors}
							onDragEnd={handleAlbumMediaDragEnd(albumContent)}
						>
							<SortableContext
								items={albumContent.map((item) => item.contentId)}
								strategy={rectSortingStrategy}
							>
								{/* The media drawer's grid and tiles. */}
								<div className={drawerGridClass(isDesktop)}>
									{/* The add tile first, like the collection editor. */}
									<DrawerAddTile
										label={t("chat_drawer.add_media", { defaultValue: "Add media" })}
										actions={addActions}
										isDesktop={isDesktop}
										disabled={isAdding}
									/>
									{uploadTiles.tiles}
									{albumContent.map((item, index) => (
										<SortableAlbumMediaItem
											key={`${albumId}-${item.contentId}`}
											item={item}
											index={index}
											isReordering={isReordering}
											isDeleting={deletingContentId === item.contentId}
											onDeleteClick={() => setConfirmDeleteContentId(item.contentId)}
											bindPreview={bindPreview}
											consumePreviewClick={consumePreviewClick}
										/>
									))}
								</div>
							</SortableContext>
						</DndContext>
					)}
				</div>

				<DrawerMediaPreview media={mediaPreview} />
			</BottomSheet>


			{isSharesSheetOpen && (
				<BottomSheet
					onClose={() => {
						setIsSharesSheetOpen(false);
						const profileId = pendingProfileIdRef.current;
						pendingProfileIdRef.current = null;
						if (profileId == null) return;
						// Close the album sheet underneath too, and hand over only once
						// both sheets have popped their history entries.
						albumSheetCloseRef.current?.();
						afterSheetClose(() => onOpenProfile(profileId));
					}}
					expandable
					isDesktop={isDesktop}
					bg={NATIVE_SHEET_BG}
					panelClassName={isDesktop ? "max-h-[82dvh] px-4" : "px-4"}
				>
					<div className="mb-3 flex items-center justify-between gap-3">
						<h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
							{t("settings_albums.shared_with", { defaultValue: "Shared With" })}
							{shareProfiles && shareProfiles.length > 0 && (
								<span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-bold tabular-nums text-[var(--text-muted)]">
									{shareProfiles.length}
								</span>
							)}
						</h3>
						<SheetCloseButton />
					</div>
					<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
						{isLoadingShares ? (
							<div className="-mx-4">
								{[0, 1, 2].map((i) => (
									<div key={i} className="flex items-center gap-3 px-4 py-2.5">
										<div className="h-12 w-12 shrink-0 rounded-full overflow-hidden animate-pulse bg-[var(--surface-2)]" />
										<div className="min-w-0 flex-1 space-y-1.5">
											<div className="h-3.5 w-28 animate-pulse rounded-full bg-[var(--surface-2)]" />
											<div className="h-3 w-16 animate-pulse rounded-full bg-[var(--surface-2)]" />
										</div>
										<div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-[var(--surface-2)]" />
									</div>
								))}
							</div>
						) : !shareProfiles || shareProfiles.length === 0 ? (
							<DrawerEmptyState
								icon={<Users />}
								fanned={false}
								title={t("settings_albums.not_shared", { defaultValue: "Not shared with anyone." })}
								hint={t("settings_albums.not_shared_hint", { defaultValue: "Share it from a chat and everyone with access shows up here." })}
							/>
						) : (
							<div className="-mx-4">
								{shareProfiles.map((profile) => {
									const isUnsharing = unsharingProfileId === profile.profileId;
									return (
										<div
											key={profile.profileId}
											className="flex items-center gap-3 px-4 py-2.5 transition-colors hover-fill"
										>
											<SheetClose
												onClick={() => { pendingProfileIdRef.current = profile.profileId; }}
												className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-70"
											>
												<div className="h-12 w-12 shrink-0 rounded-full overflow-hidden bg-[var(--surface-2)] drop-shadow-sm">
													<ProfileImage src={profile.avatarUrl} alt={profile.displayName} />
												</div>
												<div className="min-w-0 flex-1">
													<p className="truncate text-sm font-semibold">{profile.displayName}</p>
													<p className="text-xs text-[var(--text-muted)]">
														{t("settings_blocked.profile_id", { id: profile.profileId })}
													</p>
												</div>
											</SheetClose>
											<button
												type="button"
												onClick={() => void unshareFromProfile(profile.profileId)}
												disabled={isUnsharing}
												className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-400 transition hover:bg-red-500/20 active:scale-90 disabled:opacity-50"
												aria-label={t("settings_albums.unshare", { defaultValue: "Remove" })}
												title={t("settings_albums.unshare", { defaultValue: "Remove" })}
											>
												{isUnsharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4" />}
											</button>
										</div>
									);
								})}
							</div>
						)}
					</div>
					{shareProfiles && shareProfiles.length > 0 && !isLoadingShares && (
						<div className={SHEET_FOOTER_CLASS}>
							<button
								type="button"
								onClick={() => setIsConfirmUnshareAllOpen(true)}
								disabled={isUnsharingAll}
								className={sheetButtonClass("destructive")}
							>
								{isUnsharingAll
									? t("settings_albums.unsharing_all", { defaultValue: "Removing…" })
									: t("settings_albums.unshare_all", { defaultValue: "Remove All" })}
							</button>
						</div>
					)}
				</BottomSheet>
			)}

			<ConfirmDialog
				isOpen={isConfirmDeleteOpen}
				title={t("settings_albums.confirm_delete")}
				message={t("settings_albums.confirm_delete_message", { defaultValue: "This album and all its content will be permanently deleted." })}
				confirmLabel={isDeleting ? t("settings_albums.deleting") : t("settings_albums.delete")}
				cancelLabel={t("settings_albums.cancel")}
				onConfirm={() => void deleteAlbum()}
				onCancel={() => setIsConfirmDeleteOpen(false)}
				isProcessing={isDeleting}
				confirmTone="danger"
			/>

			<ConfirmDialog
				isOpen={confirmDeleteContentId !== null}
				title={t("settings_albums.confirm_delete")}
				message={t("settings_albums.confirm_delete_content_message", { defaultValue: "This image will be permanently removed from the album." })}
				confirmLabel={deletingContentId ? t("settings_albums.deleting") : t("settings_albums.delete")}
				cancelLabel={t("settings_albums.cancel")}
				onConfirm={() => { if (confirmDeleteContentId) void deleteAlbumPicture(confirmDeleteContentId); }}
				onCancel={() => setConfirmDeleteContentId(null)}
				isProcessing={deletingContentId !== null}
				confirmTone="danger"
			/>

			<ConfirmDialog
				isOpen={isConfirmUnshareAllOpen}
				title={t("settings_albums.unshare_all_title", { defaultValue: "Remove All Shares" })}
				message={t("settings_albums.unshare_all_message", { defaultValue: "This will remove access for everyone this album is shared with." })}
				confirmLabel={isUnsharingAll ? t("settings_albums.unsharing_all", { defaultValue: "Removing…" }) : t("settings_albums.unshare_all", { defaultValue: "Remove All" })}
				cancelLabel={t("settings_albums.cancel")}
				onConfirm={() => void unshareAll()}
				onCancel={() => setIsConfirmUnshareAllOpen(false)}
				isProcessing={isUnsharingAll}
				confirmTone="danger"
			/>

			{isDrawerPickerOpen ? (() => {
				const mediaCounts = countAlbumMedia(detail);
				const remainingSlots = limits?.maxContentItemsPerAlbum != null
					? Math.max(0, limits.maxContentItemsPerAlbum - mediaCounts.total)
					: Infinity;
				const remainingVideoSlots = limits?.maxVideosPerAlbum != null
					? Math.max(0, limits.maxVideosPerAlbum - mediaCounts.videos)
					: Infinity;
				return (
					<AlbumDrawerPickerSheet
						media={drawerMedia}
						isLoading={isLoadingDrawerMedia}
						error={drawerMediaError}
						onLoadMedia={() => loadDrawerMedia(true)}
						onClose={() => setIsDrawerPickerOpen(false)}
						onConfirm={handleAddFromDrawer}
						closeRef={drawerPickerCloseRef}
						isSubmitting={isAddingFromDrawer}
						remainingSlots={remainingSlots}
						remainingVideoSlots={remainingVideoSlots}
						isDesktop={isDesktop}
					/>
				);
			})() : null}
			{editingFiles && (
				<MediaEditSheet
					files={editingFiles}
					photoLabel={t("settings_albums.edit_photo", { defaultValue: "Edit photo" })}
					videoLabel={t("settings_albums.edit_video", { defaultValue: "Edit video" })}
					confirmLabel={t("settings_albums.add_video", { defaultValue: "Add to album" })}
					maxVideoMs={maxVideoMs}
					// Album uploads take neither.
					showTakenOnGrindr={false}
					showLooping={false}
					// An album takes a single video, so a split has nowhere to go.
					allowVideoSplit={false}
					isDesktop={isDesktop}
					zIndex="z-[70]"
					onConfirmFile={(edit) => editedFilesRef.current.push(edit.file)}
					onDone={finishMediaEdit}
				/>
			)}
		</>
	);
}
