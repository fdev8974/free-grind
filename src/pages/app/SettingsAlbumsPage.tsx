import {
	Album as AlbumIcon,
	AlertTriangle,
	ChevronRight,
	Clock,
	Film,
	GripVertical,
	HardDrive,
	Images,
	Inbox,
	Loader2,
	Play,
	Plus,
	Share2,
	Trash2,
	Upload,
	UserMinus,
	Users,
} from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ChangeEvent,
} from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { useApiFunctions } from "../../hooks/useApiFunctions";
import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { BottomSheet, SHEET_ICON_BUTTON_CLASS, SheetClose, SheetCloseButton } from "../../components/ui/bottom-sheet";
import {
	ErrorState,
	LoadingState,
} from "../../components/ui/states";
import { ApiFunctionError } from "../../services/apiFunctions";
import {
	type Album,
	type AlbumDetail,
	type AlbumLimits,
	type AlbumMedia,
} from "../../types/albums";
import {
	buildMultipartBody,
	countAlbumMedia,
	getVideodimensions,
	getVideoDurationMs,
} from "./settings-albums/settingsAlbumsUtils";
import { AlbumDrawerPickerSheet } from "./settings-albums/AlbumDrawerPickerSheet";
import { DrawerCollectionsSection } from "./settings-albums/DrawerCollectionsSection";
import { EmptyStateCreateButton, NATIVE_SHEET_BG, SectionAddButton, SheetActionList, afterSheetClose } from "./settings-albums/SheetActionList";
import { SheetSection, SheetTextInput } from "../../components/ui/sheet-section";
import {
	DRAWER_PRIMARY_BUTTON_CLASS,
	DrawerEmptyState,
	DrawerFooter,
	DrawerGridSkeleton,
	DrawerHeader,
} from "./chat/drawerUi";
import type { DrawerMedia } from "./chat/ChatDrawerPanel";
import { sortDrawerMediaByUsage } from "./chat/chatUtils";
import * as chatDb from "../../services/chatDb";
import { getCachedMediaUri, getDrawerMediaKey } from "../../services/mediaStore";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { appLog } from "../../utils/logger";
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
import { ProfileImage } from "../../components/ui/profile-image";
import { getThumbImageUrl, validateMediaHash } from "../../utils/media";
import { useNavigate, useLocation } from "react-router-dom";
import { usePreferences } from "../../contexts/PreferencesContext";

function LimitRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
	return (
		<div className="flex items-center gap-3 px-4 py-3">
			<span className="shrink-0 text-[var(--text-muted)]">{icon}</span>
			<p className="min-w-0 flex-1 text-sm text-[var(--text-muted)]">{label}</p>
			<span className="shrink-0 rounded-lg bg-[var(--surface)] px-2.5 py-1 text-xs font-semibold tabular-nums">
				{value}
			</span>
		</div>
	);
}

function formatMs(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return seconds === 0 ? `${minutes} min` : `${minutes}:${String(seconds).padStart(2, "0")} min`;
}

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
					src={imageUrl}
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

type ShareProfileListItem = {
	profileId: number;
	displayName: string;
	avatarUrl: string | null;
};

