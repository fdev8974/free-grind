import { ChevronLeft, Film, Images, MessageCircle, Play, RefreshCw, UserRound } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { EmptyState, ErrorState } from "../../components/ui/states";
import { FeedScrollContainer } from "../../components/ui/FeedScrollContainer";
import { PageHeaderBackground } from "../../components/ui/PageHeaderBackground";
import { ProfileImage } from "../../components/ui/profile-image";
import { PhotoViewer, type PhotoViewerMedia, type PhotoViewerMenuAction } from "../../components/PhotoViewer";
import { useAuth } from "../../contexts/useAuth";
import { usePreferences } from "../../contexts/PreferencesContext";
import {
	getAlbumMediaData,
	getAllAlbumVideos,
	getAllReceivedChatVideos,
	getConversation,
	getMediaFile,
} from "../../services/chatDb";
import { getThumbImageUrl, validateMediaHash } from "../../utils/media";
import { limitChatDbBlobRead } from "../../utils/chatDbBlobLimiter";
import { createLimiter } from "../../utils/concurrencyLimit";
import { cn } from "../../utils/cn";
import { appLog } from "../../utils/logger";

type VideoSource = "album" | "chat";

type GalleryVideo = {
	/** album_media's composite `${albumId}:${contentId}` key, or media_files' media_key. */
	key: string;
	source: VideoSource;
	thumbUrl: string | null;
	albumName: string | null;
	conversationId: string | null;
	profileId: number | null;
	profileName: string;
	profileMediaHash: string | null;
	timestamp: number;
};

type SourceFilter = "all" | VideoSource;

const VIEWER_HISTORY_KEY = "videoGalleryOverlay";

// Album thumbnails are stored under the item's own (video/*) content type,
// so the real image type is sniffed from the base64 magic bytes instead. No
// match means the stored "thumb" isn't a still image at all.
function sniffImageMimeType(base64: string): string | null {
	if (base64.startsWith("/9j/")) return "image/jpeg";
	if (base64.startsWith("iVBORw0KGgo")) return "image/png";
	if (base64.startsWith("UklGR")) return "image/webp";
	if (base64.startsWith("R0lGOD")) return "image/gif";
	return null;
}

function base64ToBlobUrl(base64: string, mimeType: string | null): string {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return URL.createObjectURL(new Blob([bytes], { type: mimeType || "video/mp4" }));
}

async function loadVideoBlobUrl(video: Pick<GalleryVideo, "key" | "source">): Promise<string | null> {
	if (video.source === "album") {
		const data = await limitChatDbBlobRead(() => getAlbumMediaData(video.key));
		return data ? base64ToBlobUrl(data.dataBase64, data.contentType) : null;
	}
	const file = await limitChatDbBlobRead(() => getMediaFile(video.key));
	return file ? base64ToBlobUrl(file.dataBase64, file.mimeType) : null;
}

// Chat videos (and some album videos) have no stored still preview, so one
// is grabbed from the video's first frame the first time its tile scrolls
// into view. Kept for the whole session so revisiting the page is instant;
// decoding is capped at two at a time since each one loads the full bytes.
const posterCache = new Map<string, string | null>();
const limitPosterJob = createLimiter(2);
const POSTER_MAX_EDGE = 360;
const POSTER_TIMEOUT_MS = 10_000;

function extractPosterFrame(blobUrl: string): Promise<string | null> {
	return new Promise((resolve) => {
		const video = document.createElement("video");
		video.muted = true;
		video.playsInline = true;
		video.preload = "auto";
		const finish = (result: string | null) => {
			window.clearTimeout(timer);
			video.removeAttribute("src");
			video.load();
			resolve(result);
		};
		const timer = window.setTimeout(() => finish(null), POSTER_TIMEOUT_MS);
		video.onloadeddata = () => {
			video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
		};
		video.onseeked = () => {
			try {
				const scale = Math.min(1, POSTER_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight, 1));
				const canvas = document.createElement("canvas");
				canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
				canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
				canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
				finish(canvas.toDataURL("image/jpeg", 0.7));
			} catch {
				finish(null);
			}
		};
		video.onerror = () => finish(null);
		video.src = blobUrl;
	});
}

function generatePoster(video: GalleryVideo): Promise<string | null> {
	return limitPosterJob(async () => {
		const blobUrl = await loadVideoBlobUrl(video).catch(() => null);
		if (!blobUrl) return null;
		try {
			return await extractPosterFrame(blobUrl);
		} finally {
			URL.revokeObjectURL(blobUrl);
		}
	});
}

