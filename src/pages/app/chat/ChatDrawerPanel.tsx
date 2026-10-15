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
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DrawerAddMediaStep } from "./DrawerAddMediaStep";
import { ImagesFilled } from "../../../components/icons/FilledIcons";
import { SlidingTabs } from "../../../components/ui/sliding-tabs";
import {
	DRAWER_ICON_BUTTON_CLASS,
	DRAWER_TILE_CLASS,
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
} from "./drawerUi";
import type { AlbumListItem, AlbumMediaCount } from "../../../types/chat-page";
import { ProfileImage } from "../../../components/ui/profile-image";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import freegrindLogo from "../../../images/freegrind-logo.webp";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { useModalClose } from "../../../hooks/useModalClose";
import { BottomSheet } from "../../../components/ui/bottom-sheet";
import { useLocalMediaCache } from "../../../hooks/useLocalMediaCache";
import { getCachedMediaUri, getDrawerMediaKey } from "../../../services/mediaStore";
import { usePreferences } from "../../../contexts/PreferencesContext";
import * as chatDb from "../../../services/chatDb";
import type { StoredDrawerCollection } from "../../../services/chatDb";
import { appLog } from "../../../utils/logger";

/** Bottom-left photo/video count on album and collection tiles. */
function TileMediaCount({ images, videos }: AlbumMediaCount) {
	return (
		<span className="pointer-events-none absolute bottom-1 left-1.5 inline-flex items-center gap-2 text-[10px] font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
			{images > 0 || videos === 0 ? (
				<span className="inline-flex items-center gap-1">
					<Images className="h-3 w-3" />
					{images}
				</span>
			) : null}
			{videos > 0 ? (
				<span className="inline-flex items-center gap-1">
					<Video className="h-3 w-3" />
					{videos}
				</span>
			) : null}
		</span>
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

interface ChatDrawerPanelProps {
	isLoading: boolean;
	error: string | null;
	media: DrawerMedia[];
	onBack: () => void;
	onLoadMedia: () => void;
	onSendMedia: (mediaIds: number[], maxViews?: number) => void | Promise<void>;
	isSending: boolean;
	isAdding: boolean;
	onAddMedia: (file: File, takenOnGrindr: boolean, looping?: boolean) => void | Promise<void>;
	deletingMediaId: number | null;
	onDeleteMedia: (mediaId: number) => void | Promise<void>;
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
	ownProfilePhotoUrl?: string | null;
}

export function ChatDrawerPanel({
	isLoading,
	error,
	media,
	onBack,
	onLoadMedia,
	onSendMedia,
	isSending,
	isAdding,
	onAddMedia,
	deletingMediaId,
	onDeleteMedia,
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
	ownProfilePhotoUrl,
}: ChatDrawerPanelProps) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { defaultExpiringPhotos, defaultAlbumExpirationType, splitDrawerCategories, setPreferences } = usePreferences();
	// Re-renders once a background fetch lands a drawer item in the local
	// media cache, so it can swap in the cached copy without waiting for a DB read.
	useLocalMediaCache();
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
	const { preview: drawerPreview, bind: bindPreview, consumeClick: consumePreviewClick } = useDrawerMediaPreview();
	const [pendingAddFile, setPendingAddFile] = useState<File | null>(null);
	const [confirmDeleteMediaId, setConfirmDeleteMediaId] = useState<number | null>(null);
	const [selectAfterUpload, setSelectAfterUpload] = useState(false);
	const [selectedAlbumIds, setSelectedAlbumIds] = useState<Set<number>>(new Set());
	// Collections: local-only, named groups of drawer media, managed on the
	// albums settings page. Sending one goes through the regular onSendMedia
	// path, which already sends each item as its own message, one after another.
	const [collections, setCollections] = useState<StoredDrawerCollection[]>([]);
	const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
	const [collectionsLoaded, setCollectionsLoaded] = useState(false);
	const [activeTab, setActiveTab] = useState<DrawerTab>("media");
	// Split into categories off (appearance setting): no tabs, one grid of
	// actions, albums, collections, then media.
	const combined = !splitDrawerCategories;
	const hasCombinedGroups = combined && (albums.length > 0 || collections.length > 0);
	const showSection = (tab: DrawerTab) => combined || activeTab === tab;
	const EXPIRY_OPTIONS = ["INDEFINITE", "ONCE", "TEN_MINUTES", "ONE_HOUR", "ONE_DAY"];
	const [albumExpirationType, setAlbumExpirationType] = useState<string>(defaultAlbumExpirationType);
	const EXPIRY_LABELS: Record<string, string> = {
		INDEFINITE: t("chat_drawer.expiry.unlimited", { defaultValue: "Unlimited" }),
		ONCE: t("chat_drawer.expiry.once", { defaultValue: "Once" }),
		TEN_MINUTES: t("chat_drawer.expiry.ten_minutes", { defaultValue: "10 minutes" }),
		ONE_HOUR: t("chat_drawer.expiry.one_hour", { defaultValue: "1 hour" }),
		ONE_DAY: t("chat_drawer.expiry.one_day", { defaultValue: "1 day" }),
	};
	const prevMediaIdsRef = useRef<Set<number>>(new Set());

	useEffect(() => {
		let cancelled = false;
		chatDb
			.getDrawerCollections()
			.then((items) => {
				if (!cancelled) setCollections(items);
			})
			.catch((error) => appLog.warn("[ChatDrawerPanel] failed to load collections", error))
			.finally(() => {
				if (!cancelled) setCollectionsLoaded(true);
			});
		return () => {
			cancelled = true;
		};
	}, []);
	useModalClose({
		isOpen: true,
		onClose: onBack,
		escapeKey: !isSending && !isAdding,
	});

	// The 10-second disappearing timer default only applies to photos — videos
	// keep their own existing default (maxViews=1, meaning a normal single-play
	// video rather than the unrelated "NonExpiringVideo" type), unaffected by
	// this preference.
	const defaultImageMaxViews = defaultExpiringPhotos ? 1 : 2147483647;
	const [mediaMaxViews, setMediaMaxViews] = useState(defaultImageMaxViews);

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

	const handleSendSelected = useCallback(async () => {
		if (sendIds.length === 0) {
			toast.error(
				selectedCollection ? t("chat_drawer.collection_empty_send") : t("chat_drawer.error_no_selection"),
			);
			return;
		}
		try {
			await onSendMedia(sendIds, mediaMaxViews);
			setSelectedIds(new Set());
			setSelectedCollectionId(null);
			setMediaMaxViews(defaultImageMaxViews);
			onBack();
		} catch (err) {
			const message = err instanceof Error ? err.message : t("chat_drawer.error_send_failed");
			toast.error(message);
		}
	}, [sendIds, selectedCollection, onSendMedia, onBack, t, mediaMaxViews, defaultImageMaxViews]);
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

	const onPickDrawerFiles = useCallback(
		(files: File[]) => {
			const file = files[0];
			if (!file) return;
			if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
				toast.error(t("chat_drawer.invalid_file_type"));
				return;
			}
			setPendingAddFile(file);
		},
		[],
	);

	const confirmAddPhoto = useCallback(async (file: File, takenOnGrindr: boolean, looping: boolean) => {
		prevMediaIdsRef.current = new Set(media.map((m) => m.id));
		await onAddMedia(file, takenOnGrindr, looping);
		setSelectedIds(new Set());
		setSelectAfterUpload(true);
		setPendingAddFile(null);
	}, [onAddMedia, media]);

	useEffect(() => {
		if (!selectAfterUpload) return;
		const newItem = media.find((m) => !prevMediaIdsRef.current.has(m.id));
		if (newItem) {
			setSelectedIds(new Set([newItem.id]));
			setSelectAfterUpload(false);
		}
	}, [media, selectAfterUpload]);

	const cancelAddPhoto = useCallback(() => {
		setPendingAddFile(null);
	}, []);

	const handleDeleteMedia = useCallback(
		(event: React.MouseEvent<HTMLButtonElement>, mediaId: number) => {
			event.stopPropagation();
			setConfirmDeleteMediaId(mediaId);
		},
		[],
	);

	const confirmDeleteMedia = useCallback(async () => {
		if (confirmDeleteMediaId == null) return;
		await onDeleteMedia(confirmDeleteMediaId);
		setSelectedIds((previous) => {
			if (!previous.has(confirmDeleteMediaId)) return previous;
			const next = new Set(previous);
			next.delete(confirmDeleteMediaId);
			return next;
		});
		setConfirmDeleteMediaId(null);
	}, [confirmDeleteMediaId, onDeleteMedia]);

	const cancelDeleteMedia = useCallback(() => {
		if (deletingMediaId != null) return;
		setConfirmDeleteMediaId(null);
	}, [deletingMediaId]);

	// Albums and collections are both created on the albums settings page.
	const openAlbumsPage = () => {
		onBack();
		navigate("/settings/albums");
	};
	// Empty album/collection tabs: both are created on the albums settings page.
	const renderCreateButton = (label: string) => (
		<button
			type="button"
			onClick={openAlbumsPage}
			className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)] transition hover:brightness-110"
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
				{cover ? <img src={cover} alt="" className="h-full w-full object-cover scale-110" style={{ filter: "blur(3px)" }} /> : (
					<div className="absolute inset-0 flex items-center justify-center bg-[var(--surface)] text-[var(--text-muted)]"><Album className="h-6 w-6 opacity-50" /></div>
				)}
				<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
					<div className="h-10 w-10 overflow-hidden rounded-full ring-2 ring-white/60" style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.5))" }}>
						<ProfileImage src={ownProfilePhotoUrl} />
					</div>
					<p className="truncate text-[11px] font-medium text-white leading-tight drop-shadow px-1 max-w-full">{album.albumName || t("chat_drawer.album_fallback", { defaultValue: "My Album" })}</p>
					{isShared && <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-contrast)]">{t("chat_drawer.sharing", { defaultValue: "Sharing" })}</span>}
				</div>
				{mediaCount ? <TileMediaCount {...mediaCount} /> : null}
				{isSelected ? <div className="absolute inset-0 flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--accent) 45%, transparent)" }}><Check className="h-5 w-5 text-white drop-shadow" /></div> : null}
				{isSelected && <div className="absolute inset-0 pointer-events-none rounded-md" style={{ border: "2px solid var(--accent)" }} />}
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
				onClick={() => { if (!dimmed) toggleCollectionSelection(collection); }}
				onKeyDown={(e) => { if (e.key === "Enter" && !dimmed) toggleCollectionSelection(collection); }}
				className={`${DRAWER_TILE_CLASS} cursor-pointer transition ${dimmed ? "opacity-30 pointer-events-none" : ""}`}
			>
				{coverItems.length > 0 ? (
					<div className={`absolute inset-0 grid gap-px bg-black ${mosaicClass} ${mosaicRows}`}>
						{coverItems.map((item, index) => {
							const src = getCachedMediaUri(getDrawerMediaKey(item.id)) ?? item.url;
							// With three items the first spans the full left column.
							const span = coverItems.length === 3 && index === 0 ? "row-span-2" : "";
							return item.contentType.startsWith("video/") ? (
								<video
									key={item.id}
									src={src}
									preload="metadata"
									muted
									onLoadedMetadata={(e) => { (e.currentTarget as HTMLVideoElement).currentTime = 0.001; }}
									className={`h-full w-full min-h-0 object-cover ${span}`}
								/>
							) : (
								<img key={item.id} src={src} alt="" className={`h-full w-full min-h-0 object-cover ${span}`} />
							);
						})}
					</div>
				) : (
					<div className="absolute inset-0 bg-[var(--surface)]" />
				)}
				<div className="absolute inset-0 bg-black/35" />
				<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
					<div
						className="flex h-10 w-10 items-center justify-center rounded-full bg-black/45 ring-2 ring-white/60 backdrop-blur-sm"
						style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.5))" }}
					>
						<Layers className="h-5 w-5 text-white" />
					</div>
					<p className="truncate text-[11px] font-medium text-white leading-tight drop-shadow px-1 max-w-full">{collection.name}</p>
				</div>
				<TileMediaCount images={presentIds.length - presentVideoCount} videos={presentVideoCount} />
				{isSelected ? <div className="absolute inset-0 flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--accent) 45%, transparent)" }}><Check className="h-5 w-5 text-white drop-shadow" /></div> : null}
				{isSelected && <div className="absolute inset-0 pointer-events-none rounded-md" style={{ border: "2px solid var(--accent)" }} />}
			</div>
		);
	});

	// Capture / upload actions, shown as the first tiles of the media grid.
	const actionsDisabled = isAdding || hasSelection || hasAlbumSelection || hasCollectionSelection || noConversation;
	const { actions: drawerActions, inputs: drawerAddInputs } = useDrawerAddActions({
		onFiles: onPickDrawerFiles,
		busy: isAdding,
	});

	return (
		<BottomSheet
			onClose={isSending || isAdding ? () => {} : onBack}
			isProcessing={isSending || isAdding}
			isDesktop={isDesktop}
			bg="bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]"
			panelClassName="px-4"
		>
			<DrawerHeader
				title={pendingAddFile
					? pendingAddFile.type.startsWith("video/")
						? t("chat_drawer.add_video", { defaultValue: "Add video" })
						: t("chat_drawer.add_photo")
					: t("chat_drawer.title", { defaultValue: "Drawer" })}
				// While adding a file, X goes back to the drawer instead of closing it.
				onClose={pendingAddFile ? cancelAddPhoto : undefined}
				actions={pendingAddFile ? undefined : (() => {
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

				{drawerAddInputs}

				{pendingAddFile ? (
					<DrawerAddMediaStep
						file={pendingAddFile}
						isAdding={isAdding}
						onCancel={cancelAddPhoto}
						onConfirm={confirmAddPhoto}
					/>
				) : (
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
						<DrawerBody isLoading={isLoading} error={error} onRetry={onLoadMedia}>
								<div className="flex flex-col gap-3">
								{!combined && activeTab === "albums" && albums.length === 0 && (
									isLoadingAlbums ? (
										<div className="flex justify-center py-8">
											<Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" />
										</div>
									) : (
										<DrawerEmptyState
											icon={<Album className="h-5 w-5" />}
											title={t("chat_drawer.albums_empty", { defaultValue: "You don't have any albums yet." })}
											hint={t("chat_drawer.albums_empty_hint", { defaultValue: "Albums let you share several photos at once, and stop sharing any time." })}
										>
											{renderCreateButton(t("chat_drawer.albums_create", { defaultValue: "Create album" }))}
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
											{renderCreateButton(t("chat_drawer.collections_create", { defaultValue: "Create collection" }))}
										</DrawerEmptyState>
									) : (
										<div className="flex justify-center py-8">
											<Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" />
										</div>
									)
								)}
								{!combined && ((activeTab === "albums" && albums.length > 0) || (activeTab === "collections" && collections.length > 0)) && (
									<div className={`grid gap-2 ${isDesktop ? "grid-cols-4" : "grid-cols-3"}`}>
										{activeTab === "albums" ? albumTiles : collectionTiles}
									</div>
								)}
								{showSection("media") && (media.length > 0 || hasCombinedGroups) && (
								<DrawerGrid isDesktop={isDesktop}>
									{drawerActions.map((action) => (
										<DrawerActionTile
											key={action.key}
											icon={action.icon}
											label={action.label}
											onClick={action.onClick}
											disabled={actionsDisabled}
										/>
									))}
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
												onDelete={hasCollectionSelection ? undefined : (event) => void handleDeleteMedia(event, item.id)}
												isDeleting={deletingMediaId === item.id}
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
												{item.takenOnGrindr ? (
													<img
														src={freegrindLogo}
														alt=""
														className="absolute bottom-1 left-1 h-4 w-4 rounded-full logo-shine"
													/>
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
													onClick={openAlbumsPage}
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
							const editButton = (
								<button
									type="button"
									onClick={() => {
										// With exactly one album selected, open it straight away there.
										const [onlyAlbumId] = selectedAlbumIds.size === 1 ? [...selectedAlbumIds] : [];
										onBack();
										navigate("/settings/albums", onlyAlbumId != null ? { state: { openAlbumId: onlyAlbumId } } : undefined);
									}}
									disabled={isSharingAlbum}
									className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)] disabled:opacity-60"
									aria-label={t("chat_drawer.album_manage")}
									title={t("chat_drawer.album_manage")}
								>
									<Pencil className="h-4 w-4" />
								</button>
							);
							return (
								<DrawerFooter>
									{isSelectedShared ? (
										<>
											{editButton}
											<button
												type="button"
												onClick={() => {
													if (selectedAlbumIds.size === 0 || !onStopAlbumShare) return;
													void Promise.all([...selectedAlbumIds].map(id => onStopAlbumShare!(id))).then(() => { setSelectedAlbumIds(new Set()); onBack(); });
												}}
												disabled={isSharingAlbum}
												className="min-w-0 flex-1 inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-orange-500/40 bg-orange-500/10 px-4 text-sm font-semibold text-orange-300 transition hover:bg-orange-500/20 disabled:opacity-60"
											>
												{isSharingAlbum ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
												<span>{t("chat.actions.stop_sharing", { defaultValue: "Stop Sharing" })} ({selectedAlbumIds.size})</span>
											</button>
										</>
									) : (
										<>
											<div className="relative inline-flex h-11 min-w-0 flex-1 items-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)]">
												<Hourglass className="pointer-events-none absolute left-3 h-4 w-4 shrink-0" />
												<select
													value={albumExpirationType}
													onChange={(e) => setAlbumExpirationType(e.target.value)}
													className="h-full w-full appearance-none rounded-xl bg-transparent pl-9 pr-3 text-sm font-semibold text-[var(--text)] focus:outline-none cursor-pointer text-center"
												>
													{EXPIRY_OPTIONS.map((opt) => (
														<option key={opt} value={opt}>{EXPIRY_LABELS[opt]}</option>
													))}
												</select>
											</div>
											{editButton}
											<button
												type="button"
												onClick={() => {
													if (selectedAlbumIds.size === 0 || !onShareAlbum) return;
													void Promise.all([...selectedAlbumIds].map(id => onShareAlbum!(id, albumExpirationType))).then(() => { setSelectedAlbumIds(new Set()); onBack(); });
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
								<div className="relative inline-flex h-11 min-w-0 flex-1 items-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)]">
									<Hourglass className="pointer-events-none absolute left-3 h-4 w-4 shrink-0" />
									<select
										value={mediaMaxViews}
										onChange={(e) => setMediaMaxViews(Number(e.target.value))}
										className="h-full w-full appearance-none rounded-xl bg-transparent pl-9 pr-3 text-sm font-semibold text-[var(--text)] focus:outline-none cursor-pointer text-center"
									>
										{isMixedSelection ? (
											<>
												<option value={2147483647}>{t("chat_drawer.expiry.unlimited", { defaultValue: "Unlimited" })}</option>
												<option value={1}>{t("chat_drawer.expiry.ten_seconds_or_once", { defaultValue: "10s / once" })}</option>
											</>
										) : hasAnyVideo ? (
											<>
												<option value={2147483647}>{t("chat_drawer.expiry.unlimited", { defaultValue: "Unlimited" })}</option>
												<option value={1}>{t("chat_drawer.expiry.once", { defaultValue: "Once" })}</option>
												<option value={2}>{t("chat_drawer.expiry.repeat", { defaultValue: "Repeat" })}</option>
											</>
										) : (
											<>
												<option value={2147483647}>{t("chat_drawer.expiry.unlimited", { defaultValue: "Unlimited" })}</option>
												<option value={1}>{t("chat_drawer.expiry.ten_seconds", { defaultValue: "10s" })}</option>
											</>
										)}
									</select>
								</div>
								{selectedCollection ? (
									<button
										type="button"
										onClick={() => {
											onBack();
											navigate("/settings/albums");
										}}
										disabled={isSending}
										className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)] disabled:opacity-60"
										aria-label={t("chat_drawer.collection_manage")}
										title={t("chat_drawer.collection_manage")}
									>
										<Pencil className="h-4 w-4" />
									</button>
								) : null}
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
				<ConfirmDialog
					isOpen={confirmDeleteMediaId != null}
					title={t("chat_drawer.delete_confirm_title")}
					message={t("chat_drawer.delete_confirm_message")}
					confirmLabel={t("chat_drawer.delete_confirm_label")}
					cancelLabel={t("chat.actions.cancel")}
					onConfirm={confirmDeleteMedia}
					onCancel={cancelDeleteMedia}
					isProcessing={confirmDeleteMediaId != null && deletingMediaId === confirmDeleteMediaId}
					confirmTone="danger"
				/>
		</BottomSheet>
	);
}