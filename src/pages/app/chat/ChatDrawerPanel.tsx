import {
	Album,
	Check,
	Images,
	Layers,
	LayoutGrid,
	LayoutPanelTop,
	Pencil,
	Loader2,
	Plus,
	Hourglass,
	Send,
	Share2,
	Video,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useDrawerMediaDelete } from "./useDrawerMediaDelete";
import { useDrawerUploadQueue } from "./useDrawerUploadQueue";
import { ImagesFilled } from "../../../components/icons/FilledIcons";
import { SlidingTabs, useSwipeTabs } from "../../../components/ui/sliding-tabs";
import {
	DRAWER_ICON_BUTTON_CLASS,
	drawerGridClass,
	DRAWER_PRIMARY_BUTTON_CLASS,
	DrawerActionButton,
	DrawerActionBar,
	DrawerBody,
	DrawerGridSkeleton,
	DrawerEmptyState,
	DrawerFooter,
	DrawerGrid,
	DrawerHeader,
	DrawerMediaPreview,
	DrawerMediaTile,
	DRAWER_TILE_CLASS,
	DrawerTileCornerButton,
	ExpiryToggleButton,
	useDrawerMediaPreview,
	VideoExpiryButton,
} from "./drawerUi";
import type { AlbumListItem, AlbumMediaCount } from "../../../types/chat-page";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useModalClose } from "../../../hooks/useModalClose";
import { BottomSheet, SHEET_FOOTER_FIELD_CLASS, sheetButtonClass } from "../../../components/ui/bottom-sheet";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { useApiFunctions } from "../../../hooks/useApiFunctions";
import { useLocalMediaCache } from "../../../hooks/useLocalMediaCache";
import { getCachedMediaUri, getDrawerMediaKey } from "../../../services/mediaStore";
import { usePreferences } from "../../../contexts/PreferencesContext";
import * as chatDb from "../../../services/chatDb";
import type { StoredDrawerCollection } from "../../../services/chatDb";
import { appLog } from "../../../utils/logger";
import { proxyMediaUrl } from "../../../utils/mediaProxy";
import type { Album as OwnAlbum, AlbumLimits } from "../../../types/albums";
import { useCreateAlbum } from "../settings-albums/useCreateAlbum";
import { AlbumEditorSheet } from "../settings-albums/AlbumEditorSheet";
import { DrawerCollectionEditorSheet } from "../settings-albums/DrawerCollectionEditorSheet";

/** Album / collection tile overlay: a glass badge with the type icon and
 * the name in the middle (so these read differently from plain media
 * tiles), media counts along the bottom — inset and sized like the corner
 * buttons up top, so a badge there lines up with them. */
function GroupTileOverlay({ icon, name, counts, badge }: { icon: ReactNode; name: string; counts?: AlbumMediaCount; badge?: ReactNode }) {
	return (
		<>
			<div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-2 pb-3 text-white">
				<div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/35 backdrop-blur-md shadow-[0_2px_8px_rgba(0,0,0,0.35)]">
					{icon}
				</div>
				<p className="max-w-full truncate text-[11px] font-semibold leading-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">{name}</p>
			</div>
			<div className="pointer-events-none absolute inset-x-1.5 bottom-1.5 flex h-5 items-center justify-between gap-1 text-[10px] font-semibold tabular-nums text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
				<span className="inline-flex min-w-0 items-center gap-2">
					{counts && (counts.images > 0 || counts.videos === 0) ? (
						<span className="inline-flex items-center gap-0.5">
							<Images className="h-3 w-3" />
							{counts.images}
						</span>
					) : null}
					{counts && counts.videos > 0 ? (
						<span className="inline-flex items-center gap-0.5">
							<Video className="h-3 w-3" />
							{counts.videos}
						</span>
					) : null}
				</span>
				{badge}
			</div>
		</>
	);
}

export interface DrawerMedia {
	id: number;
	url: string;
	contentType: string;
	createdTs: number;
	used: boolean;
	takenOnGrindr: boolean;
	/** Local-only, not from the server — how often this item has been sent
	 * from the drawer, used to sort most-used media first. See chatDb's
	 * drawer_media_usage table. */
	sendCount: number;
}

type DrawerTab = "media" | "albums" | "collections";
const DRAWER_TABS: readonly DrawerTab[] = ["media", "albums", "collections"];

interface ChatDrawerPanelProps {
	isLoading: boolean;
	error: string | null;
	media: DrawerMedia[];
	onBack: () => void;
	onLoadMedia: () => void | Promise<void>;
	onSendMedia: (mediaIds: number[], maxViews?: number) => void | Promise<void>;
	isSending: boolean;
	/** Called after media was deleted from the drawer here, to drop it from the list. */
	onMediaDeleted: (mediaId: number) => void;
	/** Called after an album was deleted from its drawer tile, to drop it from the list. */
	onAlbumDeleted: (albumId: number) => void;
	/** Called after an album was created or edited here, to reload the list. */
	onAlbumsChanged?: () => void | Promise<unknown>;
	isDesktop: boolean;
	albums?: AlbumListItem[];
	isLoadingAlbums?: boolean;
	albumCoverMap?: Map<number, string>;
	albumMediaCountMap?: Map<number, AlbumMediaCount>;
	sharedAlbumIds?: Set<number>;
	onShareAlbum?: (albumId: number, expirationType: string) => Promise<void>;
	isSharingAlbum?: boolean;
	onStopAlbumShare?: (albumId: number) => Promise<void>;
	noConversation?: boolean;
}