function VideoTile({ item, onClick }: { item: GalleryVideo; onClick: () => void }) {
	const { t } = useTranslation();
	const ref = useRef<HTMLButtonElement | null>(null);
	const [poster, setPoster] = useState<string | null>(item.thumbUrl ?? posterCache.get(item.key) ?? null);
	const [posterFailed, setPosterFailed] = useState(posterCache.get(item.key) === null);

	useEffect(() => {
		if (poster || posterFailed || !ref.current) return;
		let cancelled = false;
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				observer.disconnect();
				void generatePoster(item).then((url) => {
					posterCache.set(item.key, url);
					if (cancelled) return;
					if (url) setPoster(url);
					else setPosterFailed(true);
				});
			},
			{ rootMargin: "200px" },
		);
		observer.observe(ref.current);
		return () => {
			cancelled = true;
			observer.disconnect();
		};
	}, [item, poster, posterFailed]);

	return (
		<button
			ref={ref}
			type="button"
			onClick={onClick}
			className="group relative block aspect-[3/4] w-full overflow-hidden rounded-2xl bg-[var(--surface-2)]"
		>
			{poster ? (
				<img
					src={poster}
					alt={item.albumName ?? t("video_gallery.video_alt", { defaultValue: "Video" })}
					loading="lazy"
					className="h-full w-full object-cover transition group-hover:scale-105"
				/>
			) : (
				<div className={cn("absolute inset-0 flex items-center justify-center", !posterFailed && "animate-pulse")}>
					<Film className="h-8 w-8 text-[var(--text-muted)] opacity-40" />
				</div>
			)}
			<div className="absolute inset-0 flex items-center justify-center bg-black/15">
				<Play className="h-8 w-8 text-white drop-shadow" fill="white" />
			</div>
			<div className="absolute left-2 top-2 inline-flex items-center rounded-full bg-black/50 p-1 text-white/85 backdrop-blur-sm">
				{item.source === "album" ? <Images className="h-3 w-3" /> : <MessageCircle className="h-3 w-3" />}
			</div>
			<div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2 pb-2 pt-6 text-left">
				<div className="h-5 w-5 shrink-0 overflow-hidden rounded-full bg-white/15">
					<ProfileImage
						src={item.profileMediaHash ? getThumbImageUrl(item.profileMediaHash, "75x75") : null}
						alt={item.profileName}
					/>
				</div>
				<p className="min-w-0 truncate text-[11px] font-semibold text-white drop-shadow">{item.profileName}</p>
			</div>
		</button>
	);
}