export function SettingsAlbumsPage() {
	const { t } = useTranslation();
	const { sortDrawerMediaByFrequency } = usePreferences();
	const isDesktop = useDesktopBreakpoint();
	const apiFunctions = useApiFunctions();
	const navigate = useNavigate();
	const location = useLocation();
	const [albums, setAlbums] = useState<Album[]>([]);
	const [limits, setLimits] = useState<AlbumLimits | null>(null);
	const [isLimitsSheetOpen, setIsLimitsSheetOpen] = useState(false);
	const maxAlbums = limits?.maxAlbums ?? 1;
	const subscriptionType = limits?.subscriptionType ?? null;

	const planLabel = useMemo(() => {
		if (!subscriptionType) return null;
		return subscriptionType.replace(/Albums$/i, "").trim() || subscriptionType;
	}, [subscriptionType]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [createName, setCreateName] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [isCreateSheetOpen, setIsCreateSheetOpen] = useState(false);
	const createSheetCloseRef = useRef<(() => void) | null>(null);
	const [editingName, setEditingName] = useState("");
	const [isSavingEdit, setIsSavingEdit] = useState(false);
	const [deletingAlbumId, setDeletingAlbumId] = useState<string | null>(null);
	const [openAlbumId, setOpenAlbumId] = useState<string | null>(null);
	const [albumDetails, setAlbumDetails] = useState<Record<string, AlbumDetail>>({});
	const [loadingAlbumDetailsId, setLoadingAlbumDetailsId] = useState<string | null>(null);
	const [uploadingAlbumId, setUploadingAlbumId] = useState<string | null>(null);
	const [reorderingAlbumId, setReorderingAlbumId] = useState<string | null>(null);
	const [deletingContentKey, setDeletingContentKey] = useState<string | null>(null);
	const [confirmDeleteAlbumId, setConfirmDeleteAlbumId] = useState<string | null>(null);
	const [confirmDeleteContentKey, setConfirmDeleteContentKey] = useState<string | null>(null);
	const albumSheetCloseRef = useRef<(() => void) | null>(null);

	// Drawer picker state ("add to album" from own chat drawer media)
	const [drawerMedia, setDrawerMedia] = useState<DrawerMedia[]>([]);
	const [isLoadingDrawerMedia, setIsLoadingDrawerMedia] = useState(false);
	const [drawerMediaError, setDrawerMediaError] = useState<string | null>(null);
	const [drawerPickerAlbumId, setDrawerPickerAlbumId] = useState<string | null>(null);
	const [isAddingFromDrawer, setIsAddingFromDrawer] = useState(false);

	// Shares state
	const [albumShareProfiles, setAlbumShareProfiles] = useState<Record<string, ShareProfileListItem[]>>({});
	const [loadingSharesAlbumId, setLoadingSharesAlbumId] = useState<string | null>(null);
	const [unsharingKey, setUnsharingKey] = useState<string | null>(null);
	const [unsharingAllAlbumId, setUnsharingAllAlbumId] = useState<string | null>(null);
	const [confirmUnshareAllAlbumId, setConfirmUnshareAllAlbumId] = useState<string | null>(null);
	const [sharesSheetAlbumId, setSharesSheetAlbumId] = useState<string | null>(null);
	const [addSheetAlbumId, setAddSheetAlbumId] = useState<string | null>(null);
	const pendingShareNavigationRef = useRef<(() => void) | null>(null);

	// DnD sensors
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
		useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
	);

	const loadAlbumsAndLimits = useCallback(async () => {
		setIsLoading(true);
		setError(null);
		try {
			const [ownAlbums, ownStorage] = await Promise.all([
				apiFunctions.getOwnAlbums(),
				apiFunctions.getOwnAlbumStorage(),
			]);
			setAlbums(ownAlbums);
			setLimits(ownStorage);

			// Load covers in background without blocking
			void Promise.all(
				ownAlbums.map(async (album) => {
					try {
						const detail = await apiFunctions.getOwnAlbumDetails(album.albumId);
						setAlbumDetails((prev) => ({ ...prev, [album.albumId]: detail }));
					} catch {
						// silently skip
					}
				}),
			);
		} catch (loadError) {
			setError(loadError instanceof Error ? loadError.message : t("settings_albums.error_load_fallback"));
		} finally {
			setIsLoading(false);
		}
	}, [apiFunctions]);

	useEffect(() => {
		void loadAlbumsAndLimits();
	}, [loadAlbumsAndLimits]);

	// Persist open album across navigation
	useEffect(() => {
		if (openAlbumId) {
			sessionStorage.setItem("settings-albums-open", openAlbumId);
		} else {
			sessionStorage.removeItem("settings-albums-open");
		}
	}, [openAlbumId]);

	// Poll album details every 3 s while the open album has processing items.
	// albumDetails kept in a ref so the interval doesn't restart on every poll response.
	const albumDetailsRef = useRef(albumDetails);
	albumDetailsRef.current = albumDetails;
	useEffect(() => {
		if (!openAlbumId) return;
		let cancelled = false;

		const tick = async () => {
			const detail = albumDetailsRef.current[openAlbumId];
			if (!detail?.content.some((item) => item.processing)) return;
			try {
				const updated = await apiFunctions.getOwnAlbumDetails(openAlbumId);
				if (!cancelled) {
					setAlbumDetails((prev) => ({ ...prev, [openAlbumId]: updated }));
				}
			} catch {
				// silently skip failed poll
			}
		};

		const id = setInterval(() => { void tick(); }, 3000);

		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [openAlbumId, apiFunctions]);

	const canCreateAlbum = useMemo(() => albums.length < maxAlbums, [albums.length, maxAlbums]);

	const handleCreateAlbum = async () => {
		if (!canCreateAlbum || isCreating) return;
		setIsCreating(true);
		const albumName = createName.trim() || `Album ${albums.length + 1}`;
		try {
			await apiFunctions.createOwnAlbum({ albumName });
			setCreateName("");
			toast.success(t("settings_albums.toast_created"));
			createSheetCloseRef.current?.();
			await loadAlbumsAndLimits();
		} catch (createError) {
			if (createError instanceof ApiFunctionError && createError.status === 402) {
				toast.error(t("settings_albums.limit_reached_toast"));
				return;
			}
			toast.error(createError instanceof Error ? createError.message : t("settings_albums.error_create_fallback"));
		} finally {
			setIsCreating(false);
		}
	};

	// The album sheet's name field: saved when it loses focus (or on Enter);
	// an empty or failed rename falls back to the current name.
	const saveAlbumName = async (album: Album) => {
		const current = album.albumName?.trim() ?? "";
		const next = editingName.trim();
		if (!next) {
			setEditingName(current);
			return;
		}
		if (next === current || isSavingEdit) return;
		setIsSavingEdit(true);
		try {
			await apiFunctions.renameOwnAlbum({ albumId: album.albumId, albumName: next });
			setAlbums((previous) =>
				previous.map((item) =>
					item.albumId === album.albumId ? { ...item, albumName: next } : item,
				),
			);
			setEditingName(next);
			toast.success(t("settings_albums.toast_renamed"));
		} catch (saveError) {
			setEditingName(current);
			toast.error(saveError instanceof Error ? saveError.message : t("settings_albums.error_rename_fallback"));
		} finally {
			setIsSavingEdit(false);
		}
	};

	const deleteAlbum = async (albumId: string) => {
		if (deletingAlbumId) return;
		setDeletingAlbumId(albumId);
		try {
			await apiFunctions.deleteOwnAlbum({ albumId });
			const removeAlbum = () => setAlbums((previous) => previous.filter((album) => album.albumId !== albumId));
			if (openAlbumId === albumId) {
				// Let the album sheet animate out (and pop its history entry) before the album disappears.
				albumSheetCloseRef.current?.();
				afterSheetClose(removeAlbum);
			} else {
				removeAlbum();
			}
			setConfirmDeleteAlbumId((previous) => previous === albumId ? null : previous);
			toast.success(t("settings_albums.toast_deleted"));
		} catch (deleteError) {
			toast.error(deleteError instanceof Error ? deleteError.message : t("settings_albums.error_delete_fallback"));
		} finally {
			setDeletingAlbumId(null);
		}
	};

	const loadAlbumDetails = useCallback(async (albumId: string, forceRefresh = false) => {
		if (!forceRefresh && albumDetails[albumId]) return;
		setLoadingAlbumDetailsId(albumId);
		try {
			const parsed = await apiFunctions.getOwnAlbumDetails(albumId);
			setAlbumDetails((previous) => ({ ...previous, [albumId]: parsed }));
		} catch (loadError) {
			toast.error(loadError instanceof Error ? loadError.message : t("settings_albums.error_load_details_fallback"));
		} finally {
			setLoadingAlbumDetailsId((previous) => previous === albumId ? null : previous);
		}
	}, [albumDetails, apiFunctions]);

	const loadDrawerMedia = useCallback(async (forceRefresh = false) => {
		if (!forceRefresh && drawerMedia.length > 0) return;
		setIsLoadingDrawerMedia(true);
		setDrawerMediaError(null);
		try {
			const [items, sendCounts] = await Promise.all([
				apiFunctions.getGlobalDrawerMedia(),
				chatDb.getDrawerMediaSendCounts(),
			]);
			const withCounts = items.map((item) => ({ ...item, sendCount: sendCounts.get(item.id) ?? 0 }));
			setDrawerMedia(
				sortDrawerMediaByFrequency ? sortDrawerMediaByUsage(withCounts) : withCounts,
			);
		} catch (loadError) {
			setDrawerMediaError(
				loadError instanceof Error ? loadError.message : t("settings_albums.error_load_details_fallback"),
			);
		} finally {
			setIsLoadingDrawerMedia(false);
		}
	}, [apiFunctions, drawerMedia.length, sortDrawerMediaByFrequency, t]);

	const openDrawerPicker = useCallback((albumId: string) => {
		const mediaCounts = countAlbumMedia(albumDetails[albumId]);
		if (limits?.maxContentItemsPerAlbum != null && mediaCounts.total >= limits.maxContentItemsPerAlbum) {
			toast.error(t("settings_albums.error_album_full", {
				defaultValue: "Album is full (max {{max}} items).",
				max: limits.maxContentItemsPerAlbum,
			}));
			return;
		}
		setDrawerPickerAlbumId(albumId);
		// Force-refresh — otherwise the guard in loadDrawerMedia reuses the
		// cached list from a previous picker session and drawer media added
		// since then (e.g. from the chat screen) never shows up here.
		void loadDrawerMedia(true);
	}, [albumDetails, limits, loadDrawerMedia, t]);

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
			appLog.warn(`[SettingsAlbumsPage] failed to download drawer media ${item.id}`, downloadError);
			return null;
		}
	};

	// Photos go in by drawer id. Videos can't (the by-id endpoint doesn't add
	// them), so they're downloaded from the drawer and uploaded directly.
	const drawerPickerCloseRef = useRef<(() => void) | null>(null);
	const handleAddFromDrawer = async (mediaIds: number[]) => {
		if (!drawerPickerAlbumId || mediaIds.length === 0) return;
		const albumId = drawerPickerAlbumId;
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
				const valid = await filterAlbumUploads(albumId, downloaded);
				await uploadFilesToAlbum(albumId, valid);
				added += valid.length;
			}
			if (added > 0) toast.success(t("settings_albums.toast_added_from_drawer", { count: added }));
			await loadAlbumDetails(albumId, true);
			// Animated close; falls back to unmounting if the sheet is already gone.
			if (drawerPickerCloseRef.current) drawerPickerCloseRef.current();
			else setDrawerPickerAlbumId(null);
		} catch (addError) {
			toast.error(addError instanceof Error ? addError.message : t("settings_albums.error_upload_fallback"));
		} finally {
			setIsAddingFromDrawer(false);
		}
	};

	const loadAlbumShares = useCallback(async (albumId: string, forceRefresh = false) => {
		if (!forceRefresh && albumShareProfiles[albumId]) return;
		setLoadingSharesAlbumId(albumId);
		try {
			const profileIds = await apiFunctions.getAlbumShares({ albumId });
			if (profileIds.length === 0) {
				setAlbumShareProfiles((prev) => ({ ...prev, [albumId]: [] }));
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

			setAlbumShareProfiles((prev) => ({
				...prev,
				[albumId]: profileIds
					.filter((profileId) => detailsById.has(profileId))
					.map((profileId) => {
						const meta = detailsById.get(profileId)!;
						return {
							profileId,
							displayName: meta.displayName,
							avatarUrl: meta.avatarUrl,
						};
					}),
			}));
		} catch (loadError) {
			toast.error(loadError instanceof Error ? loadError.message : t("settings_albums.error_load_shares", { defaultValue: "Failed to load album shares." }));
		} finally {
			setLoadingSharesAlbumId((prev) => prev === albumId ? null : prev);
		}
	}, [albumShareProfiles, apiFunctions, t]);

	// Restore open album after initial load (placed after loadAlbumDetails/loadAlbumShares declarations)
	const restoredRef = useRef(false);
	useEffect(() => {
		if (isLoading || albums.length === 0 || restoredRef.current) return;
		restoredRef.current = true;
		// An album handed over via navigation state (e.g. the chat drawer's
		// edit button) wins over the one remembered from this session.
		const requestedId = (location.state as { openAlbumId?: unknown } | null)?.openAlbumId;
		const fromNavigation = typeof requestedId === "string" || typeof requestedId === "number";
		const savedId = fromNavigation ? String(requestedId) : sessionStorage.getItem("settings-albums-open");
		if (!savedId || !albums.some((a) => String(a.albumId) === savedId)) return;
		const restored = albums.find((a) => String(a.albumId) === savedId)!;
		const albumId = restored.albumId;
		setOpenAlbumId(albumId);
		setEditingName(restored.albumName?.trim() ?? "");
		void loadAlbumDetails(albumId);
		void loadAlbumShares(albumId);
	}, [isLoading, albums, loadAlbumDetails, loadAlbumShares, location.state]);

	const unshareAlbumFromProfile = async (albumId: string, profileId: number) => {
		const key = `${albumId}:${profileId}`;
		if (unsharingKey === key) return;
		setUnsharingKey(key);
		try {
			await apiFunctions.unshareAlbum({ albumId, profiles: [{ profileId, shareId: 0 }] });
			setAlbumShareProfiles((prev) => ({
				...prev,
				[albumId]: (prev[albumId] ?? []).filter((p) => p.profileId !== profileId),
			}));
			toast.success(t("settings_albums.toast_unshared", { defaultValue: "Album share removed." }));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t("settings_albums.error_unshare", { defaultValue: "Failed to remove share." }));
		} finally {
			setUnsharingKey(null);
		}
	};

	const unshareAllFromAlbum = async (albumId: string) => {
		const profiles = albumShareProfiles[albumId] ?? [];
		if (!profiles.length || unsharingAllAlbumId === albumId) return;
		setUnsharingAllAlbumId(albumId);
		try {
			await apiFunctions.unshareAlbum({
				albumId,
				profiles: profiles.map((p) => ({ profileId: p.profileId, shareId: 0 })),
			});
			setAlbumShareProfiles((prev) => ({ ...prev, [albumId]: [] }));
			toast.success(t("settings_albums.toast_unshared_all", { defaultValue: "All shares removed." }));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t("settings_albums.error_unshare", { defaultValue: "Failed to remove share." }));
		} finally {
			setUnsharingAllAlbumId(null);
			setConfirmUnshareAllAlbumId(null);
		}
	};

	/** "3 / 50 items · 1 / 10 videos · 2 shared" — parts without data are left out. */
	const formatAlbumMeta = (counts: { total: number; videos: number } | null, sharedCount: number | null) => {
		const items = t("settings_albums.media_items", { defaultValue: "items" });
		const videos = t("settings_albums.media_videos", { defaultValue: "videos" });
		return [
			counts && (limits?.maxContentItemsPerAlbum != null
				? `${counts.total} / ${limits.maxContentItemsPerAlbum} ${items}`
				: counts.total > 0 ? `${counts.total} ${items}` : null),
			counts && (limits?.maxVideosPerAlbum != null
				? `${counts.videos} / ${limits.maxVideosPerAlbum} ${videos}`
				: counts.videos > 0 ? `${counts.videos} ${videos}` : null),
			sharedCount ? `${sharedCount} ${t("settings_albums.shared_count", { defaultValue: "shared" })}` : null,
		].filter(Boolean).join(" · ");
	};

	const openAlbum = (albumId: string) => {
		setOpenAlbumId(albumId);
		setEditingName(albums.find((album) => album.albumId === albumId)?.albumName?.trim() ?? "");
		void loadAlbumDetails(albumId);
		void loadAlbumShares(albumId);
	};

	// Applies the album's limits (free slots, size, video count and length)
	// to files about to be uploaded; toasts and drops the ones that don't fit.
	const filterAlbumUploads = async (albumId: string, files: File[]): Promise<File[]> => {
		const detail = albumDetails[albumId];
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

	const uploadFilesToAlbum = async (albumId: string, files: File[]) => {
		for (const file of files) {
			const multipart = await buildMultipartBody(file);
			const isVideo = file.type.startsWith("video/");
			const dims = isVideo ? await getVideodimensions(file) : undefined;
			await apiFunctions.uploadOwnAlbumContent({ albumId, multipart, ...dims });
		}
	};

	const uploadPictures = async (albumId: string, files: File[]) => {
		if (!files.length || uploadingAlbumId) return;

		const valid = await filterAlbumUploads(albumId, files);
		if (valid.length === 0) return;

		setUploadingAlbumId(albumId);
		try {
			await uploadFilesToAlbum(albumId, valid);
			toast.success(t("settings_albums.toast_picture_added", { count: valid.length }));
			await loadAlbumDetails(albumId, true);
		} catch (uploadError) {
			toast.error(uploadError instanceof Error ? uploadError.message : t("settings_albums.error_upload_fallback"));
		} finally {
			setUploadingAlbumId(null);
		}
	};

	const handleUploadInputChange = async (albumId: string, event: ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(event.target.files ?? []);
		event.target.value = "";
		await uploadPictures(albumId, files);
	};

	const reorderAlbumContent = async (albumId: string, content: AlbumMedia[], fromIndex: number, toIndex: number) => {
		if (reorderingAlbumId || fromIndex < 0 || toIndex < 0) return;
		if (toIndex >= content.length || fromIndex >= content.length) return;

		const reordered = arrayMove(content, fromIndex, toIndex);
		const contentIds = reordered.map((item) => Number.parseInt(item.contentId, 10));
		if (contentIds.some((value) => Number.isNaN(value))) {
			toast.error(t("settings_albums.error_reorder_unsupported"));
			return;
		}

		setAlbumDetails((previous) => {
			const detail = previous[albumId];
			if (!detail) return previous;
			return { ...previous, [albumId]: { ...detail, content: reordered } };
		});

		setReorderingAlbumId(albumId);
		try {
			await apiFunctions.reorderOwnAlbumContent({ albumId, contentIds });
			toast.success(t("settings_albums.toast_reordered", { defaultValue: "Order saved." }));
		} catch (reorderError) {
			// Revert on failure
			setAlbumDetails((previous) => {
				const detail = previous[albumId];
				if (!detail) return previous;
				return { ...previous, [albumId]: { ...detail, content: content } };
			});
			toast.error(reorderError instanceof Error ? reorderError.message : t("settings_albums.error_reorder_fallback"));
		} finally {
			setReorderingAlbumId(null);
		}
	};

	const handleAlbumMediaDragEnd = (albumId: string, content: AlbumMedia[]) => (event: DragEndEvent) => {
		const { active, over } = event;
		if (!over || active.id === over.id) return;
		const from = content.findIndex((item) => item.contentId === String(active.id));
		const to = content.findIndex((item) => item.contentId === String(over.id));
		if (from === -1 || to === -1) return;
		void reorderAlbumContent(albumId, content, from, to);
	};

	const deleteAlbumPicture = async (albumId: string, contentId: string) => {
		if (deletingContentKey) return;
		const deleteKey = `${albumId}:${contentId}`;
		setDeletingContentKey(deleteKey);
		try {
			await apiFunctions.deleteOwnAlbumContent({ albumId, contentId });
			setAlbumDetails((previous) => {
				const detail = previous[albumId];
				if (!detail) return previous;
				return { ...previous, [albumId]: { ...detail, content: detail.content.filter((item) => item.contentId !== contentId) } };
			});
			setConfirmDeleteContentKey((previous) => previous === deleteKey ? null : previous);
			toast.success(t("settings_albums.toast_picture_removed"));
		} catch (deleteError) {
			toast.error(deleteError instanceof Error ? deleteError.message : t("settings_albums.error_delete_content_fallback"));
		} finally {
			setDeletingContentKey(null);
		}
	};

	return (
		<section className="app-screen">
			<div className="grid gap-6">
				<PageHeader
					backTo="/settings"
					title={t("settings_albums.title")}
					subtitle={t("settings_albums.subtitle", { defaultValue: "Manage your private albums." })}
					subtitleClassName="-mt-4 mb-0"
					actions={limits ? (
						<button
							type="button"
							onClick={() => setIsLimitsSheetOpen(true)}
							className="header-icon-btn inline-flex shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-2 text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
							aria-label={t("settings_albums.limits_title", { defaultValue: "Plan Limits" })}
							title={t("settings_albums.limits_title", { defaultValue: "Plan Limits" })}
						>
							<HardDrive className="h-4 w-4" />
						</button>
					) : undefined}
				/>

				{/* Albums list */}
				<div className="min-w-0">
					<div className="mb-2 flex items-center gap-2 px-1">
						<p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
							{t("settings_albums.your_albums")}
						</p>
						{albums.length > 0 && (
							<span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-bold tabular-nums text-[var(--text-muted)]">
								{albums.length}
							</span>
						)}
						{/* The empty state has its own create button. */}
						{!isLoading && !error && albums.length > 0 && (
							<SectionAddButton
								label={t("settings_albums.new_short", { defaultValue: "New" })}
								onClick={() => setIsCreateSheetOpen(true)}
								disabled={!canCreateAlbum}
							/>
						)}
					</div>

					{isLoading ? (
						<LoadingState title={t("settings_albums.loading")} description={t("settings_albums.loading_desc")} compact />
					) : error ? (
						<ErrorState title={t("settings_albums.error_load")} description={error} onRetry={() => void loadAlbumsAndLimits()} />
					) : (
						<>
						{albums.length > 0 ? (
						<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
							{albums.map((album) => {
								const detail = albumDetails[album.albumId];
								const mediaCounts = countAlbumMedia(detail);
								const coverUrl = detail?.content[0]?.thumbUrl || detail?.content[0]?.url || detail?.content[0]?.coverUrl;
								const shareProfiles = albumShareProfiles[album.albumId];

								return (
									<button
										key={album.albumId}
										type="button"
										onClick={() => openAlbum(album.albumId)}
										className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)]"
									>
										{/* Same 40px tile as the settings list's icons. */}
										{coverUrl ? (
											<img src={coverUrl} alt="" className="h-10 w-10 shrink-0 rounded-2xl object-cover" />
										) : (
											<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--surface-2)] text-[var(--text-muted)]">
												<Images className="h-5 w-5 opacity-50" />
											</div>
										)}
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-semibold leading-snug">
												{album.albumName?.trim() || t("settings_albums.untitled")}
											</p>
											<p className="mt-0.5 truncate text-xs leading-snug text-[var(--text-muted)]">
												{formatAlbumMeta(detail ? mediaCounts : null, shareProfiles?.length ?? 0) || `#${album.albumId}`}
											</p>
										</div>
										<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)] opacity-50" />
									</button>
								);
							})}
						</div>
						) : (
							// Same empty state as the chat drawer's Albums tab.
							<div className="surface-card overflow-hidden px-4">
								<DrawerEmptyState
									icon={<AlbumIcon className="h-5 w-5" />}
									title={t("chat_drawer.albums_empty", { defaultValue: "You don't have any albums yet." })}
									hint={t("chat_drawer.albums_empty_hint", { defaultValue: "Albums let you share several photos at once, and stop sharing any time." })}
								>
									<EmptyStateCreateButton
										label={t("chat_drawer.albums_create", { defaultValue: "Create album" })}
										onClick={() => setIsCreateSheetOpen(true)}
										disabled={!canCreateAlbum}
									/>
								</DrawerEmptyState>
							</div>
						)}
						<p className="mt-2 px-1 text-xs leading-relaxed text-[var(--text-muted)]">
							{canCreateAlbum
								? t("settings_albums.usage", { count: albums.length, max: maxAlbums })
								: t("settings_albums.limit_reached")}
						</p>
						</>
					)}
				</div>

				<DrawerCollectionsSection
					drawerMedia={drawerMedia}
					isLoadingDrawerMedia={isLoadingDrawerMedia}
					drawerMediaError={drawerMediaError}
					loadDrawerMedia={loadDrawerMedia}
					isDesktop={isDesktop}
				/>
			</div>

			{openAlbumId && (() => {
				const album = albums.find((item) => item.albumId === openAlbumId);
				if (!album) return null;
				const albumId = album.albumId;
				const detail = albumDetails[albumId];
				const isLoadingDetails = loadingAlbumDetailsId === albumId && !detail;
				const mediaCounts = countAlbumMedia(detail);
				const shareProfiles = albumShareProfiles[albumId];
				const isLoadingShares = loadingSharesAlbumId === albumId;
				const isUploading = uploadingAlbumId === albumId;
				return (
					<BottomSheet
						onClose={() => setOpenAlbumId(null)}
						closeRef={albumSheetCloseRef}
						expandable
						isDesktop={isDesktop}
						bg={NATIVE_SHEET_BG}
						panelClassName="px-4"
					>
						<DrawerHeader
							className="mb-1"
							title={album.albumName?.trim() || t("settings_albums.untitled")}
							actions={
								<>
									<button
										type="button"
										onClick={() => setConfirmDeleteAlbumId(albumId)}
										disabled={deletingAlbumId === albumId}
										className={`${SHEET_ICON_BUTTON_CLASS} hover:!text-red-400`}
										aria-label={t("settings_albums.delete")}
										title={t("settings_albums.delete")}
									>
										{deletingAlbumId === albumId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
									</button>
								</>
							}
						/>
						<p className="mb-4 text-xs text-[var(--text-muted)]">
							{formatAlbumMeta(detail ? mediaCounts : null, null) || `#${albumId}`}
						</p>

						<SheetSection title={t("settings_albums.name_label", { defaultValue: "Name" })} className="mb-4">
							<SheetTextInput
								value={editingName}
								onChange={setEditingName}
								onCommit={() => void saveAlbumName(album)}
								placeholder={t("settings_albums.new_album_placeholder")}
								maxLength={255}
								disabled={isSavingEdit}
								trailing={isSavingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
							/>
						</SheetSection>

						{/* Who can see this album — its own row, the list itself lives in a stacked sheet. */}
						<button
							type="button"
							onClick={() => {
								setSharesSheetAlbumId(albumId);
								void loadAlbumShares(albumId);
							}}
							className="mb-4 flex w-full items-center gap-3 rounded-2xl bg-[var(--surface-2)] px-3 py-2.5 text-left transition hover:bg-[color-mix(in_srgb,var(--surface-2)_80%,var(--text)_8%)] active:scale-[0.99]"
						>
							<div className="shrink-0 rounded-xl bg-emerald-500/15 p-2 text-emerald-400">
								<Users className="h-4 w-4" />
							</div>
							<p className="min-w-0 flex-1 truncate text-sm font-semibold">
								{t("settings_albums.shared_with", { defaultValue: "Shared With" })}
							</p>
							<span className="flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums text-[var(--text-muted)]">
								{isLoadingShares && !shareProfiles ? (
									<span className="h-3 w-4 animate-pulse rounded-full bg-[var(--surface)]" />
								) : (
									shareProfiles?.length ?? 0
								)}
								<ChevronRight className="h-4 w-4 opacity-60" />
							</span>
						</button>

						<input
							id={`album-upload-${albumId}`}
							type="file"
							accept="image/*,video/*"
							multiple
							onChange={(e) => void handleUploadInputChange(albumId, e)}
							className="hidden"
						/>

						<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4" data-lenis-prevent>
							{isLoadingDetails ? (
								<DrawerGridSkeleton isDesktop={isDesktop} />
							) : !detail || detail.content.length === 0 ? (
								<p className="py-8 text-center text-sm text-[var(--text-muted)]">{t("settings_albums.no_media")}</p>
							) : (
								<DndContext
									sensors={sensors}
									onDragEnd={handleAlbumMediaDragEnd(albumId, detail.content)}
								>
									<SortableContext
										items={detail.content.map((item) => item.contentId)}
										strategy={rectSortingStrategy}
									>
										<div className={`grid gap-2 ${isDesktop ? "grid-cols-6" : "grid-cols-3"}`}>
											{detail.content.map((item, index) => {
												const deleteKey = `${albumId}:${item.contentId}`;
												return (
													<SortableAlbumMediaItem
														key={`${albumId}-${item.contentId}`}
														item={item}
														index={index}
														isReordering={reorderingAlbumId === albumId}
														isDeleting={deletingContentKey === deleteKey}
														onDeleteClick={() => setConfirmDeleteContentKey(deleteKey)}
													/>
												);
											})}
										</div>
									</SortableContext>
								</DndContext>
							)}
						</div>

						<DrawerFooter>
							<button
								type="button"
								onClick={() => setAddSheetAlbumId(albumId)}
								disabled={isUploading}
								className={DRAWER_PRIMARY_BUTTON_CLASS}
							>
								{isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
								<span>
									{isUploading
										? t("settings_albums.uploading")
										: t("settings_albums.add", { defaultValue: "Add" })}
								</span>
							</button>
						</DrawerFooter>
					</BottomSheet>
				);
			})()}

			{isLimitsSheetOpen && limits && (
				<BottomSheet
					onClose={() => setIsLimitsSheetOpen(false)}
					expandable
					isDesktop={isDesktop}
					bg={NATIVE_SHEET_BG}
					panelClassName={isDesktop ? "max-h-[82dvh] px-4" : "px-4"}
				>
					<DrawerHeader
						title={
							<span className="flex items-center gap-2">
								{t("settings_albums.limits_title", { defaultValue: "Plan Limits" })}
								{planLabel && (
									<span className="rounded-full bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--accent)]">
										{planLabel}
									</span>
								)}
							</span>
						}
					/>
					<div className="-mx-4 min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-2" data-lenis-prevent>
						<SheetSection
							title={t("settings_albums.limits_albums_used", { defaultValue: "Albums" })}
							value={`${albums.length} / ${maxAlbums}`}
						>
							<div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
								<div
									className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
									style={{ width: `${Math.min(100, (albums.length / maxAlbums) * 100)}%` }}
								/>
							</div>
						</SheetSection>
						<SheetSection title={t("settings_albums.limits_details", { defaultValue: "Details" })}>
					<div className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl bg-[var(--surface-2)]">
						{limits.maxContentItemsPerAlbum != null && (
							<LimitRow icon={<Images className="h-4 w-4" />} label={t("settings_albums.limits_items_per_album", { defaultValue: "Items per Album" })} value={String(limits.maxContentItemsPerAlbum)} />
						)}
						{limits.maxVideosPerAlbum != null && (
							<LimitRow icon={<Film className="h-4 w-4" />} label={t("settings_albums.limits_videos_per_album", { defaultValue: "Videos per Album" })} value={String(limits.maxVideosPerAlbum)} />
						)}
						{limits.maxVideoLength != null && (
							<LimitRow icon={<Film className="h-4 w-4" />} label={t("settings_albums.limits_max_video_length", { defaultValue: "Max Video Length" })} value={formatMs(limits.maxVideoLength)} />
						)}
						{limits.minVideoLength != null && (
							<LimitRow icon={<Film className="h-4 w-4" />} label={t("settings_albums.limits_min_video_length", { defaultValue: "Min Video Length" })} value={formatMs(limits.minVideoLength)} />
						)}
						{limits.maxContentSizeHumanReadable != null && (
							<LimitRow icon={<HardDrive className="h-4 w-4" />} label={t("settings_albums.limits_storage", { defaultValue: "Max File Size" })} value={limits.maxContentSizeHumanReadable} />
						)}
						{limits.maxShares != null && (
							<LimitRow icon={<Share2 className="h-4 w-4" />} label={t("settings_albums.limits_shares", { defaultValue: "Shares" })} value={String(limits.maxShares)} />
						)}
						{limits.maxShareableAlbums != null && (
							<LimitRow icon={<Share2 className="h-4 w-4" />} label={t("settings_albums.limits_shareable_albums", { defaultValue: "Shareable Albums" })} value={String(limits.maxShareableAlbums)} />
						)}
						{limits.maxViewableAlbums != null && (
							<LimitRow icon={<Images className="h-4 w-4" />} label={t("settings_albums.limits_viewable_albums", { defaultValue: "Viewable Albums (others)" })} value={String(limits.maxViewableAlbums)} />
						)}
						{limits.maxViewableVideos != null && (
							<LimitRow icon={<Film className="h-4 w-4" />} label={t("settings_albums.limits_viewable_videos", { defaultValue: "Viewable Videos (others)" })} value={String(limits.maxViewableVideos)} />
						)}
					</div>
						</SheetSection>
					</div>
				</BottomSheet>
			)}

			{isCreateSheetOpen && (
				<BottomSheet
					onClose={() => setIsCreateSheetOpen(false)}
					closeRef={createSheetCloseRef}
					isProcessing={isCreating}
					isDesktop={isDesktop}
					bg={NATIVE_SHEET_BG}
					panelClassName="px-4"
				>
					<DrawerHeader title={t("settings_albums.create")} />
					{/* Fills the sheet (min 50dvh on mobile) so the footer sits at the bottom, not under the field. */}
					<form
						className="flex min-h-0 flex-1 flex-col"
						onSubmit={(event) => {
							event.preventDefault();
							void handleCreateAlbum();
						}}
					>
						<SheetSection title={t("settings_albums.name_label", { defaultValue: "Name" })}>
							<SheetTextInput
								value={createName}
								onChange={setCreateName}
								placeholder={t("settings_albums.new_album_placeholder")}
								maxLength={255}
								disabled={isCreating}
								autoFocus
							/>
							<p className="mt-2 px-1 text-xs text-[var(--text-muted)]">
								{t("settings_albums.usage", { count: albums.length, max: maxAlbums })}
							</p>
						</SheetSection>
						<div className="mt-auto">
							<DrawerFooter>
								<button
									type="submit"
									disabled={!canCreateAlbum || isCreating}
									className={DRAWER_PRIMARY_BUTTON_CLASS}
								>
									{isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
									<span>{isCreating ? t("settings_albums.creating") : t("settings_albums.create")}</span>
								</button>
							</DrawerFooter>
						</div>
					</form>
				</BottomSheet>
			)}

			{addSheetAlbumId && (
				<SheetActionList
					title={t("settings_albums.upload")}
					onClose={() => setAddSheetAlbumId(null)}
					isDesktop={isDesktop}
					actions={[
						{
							key: "upload",
							icon: Upload,
							iconClassName: "bg-sky-500/15 text-sky-400",
							label: t("settings_albums.add_upload", { defaultValue: "Upload from device" }),
							description: t("settings_albums.add_upload_desc", { defaultValue: "Photos and videos stored on this device" }),
							// The album's hidden file input; clicked synchronously so it still counts as a user gesture.
							onSelect: () => document.getElementById(`album-upload-${addSheetAlbumId}`)?.click(),
						},
						{
							key: "drawer",
							icon: Inbox,
							iconClassName: "bg-violet-500/15 text-violet-400",
							label: t("settings_albums.add_from_drawer", { defaultValue: "Add from Drawer" }),
							description: t("settings_albums.add_drawer_desc", { defaultValue: "Media saved in your chat drawer" }),
							onSelect: () => {
								const albumId = addSheetAlbumId;
								afterSheetClose(() => openDrawerPicker(albumId));
							},
						},
					]}
				/>
			)}

			{sharesSheetAlbumId && (() => {
				const albumId = sharesSheetAlbumId;
				const shareProfiles = albumShareProfiles[albumId];
				const isLoadingShares = loadingSharesAlbumId === albumId;
				return (
					<BottomSheet
						onClose={() => {
							setSharesSheetAlbumId(null);
							const next = pendingShareNavigationRef.current;
							pendingShareNavigationRef.current = null;
							if (!next) return;
							// Close the album sheet underneath too, and navigate only once both
							// sheets have popped their history entries. Re-remember the album
							// (closing clears it) so coming back reopens it.
							albumSheetCloseRef.current?.();
							afterSheetClose(() => {
								sessionStorage.setItem("settings-albums-open", albumId);
								next();
							});
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
											<div className="h-12 w-12 shrink-0 squircle animate-pulse bg-[var(--surface-2)]" />
											<div className="min-w-0 flex-1 space-y-1.5">
												<div className="h-3.5 w-28 animate-pulse rounded-full bg-[var(--surface-2)]" />
												<div className="h-3 w-16 animate-pulse rounded-full bg-[var(--surface-2)]" />
											</div>
											<div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-[var(--surface-2)]" />
										</div>
									))}
								</div>
							) : !shareProfiles || shareProfiles.length === 0 ? (
								<div className="flex flex-col items-center gap-2 py-10 text-[var(--text-muted)]">
									<Users className="h-7 w-7 opacity-30" />
									<p className="text-sm">{t("settings_albums.not_shared", { defaultValue: "Not shared with anyone." })}</p>
								</div>
							) : (
								<div className="-mx-4">
									{shareProfiles.map((profile) => {
										const uKey = `${albumId}:${profile.profileId}`;
										const isUnsharing = unsharingKey === uKey;
										return (
											<div
												key={profile.profileId}
												className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--surface-2)]"
											>
												<SheetClose
													onClick={() => {
														pendingShareNavigationRef.current = () =>
															navigate(`/profile/${profile.profileId}`, { state: { returnTo: location.pathname } });
													}}
													className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-70"
												>
													<div className="h-12 w-12 shrink-0 squircle bg-[var(--surface-2)] drop-shadow-sm">
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
													onClick={() => void unshareAlbumFromProfile(albumId, profile.profileId)}
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
							<div className="-mx-4 mt-3 flex shrink-0 border-t border-[var(--border)] px-4 pt-3">
								<button
									type="button"
									onClick={() => setConfirmUnshareAllAlbumId(albumId)}
									disabled={unsharingAllAlbumId === albumId}
									className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-red-500/10 px-4 text-sm font-semibold text-red-400 transition hover:bg-red-500/20 active:scale-[0.98] disabled:opacity-50"
								>
									{unsharingAllAlbumId === albumId
										? t("settings_albums.unsharing_all", { defaultValue: "Removing…" })
										: t("settings_albums.unshare_all", { defaultValue: "Remove All" })}
								</button>
							</div>
						)}
					</BottomSheet>
				);
			})()}

			<ConfirmDialog
				isOpen={confirmDeleteAlbumId !== null}
				title={t("settings_albums.confirm_delete")}
				message={t("settings_albums.confirm_delete_message", { defaultValue: "This album and all its content will be permanently deleted." })}
				confirmLabel={deletingAlbumId ? t("settings_albums.deleting") : t("settings_albums.delete")}
				cancelLabel={t("settings_albums.cancel")}
				onConfirm={() => confirmDeleteAlbumId ? void deleteAlbum(confirmDeleteAlbumId) : undefined}
				onCancel={() => setConfirmDeleteAlbumId(null)}
				isProcessing={deletingAlbumId !== null}
				confirmTone="danger"
			/>

			<ConfirmDialog
				isOpen={confirmDeleteContentKey !== null}
				title={t("settings_albums.confirm_delete")}
				message={t("settings_albums.confirm_delete_content_message", { defaultValue: "This image will be permanently removed from the album." })}
				confirmLabel={deletingContentKey ? t("settings_albums.deleting") : t("settings_albums.delete")}
				cancelLabel={t("settings_albums.cancel")}
				onConfirm={() => {
					if (!confirmDeleteContentKey) return;
					const [albumId, contentId] = confirmDeleteContentKey.split(":");
					void deleteAlbumPicture(albumId, contentId);
				}}
				onCancel={() => setConfirmDeleteContentKey(null)}
				isProcessing={deletingContentKey !== null}
				confirmTone="danger"
			/>

			<ConfirmDialog
				isOpen={confirmUnshareAllAlbumId !== null}
				title={t("settings_albums.unshare_all_title", { defaultValue: "Remove All Shares" })}
				message={t("settings_albums.unshare_all_message", { defaultValue: "This will remove access for everyone this album is shared with." })}
				confirmLabel={unsharingAllAlbumId ? t("settings_albums.unsharing_all", { defaultValue: "Removing…" }) : t("settings_albums.unshare_all", { defaultValue: "Remove All" })}
				cancelLabel={t("settings_albums.cancel")}
				onConfirm={() => confirmUnshareAllAlbumId ? void unshareAllFromAlbum(confirmUnshareAllAlbumId) : undefined}
				onCancel={() => setConfirmUnshareAllAlbumId(null)}
				isProcessing={unsharingAllAlbumId !== null}
				confirmTone="danger"
			/>

			{drawerPickerAlbumId ? (() => {
				const mediaCounts = countAlbumMedia(albumDetails[drawerPickerAlbumId]);
				const remainingSlots = limits?.maxContentItemsPerAlbum != null
					? Math.max(0, limits.maxContentItemsPerAlbum - mediaCounts.total)
					: Infinity;
				return (
					<AlbumDrawerPickerSheet
						media={drawerMedia}
						isLoading={isLoadingDrawerMedia}
						error={drawerMediaError}
						onLoadMedia={() => loadDrawerMedia(true)}
						onClose={() => setDrawerPickerAlbumId(null)}
						onConfirm={handleAddFromDrawer}
						closeRef={drawerPickerCloseRef}
						isSubmitting={isAddingFromDrawer}
						remainingSlots={remainingSlots}
						isDesktop={isDesktop}
					/>
				);
			})() : null}
		</section>
	);
}
