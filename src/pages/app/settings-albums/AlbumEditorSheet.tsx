import {
	AlertTriangle,
	Clock,
	Film,
	GripVertical,
	Images,
	Inbox,
	Loader2,
	Play,
	Trash2,
	Upload,
	UserMinus,
	Users,
	Video,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
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
import { CameraFilled, CameraPlusFilled, ImagesFilled } from "../../../components/icons/FilledIcons";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { BottomSheet, SHEET_ICON_BUTTON_CLASS, SheetClose, SheetCloseButton, SHEET_FOOTER_CLASS, sheetButtonClass } from "../../../components/ui/bottom-sheet";
import { NATIVE_SHEET_BG, SheetActionList, afterSheetClose } from "../../../components/ui/action-sheet";
import { SheetSection, SheetTextInput } from "../../../components/ui/sheet-section";
import { ProfileImage } from "../../../components/ui/profile-image";
import type { Album, AlbumDetail, AlbumLimits, AlbumMedia } from "../../../types/albums";
import { getCachedMediaUri, getDrawerMediaKey } from "../../../services/mediaStore";
import { appLog } from "../../../utils/logger";
import { getThumbImageUrl, validateMediaHash } from "../../../utils/media";
import { proxyMediaUrl } from "../../../utils/mediaProxy";
import {
	DrawerActionBar,
	DrawerActionButton,
	DrawerEmptyState,
	DrawerGridSkeleton,
	DrawerHeader,
} from "../chat/drawerUi";
import type { DrawerMedia } from "../chat/ChatDrawerPanel";
import { AlbumDrawerPickerSheet } from "./AlbumDrawerPickerSheet";
import {
	buildMultipartBody,
	countAlbumMedia,
	formatMs,
	getVideodimensions,
	getVideoDurationMs,
} from "./settingsAlbumsUtils";
import { useOwnDrawerMedia } from "./useOwnDrawerMedia";

type SortableAlbumMediaItemProps = {
	item: AlbumMedia;
	index: number;
	isReordering: boolean;
	isDeleting: boolean;
	onDeleteClick: () => void;
};

function SortableAlbumMediaItem({
	item,
	index,
	isReordering,
	isDeleting,
	onDeleteClick,
}: SortableAlbumMediaItemProps) {
	const { t } = useTranslation();
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
		useSortable({ id: item.contentId });

	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
	};

	const imageUrl = item.thumbUrl || item.url || item.coverUrl || "";
	const isVideo = item.contentType?.startsWith("video/");
	const isProcessing = item.processing;
	const isRejected = item.rejectionId != null;
	// A freshly uploaded video has no preview until the server finishes
	// processing it; its thumb URL doesn't load yet either.
	const [previewFailed, setPreviewFailed] = useState(false);
	// The album poll swaps in a fresh URL once processing is done; try that one.
	useEffect(() => setPreviewFailed(false), [imageUrl]);
	const showPreview = Boolean(imageUrl) && !isProcessing && !previewFailed;

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={`relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)] ${isDragging ? "z-10 opacity-40" : ""}`}
		>
			{showPreview ? (
				<img
					src={proxyMediaUrl(imageUrl)}
					alt={t("settings_albums.media_alt", { index: index + 1 })}
					onError={() => setPreviewFailed(true)}
					className={`aspect-square w-full object-cover ${isRejected ? "opacity-40 grayscale" : ""}`}
				/>
			) : (
				<div className="flex aspect-square w-full flex-col items-center justify-center gap-1.5 bg-[var(--surface)] text-[var(--text-muted)]">
					{isVideo ? <Film className="h-7 w-7 opacity-50" /> : <Images className="h-7 w-7 opacity-50" />}
					{isProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin opacity-70" /> : null}
				</div>
			)}

			{isVideo && showPreview && (
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
					<div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm">
						<Play className="h-4 w-4 fill-white text-white" />
					</div>
				</div>
			)}

			{(isProcessing || isRejected) && (
				<div className="absolute left-1.5 top-1.5">
					<span
						className={[
							"inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white shadow-sm",
							isRejected ? "bg-red-500/90" : "bg-amber-500/90",
						].join(" ")}
					>
						{isRejected ? (
							<AlertTriangle className="h-2.5 w-2.5" />
						) : (
							<Clock className="h-2.5 w-2.5" />
						)}
						{isRejected
							? t("settings_albums.rejected", { defaultValue: "Rejected" })
							: t("settings_albums.processing", { defaultValue: "Processing" })}
					</span>
				</div>
			)}

			{!isReordering && (
				<div
					{...attributes}
					{...listeners}
					className="absolute right-1.5 top-1.5 cursor-grab touch-none rounded-lg bg-black/40 p-1.5 text-white backdrop-blur-sm active:cursor-grabbing"
				>
					<GripVertical className="h-3 w-3" />
				</div>
			)}

			<button
				type="button"
				onClick={onDeleteClick}
				disabled={isDeleting || isReordering}
				className="absolute bottom-1.5 right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md bg-black/50 text-white backdrop-blur-sm disabled:opacity-30"
				title={t("settings_albums.delete")}
			>
				<Trash2 className="h-3 w-3" />
			</button>
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
	const albumId = album.albumId;
	const [fetchedLimits, setFetchedLimits] = useState<AlbumLimits | null>(null);
	const limits = limitsProp !== undefined ? limitsProp : fetchedLimits;
	const [albumName, setAlbumName] = useState(album.albumName?.trim() ?? "");
	const [editingName, setEditingName] = useState(album.albumName?.trim() ?? "");
	const [isSavingEdit, setIsSavingEdit] = useState(false);
	const [detail, setDetail] = useState<AlbumDetail | undefined>(initialDetail);
	const [isLoadingDetails, setIsLoadingDetails] = useState(false);
	const [isUploading, setIsUploading] = useState(false);
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
	const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);

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
									: t("settings_albums.share_name_fallback", { defaultValue: "Someone" });
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

	// Drawer item as a File, for uploading it to an album directly. A locally
	// cached copy is a base64 data: URI, decoded here without a fetch; the CDN
	// URL goes through plugin-http, the webview's own fetch is blocked by CORS.
	const downloadDrawerMedia = async (item: DrawerMedia): Promise<File | null> => {
		const extension = item.contentType.split("/")[1]?.split(";")[0] || "mp4";
		const fileName = `drawer-${item.id}.${extension}`;
		try {
			const cachedUri = getCachedMediaUri(getDrawerMediaKey(item.id));
			const base64 = cachedUri?.startsWith("data:") ? cachedUri.slice(cachedUri.indexOf(",") + 1) : null;
			if (base64) {
				const binary = atob(base64);
				const bytes = new Uint8Array(binary.length);
				for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
				return new File([bytes], fileName, { type: item.contentType });
			}
			const response = await tauriFetch(item.url);
			if (!response.ok) throw new Error(`Download failed (${response.status})`);
			return new File([await response.arrayBuffer()], fileName, { type: item.contentType });
		} catch (downloadError) {
			appLog.warn(`[AlbumEditorSheet] failed to download drawer media ${item.id}`, downloadError);
			return null;
		}
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

				if (limits?.maxVideoLength != null || limits?.minVideoLength != null) {
					const durationMs = await getVideoDurationMs(file);
					if (durationMs != null) {
						if (limits.maxVideoLength != null && durationMs > limits.maxVideoLength) {
							toast.error(t("settings_albums.error_video_too_long", {
								defaultValue: "\"{{name}}\" is too long (max {{max}}).",
								name: file.name,
								max: formatMs(limits.maxVideoLength),
							}));
							continue;
						}
						if (limits.minVideoLength != null && durationMs < limits.minVideoLength) {
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

	const uploadFilesToAlbum = async (files: File[]) => {
		for (const file of files) {
			const multipart = await buildMultipartBody(file);
			const isVideo = file.type.startsWith("video/");
			const dims = isVideo ? await getVideodimensions(file) : undefined;
			await apiFunctions.uploadOwnAlbumContent({ albumId, multipart, ...dims });
		}
	};

	// Photos go in by drawer id. Videos can't (the by-id endpoint doesn't add
	// them), so they're downloaded from the drawer and uploaded directly.
	const handleAddFromDrawer = async (mediaIds: number[]) => {
		if (mediaIds.length === 0) return;
		const drawerById = new Map(drawerMedia.map((item) => [item.id, item]));
		const videoIds = mediaIds.filter((id) => drawerById.get(id)?.contentType.startsWith("video/"));
		const imageIds = mediaIds.filter((id) => !videoIds.includes(id));
		setIsAddingFromDrawer(true);
		try {
			let added = 0;
			if (imageIds.length > 0) {
				await apiFunctions.addOwnAlbumContentByIds({ albumId, ids: imageIds });
				added += imageIds.length;
			}
			if (videoIds.length > 0) {
				const downloaded: File[] = [];
				for (const id of videoIds) {
					const item = drawerById.get(id);
					const file = item ? await downloadDrawerMedia(item) : null;
					if (file) downloaded.push(file);
					else toast.error(t("settings_albums.error_drawer_video_download", { defaultValue: "Couldn't load a video from your drawer." }));
				}
				const valid = await filterAlbumUploads(downloaded);
				await uploadFilesToAlbum(valid);
				added += valid.length;
			}
			if (added > 0) toast.success(t("settings_albums.toast_added_from_drawer", { count: added }));
			await loadDetails();
			// Animated close; falls back to unmounting if the sheet is already gone.
			if (drawerPickerCloseRef.current) drawerPickerCloseRef.current();
			else setIsDrawerPickerOpen(false);
		} catch (addError) {
			toast.error(addError instanceof Error ? addError.message : t("settings_albums.error_upload_fallback"));
		} finally {
			setIsAddingFromDrawer(false);
		}
	};

	const handleUploadInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(event.target.files ?? []);
		event.target.value = "";
		if (!files.length || isUploading) return;
		const valid = await filterAlbumUploads(files);
		if (valid.length === 0) return;
		setIsUploading(true);
		try {
			await uploadFilesToAlbum(valid);
			toast.success(t("settings_albums.toast_picture_added", { count: valid.length }));
			await loadDetails();
		} catch (uploadError) {
			toast.error(uploadError instanceof Error ? uploadError.message : t("settings_albums.error_upload_fallback"));
		} finally {
			setIsUploading(false);
		}
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

	// Add actions, as in the collection editor: the bar above the media, or
	// the empty state's buttons. "Add media" asks: from the device or the drawer.
	const addActions = [
		{ key: "photo", icon: <CameraFilled className="h-4 w-4" />, label: t("chat_drawer.take_photo"), onClick: () => cameraInputRef.current?.click() },
		{ key: "video", icon: <Video className="h-4 w-4 fill-current" />, label: t("chat_drawer.record_video", { defaultValue: "Record video" }), onClick: () => cameraVideoInputRef.current?.click() },
		{
			key: "upload",
			icon: isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CameraPlusFilled className="h-4 w-4" />,
			label: isUploading ? t("settings_albums.uploading") : t("chat_drawer.add_media", { defaultValue: "Add media" }),
			onClick: () => setIsAddSheetOpen(true),
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
				panelClassName="px-4"
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

				<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4" data-lenis-prevent>
					{showDetailsSkeleton ? (
						<DrawerGridSkeleton isDesktop={isDesktop} />
					) : !detail || detail.content.length === 0 ? (
						<DrawerEmptyState
							icon={<ImagesFilled className="h-5 w-5" />}
							title={t("settings_albums.no_media")}
							hint={t("settings_albums.no_media_hint", { defaultValue: "Take a photo or video, upload from your device, or add media from your chat drawer." })}
						>
							<div className="grid w-full max-w-sm grid-cols-3 gap-2">
								{addActions.map((action) => (
									<DrawerActionButton key={action.key} icon={action.icon} label={action.label} onClick={action.onClick} disabled={isAdding} />
								))}
							</div>
						</DrawerEmptyState>
					) : (
						<DndContext
							sensors={sensors}
							onDragEnd={handleAlbumMediaDragEnd(detail.content)}
						>
							<SortableContext
								items={detail.content.map((item) => item.contentId)}
								strategy={rectSortingStrategy}
							>
								<div className={`grid gap-2 ${isDesktop ? "grid-cols-6" : "grid-cols-3"}`}>
									{/* Add actions as the grid's first row, like the collection editor. */}
									<DrawerActionBar actions={addActions} disabled={isAdding} />
									{detail.content.map((item, index) => (
										<SortableAlbumMediaItem
											key={`${albumId}-${item.contentId}`}
											item={item}
											index={index}
											isReordering={isReordering}
											isDeleting={deletingContentId === item.contentId}
											onDeleteClick={() => setConfirmDeleteContentId(item.contentId)}
										/>
									))}
								</div>
							</SortableContext>
						</DndContext>
					)}
				</div>

			</BottomSheet>

			{isAddSheetOpen && (
				<SheetActionList
					title={t("chat_drawer.add_media", { defaultValue: "Add media" })}
					onClose={() => setIsAddSheetOpen(false)}
					isDesktop={isDesktop}
					actions={[
						{
							key: "upload",
							icon: Upload,
							iconClassName: "bg-sky-500/15 text-sky-400",
							label: t("settings_albums.add_upload", { defaultValue: "Upload from device" }),
							description: t("settings_albums.add_upload_desc", { defaultValue: "Photos and videos stored on this device" }),
							// Clicked synchronously so it still counts as a user gesture.
							onSelect: () => uploadInputRef.current?.click(),
						},
						{
							key: "drawer",
							icon: Inbox,
							iconClassName: "bg-violet-500/15 text-violet-400",
							label: t("settings_albums.add_from_drawer", { defaultValue: "Add from Drawer" }),
							description: t("settings_albums.add_drawer_desc", { defaultValue: "Media saved in your chat drawer" }),
							// Once this sheet has popped its history entry.
							onSelect: () => afterSheetClose(openDrawerPicker),
						},
					]}
				/>
			)}

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
						isDesktop={isDesktop}
					/>
				);
			})() : null}
		</>
	);
}