/** Collected gallery of every locally stored video — from received albums and from chats. */
export function VideoGalleryPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { userId } = useAuth();
	const { mobileGridColumns } = usePreferences();
	const minmaxValue = mobileGridColumns === "2" ? "130px" : "100px";

	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [items, setItems] = useState<GalleryVideo[]>([]);
	const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

	const [viewerItems, setViewerItems] = useState<GalleryVideo[] | null>(null);
	const [viewerIndex, setViewerIndex] = useState(0);
	const [videoUrls, setVideoUrls] = useState<Record<string, string>>({});
	const videoUrlsRef = useRef<Record<string, string>>({});
	const loadingKeysRef = useRef<Set<string>>(new Set());

	const loadVideos = useCallback(async () => {
		setError(null);
		try {
			const [albumVideos, chatVideos] = await Promise.all([
				getAllAlbumVideos(),
				getAllReceivedChatVideos(userId),
			]);
			const nameFallback = t("shared_albums.name_fallback");

			const conversationIds = new Set<string>();
			for (const row of albumVideos) if (row.conversationId) conversationIds.add(row.conversationId);
			for (const row of chatVideos) conversationIds.add(row.conversationId);

			const conversationMeta = new Map<string, { name: string | null; mediaHash: string | null }>();
			await Promise.all(
				[...conversationIds].map(async (conversationId) => {
					const conversation = await getConversation(conversationId).catch(() => null);
					if (!conversation) return;
					const participants = conversation.entry.data.participants ?? [];
					const other =
						participants.find((participant) => participant.profileId !== userId) ?? participants[0];
					const hash = other?.primaryMediaHash ?? null;
					conversationMeta.set(conversationId, {
						name: conversation.entry.data.name?.trim() || null,
						mediaHash: hash && validateMediaHash(hash) ? hash : null,
					});
				}),
			);

			const next: GalleryVideo[] = [
				...albumVideos.map((row): GalleryVideo => {
					const meta = row.conversationId ? conversationMeta.get(row.conversationId) : undefined;
					const thumbMime = row.thumbDataBase64 ? sniffImageMimeType(row.thumbDataBase64) : null;
					return {
						key: row.contentId,
						source: "album",
						thumbUrl:
							row.thumbDataBase64 && thumbMime ? `data:${thumbMime};base64,${row.thumbDataBase64}` : null,
						albumName: row.albumName,
						conversationId: row.conversationId,
						profileId: row.ownerProfileId ? Number(row.ownerProfileId) : null,
						profileName: meta?.name ?? nameFallback,
						profileMediaHash: meta?.mediaHash ?? null,
						timestamp: row.albumUpdatedAt ?? 0,
					};
				}),
				...chatVideos.map((row): GalleryVideo => {
					const meta = conversationMeta.get(row.conversationId);
					return {
						key: row.mediaKey,
						source: "chat",
						thumbUrl: null,
						albumName: null,
						conversationId: row.conversationId,
						profileId: row.senderId,
						profileName: meta?.name ?? nameFallback,
						profileMediaHash: meta?.mediaHash ?? null,
						timestamp: row.timestamp,
					};
				}),
			];
			// Stable sort keeps each album's own item order intact.
			next.sort((a, b) => b.timestamp - a.timestamp);
			setItems(next);
		} catch (loadError) {
			setError(
				loadError instanceof Error
					? loadError.message
					: t("video_gallery.error_load_fallback", { defaultValue: "Couldn't load videos." }),
			);
		} finally {
			setIsLoading(false);
		}
	}, [t, userId]);

	useEffect(() => {
		void loadVideos();
	}, [loadVideos]);

	const visibleItems = useMemo(
		() => (sourceFilter === "all" ? items : items.filter((item) => item.source === sourceFilter)),
		[items, sourceFilter],
	);

	// Video bytes are only ever held for the current slide and its direct
	// neighbours — a gallery can easily add up to hundreds of MB, far too much
	// to decode into blob URLs all at once.
	useEffect(() => {
		if (!viewerItems || viewerItems.length === 0) return;
		const n = viewerItems.length;
		const wantedItems = [viewerIndex - 1, viewerIndex, viewerIndex + 1].map((i) => viewerItems[(i + n) % n]);
		const wanted = new Set(wantedItems.map((item) => item.key));

		let changed = false;
		const next = { ...videoUrlsRef.current };
		for (const [key, url] of Object.entries(next)) {
			if (!wanted.has(key)) {
				URL.revokeObjectURL(url);
				delete next[key];
				changed = true;
			}
		}
		if (changed) {
			videoUrlsRef.current = next;
			setVideoUrls(next);
		}

		for (const item of wantedItems) {
			if (videoUrlsRef.current[item.key] || loadingKeysRef.current.has(item.key)) continue;
			loadingKeysRef.current.add(item.key);
			void loadVideoBlobUrl(item)
				.then((url) => {
					if (!url) return;
					videoUrlsRef.current = { ...videoUrlsRef.current, [item.key]: url };
					setVideoUrls(videoUrlsRef.current);
				})
				.catch((loadError) => {
					appLog.warn(`[video-gallery] failed to load video ${item.key}`, loadError);
				})
				.finally(() => {
					loadingKeysRef.current.delete(item.key);
				});
		}
	}, [viewerItems, viewerIndex]);

	// Releases every blob URL once the viewer closes (and on unmount). A load
	// still in flight at that point gets revoked on its next slide change or
	// the next close instead.
	const releaseVideoUrls = useCallback(() => {
		for (const url of Object.values(videoUrlsRef.current)) {
			URL.revokeObjectURL(url);
		}
		videoUrlsRef.current = {};
		setVideoUrls({});
	}, []);

	useEffect(() => releaseVideoUrls, [releaseVideoUrls]);

	const closeViewerState = useCallback(() => {
		setViewerItems(null);
		setViewerIndex(0);
		releaseVideoUrls();
	}, [releaseVideoUrls]);

	const openViewer = useCallback((index: number) => {
		setViewerItems(visibleItems);
		setViewerIndex(index);
		const state = (window.history.state ?? {}) as Record<string, unknown>;
		window.history.pushState({ ...state, [VIEWER_HISTORY_KEY]: "viewer" }, "");
	}, [visibleItems]);

	// Button/Escape close drops the overlay key from the current entry rather
	// than calling history.back(), which React Router would treat as a route
	// navigation (see the history modal pattern used elsewhere).
	const closeViewer = useCallback(() => {
		const state = (window.history.state ?? {}) as Record<string, unknown>;
		if (state[VIEWER_HISTORY_KEY]) {
			const { [VIEWER_HISTORY_KEY]: _removed, ...rest } = state;
			window.history.replaceState(rest, "");
		}
		closeViewerState();
	}, [closeViewerState]);

	const isViewerOpen = viewerItems !== null;

	useEffect(() => {
		if (!isViewerOpen) return;
		const handlePopState = () => {
			const state = (window.history.state ?? {}) as Record<string, unknown>;
			if (!state[VIEWER_HISTORY_KEY]) {
				closeViewerState();
			}
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				closeViewer();
			}
		};
		window.addEventListener("popstate", handlePopState);
		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => {
			window.removeEventListener("popstate", handlePopState);
			window.removeEventListener("keydown", handleKeyDown, { capture: true });
		};
	}, [isViewerOpen, closeViewer, closeViewerState]);

	const handleIndexChange = useCallback((index: number) => {
		setViewerIndex((prev) => (prev === index ? prev : index));
	}, []);

	const viewerPhotos = useMemo<PhotoViewerMedia[]>(
		() => (viewerItems ?? []).map((item) => ({ url: videoUrls[item.key] ?? "", type: "video" })),
		[viewerItems, videoUrls],
	);

	const currentItem = viewerItems?.[viewerIndex] ?? null;

	const openProfile = useCallback(
		(profileId: number) => {
			closeViewer();
			navigate(`/profile/${profileId}`, { state: { returnTo: "/chat/videos" } });
		},
		[closeViewer, navigate],
	);

	const menuActions = useMemo<PhotoViewerMenuAction[]>(() => {
		if (!currentItem) return [];
		const actions: PhotoViewerMenuAction[] = [];
		const { conversationId, profileId } = currentItem;
		if (conversationId) {
			actions.push({
				key: "open-chat",
				label: t("profile_details.message"),
				icon: MessageCircle,
				onClick: () => {
					closeViewer();
					navigate(`/chat/${conversationId}`);
				},
			});
		}
		if (profileId != null) {
			actions.push({
				key: "view-profile",
				label: t("chat.view_profile"),
				icon: UserRound,
				onClick: () => openProfile(profileId),
			});
		}
		return actions;
	}, [currentItem, t, closeViewer, navigate, openProfile]);

	const albumHeader = useMemo(() => {
		if (!currentItem) return undefined;
		const { profileId } = currentItem;
		return {
			avatarUrl: currentItem.profileMediaHash ? getThumbImageUrl(currentItem.profileMediaHash, "75x75") : null,
			name: currentItem.profileName,
			subtitle:
				currentItem.source === "album"
					? currentItem.albumName ?? t("video_gallery.source_album", { defaultValue: "Album" })
					: t("video_gallery.source_chat", { defaultValue: "Chat" }),
			isOnline: false,
			onClick: profileId != null ? () => openProfile(profileId) : undefined,
		};
	}, [currentItem, t, openProfile]);

	const handleRefresh = () => {
		if (isLoading) return;
		setIsLoading(true);
		void loadVideos();
	};

	// Same toggle pills as SharedAlbumsPage's filters — tapping the active
	// one again goes back to showing every source.
	const toggleSource = (source: VideoSource) => {
		setSourceFilter((previous) => (previous === source ? "all" : source));
	};

	const pillClassName = (active: boolean) =>
		cn(
			"inline-flex shrink-0 items-center gap-1.5 px-4 py-2 text-sm font-bold transition-all active:scale-95 disabled:opacity-50",
			active
				? "rounded-full border border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)] shadow-lg shadow-[var(--accent)]/40"
				: "glass-pill text-[var(--accent)] hover:border-[var(--accent)]/60 hover:bg-[var(--accent)]/20",
		);
	const pillStyle = (active: boolean) =>
		!active ? ({ "--pill-color": "var(--accent)" } as CSSProperties) : undefined;

	return (
		<>
			<div className="app-screen flex h-dvh w-full flex-col overflow-x-hidden !px-0 !pb-0">
				<header className="pointer-events-none relative z-20 shrink-0">
					<PageHeaderBackground color="var(--accent)" />
					<div className="pointer-events-auto mx-auto flex w-full max-w-6xl flex-col gap-3 px-[var(--app-px)]">
						<button
							type="button"
							onClick={() => navigate("/chat", { replace: true })}
							className="mt-3 inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
						>
							<ChevronLeft className="h-4 w-4" />
							{t("nav.inbox")}
						</button>

						<div className="flex items-center justify-between gap-2">
							<div className="min-w-0">
								<h1 className="app-title">{t("video_gallery.title", { defaultValue: "Videos" })}</h1>
								<p className="app-subtitle">
									{isLoading
										? t("video_gallery.loading", { defaultValue: "Loading videos…" })
										: [
											t("video_gallery.videos_count", {
												count: items.length,
												defaultValue: items.length === 1 ? "{{count}} video" : "{{count}} videos",
											}),
											t("shared_albums.people_count", {
												count: new Set(items.map((item) => item.profileId)).size,
											}),
										].join(" · ")}
								</p>
							</div>
							<button
								type="button"
								onClick={handleRefresh}
								disabled={isLoading}
								className="shrink-0 rounded-xl p-2 text-[var(--text-muted)] transition hover:text-[var(--text)] disabled:opacity-50"
								aria-label={t("shared_albums.refresh")}
							>
								<RefreshCw className={`h-5 w-5 ${isLoading ? "animate-spin" : ""}`} />
							</button>
						</div>

						<div className="flex flex-wrap items-center gap-2 pb-4">
							<button
								type="button"
								onClick={() => toggleSource("album")}
								disabled={isLoading}
								className={pillClassName(sourceFilter === "album")}
								style={pillStyle(sourceFilter === "album")}
							>
								<Images className="h-3.5 w-3.5" />
								{t("video_gallery.filter_albums", { defaultValue: "Albums" })}
							</button>
							<button
								type="button"
								onClick={() => toggleSource("chat")}
								disabled={isLoading}
								className={pillClassName(sourceFilter === "chat")}
								style={pillStyle(sourceFilter === "chat")}
							>
								<MessageCircle className="h-3.5 w-3.5" />
								{t("video_gallery.filter_chats", { defaultValue: "Chats" })}
							</button>
						</div>
					</div>
				</header>

				<FeedScrollContainer>
					<div className="mx-auto w-full max-w-6xl px-[var(--app-px)] pb-[calc(env(safe-area-inset-bottom,0px)+120px)]">
						{isLoading ? (
							<div
								className="grid gap-3"
								style={{ gridTemplateColumns: `repeat(auto-fill, minmax(clamp(${minmaxValue}, 15vw, 220px), 1fr))` }}
							>
								{Array.from({ length: 12 }).map((_, i) => (
									<div key={i} className="aspect-[3/4] w-full animate-pulse rounded-2xl bg-[var(--surface-2)]" />
								))}
							</div>
						) : error ? (
							<ErrorState
								title={t("video_gallery.error_load_title", { defaultValue: "Couldn't load videos" })}
								description={error}
								onRetry={handleRefresh}
							/>
						) : items.length === 0 ? (
							<EmptyState
								title={t("video_gallery.empty_title", { defaultValue: "No saved videos yet" })}
								description={t("video_gallery.empty_desc", {
									defaultValue: "Videos you receive in chats or albums appear here once they've been stored on this device.",
								})}
							/>
						) : (
							<div
								className="grid gap-3"
								style={{ gridTemplateColumns: `repeat(auto-fill, minmax(clamp(${minmaxValue}, 15vw, 220px), 1fr))` }}
							>
								{visibleItems.map((item, index) => (
									<VideoTile key={`${item.source}:${item.key}`} item={item} onClick={() => openViewer(index)} />
								))}
							</div>
						)}
					</div>
				</FeedScrollContainer>
			</div>

			{viewerItems !== null && (
				<PhotoViewer
					isOpen
					onClose={closeViewer}
					photos={viewerPhotos}
					initialIndex={viewerIndex}
					onIndexChange={handleIndexChange}
					conversationId={currentItem?.profileId != null ? String(currentItem.profileId) : null}
					menuActions={menuActions}
					albumHeader={albumHeader}
				/>
			)}
		</>
	);
}
