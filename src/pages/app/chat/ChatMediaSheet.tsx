import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Images, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { ProfileImage } from "../../../components/ui/profile-image";
import { BottomSheet } from "../../../components/ui/bottom-sheet";
import { NATIVE_SHEET_BG } from "../../../components/ui/action-sheet";
import { SlidingTabs, useSwipeTabs } from "../../../components/ui/sliding-tabs";
import {
	DRAWER_ICON_BUTTON_CLASS,
	DRAWER_TILE_CLASS,
	DrawerBody,
	DrawerEmptyState,
	DrawerGrid,
	DrawerHeader,
	DrawerMediaPreview,
	DrawerMediaTile,
	GroupTileOverlay,
	useDrawerMediaPreview,
} from "./drawerUi";
import { PhotoViewer, type PhotoViewerMedia } from "../../../components/PhotoViewer";
import { useApiFunctions } from "../../../hooks/useApiFunctions";
import { isIos, saveMediaBytesBatch } from "../../../services/saveMedia";
import { fetchAndEncode, toDataUri } from "../../../services/mediaStore";
import { captureAlbum, getLocalAlbum } from "../../../services/albumStore";
import * as chatDb from "../../../services/chatDb";
import { extractImageHashFromSignedUrl } from "./chatUtils";
import { appLog } from "../../../utils/logger";
import { proxyMediaUrl } from "../../../utils/mediaProxy";

const IMAGE_HASH_KEY_PREFIX = "image:hash:";

/**
 * Content fingerprint for de-duping the local/live merge below. A local
 * image captured via the chat-message flow can end up keyed by mediaId or
 * messageId instead of a hash (whenever getMessageImageHash/
 * extractImageHashFromSignedUrl couldn't derive one at capture time) — so
 * the URL-hash check alone can miss real duplicates. Hashing the actual
 * base64 content is key-scheme-independent and always catches them.
 */
async function hashBase64(base64: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base64));
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

type Tab = "received" | "sent";
const TABS: readonly Tab[] = ["received", "sent"];

type SharedAlbum = {
	albumId: number;
	albumName: string | null;
	coverUrl: string | null;
	contentCount: { imageCount: number; videoCount: number };
};

type LocalMediaItem = {
	mediaKey: string;
	kind: "image" | "video";
	dataUri: string;
	mimeType: string | null;
	base64: string;
	// Null for media with no local message to join against (e.g. the
	// getSharedConversationImages live-merge below) — those are always
	// received (that endpoint only ever returns images shared *with* the
	// signed-in user), so treating null as "not mine" here is correct.
	senderId: number | null;
};

type Props = {
	conversationId: string;
	senderProfileId: string | null;
	userId: number | null;
	isDesktop: boolean;
	senderPhotoUrl?: string | null;
	onClose: () => void;
	openAlbumViewerById: (albumId: number) => void | Promise<void>;
	openFullScreenImage: (imageUrl: string) => void;
};

