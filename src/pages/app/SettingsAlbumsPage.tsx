import {
	AlertTriangle,
	Check,
	ChevronDown,
	ChevronRight,
	Clock,
	Film,
	FolderPlus,
	GripVertical,
	HardDrive,
	Images,
	Inbox,
	Loader2,
	Pencil,
	Play,
	Plus,
	RefreshCcw,
	Share2,
	Trash2,
	Upload,
	UserMinus,
	X,
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
import { BottomSheet, SheetClose } from "../../components/ui/bottom-sheet";
import {
	EmptyState,
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
			<span className="shrink-0 rounded-lg bg-[var(--surface-2)] px-2.5 py-1 text-xs font-semibold tabular-nums">
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

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={`relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)] ${isDragging ? "z-10 opacity-40" : ""}`}
		>
			{imageUrl ? (
				<img
					src={imageUrl}
					alt={t("settings_albums.media_alt", { index: index + 1 })}
					className={`aspect-square w-full object-cover ${isRejected ? "opacity-40 grayscale" : ""}`}
				/>
			) : (
				<div className="aspect-square w-full bg-[var(--surface)]" />
			)}

			{isVideo && (
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
	const [limitsExpanded, setLimitsExpanded] = useState(false);
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
	const [editingAlbumId, setEditingAlbumId] = useState<string | null>(null);
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
	const [editOpenedAlbumId, setEditOpenedAlbumId] = useState<string | null>(null);

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

	const startEditingAlbum = (album: Album) => {
		setEditingAlbumId(album.albumId);
		setEditingName(album.albumName?.trim() ?? "");
	};

	const cancelEditing = () => {
		if (editOpenedAlbumId) {
			setOpenAlbumId((prev) => prev === editOpenedAlbumId ? null : prev);
			setEditOpenedAlbumId(null);
		}
		setEditingAlbumId(null);
		setEditingName("");
	};

	const saveEditingAlbum = async (albumId: string) => {
		if (isSavingEdit) return;
		setIsSavingEdit(true);
		try {
			await apiFunctions.renameOwnAlbum({ albumId, albumName: editingName.trim() });
			setAlbums((previous) =>
				previous.map((album) =>
					album.albumId === albumId ? { ...album, albumName: editingName.trim() } : album,
				),
			);
			toast.success(t("settings_albums.toast_renamed"));
			cancelEditing();
		} catch (saveError) {
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
			setAlbums((previous) => previous.filter((album) => album.albumId !== albumId));
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
			setDrawerPickerAlbumId(null);
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
		const albumId = albums.find((a) => String(a.albumId) === savedId)!.albumId;
		setOpenAlbumId(albumId);
		void loadAlbumDetails(albumId);
		void loadAlbumShares(albumId);
		if (fromNavigation) {
			requestAnimationFrame(() => {
				document.getElementById(`settings-album-${albumId}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
			});
		}
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

	const toggleAlbumOpen = (albumId: string) => {
		if (openAlbumId === albumId) {
			setOpenAlbumId(null);
			return;
		}
		setOpenAlbumId(albumId);
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
				/>

				{/* Combined plan summary + create album */}
				<div className="surface-card overflow-hidden">
					{limits && (
						<>
							<button
								type="button"
								onClick={() => setLimitsExpanded((p) => !p)}
								className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-[var(--surface-2)]"
							>
								<div className="shrink-0 rounded-2xl bg-amber-500/15 p-2.5 text-amber-400">
									<HardDrive className="h-5 w-5" />
								</div>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<p className="text-sm font-semibold leading-snug">
											{t("settings_albums.limits_title", { defaultValue: "Plan Limits" })}
										</p>
										{planLabel && (
											<span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--accent-contrast)]">
												{planLabel}
											</span>
										)}
									</div>
									<div className="mt-2 space-y-1.5">
										<div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
											<div
												className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
												style={{ width: `${Math.min(100, (albums.length / maxAlbums) * 100)}%` }}
											/>
										</div>
										<div className="flex items-center justify-between gap-3">
											<p className="min-w-0 truncate text-xs text-[var(--text-muted)]">
												{[
													limits.maxContentItemsPerAlbum != null && t("settings_albums.limits_items_short", { defaultValue: "{{n}} items/album", n: limits.maxContentItemsPerAlbum }),
													limits.maxContentSizeHumanReadable != null && limits.maxContentSizeHumanReadable,
													limits.maxVideosPerAlbum != null && t("settings_albums.limits_videos_short", { defaultValue: "{{n}} videos/album", n: limits.maxVideosPerAlbum }),
												].filter(Boolean).join(" · ")}
											</p>
											<span className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]">
												{albums.length} / {maxAlbums} {t("settings_albums.limits_albums", { defaultValue: "albums" })}
											</span>
										</div>
									</div>
								</div>
								<ChevronDown
									className={`h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform duration-200 ${limitsExpanded ? "rotate-180" : ""}`}
								/>
							</button>

							{limitsExpanded && (
								<div className="divide-y divide-[var(--border)]">
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
							)}

							<div className="border-t border-[var(--border)]" />
						</>
					)}

					{/* Create album */}
					<div className="flex items-start gap-3 p-4">
						<div className="shrink-0 rounded-2xl bg-pink-500/15 p-2.5 text-pink-400">
							<FolderPlus className="h-5 w-5" />
						</div>
						<div className="min-w-0 flex-1">
							<p className="text-sm font-semibold leading-snug">{t("settings_albums.create")}</p>
							<p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">
								{canCreateAlbum
									? t("settings_albums.usage", { count: albums.length, max: maxAlbums })
									: t("settings_albums.limit_reached")}
							</p>
							<div className="mt-3 flex gap-2">
								<input
									type="text"
									value={createName}
									onChange={(e) => setCreateName(e.target.value)}
									placeholder={t("settings_albums.new_album_placeholder")}
									className="input-field min-w-0 flex-1 !min-h-0 !py-2 !px-3 text-sm"
									maxLength={255}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											void handleCreateAlbum();
										}
									}}
								/>
								<button
									type="button"
									onClick={() => void handleCreateAlbum()}
									disabled={!canCreateAlbum || isCreating}
									className="btn-accent inline-flex shrink-0 items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
								>
									<Plus className="h-3.5 w-3.5" />
									{isCreating ? t("settings_albums.creating") : t("settings_albums.create")}
								</button>
							</div>
						</div>
					</div>
				</div>

				{/* Albums list */}
				<div>
					<div className="mb-2 flex items-center gap-2 px-1">
						<p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
							{t("settings_albums.your_albums")}
						</p>
						{albums.length > 0 && (
							<span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-bold tabular-nums text-[var(--text-muted)]">
								{albums.length}
							</span>
						)}
					</div>

					{isLoading ? (
						<LoadingState title={t("settings_albums.loading")} description={t("settings_albums.loading_desc")} compact />
					) : error ? (
						<ErrorState title={t("settings_albums.error_load")} description={error} onRetry={() => void loadAlbumsAndLimits()} />
					) : albums.length === 0 ? (
						<EmptyState title={t("settings_albums.empty")} description={t("settings_albums.empty_desc")} />
					) : (
						<div className="grid gap-3">
							{albums.map((album) => {
								const isEditing = editingAlbumId === album.albumId;
								const isOpen = openAlbumId === album.albumId;
								const detail = albumDetails[album.albumId];
								const isLoadingDetails = loadingAlbumDetailsId === album.albumId;
								const uploadInputId = `album-upload-${album.albumId}`;
								const mediaCounts = countAlbumMedia(detail);
								const coverUrl = detail?.content[0]?.thumbUrl || detail?.content[0]?.url || detail?.content[0]?.coverUrl;
								const shareProfiles = albumShareProfiles[album.albumId];
								const isLoadingShares = loadingSharesAlbumId === album.albumId;

								return (
									<div key={album.albumId} id={`settings-album-${album.albumId}`} className="surface-card overflow-hidden">
										{/* Album row */}
										<div
											className="flex cursor-pointer items-center gap-3 p-4 transition-colors hover:bg-[var(--surface-2)]"
											onClick={() => !isEditing && toggleAlbumOpen(album.albumId)}
										>
											{coverUrl ? (
												<img src={coverUrl} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
											) : (
												<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-2)] text-[var(--text-muted)]">
													<Images className="h-5 w-5 opacity-40" />
												</div>
											)}
											<div className="min-w-0 flex-1">
												{isEditing ? (
													<input
														type="text"
														value={editingName}
														onChange={(e) => setEditingName(e.target.value)}
														onClick={(e) => e.stopPropagation()}
														className="input-field w-full !py-1.5 h-9 [min-height:0]"
														maxLength={255}
													/>
												) : (
													<p className="truncate font-semibold">
														{album.albumName?.trim() || t("settings_albums.untitled")}
													</p>
												)}
												{!isEditing && (
													<p className="text-xs text-[var(--text-muted)]">
														{detail
															? [
																limits?.maxContentItemsPerAlbum != null
																	? `${mediaCounts.total} / ${limits.maxContentItemsPerAlbum} ${t("settings_albums.media_items", { defaultValue: "items" })}`
																	: mediaCounts.total > 0 ? `${mediaCounts.total} ${t("settings_albums.media_items", { defaultValue: "items" })}` : null,
																limits?.maxVideosPerAlbum != null
																	? `${mediaCounts.videos} / ${limits.maxVideosPerAlbum} ${t("settings_albums.media_videos", { defaultValue: "videos" })}`
																	: mediaCounts.videos > 0 ? `${mediaCounts.videos} ${t("settings_albums.media_videos", { defaultValue: "videos" })}` : null,
																shareProfiles?.length
																	? `${shareProfiles.length} ${t("settings_albums.shared_count", { defaultValue: "shared" })}`
																	: null,
															].filter(Boolean).join(" · ") || `#${album.albumId}`
															: `#${album.albumId}`}
													</p>
												)}
											</div>
											<div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
												{isEditing ? (
													<>
														<button
															type="button"
															onClick={() => void saveEditingAlbum(album.albumId)}
															disabled={isSavingEdit}
															className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)] text-[var(--accent-contrast)] transition hover:brightness-110 disabled:opacity-60"
															title={t("settings_albums.save")}
														>
															<Check className="h-4 w-4" />
														</button>
														<button
															type="button"
															onClick={cancelEditing}
															className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] transition hover:border-[var(--text-muted)]"
															title={t("settings_albums.cancel")}
														>
															<X className="h-4 w-4" />
														</button>
													</>
												) : (
													<>
														<button
															type="button"
															onClick={() => {
																startEditingAlbum(album);
																if (!isOpen) {
																	toggleAlbumOpen(album.albumId);
																	setEditOpenedAlbumId(album.albumId);
																}
															}}
															className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
															title={t("settings_albums.rename")}
														>
															<Pencil className="h-3.5 w-3.5" />
														</button>
														<button
															type="button"
															onClick={() => setConfirmDeleteAlbumId(album.albumId)}
															disabled={deletingAlbumId === album.albumId}
															className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] transition hover:border-red-400 hover:text-red-400 disabled:opacity-50"
															title={t("settings_albums.delete")}
														>
															<Trash2 className="h-3.5 w-3.5" />
														</button>
													</>
												)}
											</div>
										</div>

										{/* Expanded content */}
										{isOpen && (
											<div className="border-t border-[var(--border)] p-4">
												{/* Media toolbar */}
												<div className="mb-3 flex items-center justify-between gap-2">
													<p className="min-w-0 truncate text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
														{t("settings_albums.section_content", { defaultValue: "Content" })}
													</p>
													<div className="flex shrink-0 items-center gap-1.5">
														<input
															id={uploadInputId}
															type="file"
															accept="image/*,video/*"
															multiple
															onChange={(e) => void handleUploadInputChange(album.albumId, e)}
															className="hidden"
														/>
														<button
															type="button"
															onClick={() => setAddSheetAlbumId(album.albumId)}
															disabled={uploadingAlbumId === album.albumId}
															className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-xl border border-[var(--border)] px-2.5 text-xs font-medium transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
														>
															{uploadingAlbumId === album.albumId ? (
																<>
																	<Loader2 className="h-3.5 w-3.5 animate-spin" />
																	{t("settings_albums.uploading")}
																</>
															) : (
																<>
																	<Plus className="h-3.5 w-3.5" />
																	{t("settings_albums.add", { defaultValue: "Add" })}
																</>
															)}
														</button>
														<button
															type="button"
															onClick={() => {
																void loadAlbumDetails(album.albumId, true);
																void loadAlbumShares(album.albumId, true);
															}}
															className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--border)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
															title={t("settings_albums.refresh")}
														>
															<RefreshCcw className="h-3.5 w-3.5" />
														</button>
													</div>
												</div>

												{/* Media grid with DnD */}
												{isLoadingDetails ? (
													<p className="text-sm text-[var(--text-muted)]">{t("settings_albums.loading_media")}</p>
												) : !detail || detail.content.length === 0 ? (
													<p className="text-sm text-[var(--text-muted)]">{t("settings_albums.no_media")}</p>
												) : (
													<DndContext
														sensors={sensors}
														onDragEnd={handleAlbumMediaDragEnd(album.albumId, detail.content)}
													>
														<SortableContext
															items={detail.content.map((item) => item.contentId)}
															strategy={rectSortingStrategy}
														>
															<div className={`grid gap-2 ${isDesktop ? "grid-cols-6" : "grid-cols-3"}`}>
																{detail.content.map((item, index) => {
																	const deleteKey = `${album.albumId}:${item.contentId}`;
																	return (
																		<SortableAlbumMediaItem
																			key={`${album.albumId}-${item.contentId}`}
																			item={item}
																			index={index}
																			isReordering={reorderingAlbumId === album.albumId}
																			isDeleting={deletingContentKey === deleteKey}
																			onDeleteClick={() => setConfirmDeleteContentKey(deleteKey)}
																		/>
																	);
																})}
															</div>
														</SortableContext>
													</DndContext>
												)}

												{/* Shared with — a subheading like "Content"; the list itself lives in a bottom sheet. */}
												<button
													type="button"
													onClick={() => {
														setSharesSheetAlbumId(album.albumId);
														void loadAlbumShares(album.albumId);
													}}
													className="mt-5 flex w-full items-center justify-between gap-2 text-left text-[var(--text-muted)] transition hover:text-[var(--text)]"
												>
													<p className="min-w-0 truncate text-xs font-semibold uppercase tracking-widest">
														{t("settings_albums.shared_with", { defaultValue: "Shared With" })}
													</p>
													<span className="flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums">
														{isLoadingShares ? (
															<span className="h-3 w-4 animate-pulse rounded-full bg-[var(--surface-2)]" />
														) : (
															shareProfiles?.length ?? 0
														)}
														<ChevronRight className="h-4 w-4" />
													</span>
												</button>
											</div>
										)}
									</div>
								);
							})}
						</div>
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

			{addSheetAlbumId && (
				<BottomSheet onClose={() => setAddSheetAlbumId(null)} isDesktop={isDesktop}>
					<div className="flex items-center justify-between px-4 pb-3">
						<p className="text-sm font-semibold text-[var(--text)]">{t("settings_albums.upload")}</p>
						<SheetClose className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
							<X className="h-4 w-4" />
						</SheetClose>
					</div>
					<div className="divide-y divide-[var(--border)] pb-2">
						<SheetClose
							// The album's hidden file input; clicked synchronously so it still counts as a user gesture.
							onClick={() => document.getElementById(`album-upload-${addSheetAlbumId}`)?.click()}
							className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-[var(--surface-2)]"
						>
							<div className="shrink-0 rounded-2xl bg-sky-500/15 p-2.5 text-sky-400">
								<Upload className="h-5 w-5" />
							</div>
							<div className="min-w-0 flex-1">
								<p className="text-sm font-semibold leading-snug">
									{t("settings_albums.add_upload", { defaultValue: "Upload from device" })}
								</p>
								<p className="mt-0.5 text-xs text-[var(--text-muted)]">
									{t("settings_albums.add_upload_desc", { defaultValue: "Photos and videos stored on this device" })}
								</p>
							</div>
						</SheetClose>
						<SheetClose
							onClick={() => {
								const albumId = addSheetAlbumId;
								// Let this sheet pop its history entry before the picker sheet pushes its own.
								window.setTimeout(() => openDrawerPicker(albumId), 340);
							}}
							className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-[var(--surface-2)]"
						>
							<div className="shrink-0 rounded-2xl bg-violet-500/15 p-2.5 text-violet-400">
								<Inbox className="h-5 w-5" />
							</div>
							<div className="min-w-0 flex-1">
								<p className="text-sm font-semibold leading-snug">
									{t("settings_albums.add_from_drawer", { defaultValue: "Add from Drawer" })}
								</p>
								<p className="mt-0.5 text-xs text-[var(--text-muted)]">
									{t("settings_albums.add_drawer_desc", { defaultValue: "Media saved in your chat drawer" })}
								</p>
							</div>
						</SheetClose>
					</div>
				</BottomSheet>
			)}

			{sharesSheetAlbumId && (() => {
				const albumId = sharesSheetAlbumId;
				const shareProfiles = albumShareProfiles[albumId];
				const isLoadingShares = loadingSharesAlbumId === albumId;
				return (
					<BottomSheet
						onClose={() => {
							setSharesSheetAlbumId(null);
							// Navigate only after the sheet has popped its history entry.
							const next = pendingShareNavigationRef.current;
							pendingShareNavigationRef.current = null;
							next?.();
						}}
						isDesktop={isDesktop}
						panelClassName="max-h-[82dvh]"
					>
						<div className="flex items-center justify-between px-4 pb-3">
							<p className="text-sm font-semibold text-[var(--text)]">
								{t("settings_albums.shared_with", { defaultValue: "Shared With" })}
								{shareProfiles && shareProfiles.length > 0 && (
									<span className="ml-2 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-bold tabular-nums">
										{shareProfiles.length}
									</span>
								)}
							</p>
							<SheetClose className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
								<X className="h-4 w-4" />
							</SheetClose>
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
							{isLoadingShares ? (
								<div className="space-y-2">
									{[0, 1].map((i) => (
										<div key={i} className="flex items-center gap-3 py-1">
											<div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-[var(--surface-2)]" />
											<div className="min-w-0 flex-1 space-y-1.5">
												<div className="h-3.5 w-28 animate-pulse rounded-full bg-[var(--surface-2)]" />
												<div className="h-3 w-16 animate-pulse rounded-full bg-[var(--surface-2)]" />
											</div>
											<div className="h-7 w-20 animate-pulse rounded-xl bg-[var(--surface-2)]" />
										</div>
									))}
								</div>
							) : !shareProfiles || shareProfiles.length === 0 ? (
								<p className="py-2 text-sm text-[var(--text-muted)]">
									{t("settings_albums.not_shared", { defaultValue: "Not shared with anyone." })}
								</p>
							) : (
								<div className="divide-y divide-[var(--border)]">
									{shareProfiles.map((profile) => {
										const uKey = `${albumId}:${profile.profileId}`;
										const isUnsharing = unsharingKey === uKey;
										return (
											<div key={profile.profileId} className="flex items-center gap-3 py-2.5">
												<SheetClose
													onClick={() => {
														pendingShareNavigationRef.current = () =>
															navigate(`/profile/${profile.profileId}`, { state: { returnTo: location.pathname } });
													}}
													className="flex min-w-0 flex-1 items-center gap-3 text-left transition-opacity hover:opacity-70"
												>
													<div className="h-9 w-9 shrink-0 overflow-hidden rounded-full">
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
													className="shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text-muted)] transition hover:border-red-400/60 hover:bg-red-500/5 hover:text-red-400 disabled:opacity-50"
												>
													<UserMinus className="h-3.5 w-3.5" />
													{isUnsharing
														? t("settings_albums.unsharing", { defaultValue: "Removing…" })
														: t("settings_albums.unshare", { defaultValue: "Remove" })}
												</button>
											</div>
										);
									})}
								</div>
							)}
						</div>
						{shareProfiles && shareProfiles.length > 0 && !isLoadingShares && (
							<div className="px-4 pt-2">
								<button
									type="button"
									onClick={() => setConfirmUnshareAllAlbumId(albumId)}
									disabled={unsharingAllAlbumId === albumId}
									className="w-full inline-flex items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-400 transition hover:bg-red-500/20 disabled:opacity-50"
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
						isSubmitting={isAddingFromDrawer}
						remainingSlots={remainingSlots}
						isDesktop={isDesktop}
					/>
				);
			})() : null}
		</section>
	);
}