export function ChatDrawerPanel({
	isLoading,
	error,
	media,
	onBack,
	onLoadMedia,
	onSendMedia,
	isSending,
	onMediaDeleted,
	onAlbumDeleted,
	onAlbumsChanged,
	isDesktop,
	albums = [],
	isLoadingAlbums = false,
	albumCoverMap = new Map(),
	albumMediaCountMap = new Map(),
	sharedAlbumIds = new Set(),
	onShareAlbum,
	isSharingAlbum = false,
	onStopAlbumShare,
	noConversation = false,
}: ChatDrawerPanelProps) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const location = useLocation();
	const { defaultExpiringPhotos, defaultAlbumExpirationType, splitDrawerCategories, setPreferences } = usePreferences();
	// Re-renders once a background fetch lands a drawer item in the local
	// media cache, so it can swap in the cached copy without waiting for a DB read.
	useLocalMediaCache();
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
	const { preview: drawerPreview, bind: bindPreview, consumeClick: consumePreviewClick } = useDrawerMediaPreview();
	const [selectedAlbumIds, setSelectedAlbumIds] = useState<Set<number>>(new Set());
	// Collections: local-only, named groups of drawer media, edited right
	// here (or on the albums settings page). Sending one goes through the regular onSendMedia
	// path, which already sends each item as its own message, one after another.
	const [collections, setCollections] = useState<StoredDrawerCollection[]>([]);
	const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
	const [collectionsLoaded, setCollectionsLoaded] = useState(false);
	const [activeTab, setActiveTab] = useState<DrawerTab>("media");
	// The grid only renders once the sheet has slid in: rendering every tile
	// mid-animation blocked the main thread, so the drawer seemed to open late.
	// Until then the body shows its loading spinner.
	const [hasSlidIn, setHasSlidIn] = useState(false);
	useEffect(() => {
		const timer = setTimeout(() => setHasSlidIn(true), 350);
		return () => clearTimeout(timer);
	}, []);
	// Split into categories off (appearance setting): no tabs, one grid of
	// actions, albums, collections, then media.
	const combined = !splitDrawerCategories;
	const hasCombinedGroups = combined && (albums.length > 0 || collections.length > 0);
	const showSection = (tab: DrawerTab) => combined || activeTab === tab;
	const tabSwipe = useSwipeTabs<DrawerTab>(DRAWER_TABS, activeTab, setActiveTab, !combined);
	const EXPIRY_OPTIONS = ["INDEFINITE", "ONCE", "TEN_MINUTES", "ONE_HOUR", "ONE_DAY"];
	const [albumExpirationType, setAlbumExpirationType] = useState<string>(defaultAlbumExpirationType);
	const EXPIRY_LABELS: Record<string, string> = {
		INDEFINITE: t("chat_drawer.expiry.unlimited", { defaultValue: "Unlimited" }),
		ONCE: t("chat_drawer.expiry.once", { defaultValue: "Once" }),
		TEN_MINUTES: t("chat_drawer.expiry.ten_minutes", { defaultValue: "10 minutes" }),
		ONE_HOUR: t("chat_drawer.expiry.one_hour", { defaultValue: "1 hour" }),
		ONE_DAY: t("chat_drawer.expiry.one_day", { defaultValue: "1 day" }),
	};

	// Reloads on changes too: deleting media here can empty (and so delete) a collection.
	useEffect(() => {
		let cancelled = false;
		const load = () => {
			chatDb
				.getDrawerCollections()
				.then((items) => {
					if (cancelled) return;
					setCollections(items);
					setSelectedCollectionId((current) => (current && items.some((c) => c.id === current) ? current : null));
				})
				.catch((error) => appLog.warn("[ChatDrawerPanel] failed to load collections", error))
				.finally(() => {
					if (!cancelled) setCollectionsLoaded(true);
				});
		};
		load();
		const unsubscribe = chatDb.subscribeToDrawerCollections(load);
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);
	// The 10-second disappearing timer default only applies to photos — videos
	// keep their own existing default (maxViews=1, meaning a normal single-play
	// video rather than the unrelated "NonExpiringVideo" type), unaffected by
	// this preference.
	const defaultImageMaxViews = defaultExpiringPhotos ? 1 : 2147483647;
	const [mediaMaxViews, setMediaMaxViews] = useState(defaultImageMaxViews);

	// New uploads (same add step and upload as every other drawer sheet)
	// come back selected, ready to send — same expiry default as picking them.
	const selectUploaded = useCallback((uploaded: { mediaId: number; isVideo: boolean }[]) => {
		setSelectedAlbumIds(new Set());
		setSelectedCollectionId(null);
		setSelectedIds(new Set(uploaded.map((item) => item.mediaId)));
		setMediaMaxViews(uploaded.every((item) => item.isVideo) ? 1 : defaultImageMaxViews);
	}, [defaultImageMaxViews]);
	const reloadMedia = useCallback(async () => { await onLoadMedia(); }, [onLoadMedia]);
	const upload = useDrawerUploadQueue({ onReloadMedia: reloadMedia, onUploaded: selectUploaded });

	const removeDeleted = useCallback((mediaId: number) => {
		setSelectedIds((previous) => {
			if (!previous.has(mediaId)) return previous;
			const next = new Set(previous);
			next.delete(mediaId);
			return next;
		});
		onMediaDeleted(mediaId);
	}, [onMediaDeleted]);
	const deletion = useDrawerMediaDelete({ onDeleted: removeDeleted });

	// Deleting albums and collections right from their tiles, after a confirm.
	const apiFunctions = useApiFunctions();
	const [confirmDeleteAlbumId, setConfirmDeleteAlbumId] = useState<number | null>(null);
	const [deletingAlbumId, setDeletingAlbumId] = useState<number | null>(null);
	const [confirmDeleteCollectionId, setConfirmDeleteCollectionId] = useState<string | null>(null);
	const [isDeletingCollection, setIsDeletingCollection] = useState(false);

	// The album and collection editors open on top of the drawer, same sheets
	// as on the albums settings page. Collection: undefined = closed, null = new.
	const [editingAlbum, setEditingAlbum] = useState<OwnAlbum | null>(null);
	const { createAlbum, isCreating: isCreatingAlbum } = useCreateAlbum();
	// Created as "Album" and opened right away, to be named and filled there.
	const handleCreateAlbum = useCallback(async () => {
		const album = await createAlbum();
		if (!album) return;
		void onAlbumsChanged?.();
		setEditingAlbum(album);
	}, [createAlbum, onAlbumsChanged]);
	const [editingCollection, setEditingCollection] = useState<StoredDrawerCollection | null | undefined>(undefined);
	const collectionEditorCloseRef = useRef<(() => void) | null>(null);
	const isEditorOpen = editingAlbum != null || editingCollection !== undefined;

	// The plan's album limits, enforced like on the albums settings page (the
	// album count here; items and videos per album in the editor). Until they
	// are known, creating stays allowed — the server rejects it past the limit.
	const [albumLimits, setAlbumLimits] = useState<AlbumLimits | null>(null);
	useEffect(() => {
		let cancelled = false;
		apiFunctions.getOwnAlbumStorage()
			.then((storage) => { if (!cancelled) setAlbumLimits(storage); })
			.catch((loadError) => appLog.warn("[ChatDrawerPanel] failed to load album limits", loadError));
		return () => { cancelled = true; };
	}, [apiFunctions]);
	const maxAlbums = albumLimits ? albumLimits.maxAlbums ?? 1 : undefined;
	const canCreateAlbum = maxAlbums == null || albums.length < maxAlbums;

	const confirmDeleteAlbum = useCallback(async () => {
		if (confirmDeleteAlbumId == null) return;
		const albumId = confirmDeleteAlbumId;
		setDeletingAlbumId(albumId);
		try {
			await apiFunctions.deleteOwnAlbum({ albumId: String(albumId) });
			setSelectedAlbumIds((previous) => {
				if (!previous.has(albumId)) return previous;
				const next = new Set(previous);
				next.delete(albumId);
				return next;
			});
			onAlbumDeleted(albumId);
			toast.success(t("settings_albums.toast_deleted"));
		} catch (deleteError) {
			toast.error(deleteError instanceof Error ? deleteError.message : t("settings_albums.error_delete_fallback"));
		} finally {
			setDeletingAlbumId(null);
			setConfirmDeleteAlbumId(null);
		}
	}, [confirmDeleteAlbumId, apiFunctions, onAlbumDeleted, t]);

	const confirmDeleteCollection = useCallback(async () => {
		if (confirmDeleteCollectionId == null) return;
		setIsDeletingCollection(true);
		try {
			// The collections subscription reloads the list (and drops a selection of it).
			await chatDb.deleteDrawerCollection(confirmDeleteCollectionId);
			// Deleted from inside its editor: close that (animated); its onClose clears `editingCollection`.
			if (editingCollection?.id === confirmDeleteCollectionId) collectionEditorCloseRef.current?.();
		} catch (deleteError) {
			appLog.error("[ChatDrawerPanel] failed to delete collection", deleteError);
			toast.error(t("settings_albums.collections_delete_failed"));
		} finally {
			setIsDeletingCollection(false);
			setConfirmDeleteCollectionId(null);
		}
	}, [confirmDeleteCollectionId, editingCollection, t]);

	useModalClose({
		isOpen: true,
		onClose: onBack,
		// An editor on top handles Escape itself.
		escapeKey: !isSending && !upload.isUploading && !isEditorOpen,
	});

	const toggleSelection = useCallback((id: number, isVideo: boolean) => {
		setSelectedAlbumIds(new Set());
		setSelectedCollectionId(null);
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
				if (next.size === 0) setMediaMaxViews(defaultImageMaxViews);
			} else {
				if (prev.size === 0) setMediaMaxViews(isVideo ? 1 : defaultImageMaxViews);
				next.add(id);
			}
			return next;
		});
	}, [defaultImageMaxViews]);

	const isVideoMediaId = useCallback(
		(id: number) => media.find((m) => m.id === id)?.contentType.startsWith("video") ?? false,
		[media],
	);
	// A collection can outlive some of its media (deleted from the drawer
	// since) — those ids are skipped rather than pruned, so a failed/partial
	// drawer load never silently shrinks a collection.
	const getPresentCollectionMediaIds = useCallback(
		(collection: StoredDrawerCollection) => collection.mediaIds.filter((id) => media.some((m) => m.id === id)),
		[media],
	);
	const selectedCollection = collections.find((c) => c.id === selectedCollectionId) ?? null;
	const sendIds = selectedCollection ? getPresentCollectionMediaIds(selectedCollection) : Array.from(selectedIds);

	// Closes the sheet animated (sliding out and popping its history entry),
	// then runs `after` — e.g. a navigation that would otherwise race that pop.
	const sheetCloseRef = useRef<(() => void) | null>(null);
	const afterCloseRef = useRef<(() => void) | null>(null);
	const closeSheet = useCallback((after?: () => void) => {
		afterCloseRef.current = after ?? null;
		if (sheetCloseRef.current) {
			sheetCloseRef.current();
		} else {
			afterCloseRef.current = null;
			onBack();
			after?.();
		}
	}, [onBack]);

	const handleSendSelected = useCallback(async () => {
		if (sendIds.length === 0) {
			toast.error(
				selectedCollection ? t("chat_drawer.collection_empty_send") : t("chat_drawer.error_no_selection"),
			);
			return;
		}
		// Close right away: the thread shows each item as a "sending" bubble and
		// the composer's send button carries the progress, so there's no reason
		// to keep the sheet up for the whole (sequential, often slow) send.
		const ids = sendIds;
		const maxViews = mediaMaxViews;
		setSelectedIds(new Set());
		setSelectedCollectionId(null);
		setMediaMaxViews(defaultImageMaxViews);
		closeSheet();
		try {
			await onSendMedia(ids, maxViews);
		} catch (err) {
			const message = err instanceof Error ? err.message : t("chat_drawer.error_send_failed");
			toast.error(message);
		}
	}, [sendIds, selectedCollection, onSendMedia, closeSheet, t, mediaMaxViews, defaultImageMaxViews]);
	const hasSelection = selectedIds.size > 0;
	const hasAlbumSelection = selectedAlbumIds.size > 0;
	const hasCollectionSelection = selectedCollection != null;
	const hasAnyVideo = sendIds.some((id) => isVideoMediaId(id));
	const hasAnyImage = sendIds.some((id) => !isVideoMediaId(id));
	// Photos and videos can be sent together; the single expiry choice then
	// maps per item in onSendMedia (1 = photos 10s / videos once). "Repeat"
	// (2) only means something for videos, so it's not offered once photos
	// are in the mix.
	const isMixedSelection = hasAnyVideo && hasAnyImage;
	useEffect(() => {
		if (mediaMaxViews === 2 && hasAnyImage) setMediaMaxViews(1);
	}, [mediaMaxViews, hasAnyImage]);

	const toggleCollectionSelection = useCallback(
		(collection: StoredDrawerCollection) => {
			setSelectedIds(new Set());
			setSelectedAlbumIds(new Set());
			if (selectedCollectionId === collection.id) {
				setSelectedCollectionId(null);
				setMediaMaxViews(defaultImageMaxViews);
				return;
			}
			setSelectedCollectionId(collection.id);
			const presentIds = getPresentCollectionMediaIds(collection);
			const onlyVideos = presentIds.length > 0 && presentIds.every((id) => isVideoMediaId(id));
			setMediaMaxViews(onlyVideos ? 1 : defaultImageMaxViews);
		},
		[selectedCollectionId, getPresentCollectionMediaIds, isVideoMediaId, defaultImageMaxViews],
	);


	// Empty album/collection tabs: create one right here.
	const renderCreateButton = (label: string, onClick: () => void, disabled = false) => (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)] transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-50"
		>
			<Plus className="h-4 w-4" />
			{label}
		</button>
	);

	const albumTiles = albums.map((album) => {
		const cover = albumCoverMap.get(album.albumId);
		const isShared = sharedAlbumIds.has(album.albumId);
		const mediaCount = albumMediaCountMap.get(album.albumId);
		const isSelected = selectedAlbumIds.has(album.albumId);
		const dimmed = (hasSelection || hasCollectionSelection) && !isSelected;
		return (
			<div
				key={`album-${album.albumId}`}
				role="button"
				tabIndex={0}
				onClick={() => { if (hasSelection) return; setSelectedAlbumIds(prev => { const n = new Set(prev); n.has(album.albumId) ? n.delete(album.albumId) : n.add(album.albumId); return n; }); }}
				onKeyDown={(e) => { if (e.key === "Enter" && !hasSelection) { setSelectedAlbumIds(prev => { const n = new Set(prev); n.has(album.albumId) ? n.delete(album.albumId) : n.add(album.albumId); return n; }); } }}
				className={`${DRAWER_TILE_CLASS} cursor-pointer transition ${dimmed ? "opacity-30 pointer-events-none" : ""}`}
			>
				{cover ? (
					<>
						<img src={proxyMediaUrl(cover)} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover" style={{ filter: "blur(3px)" }} />
						<div className="absolute inset-0 bg-black/25" />
					</>
				) : (
					<div className="absolute inset-0 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--accent)_45%,var(--surface)),color-mix(in_srgb,var(--accent)_12%,var(--surface)))]" />
				)}
				<GroupTileOverlay
					icon={<Album className="h-5 w-5 drop-shadow" />}
					name={album.albumName || t("chat_drawer.album_fallback", { defaultValue: "My Album" })}
					counts={mediaCount}
					badge={isShared ? (
						<span
							className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)]"
							title={t("chat_drawer.sharing", { defaultValue: "Sharing" })}
							aria-label={t("chat_drawer.sharing", { defaultValue: "Sharing" })}
						>
							<Share2 className="h-3 w-3" />
						</span>
					) : null}
				/>
				{isSelected ? <div className="absolute inset-0 flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--accent) 45%, transparent)" }}><Check className="h-5 w-5 text-white drop-shadow" /></div> : null}
				{isSelected && <div className="absolute inset-0 pointer-events-none rounded-lg" style={{ border: "2px solid var(--accent)" }} />}
				{!isSelected && !dimmed && (
					<>
						<DrawerTileCornerButton
							corner="left"
							icon={deletingAlbumId === album.albumId ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
							label={t("chat_drawer.album_delete", { defaultValue: "Delete album" })}
							onClick={() => setConfirmDeleteAlbumId(album.albumId)}
							disabled={deletingAlbumId != null}
						/>
						<DrawerTileCornerButton
							corner="right"
							icon={<Pencil className="h-2.5 w-2.5" />}
							label={t("chat_drawer.album_edit", { defaultValue: "Edit album" })}
							onClick={() => setEditingAlbum({ albumId: String(album.albumId), albumName: album.albumName })}
						/>
					</>
				)}
			</div>
		);
	});

	const collectionTiles = collections.map((collection) => {
		const presentIds = getPresentCollectionMediaIds(collection);
		const presentVideoCount = presentIds.filter((id) => isVideoMediaId(id)).length;
		// Up to four items as a mosaic cover, so a collection reads as
		// "several photos" at a glance.
		const coverItems = presentIds
			.slice(0, 4)
			.map((id) => media.find((m) => m.id === id))
			.filter((m): m is DrawerMedia => m != null);
		const mosaicClass =
			coverItems.length >= 2 ? "grid-cols-2" : "grid-cols-1";
		const mosaicRows = coverItems.length >= 3 ? "grid-rows-2" : "grid-rows-1";
		const isSelected = selectedCollectionId === collection.id;
		const dimmed = (hasSelection || hasAlbumSelection || hasCollectionSelection || noConversation) && !isSelected;
		return (
			<div
				key={`collection-${collection.id}`}
				role="button"
				tabIndex={0}
				title={t("chat_drawer.collection_badge")}
				// Hold to peek at everything in the collection, in send order.
				{...bindPreview({
					title: collection.name,
					items: presentIds
						.map((id) => media.find((m) => m.id === id))
						.filter((m): m is DrawerMedia => m != null)
						.map((item) => ({
							src: getCachedMediaUri(getDrawerMediaKey(item.id)) ?? item.url,
							isVideo: item.contentType.startsWith("video/"),
						})),
				})}
				onClick={() => { if (consumePreviewClick()) return; if (!dimmed) toggleCollectionSelection(collection); }}
				onKeyDown={(e) => { if (e.key === "Enter" && !dimmed) toggleCollectionSelection(collection); }}
				className={`${DRAWER_TILE_CLASS} no-touch-callout cursor-pointer transition ${dimmed ? "opacity-30 pointer-events-none" : ""}`}
			>
				{coverItems.length > 0 ? (
					<div className={`absolute inset-0 grid gap-0.5 bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)] ${mosaicClass} ${mosaicRows}`}>
						{coverItems.map((item, index) => {
							const src = getCachedMediaUri(getDrawerMediaKey(item.id)) ?? item.url;
							// With three items the first spans the full left column.
							const span = coverItems.length === 3 && index === 0 ? "row-span-2" : "";
							return item.contentType.startsWith("video/") ? (
								<video
									key={item.id}
									src={proxyMediaUrl(src, { as: "video" })}
									preload="metadata"
									muted
									onLoadedMetadata={(e) => { (e.currentTarget as HTMLVideoElement).currentTime = 0.001; }}
									className={`h-full w-full min-h-0 object-cover ${span}`}
								/>
							) : (
								<img key={item.id} src={proxyMediaUrl(src)} alt="" className={`h-full w-full min-h-0 object-cover ${span}`} />
							);
						})}
					</div>
				) : (
					<div className="absolute inset-0 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--text)_22%,var(--surface)),var(--surface))]" />
				)}
				<div className="absolute inset-0 bg-black/40" />
				<GroupTileOverlay
					icon={<Layers className="h-5 w-5 drop-shadow" />}
					name={collection.name}
					counts={{ images: presentIds.length - presentVideoCount, videos: presentVideoCount }}
				/>
				{isSelected ? <div className="absolute inset-0 flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--accent) 45%, transparent)" }}><Check className="h-5 w-5 text-white drop-shadow" /></div> : null}
				{isSelected && <div className="absolute inset-0 pointer-events-none rounded-lg" style={{ border: "2px solid var(--accent)" }} />}
				{!isSelected && !dimmed && (
					<>
						<DrawerTileCornerButton
							corner="left"
							icon={<X className="h-3 w-3" />}
							label={t("chat_drawer.collection_delete", { defaultValue: "Delete collection" })}
							onClick={() => setConfirmDeleteCollectionId(collection.id)}
						/>
						<DrawerTileCornerButton
							corner="right"
							icon={<Pencil className="h-2.5 w-2.5" />}
							label={t("chat_drawer.collection_edit", { defaultValue: "Edit collection" })}
							onClick={() => setEditingCollection(collection)}
						/>
					</>
				)}
			</div>
		);
	});

	// Capture / upload actions, shown as the first tiles of the media grid.
	const actionsDisabled = upload.isUploading || hasSelection || hasAlbumSelection || hasCollectionSelection || noConversation;
	const drawerActions = upload.actions;
	// Not split into categories and no albums yet: there's no albums tab with
	// its own create button, so it joins the grid's action row (the empty
	// drawer's buttons below get it the same way).
	const gridActions = combined && albums.length === 0 && !isLoadingAlbums && canCreateAlbum
		? [
			...drawerActions,
			{
				key: "create-album",
				icon: isCreatingAlbum ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagesFilled className="h-4 w-4" />,
				label: t("chat_drawer.albums_create", { defaultValue: "Create album" }),
				onClick: () => void handleCreateAlbum(),
			},
		]
		: drawerActions;

	return (
		<>
		<BottomSheet
			// isProcessing already blocks user-initiated closes while busy; onClose
			// must stay real so a programmatic close (closeRef) still unmounts.
			onClose={() => {
				onBack();
				const after = afterCloseRef.current;
				afterCloseRef.current = null;
				after?.();
			}}
			closeRef={sheetCloseRef}
			isProcessing={isSending || upload.isUploading}
			// The add-media step (crop) needs its natural height.
			expandable={!upload.step}
			isDesktop={isDesktop}
			bg="bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]"
			panelClassName="px-4"
		>
			<DrawerHeader
				title={upload.stepTitle ?? t("chat_drawer.title", { defaultValue: "Drawer" })}
				// While adding files, X goes back to the drawer instead of closing it.
				onClose={upload.step ? upload.stop : undefined}
				actions={upload.step ? undefined : (() => {
					// Same switch as the appearance setting, flipped right here. The icon shows the view it switches to.
					const label = splitDrawerCategories
						? t("chat_drawer.view_combined", { defaultValue: "Show all on one page" })
						: t("chat_drawer.view_split", { defaultValue: "Split into categories" });
					return (
						<button
							type="button"
							onClick={() => void setPreferences({ splitDrawerCategories: !splitDrawerCategories })}
							className={DRAWER_ICON_BUTTON_CLASS}
							aria-label={label}
							title={label}
						>
							{splitDrawerCategories ? <LayoutGrid className="h-4 w-4" /> : <LayoutPanelTop className="h-4 w-4" />}
						</button>
					);
				})()}
			/>

				{upload.inputs}

				{upload.step ?? (
					<>
						{/* Media / albums / collections switcher. Empty album/collection tabs link to the albums page to create one. */}
						{!combined && (() => {
							const tabs = [
								{ value: "media" as const, label: t("chat_drawer.tab_media", { defaultValue: "Media" }) },
								{ value: "albums" as const, label: t("chat_drawer.tab_albums", { defaultValue: "Albums" }) },
								{ value: "collections" as const, label: t("chat_drawer.tab_collections", { defaultValue: "Collections" }) },
							];
							return <SlidingTabs<DrawerTab> tabs={tabs} value={activeTab} onChange={setActiveTab} className="mb-2 shrink-0" />;
						})()}

						{/* Content Grid */}
						<DrawerBody isLoading={isLoading || !hasSlidIn} isDesktop={isDesktop} error={error} onRetry={onLoadMedia} gestureProps={tabSwipe}>
								<div className="flex flex-col gap-3">
								{!combined && activeTab === "albums" && albums.length === 0 && (
									isLoadingAlbums ? (
										<DrawerGridSkeleton isDesktop={isDesktop} />
									) : (
										<DrawerEmptyState
											icon={<Album className="h-5 w-5" />}
											title={t("chat_drawer.albums_empty", { defaultValue: "You don't have any albums yet." })}
											hint={t("chat_drawer.albums_empty_hint", { defaultValue: "Albums let you share several photos at once, and stop sharing any time." })}
										>
											{renderCreateButton(t("chat_drawer.albums_create", { defaultValue: "Create album" }), () => void handleCreateAlbum(), !canCreateAlbum || isCreatingAlbum)}
										</DrawerEmptyState>
									)
								)}
								{!combined && activeTab === "collections" && collections.length === 0 && (
									collectionsLoaded ? (
										<DrawerEmptyState
											icon={<Layers className="h-5 w-5" />}
											title={t("chat_drawer.collections_empty", { defaultValue: "You don't have any collections yet." })}
											hint={t("chat_drawer.collections_empty_hint", { defaultValue: "Collections group drawer photos so you can send them together in one tap." })}
										>
											{renderCreateButton(t("chat_drawer.collections_create", { defaultValue: "Create collection" }), () => setEditingCollection(null))}
										</DrawerEmptyState>
									) : (
										<DrawerGridSkeleton isDesktop={isDesktop} />
									)
								)}
								{!combined && ((activeTab === "albums" && albums.length > 0) || (activeTab === "collections" && collections.length > 0)) && (
									<div className={drawerGridClass(isDesktop)}>
										{/* Like the media tab's add actions: a create row above the albums. */}
										{/* Hidden once the plan's album limit is reached. */}
										{activeTab === "albums" && canCreateAlbum && (
											<DrawerActionBar
												disabled={isCreatingAlbum}
												actions={[{
													key: "create-album",
													icon: isCreatingAlbum ? <Loader2 className="animate-spin" /> : <Plus />,
													label: t("chat_drawer.albums_create", { defaultValue: "Create album" }),
													onClick: () => void handleCreateAlbum(),
												}]}
											/>
										)}
										{activeTab === "albums" ? albumTiles : collectionTiles}
									</div>
								)}
								{showSection("media") && (media.length > 0 || hasCombinedGroups) && (
								<DrawerGrid isDesktop={isDesktop}>
									<DrawerActionBar actions={gridActions} disabled={actionsDisabled || isCreatingAlbum} />
									{/* Not split into categories: albums and collections share the media grid. */}
									{combined && albumTiles}
									{combined && collectionTiles}
									{media.map((item) => {
										const isSelected = selectedIds.has(item.id);
										const isItemVideo = item.contentType.startsWith("video/");
										const mediaSrc = getCachedMediaUri(getDrawerMediaKey(item.id)) ?? item.url;
										// 1-based send position, previewing a selected collection's contents.
										const collectionPosition = selectedCollection ? sendIds.indexOf(item.id) + 1 : 0;
										const isBlocked = hasAlbumSelection || noConversation || (hasCollectionSelection && collectionPosition === 0);
										const isClickable = !isBlocked && !hasCollectionSelection;

										return (
											<DrawerMediaTile
												key={item.id}
												src={mediaSrc}
												isVideo={isItemVideo}
												alt={t("chat_drawer.media_alt")}
												selected={isSelected}
												muted={isBlocked}
												onSelect={isClickable ? () => toggleSelection(item.id, isItemVideo) : undefined}
												previewProps={bindPreview({ src: mediaSrc, isVideo: isItemVideo })}
												consumePreviewClick={consumePreviewClick}
												takenOnGrindr={item.takenOnGrindr}
												busy={deletion.deletingId === item.id}
												onDelete={hasCollectionSelection ? undefined : () => deletion.requestDelete(item.id)}
												isDeleting={deletion.deletingId === item.id}
												deleteLabel={t("chat_drawer.delete_media")}
											>
												{item.used && !isSelected ? (
													<div className="absolute inset-0 flex items-center justify-center bg-black/40">
														<span className="text-[11px] font-semibold uppercase tracking-widest text-white/90">
															{t("chat_drawer.sent", { defaultValue: "Sent" })}
														</span>
													</div>
												) : null}
												{!isSelected && collectionPosition > 0 ? (
													<span className="pointer-events-none absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[11px] font-bold text-[var(--accent-contrast)]">
														{collectionPosition}
													</span>
												) : null}
											</DrawerMediaTile>
										);
									})}
								</DrawerGrid>
								)}
								{/* Empty drawer: the add actions on their own, as the way in. */}
								{showSection("media") && media.length === 0 && !hasCombinedGroups && (
									<DrawerEmptyState
										icon={<ImagesFilled className="h-5 w-5" />}
										title={t("chat_drawer.empty", { defaultValue: "Your drawer is empty." })}
										hint={t("chat_drawer.empty_hint", { defaultValue: "Take a photo or video, or upload one from your device." })}
									>
										{/* Not split into categories: there is no albums tab with its own create link, so it joins the actions. */}
										<div className={`grid w-full gap-2 ${combined ? "max-w-md grid-cols-4" : "max-w-sm grid-cols-3"}`}>
											{drawerActions.map((action) => (
												<DrawerActionButton
													key={action.key}
													icon={action.icon}
													label={action.label}
													onClick={action.onClick}
													disabled={actionsDisabled}
												/>
											))}
											{combined && (
												<DrawerActionButton
													icon={<ImagesFilled className="h-4 w-4" />}
													label={t("chat_drawer.albums_create", { defaultValue: "Create album" })}
													onClick={() => void handleCreateAlbum()}
													disabled={!canCreateAlbum || isCreatingAlbum}
												/>
											)}
										</div>
									</DrawerEmptyState>
								)}
								</div>
						</DrawerBody>

						{/* Footer - Album share button */}
						{hasAlbumSelection ? (() => {
							const isSelectedShared = selectedAlbumIds.size > 0 && [...selectedAlbumIds].every(id => sharedAlbumIds.has(id));
							return (
								<DrawerFooter>
									{isSelectedShared ? (
										<>
											<button
												type="button"
												onClick={() => {
													if (selectedAlbumIds.size === 0 || !onStopAlbumShare) return;
													void Promise.all([...selectedAlbumIds].map(id => onStopAlbumShare!(id))).then(() => { setSelectedAlbumIds(new Set()); closeSheet(); });
												}}
												disabled={isSharingAlbum}
												className={sheetButtonClass("warning")}
											>
												{isSharingAlbum ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
												<span>{t("chat.actions.stop_sharing", { defaultValue: "Stop Sharing" })} ({selectedAlbumIds.size})</span>
											</button>
										</>
									) : (
										<>
											<div className={`${SHEET_FOOTER_FIELD_CLASS} min-w-0 flex-1`}>
												<Hourglass className="pointer-events-none absolute left-3 h-4 w-4 shrink-0" />
												<select
													value={albumExpirationType}
													onChange={(e) => setAlbumExpirationType(e.target.value)}
													className="h-full w-full appearance-none rounded-full bg-transparent pl-9 pr-3 text-sm font-semibold text-[var(--text)] focus:outline-none cursor-pointer text-center"
												>
													{EXPIRY_OPTIONS.map((opt) => (
														<option key={opt} value={opt}>{EXPIRY_LABELS[opt]}</option>
													))}
												</select>
											</div>
											<button
												type="button"
												onClick={() => {
													if (selectedAlbumIds.size === 0 || !onShareAlbum) return;
													void Promise.all([...selectedAlbumIds].map(id => onShareAlbum!(id, albumExpirationType))).then(() => { setSelectedAlbumIds(new Set()); closeSheet(); });
												}}
												disabled={isSharingAlbum}
												className={DRAWER_PRIMARY_BUTTON_CLASS}
											>
												{isSharingAlbum ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
												<span>{isSharingAlbum ? t("chat_drawer.sending") : `${t("chat.share")} (${selectedAlbumIds.size})`}</span>
											</button>
										</>
									)}
								</DrawerFooter>
							);
						})() : null}
						{/* Footer - Send button */}
						{hasSelection || hasCollectionSelection ? (
							<DrawerFooter>
								{/* Only videos have a third choice (repeat); otherwise it's on/off. */}
								{hasAnyVideo && !isMixedSelection ? (
									<VideoExpiryButton value={mediaMaxViews} onChange={setMediaMaxViews} isDesktop={isDesktop} />
								) : (
									<ExpiryToggleButton
										expiring={mediaMaxViews !== 2147483647}
										onChange={(expiring) => setMediaMaxViews(expiring ? 1 : 2147483647)}
										expiringLabel={isMixedSelection
											? t("chat_drawer.expiry.ten_seconds_or_once", { defaultValue: "10s / once" })
											: t("chat_drawer.expiry.ten_seconds", { defaultValue: "10s" })}
									/>
								)}
								<button
									type="button"
									onClick={handleSendSelected}
									disabled={isSending || sendIds.length === 0}
									className={DRAWER_PRIMARY_BUTTON_CLASS}
								>
									{isSending ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										<Send className="h-4 w-4" />
									)}
									<span className="truncate">
										{isSending
											? t("chat_drawer.sending")
											: mediaMaxViews !== 2147483647
												? t("chat_drawer.is_expiring_send", { count: sendIds.length })
												: t("chat_drawer.send", { count: sendIds.length })}
									</span>
								</button>
							</DrawerFooter>
						) : null}
					</>
				)}

				<DrawerMediaPreview media={drawerPreview} />
				{deletion.dialog}
				<ConfirmDialog
					isOpen={confirmDeleteAlbumId != null}
					title={t("chat_drawer.album_delete_confirm_title", { defaultValue: "Delete album?" })}
					message={t("chat_drawer.album_delete_confirm_message", { defaultValue: "This deletes the album and everything in it. Anyone you shared it with loses access." })}
					confirmLabel={t("chat_drawer.delete_confirm_label")}
					cancelLabel={t("chat.actions.cancel")}
					onConfirm={() => void confirmDeleteAlbum()}
					onCancel={() => { if (deletingAlbumId == null) setConfirmDeleteAlbumId(null); }}
					isProcessing={deletingAlbumId != null}
					confirmTone="danger"
				/>
				<ConfirmDialog
					isOpen={confirmDeleteCollectionId != null}
					title={t("settings_albums.collections_delete_confirm_title")}
					message={t("settings_albums.collections_delete_confirm_message")}
					confirmLabel={t("chat_drawer.delete_confirm_label")}
					cancelLabel={t("chat.actions.cancel")}
					onConfirm={() => void confirmDeleteCollection()}
					onCancel={() => { if (!isDeletingCollection) setConfirmDeleteCollectionId(null); }}
					isProcessing={isDeletingCollection}
					confirmTone="danger"
				/>
		</BottomSheet>

		{/* Siblings of the drawer sheet, not children: stacked on top of it. */}
		{editingAlbum && (
			<AlbumEditorSheet
				key={editingAlbum.albumId}
				album={editingAlbum}
				// Not loaded yet: the editor fetches them itself.
				limits={albumLimits ?? undefined}
				onClose={() => {
					setEditingAlbum(null);
					void onAlbumsChanged?.();
				}}
				onDeleted={(albumId) => {
					const id = Number(albumId);
					setSelectedAlbumIds((previous) => {
						if (!previous.has(id)) return previous;
						const next = new Set(previous);
						next.delete(id);
						return next;
					});
					onAlbumDeleted(id);
				}}
				// Leaving the chat for the profile: the drawer goes too.
				onOpenProfile={(profileId) => {
					closeSheet(() => navigate(`/profile/${profileId}`, { state: { returnTo: location.pathname } }));
				}}
				isDesktop={isDesktop}
			/>
		)}
		{editingCollection !== undefined && (
			<DrawerCollectionEditorSheet
				collection={editingCollection}
				media={media}
				isLoading={isLoading}
				error={error}
				onReloadMedia={reloadMedia}
				onClose={() => setEditingCollection(undefined)}
				// The collections subscription above picks up the saved list.
				onSaved={() => {}}
				onDelete={editingCollection ? () => setConfirmDeleteCollectionId(editingCollection.id) : undefined}
				closeRef={collectionEditorCloseRef}
				isDesktop={isDesktop}
			/>
		)}
		</>
	);
}