export function ChatMediaSheet({
	conversationId,
	senderProfileId,
	userId,
	isDesktop,
	senderPhotoUrl,
	onClose,
	openAlbumViewerById,
	openFullScreenImage: _openFullScreenImage,
}: Props) {
	const { t } = useTranslation();
	const service = useApiFunctions();
	const [tab, setTab] = useState<Tab>("received");
	const [albums, setAlbums] = useState<SharedAlbum[]>([]);
	const [albumsLoading, setAlbumsLoading] = useState(true);
	const [media, setMedia] = useState<LocalMediaItem[]>([]);
	const [mediaLoading, setMediaLoading] = useState(true);
	const [failedCovers, setFailedCovers] = useState<Set<number>>(new Set());
	const [viewerIndex, setViewerIndex] = useState<number | null>(null);
	const [isSavingAll, setIsSavingAll] = useState(false);

	const isMine = (senderId: number | null) => senderId != null && userId != null && Number(senderId) === Number(userId);
	const sentMedia = media.filter((m) => isMine(m.senderId));
	const receivedMedia = media.filter((m) => !isMine(m.senderId));
	const activeMedia = tab === "sent" ? sentMedia : receivedMedia;

	const handleSaveAll = async () => {
		if (activeMedia.length === 0) {
			toast.error(t("profile_details.save_all_empty"));
			return;
		}

		setIsSavingAll(true);
		const toastId = toast.loading(
			t("profile_details.save_all_progress", { done: 0, total: activeMedia.length }),
		);
		try {
			const result = await saveMediaBytesBatch(
				activeMedia.map((m) => ({ base64: m.base64, mimeType: m.mimeType, type: m.kind })),
				(done, total) => {
					toast.loading(t("profile_details.save_all_progress", { done, total }), {
						id: toastId,
					});
				},
				conversationId,
			);

			if (result.failed === 0) {
				toast.success(
					t(
						isIos() ? "profile_details.save_all_success" : "profile_details.save_all_success_downloads",
						{ count: result.succeeded },
					),
					{ id: toastId },
				);
			} else {
				toast.error(
					t("profile_details.save_all_partial", {
						succeeded: result.succeeded,
						total: result.total,
						failed: result.failed,
					}),
					{ id: toastId },
				);
			}
		} catch (error) {
			appLog.error("[ChatMediaSheet] Save all failed", error);
			toast.error(
				t(isIos() ? "profile_details.save_all_error" : "profile_details.save_all_error_downloads"),
				{ id: toastId },
			);
		} finally {
			setIsSavingAll(false);
		}
	};

	// Load this conversation's albums from the local cache first — durable
	// even once a share expires/exhausts server-side — then merge in the
	// live list (exact albumId match, no heuristic needed here) so covers/
	// counts stay fresh when reachable, and so albums surfaced only via this
	// profile-wide endpoint (not necessarily backed by a message in this
	// conversation's own history) still get captured for permanent access.
	useEffect(() => {
		let cancelled = false;
		setAlbumsLoading(true);

		void (async () => {
			let localAlbumIds = new Set<number>();
			try {
				const stored = await chatDb.getAlbumsForConversation(conversationId);
				const withCovers = await Promise.all(
					stored.map(async (a) => {
						const albumId = Number(a.albumId);
						const local = await getLocalAlbum(albumId);
						const first = local?.content[0] ?? null;
						const videoCount =
							local?.content.filter((c) => c.contentType?.startsWith("video/")).length ?? 0;
						return {
							albumId,
							albumName: a.albumName,
							coverUrl: first?.thumbUrl ?? first?.coverUrl ?? first?.url ?? null,
							contentCount: {
								imageCount: (local?.content.length ?? 0) - videoCount,
								videoCount,
							},
						};
					}),
				);
				localAlbumIds = new Set(withCovers.map((a) => a.albumId));
				if (!cancelled) setAlbums(withCovers);
			} catch (error) {
				appLog.warn("[ChatMediaSheet] failed to load local albums", error);
			} finally {
				if (!cancelled) setAlbumsLoading(false);
			}

			if (!senderProfileId) {
				return;
			}

			try {
				const sharedAlbums = await service.getSharedAlbumsForProfile({
					profileId: Number(senderProfileId),
				});
				if (cancelled) return;
				const liveAlbums: SharedAlbum[] = sharedAlbums.map((a) => ({
					albumId: a.albumId,
					albumName: a.albumName ?? a.name ?? null,
					coverUrl: a.content?.thumbUrl ?? a.content?.url ?? a.content?.coverUrl ?? null,
					contentCount: a.contentCount,
				}));
				setAlbums((previous) => {
					const map = new Map(previous.map((a) => [a.albumId, a] as const));
					for (const a of liveAlbums) {
						map.set(a.albumId, a); // live metadata wins when reachable
					}
					return [...map.values()];
				});

				for (const album of liveAlbums) {
					if (localAlbumIds.has(album.albumId)) continue;
					void (async () => {
						try {
							const details = await service.getAlbum(album.albumId);
							await captureAlbum({
								albumId: details.albumId,
								albumName: details.albumName,
								content: details.content,
								ownerProfileId: senderProfileId,
								conversationId,
								sharedViaMessageId: null,
								remainingViews: null,
								isViewable: null,
							});
						} catch (error) {
							appLog.warn(
								`[ChatMediaSheet] failed to eagerly capture album ${album.albumId}`,
								error,
							);
						}
					})();
				}
			} catch (err) {
				console.error("[ChatMediaSheet] getSharedAlbumsForProfile failed", err);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [conversationId, senderProfileId, service]);

	// Load this conversation's media from the local cache (chatDb) first — it
	// stays viewable forever, even after the server no longer serves it
	// (expired signed URLs, view-once exhausted, conversation
	// archived/blocked) — then merge in anything the live API still has that
	// isn't cached yet (e.g. an older conversation predating this cache).
	// The live endpoint exposes no messageId/hash to cross-reference chatDb
	// with directly, so de-duping uses the content hash embedded in
	// Grindr's signed CloudFront URLs instead — a heuristic, not a
	// guaranteed-exact match, but the same hash this codebase already
	// relies on elsewhere to identify images across re-signed URLs.
	useEffect(() => {
		let cancelled = false;
		setMediaLoading(true);

		void (async () => {
			let knownUrlHashes = new Set<string>();
			let knownContentHashes = new Set<string>();
			try {
				const files = await chatDb.getMediaFilesForConversation(conversationId);
				if (cancelled) return;
				setMedia(
					files.map((f) => ({
						mediaKey: f.mediaKey,
						kind: f.kind === "video" ? "video" : "image",
						dataUri: toDataUri(f.mimeType, f.dataBase64),
						mimeType: f.mimeType,
						base64: f.dataBase64,
						senderId: f.senderId,
					})),
				);
				knownUrlHashes = new Set(
					files
						.filter((f) => f.mediaKey.startsWith(IMAGE_HASH_KEY_PREFIX))
						.map((f) => f.mediaKey.slice(IMAGE_HASH_KEY_PREFIX.length)),
				);
				// Robust fallback, independent of which media_key scheme a given
				// local image happened to be captured under (hash/mediaId/
				// messageId) — covers the cases the URL-hash pre-check below
				// would otherwise miss.
				knownContentHashes = new Set(
					await Promise.all(files.map((f) => hashBase64(f.dataBase64))),
				);
			} catch (error) {
				appLog.warn("[ChatMediaSheet] failed to load local media", error);
			} finally {
				if (!cancelled) setMediaLoading(false);
			}

			try {
				const liveImages = await service.getSharedConversationImages(conversationId);

				for (const img of liveImages) {
					if (cancelled) return;
					if (!img.url) continue;

					const urlHash = extractImageHashFromSignedUrl(img.url);
					if (urlHash && knownUrlHashes.has(urlHash)) {
						// Fast path: definitely already local, skip the download.
						continue;
					}

					const fetched = await fetchAndEncode(img.url);
					if (!fetched || cancelled) continue;

					const contentHash = await hashBase64(fetched.base64);
					if (knownContentHashes.has(contentHash)) {
						// Already local under a different media_key scheme — don't
						// add a visible duplicate, but it's still worth recording
						// the URL hash now so a future load can take the fast path.
						if (urlHash) knownUrlHashes.add(urlHash);
						continue;
					}
					knownContentHashes.add(contentHash);
					if (urlHash) knownUrlHashes.add(urlHash);

					const mediaKey = urlHash
						? `${IMAGE_HASH_KEY_PREFIX}${urlHash}`
						: `image:media:${img.mediaId}`;

					await chatDb.upsertMediaFile({
						mediaKey,
						conversationId,
						messageId: null,
						kind: "image",
						mimeType: fetched.mimeType,
						dataBase64: fetched.base64,
						viewOnce: false,
						sizeBytes: fetched.sizeBytes,
						fetchStatus: "ok",
					});

					if (!cancelled) {
						setMedia((previous) => {
							if (previous.some((m) => m.mediaKey === mediaKey)) {
								return previous;
							}
							return [
								...previous,
								{
									mediaKey,
									kind: "image" as const,
									dataUri: toDataUri(fetched.mimeType, fetched.base64),
									mimeType: fetched.mimeType,
									base64: fetched.base64,
									// getSharedConversationImages only ever returns images shared
									// with the signed-in user, so this is always received.
									senderId: null,
								},
							];
						});
					}
				}
			} catch (error) {
				appLog.warn("[ChatMediaSheet] failed to merge live shared images", error);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [conversationId, service]);

	// Same look as the chat drawer: sliding tabs you can also swipe between,
	// drawer tiles with press-and-hold peek, and the drawer's empty states.
	const tabSwipe = useSwipeTabs<Tab>(TABS, tab, setTab);
	const { preview, bind: bindPreview, consumeClick: consumePreviewClick } = useDrawerMediaPreview();
	// Like the drawer: the grid renders once the sheet has slid in, so
	// decoding every tile doesn't stall the opening animation.
	const [hasSlidIn, setHasSlidIn] = useState(false);
	useEffect(() => {
		const timer = setTimeout(() => setHasSlidIn(true), 350);
		return () => clearTimeout(timer);
	}, []);

	const withCount = (label: string, count: number) => (!mediaLoading && count > 0 ? `${label} · ${count}` : label);
	const tabs = [
		{ value: "received" as const, label: withCount(t("chat.media_sheet.tab_received"), receivedMedia.length + albums.length) },
		{ value: "sent" as const, label: withCount(t("chat.media_sheet.tab_sent"), sentMedia.length) },
	];

	const showAlbums = tab === "received" && albums.length > 0;
	const isTabLoading = mediaLoading || (tab === "received" && albumsLoading);
	const isEmpty = !showAlbums && activeMedia.length === 0;

	const viewerPhotos: PhotoViewerMedia[] = activeMedia.map((m) => ({ url: m.dataUri, type: m.kind }));

	return (
		<>
		<BottomSheet onClose={onClose} isDesktop={isDesktop} expandable bg={NATIVE_SHEET_BG} panelClassName="px-4">
			<DrawerHeader
				title={t("chat.media_sheet.title")}
				actions={activeMedia.length > 0 ? (
					<button
						type="button"
						onClick={() => void handleSaveAll()}
						disabled={isSavingAll}
						className={DRAWER_ICON_BUTTON_CLASS}
						aria-label={t("profile_details.save_all")}
						title={t("profile_details.save_all")}
					>
						{isSavingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
					</button>
				) : undefined}
			/>

			<SlidingTabs<Tab> tabs={tabs} value={tab} onChange={setTab} className="mb-2 shrink-0" />

			<DrawerBody
				isLoading={!hasSlidIn || (isTabLoading && isEmpty)}
				isDesktop={isDesktop}
				gestureProps={tabSwipe}
				empty={isEmpty ? (
					<DrawerEmptyState
						icon={<Images className="h-5 w-5" />}
						title={t(tab === "sent" ? "chat.media_sheet.sent_empty_title" : "chat.media_sheet.received_empty_title")}
						hint={t(tab === "sent" ? "chat.media_sheet.sent_empty_desc" : "chat.media_sheet.received_empty_desc")}
					/>
				) : undefined}
			>
				<DrawerGrid isDesktop={isDesktop}>
					{showAlbums && albums.map((album) => {
						const showCover = !!album.coverUrl && !failedCovers.has(album.albumId);
						return (
							<div
								key={`album-${album.albumId}`}
								role="button"
								tabIndex={0}
								onClick={() => void openAlbumViewerById(album.albumId)}
								onKeyDown={(e) => { if (e.key === "Enter") void openAlbumViewerById(album.albumId); }}
								className={`${DRAWER_TILE_CLASS} cursor-pointer`}
							>
								{showCover ? (
									<>
										<img
											src={proxyMediaUrl(album.coverUrl!)}
											alt=""
											className="absolute inset-0 h-full w-full scale-110 object-cover"
											style={{ filter: "blur(3px)" }}
											onError={() => setFailedCovers((p) => new Set([...p, album.albumId]))}
										/>
										<div className="absolute inset-0 bg-black/25" />
									</>
								) : (
									<div className="absolute inset-0 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--accent)_45%,var(--surface)),color-mix(in_srgb,var(--accent)_12%,var(--surface)))]" />
								)}
								<GroupTileOverlay
									// Their avatar instead of the drawer's album icon: these are albums shared with you.
									icon={<ProfileImage src={senderPhotoUrl} className="rounded-full" iconClassName="h-5 w-5" />}
									name={album.albumName ?? `#${album.albumId}`}
									counts={{ images: album.contentCount.imageCount, videos: album.contentCount.videoCount }}
								/>
							</div>
						);
					})}
					{activeMedia.map((item, idx) => (
						<DrawerMediaTile
							key={item.mediaKey}
							src={item.dataUri}
							isVideo={item.kind === "video"}
							onSelect={() => setViewerIndex(idx)}
							previewProps={bindPreview({ src: item.dataUri, isVideo: item.kind === "video" })}
							consumePreviewClick={consumePreviewClick}
						/>
					))}
				</DrawerGrid>
			</DrawerBody>

			<DrawerMediaPreview media={preview} />
		</BottomSheet>

		{viewerIndex !== null && createPortal(
			<PhotoViewer
				isOpen
				onClose={() => setViewerIndex(null)}
				photos={viewerPhotos}
				initialIndex={viewerIndex}
				conversationId={conversationId}
			/>,
			document.body,
		)}
		</>
	);
}
