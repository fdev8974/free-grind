import {
	Album,
	Camera,
	Check,
	FolderPlus,
	Images,
	Pencil,
	SquareCenterlineDashedHorizontal,
	Image as ImageIcon,
	Loader2,
	Play,
	RotateCw,
	Plus,
	Hourglass,
	RefreshCw,
	Send,
	Share2,
	Trash2,
	Upload,
	Video,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AlbumListItem } from "../../../types/chat-page";
import { ProfileImage } from "../../../components/ui/profile-image";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import ReactCrop, { type Crop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import freegrindLogo from "../../../images/freegrind-logo.webp";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { PromptDialog } from "../../../components/ui/prompt-dialog";
import { ToggleRow } from "../../../components/ui/toggle-row";
import { useModalClose } from "../../../hooks/useModalClose";
import { BottomSheet, SheetClose } from "../../../components/ui/bottom-sheet";
import { useLocalMediaCache } from "../../../hooks/useLocalMediaCache";
import { getCachedMediaUri, getDrawerMediaKey } from "../../../services/mediaStore";
import { usePreferences } from "../../../contexts/PreferencesContext";
import * as chatDb from "../../../services/chatDb";
import type { StoredLocalDrawerAlbum } from "../../../services/chatDb";
import { appLog } from "../../../utils/logger";

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
	isLoadingAlbums: _isLoadingAlbums = false,
	albumCoverMap = new Map(),
	sharedAlbumIds = new Set(),
	onShareAlbum,
	isSharingAlbum = false,
	onStopAlbumShare,
	noConversation = false,
	ownProfilePhotoUrl,
}: ChatDrawerPanelProps) {
	const { t } = useTranslation();
	const { defaultExpiringPhotos, defaultAlbumExpirationType } = usePreferences();
	// Re-renders once a background fetch lands a drawer item in the local
	// media cache, so it can swap in the cached copy without waiting for a DB read.
	useLocalMediaCache();
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
	// Files waiting for the add-to-drawer preview, one at a time — more than
	// one only when picking several at once in the album editor.
	const [pendingAddQueue, setPendingAddQueue] = useState<File[]>([]);
	const pendingAddFile = pendingAddQueue[0] ?? null;
	const [pendingTakenOnGrindr, setPendingTakenOnGrindr] = useState(false);
	const [pendingLooping, setPendingLooping] = useState(false);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [crop, setCrop] = useState<Crop | undefined>(undefined);
    const [isDraggingCrop, setIsDraggingCrop] = useState(false);
	const [completedCrop, setCompletedCrop] = useState<PixelCrop | undefined>(undefined);
	const imgRef = useRef<HTMLImageElement | null>(null);
	const [confirmDeleteMediaId, setConfirmDeleteMediaId] = useState<number | null>(null);
	const [selectAfterUpload, setSelectAfterUpload] = useState(false);
	const [selectedAlbumIds, setSelectedAlbumIds] = useState<Set<number>>(new Set());
	// Local-only albums: named, ordered lists of drawer media ids. Sending one
	// goes through the regular onSendMedia path, which already sends each
	// item as its own message, one after another.
	const [localAlbums, setLocalAlbums] = useState<StoredLocalDrawerAlbum[]>([]);
	const [selectedLocalAlbumId, setSelectedLocalAlbumId] = useState<string | null>(null);
	// Non-null while creating/editing a local album — the media grid then
	// picks the album's contents (in tap order) instead of what to send.
	const [albumEditor, setAlbumEditor] = useState<{ id: string | null; name: string } | null>(null);
	const [isAlbumNamePromptOpen, setIsAlbumNamePromptOpen] = useState(false);
	const [isSavingLocalAlbum, setIsSavingLocalAlbum] = useState(false);
	const [confirmDeleteLocalAlbumId, setConfirmDeleteLocalAlbumId] = useState<string | null>(null);
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
	const uploadInputRef = useRef<HTMLInputElement | null>(null);
	const cameraInputRef = useRef<HTMLInputElement | null>(null);
	const cameraVideoInputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		let cancelled = false;
		chatDb
			.getLocalDrawerAlbums()
			.then((albums) => {
				if (!cancelled) setLocalAlbums(albums);
			})
			.catch((error) => appLog.warn("[ChatDrawerPanel] failed to load local albums", error));
		return () => {
			cancelled = true;
		};
	}, []);
	useEffect(() => {
		if (!pendingAddFile) {
			setPreviewUrl(null);
			setCrop(undefined);
			setCompletedCrop(undefined);
			return;
		}
		const url = URL.createObjectURL(pendingAddFile);
		setPreviewUrl(url);
		setCrop(undefined);
		setCompletedCrop(undefined);
		return () => URL.revokeObjectURL(url);
	}, [pendingAddFile]);

	useEffect(() => {
		if (!previewUrl) return;
		setCrop({ unit: "%", x: 0, y: 0, width: 100, height: 100 });
	}, [previewUrl]);

	const applyTransform = useCallback(async (type: "flipH" | "rotateCw") => {
		const img = imgRef.current;
		if (!img || !img.complete || img.naturalWidth === 0) return;
		const sw = img.naturalWidth;
		const sh = img.naturalHeight;
		const canvas = document.createElement("canvas");
		canvas.width = type === "rotateCw" ? sh : sw;
		canvas.height = type === "rotateCw" ? sw : sh;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.translate(canvas.width / 2, canvas.height / 2);
		if (type === "flipH") ctx.scale(-1, 1);
		if (type === "rotateCw") ctx.rotate(Math.PI / 2);
		ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, "image/jpeg", 0.95),
		);
		if (!blob) return;
		setPreviewUrl((prev) => {
			if (prev) URL.revokeObjectURL(prev);
			return URL.createObjectURL(blob);
		});
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
		setSelectedLocalAlbumId(null);
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
				if (next.size === 0) setMediaMaxViews(defaultImageMaxViews);
			} else {
				// Enforce image/video exclusivity: clear opposite type
				const hasOppositeType = [...next].some((existingId) => {
					const item = media.find((m) => m.id === existingId);
					return item ? item.contentType.startsWith("video") !== isVideo : false;
				});
				if (hasOppositeType) return prev;
				if (prev.size === 0) setMediaMaxViews(isVideo ? 1 : defaultImageMaxViews);
				next.add(id);
			}
			return next;
		});
	}, [media, defaultImageMaxViews]);

	const isVideoMediaId = useCallback(
		(id: number) => media.find((m) => m.id === id)?.contentType.startsWith("video") ?? false,
		[media],
	);
	// An album can outlive some of its media (deleted from the drawer since) —
	// those ids are skipped rather than pruned, so a failed/partial drawer
	// load never silently shrinks an album.
	const getPresentAlbumMediaIds = useCallback(
		(album: StoredLocalDrawerAlbum) => album.mediaIds.filter((id) => media.some((m) => m.id === id)),
		[media],
	);
	const selectedLocalAlbum = albumEditor ? null : localAlbums.find((a) => a.id === selectedLocalAlbumId) ?? null;
	const sendIds = selectedLocalAlbum ? getPresentAlbumMediaIds(selectedLocalAlbum) : Array.from(selectedIds);

	const handleSendSelected = useCallback(async () => {
		if (sendIds.length === 0) {
			toast.error(
				selectedLocalAlbum ? t("chat_drawer.local_album_empty_send") : t("chat_drawer.error_no_selection"),
			);
			return;
		}
		try {
			await onSendMedia(sendIds, mediaMaxViews);
			setSelectedIds(new Set());
			setSelectedLocalAlbumId(null);
			setMediaMaxViews(defaultImageMaxViews);
			onBack();
		} catch (err) {
			const message = err instanceof Error ? err.message : t("chat_drawer.error_send_failed");
			toast.error(message);
		}
	}, [sendIds, selectedLocalAlbum, onSendMedia, onBack, t, mediaMaxViews, defaultImageMaxViews]);
	const hasSelection = selectedIds.size > 0;
	const hasAlbumSelection = selectedAlbumIds.size > 0;
	const hasLocalAlbumSelection = selectedLocalAlbum != null;
	// The add-media tiles stay usable in the album editor: new uploads land
	// in the drawer and get appended to the album being built.
	const actionsLocked = !albumEditor && (hasSelection || hasAlbumSelection || hasLocalAlbumSelection || noConversation);
	const hasAnyVideo = sendIds.some((id) => isVideoMediaId(id));
	const hasAnyImage = sendIds.some((id) => !isVideoMediaId(id));

	const toggleLocalAlbumSelection = useCallback(
		(album: StoredLocalDrawerAlbum) => {
			setSelectedIds(new Set());
			setSelectedAlbumIds(new Set());
			if (selectedLocalAlbumId === album.id) {
				setSelectedLocalAlbumId(null);
				setMediaMaxViews(defaultImageMaxViews);
				return;
			}
			setSelectedLocalAlbumId(album.id);
			const firstId = getPresentAlbumMediaIds(album)[0];
			setMediaMaxViews(firstId != null && isVideoMediaId(firstId) ? 1 : defaultImageMaxViews);
		},
		[selectedLocalAlbumId, getPresentAlbumMediaIds, isVideoMediaId, defaultImageMaxViews],
	);

	const startNewLocalAlbum = useCallback(() => {
		setSelectedIds(new Set());
		setSelectedAlbumIds(new Set());
		setSelectedLocalAlbumId(null);
		setAlbumEditor({ id: null, name: "" });
	}, []);

	const startEditLocalAlbum = useCallback(
		(album: StoredLocalDrawerAlbum) => {
			setSelectedAlbumIds(new Set());
			setSelectedIds(new Set(getPresentAlbumMediaIds(album)));
			setAlbumEditor({ id: album.id, name: album.name });
		},
		[getPresentAlbumMediaIds],
	);

	const cancelAlbumEditor = useCallback(() => {
		setAlbumEditor(null);
		setIsAlbumNamePromptOpen(false);
		setSelectedIds(new Set());
		setMediaMaxViews(defaultImageMaxViews);
	}, [defaultImageMaxViews]);

	const saveLocalAlbum = useCallback(
		async (name: string) => {
			if (!albumEditor || selectedIds.size === 0) return;
			const id = albumEditor.id ?? crypto.randomUUID();
			setIsSavingLocalAlbum(true);
			try {
				const albums = await chatDb.upsertLocalDrawerAlbum({ id, name, mediaIds: Array.from(selectedIds) });
				setLocalAlbums(albums);
				setAlbumEditor(null);
				setIsAlbumNamePromptOpen(false);
				setSelectedIds(new Set());
				// Leave the saved album selected so it can be sent right away.
				setSelectedLocalAlbumId(id);
				const firstId = selectedIds.values().next().value;
				setMediaMaxViews(firstId != null && isVideoMediaId(firstId) ? 1 : defaultImageMaxViews);
			} catch (error) {
				appLog.error("[ChatDrawerPanel] failed to save local album", error);
				toast.error(t("chat_drawer.local_album_save_failed"));
			} finally {
				setIsSavingLocalAlbum(false);
			}
		},
		[albumEditor, selectedIds, isVideoMediaId, defaultImageMaxViews, t],
	);

	const confirmDeleteLocalAlbum = useCallback(async () => {
		if (confirmDeleteLocalAlbumId == null) return;
		try {
			setLocalAlbums(await chatDb.deleteLocalDrawerAlbum(confirmDeleteLocalAlbumId));
			if (selectedLocalAlbumId === confirmDeleteLocalAlbumId) setSelectedLocalAlbumId(null);
		} catch (error) {
			appLog.error("[ChatDrawerPanel] failed to delete local album", error);
			toast.error(t("chat_drawer.local_album_delete_failed"));
		} finally {
			setConfirmDeleteLocalAlbumId(null);
		}
	}, [confirmDeleteLocalAlbumId, selectedLocalAlbumId, t]);

	const onPickDrawerPhoto = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const files = Array.from(event.target.files ?? []);
			event.target.value = "";
			if (files.length === 0) return;
			const valid = files.filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"));
			if (valid.length < files.length) {
				toast.error(t("chat_drawer.invalid_file_type"));
			}
			if (valid.length === 0) return;
			setPendingAddQueue(valid);
			setPendingTakenOnGrindr(false);
		},
		[t],
	);

	const confirmAddPhoto = useCallback(async () => {
		if (!pendingAddFile) return;

		let fileToUpload = pendingAddFile;
		const isFullImage =
			!completedCrop ||
			!imgRef.current ||
			(completedCrop.x <= 1 &&
				completedCrop.y <= 1 &&
				Math.abs(completedCrop.width - imgRef.current.width) <= 2 &&
				Math.abs(completedCrop.height - imgRef.current.height) <= 2);
		if (!isFullImage && completedCrop?.width && completedCrop.height && imgRef.current) {
			const img = imgRef.current;
			const scaleX = img.naturalWidth / img.width;
			const scaleY = img.naturalHeight / img.height;
			const canvas = document.createElement("canvas");
			canvas.width = Math.round(completedCrop.width * scaleX);
			canvas.height = Math.round(completedCrop.height * scaleY);
			const ctx = canvas.getContext("2d");
			if (ctx) {
				ctx.drawImage(
					img,
					completedCrop.x * scaleX, completedCrop.y * scaleY,
					completedCrop.width * scaleX, completedCrop.height * scaleY,
					0, 0, canvas.width, canvas.height,
				);
				fileToUpload = await new Promise<File>((resolve) => {
					canvas.toBlob((blob) => {
						if (!blob) { resolve(pendingAddFile); return; }
						resolve(new File([blob], pendingAddFile.name, { type: pendingAddFile.type || "image/jpeg" }));
					}, pendingAddFile.type || "image/jpeg", 0.92);
				});
			}
		}

		prevMediaIdsRef.current = new Set(media.map((m) => m.id));
		await onAddMedia(fileToUpload, pendingTakenOnGrindr, pendingLooping);
		// In the album editor the upload is appended to the album being built
		// instead of replacing the selection.
		if (!albumEditor) setSelectedIds(new Set());
		setSelectAfterUpload(true);
		setPendingAddQueue((queue) => queue.slice(1));
		setPendingTakenOnGrindr(false);
		setPendingLooping(false);
	}, [onAddMedia, pendingAddFile, pendingTakenOnGrindr, pendingLooping, media, completedCrop, albumEditor]);

	useEffect(() => {
		if (!selectAfterUpload) return;
		const newItem = media.find((m) => !prevMediaIdsRef.current.has(m.id));
		if (!newItem) return;
		setSelectAfterUpload(false);
		if (!albumEditor) {
			setSelectedIds(new Set([newItem.id]));
			return;
		}
		const isNewVideo = newItem.contentType.startsWith("video");
		// Same image/video exclusivity as toggleSelection — an album is sent
		// with a single expiry setting.
		if ([...selectedIds].some((id) => isVideoMediaId(id) !== isNewVideo)) {
			toast.error(t("chat_drawer.local_album_mixed_types"));
			return;
		}
		setSelectedIds(new Set([...selectedIds, newItem.id]));
	}, [media, selectAfterUpload, albumEditor, selectedIds, isVideoMediaId, t]);

	const cancelAddPhoto = useCallback(() => {
		setPendingAddQueue((queue) => queue.slice(1));
		setPendingTakenOnGrindr(false);
		setPendingLooping(false);
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

	return (
		<BottomSheet
			onClose={isSending || isAdding ? () => {} : onBack}
			isProcessing={isSending || isAdding}
			isDesktop={isDesktop}
			bg="bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]"
			panelClassName="px-4"
		>
			<div className="mb-4 flex items-center justify-between">
					<h3 className="text-sm font-semibold text-[var(--text)]">
						{pendingAddFile
							? pendingAddFile.type.startsWith("video/")
								? t("chat_drawer.add_video", { defaultValue: "Add video" })
								: t("chat_drawer.add_photo")
							: albumEditor
								? albumEditor.id
									? albumEditor.name
									: t("chat_drawer.local_album_new")
								: t("chat_drawer.title", { defaultValue: "Drawer" })}
						{pendingAddQueue.length > 1 ? (
							<span className="ml-1.5 text-xs font-medium text-[var(--text-muted)]">
								{t("chat_drawer.upload_queue_remaining", { count: pendingAddQueue.length - 1 })}
							</span>
						) : null}
					</h3>
					{pendingAddFile || albumEditor ? (
						<button type="button" onClick={pendingAddFile ? cancelAddPhoto : cancelAlbumEditor} disabled={isAdding} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
							<X className="h-4 w-4" />
						</button>
					) : (
						<SheetClose className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
							<X className="h-4 w-4" />
						</SheetClose>
					)}
				</div>

				<input type="file" ref={uploadInputRef} onChange={onPickDrawerPhoto} accept="image/*,video/*" multiple={albumEditor != null} className="hidden" />
				<input type="file" ref={cameraInputRef} onChange={onPickDrawerPhoto} accept="image/*" capture="environment" className="hidden" />
				<input type="file" ref={cameraVideoInputRef} onChange={onPickDrawerPhoto} accept="video/*" capture="environment" className="hidden" />

				{pendingAddFile ? (
					<>
						{previewUrl && pendingAddFile.type.startsWith("video/") && (
							<div className="mb-4 flex justify-center">
								<div className="overflow-hidden rounded-xl border border-[var(--border)]" style={{ clipPath: "inset(0 round 0.75rem)" }}>
									<video src={previewUrl} controls className="block max-h-[50dvh] w-full" style={{ maxWidth: "100%" }} />
								</div>
							</div>
						)}
						{previewUrl && !pendingAddFile.type.startsWith("video/") && (
							<>
							<div className="mb-4 flex justify-center">
								<style>{`
									.drawer-crop .ReactCrop__crop-mask { display: none !important; }
									.drawer-crop .ReactCrop__crop-selection {
										background-image: none !important;
										animation: none !important;
										outline: none !important;
										border: 3px solid rgba(255,255,255,0.6) !important;
										border-radius: 11px !important;
										box-shadow: 0 0 0 9999px rgba(0,0,0,0.5) !important;
									}
									.drawer-crop .ord-n,
									.drawer-crop .ord-s,
									.drawer-crop .ord-e,
									.drawer-crop .ord-w { display: none !important; }

									.drawer-crop .ReactCrop__drag-handle {
										background: transparent !important;
										border: none !important;
										width: 15px !important;
										height: 15px !important;
									}
									.drawer-crop .ord-nw { transform: translate(4px, 4px) !important; border-top: 2px solid white !important; border-left: 2px solid white !important; border-top-left-radius: 4px !important; }
									.drawer-crop .ord-ne { transform: translate(-4px, 4px) !important; border-top: 2px solid white !important; border-right: 2px solid white !important; border-top-right-radius: 4px !important; }
									.drawer-crop .ord-sw { transform: translate(4px, -4px) !important; border-bottom: 2px solid white !important; border-left: 2px solid white !important; border-bottom-left-radius: 4px !important; }
									.drawer-crop .ord-se { transform: translate(-4px, -4px) !important; border-bottom: 2px solid white !important; border-right: 2px solid white !important; border-bottom-right-radius: 4px !important; }

									@keyframes logo-shine {
										0%, 100% { filter: drop-shadow(0 0 2px rgba(255,140,0,0.3)) brightness(1); }
										50% { filter: drop-shadow(0 0 7px rgba(255,140,0,0.95)) brightness(1.25); }
									}
									.logo-shine { animation: logo-shine 2.8s ease-in-out infinite; }
								`}</style>
								<div className="relative rounded-xl border border-[var(--border)] overflow-hidden">
								<ReactCrop
									crop={crop}
                                    onChange={(c) => {
                                        setIsDraggingCrop(true);
                                        setCrop(c);
                                    }}
                                    onComplete={(c) => {
                                        setIsDraggingCrop(false);
                                        setCompletedCrop(c);
                                    }}
                                    ruleOfThirds={isDraggingCrop}
									minWidth={150}
									minHeight={150}
									className="drawer-crop ReactCrop--no-animate"
									style={{ maxHeight: "50dvh", display: "block" }}
								>
									<img
										ref={imgRef}
										src={previewUrl}
										alt="Preview"
										className="block"
										style={{ maxHeight: "50dvh" }}
									/>
								</ReactCrop>
								{pendingTakenOnGrindr && crop && (
									<div
										className="absolute inline-flex items-center gap-1.5 pointer-events-none"
										style={{
											left: `calc(${crop.unit === "%" ? crop.x + "%" : crop.x + "px"} + 10px)`,
											top: `calc(${crop.unit === "%" ? (crop.y + crop.height) + "%" : (crop.y + crop.height) + "px"} - 10px)`,
											transform: "translateY(-100%)",
										}}
									>
										<img src={freegrindLogo} alt={t("chat.thread.taken_on_grindr")} className="h-5 w-5 rounded-full logo-shine" />
										<span className="inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-1 text-[10px] font-semibold text-white">
											<span>{t("chat.time.just_now", { defaultValue: "just now" })}</span>
										</span>
									</div>
								)}
							</div>
							</div>
							<div className="mb-4 flex items-center justify-center gap-8">
								<button
									type="button"
									onClick={() => void applyTransform("flipH")}
									className="flex flex-col items-center gap-1 text-[var(--text-muted)] transition hover:text-[var(--text)]"
									aria-label="Flip horizontal"
								>
									<SquareCenterlineDashedHorizontal className="h-6 w-6" />
								</button>
								<button
									type="button"
									onClick={() => void applyTransform("rotateCw")}
									className="flex flex-col items-center gap-1 text-[var(--text-muted)] transition hover:text-[var(--text)]"
									aria-label="Rotate clockwise"
								>
									<RotateCw className="h-6 w-6" />
								</button>
							</div>
							</>
						)}
						{pendingAddFile?.type.startsWith("video/") && (
							<div className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]">
								<ToggleRow
									checked={pendingLooping}
									onChange={setPendingLooping}
									label={t("chat.attachments.looping")}
									description={t("chat.attachments.looping_description")}
								/>
							</div>
						)}
						{!pendingAddFile?.type.startsWith("video/") && (
							<div className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]">
								<ToggleRow
									checked={pendingTakenOnGrindr}
									onChange={setPendingTakenOnGrindr}
									label={t("chat.attachments.taken_on_grindr")}
									description={t("chat.attachments.taken_on_grindr_description")}
								/>
							</div>
						)}
						<div className="flex gap-2">
							<button
								type="button"
								onClick={cancelAddPhoto}
								disabled={isAdding}
								className="flex-1 inline-flex h-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)] disabled:opacity-60"
							>
								{t("chat.actions.cancel")}
							</button>
							<button
								type="button"
								onClick={confirmAddPhoto}
								disabled={isAdding}
								className="flex-1 inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)] transition hover:brightness-110 disabled:opacity-60"
							>
								{isAdding ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<Plus className="h-4 w-4" />
								)}
								<span>{isAdding ? t("chat_drawer.sending") : t("chat_drawer.add_to_drawer")}</span>
							</button>
						</div>
					</>
				) : (
					<>
						{/* Content Grid */}
						<div
							data-lenis-prevent
							className="flex-1 overflow-y-auto max-h-[60vh] rounded-xl border border-[var(--border)] bg-[var(--surface-2)]"
						>
							{isLoading ? (
								<div className="flex h-full items-center justify-center py-8">
									<Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" />
								</div>
							) : error ? (
								<div className="flex flex-col items-center justify-center gap-3 p-6 text-center py-8">
									<ImageIcon className="h-8 w-8 text-[var(--text-muted)]" />
									<p className="text-xs text-[var(--text-muted)]">{error}</p>
									<button
										type="button"
										onClick={onLoadMedia}
										className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-readable)]"
									>
										<RefreshCw className="h-3 w-3" />
										{t("chat_drawer.retry")}
									</button>
								</div>
							) : (
								<div className={`grid gap-px bg-[var(--border)] ${isDesktop ? "grid-cols-5" : "grid-cols-3"}`}>
									{/* Camera photo button */}
									<button
										type="button"
										onClick={() => cameraInputRef.current?.click()}
										disabled={isAdding || actionsLocked}
										className="relative aspect-square bg-[var(--surface)] text-[var(--text-muted)] transition hover:text-[var(--text)] disabled:brightness-75"
										aria-label={t("chat_drawer.take_photo")}
										title={t("chat_drawer.take_photo")}
									>
										<div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
											{isAdding ? (
												<Loader2 className="h-5 w-5 animate-spin" />
											) : (
												<span className="relative inline-flex">
													<Camera className="h-5 w-5" />
													{!actionsLocked && <span className="absolute -bottom-1 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--accent)]">
														<Plus className="h-2.5 w-2.5 stroke-[3] text-[var(--accent-contrast)]" />
													</span>}
												</span>
											)}
										</div>
									</button>
									{/* Camera video button */}
									<button
										type="button"
										onClick={() => cameraVideoInputRef.current?.click()}
										disabled={isAdding || actionsLocked}
										className="relative aspect-square bg-[var(--surface)] text-[var(--text-muted)] transition hover:text-[var(--text)] disabled:brightness-75"
										aria-label={t("chat_drawer.record_video", { defaultValue: "Record video" })}
										title={t("chat_drawer.record_video", { defaultValue: "Record video" })}
									>
										<div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
											<span className="relative inline-flex">
												<Video className="h-5 w-5" />
												{!actionsLocked && <span className="absolute -bottom-1 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--accent)]">
													<Plus className="h-2.5 w-2.5 stroke-[3] text-[var(--accent-contrast)]" />
												</span>}
											</span>
										</div>
									</button>
									{/* Upload button */}
									<button
										type="button"
										onClick={() => uploadInputRef.current?.click()}
										disabled={isAdding || actionsLocked}
										className="relative aspect-square bg-[var(--surface)] text-[var(--text-muted)] transition hover:text-[var(--text)] disabled:brightness-75"
										aria-label={t("chat_drawer.upload_photo")}
										title={t("chat_drawer.upload_photo")}
									>
										<div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
											<span className="relative inline-flex">
												<Upload className="h-5 w-5" />
												{!actionsLocked && <span className="absolute -bottom-1 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--accent)]">
													<Plus className="h-2.5 w-2.5 stroke-[3] text-[var(--accent-contrast)]" />
												</span>}
											</span>
										</div>
									</button>
									{/* New local album button */}
									{!albumEditor && (
										<button
											type="button"
											onClick={startNewLocalAlbum}
											disabled={isAdding || hasSelection || hasAlbumSelection || hasLocalAlbumSelection}
											className="relative aspect-square bg-[var(--surface)] text-[var(--text-muted)] transition hover:text-[var(--text)] disabled:brightness-75"
											aria-label={t("chat_drawer.local_album_new")}
											title={t("chat_drawer.local_album_new")}
										>
											<div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
												<FolderPlus className="h-5 w-5" />
												<span className="px-1 text-[10px] font-medium leading-tight">{t("chat_drawer.local_album_new")}</span>
											</div>
										</button>
									)}
									{/* Albums */}
									{!albumEditor && albums.map((album) => {
										const cover = albumCoverMap.get(album.albumId);
										const isShared = sharedAlbumIds.has(album.albumId);
										const isSelected = selectedAlbumIds.has(album.albumId);
										const dimmed = (hasSelection || hasLocalAlbumSelection) && !isSelected;
										return (
											<div
												key={`album-${album.albumId}`}
												role="button"
												tabIndex={0}
												onClick={() => { if (hasSelection) return; setSelectedAlbumIds(prev => { const n = new Set(prev); n.has(album.albumId) ? n.delete(album.albumId) : n.add(album.albumId); return n; }); }}
												onKeyDown={(e) => { if (e.key === "Enter" && !hasSelection) { setSelectedAlbumIds(prev => { const n = new Set(prev); n.has(album.albumId) ? n.delete(album.albumId) : n.add(album.albumId); return n; }); } }}
												className={`relative aspect-square overflow-hidden cursor-pointer transition ${dimmed ? "opacity-30 pointer-events-none" : ""}`}
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
												{isSelected ? <div className="absolute inset-0 flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--accent) 45%, transparent)" }}><Check className="h-5 w-5 text-white drop-shadow" /></div> : null}
												{isSelected && <div className="absolute inset-0 pointer-events-none" style={{ border: "2px solid var(--accent)" }} />}
											</div>
										);
									})}
									{/* Local albums */}
									{!albumEditor && localAlbums.map((album) => {
										const presentIds = getPresentAlbumMediaIds(album);
										const coverItem = media.find((m) => m.id === presentIds[0]);
										const coverSrc = coverItem
											? getCachedMediaUri(getDrawerMediaKey(coverItem.id)) ?? coverItem.url
											: null;
										const isSelected = selectedLocalAlbumId === album.id;
										const dimmed = (hasSelection || hasAlbumSelection || hasLocalAlbumSelection || noConversation) && !isSelected;
										return (
											<div
												key={`local-album-${album.id}`}
												role="button"
												tabIndex={0}
												onClick={() => { if (!dimmed) toggleLocalAlbumSelection(album); }}
												onKeyDown={(e) => { if (e.key === "Enter" && !dimmed) toggleLocalAlbumSelection(album); }}
												className={`relative aspect-square overflow-hidden cursor-pointer transition ${dimmed ? "opacity-30 pointer-events-none" : ""}`}
											>
												{coverSrc && coverItem?.contentType.startsWith("image/") ? (
													<img src={coverSrc} alt="" className="h-full w-full object-cover" />
												) : coverSrc ? (
													<video src={coverSrc} preload="metadata" muted className="h-full w-full object-cover" />
												) : (
													<div className="absolute inset-0 flex items-center justify-center bg-[var(--surface)] text-[var(--text-muted)]"><Images className="h-6 w-6 opacity-50" /></div>
												)}
												<div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-1.5 pb-1.5 pt-6">
													<p className="truncate text-[11px] font-semibold leading-tight text-white drop-shadow">{album.name}</p>
													<p className="flex items-center gap-1 text-[10px] text-white/80">
														<Images className="h-3 w-3" />
														{presentIds.length}
													</p>
												</div>
												<span className="pointer-events-none absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/90">
													{t("chat_drawer.local_album_badge")}
												</span>
												{isSelected ? <div className="absolute inset-0 flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--accent) 45%, transparent)" }}><Check className="h-5 w-5 text-white drop-shadow" /></div> : null}
												{isSelected && <div className="absolute inset-0 pointer-events-none" style={{ border: "2px solid var(--accent)" }} />}
											</div>
										);
									})}
									{media.length === 0 && (
										<div className={`col-span-${isDesktop ? "3" : "1"} flex flex-col items-center justify-center gap-2 py-8 text-[var(--text-muted)]`} style={{ gridColumn: "1 / -1" }}>
											<ImageIcon className="h-8 w-8 opacity-30" />
											<p className="text-xs">{t("chat_drawer.empty", { defaultValue: "No photos yet" })}</p>
										</div>
									)}
									{media.map((item) => {
										const isSelected = selectedIds.has(item.id);
										const isImage = item.contentType.startsWith("image/");
										const isItemVideo = item.contentType.startsWith("video/");
										const isDisabledByType = hasSelection && (
											(isItemVideo && hasAnyImage) || (!isItemVideo && hasAnyVideo)
										);
										const mediaSrc = getCachedMediaUri(getDrawerMediaKey(item.id)) ?? item.url;
										// 1-based send position: in the album editor (tap order) or as a
										// preview of a selected local album's contents.
										const albumPosition = albumEditor
											? (isSelected ? [...selectedIds].indexOf(item.id) + 1 : 0)
											: selectedLocalAlbum
												? sendIds.indexOf(item.id) + 1
												: 0;
										const isBlocked = albumEditor
											? isDisabledByType
											: hasAlbumSelection || noConversation || isDisabledByType || (hasLocalAlbumSelection && albumPosition === 0);
										const isClickable = !isBlocked && !hasLocalAlbumSelection;

										return (
											<div
												key={item.id}
												role="button"
												tabIndex={0}
												onClick={() => { if (isClickable) toggleSelection(item.id, isItemVideo); }}
												onKeyDown={(e) => e.key === "Enter" && isClickable && toggleSelection(item.id, isItemVideo)}
												className={`relative aspect-square overflow-hidden transition ${isBlocked ? "opacity-30 pointer-events-none" : isClickable ? "cursor-pointer" : "pointer-events-none"}`}
												style={{
													outline: isSelected ? "2px solid var(--accent)" : "none",
													outlineOffset: "-2px",
												}}
											>
												{isImage ? (
													<img
														src={mediaSrc}
														alt={t("chat_drawer.media_alt")}
														className="h-full w-full object-cover"
													/>
												) : (
													<>
														<video
									src={mediaSrc}
									preload="metadata"
									muted
									onLoadedMetadata={(e) => { (e.currentTarget as HTMLVideoElement).currentTime = 0.001; }}
									className="h-full w-full object-cover"
								/>
														<div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
															<div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm">
																<Play className="h-4 w-4 fill-white text-white" />
															</div>
														</div>
													</>
												)}

												{item.used && !isSelected ? (
													<div className="absolute inset-0 flex items-center justify-center bg-black/40">
														<span className="text-[11px] font-semibold uppercase tracking-widest text-white/90">
															{t("chat_drawer.sent", { defaultValue: "Sent" })}
														</span>
													</div>
												) : null}

												{isSelected ? (
													<div className="absolute inset-0 flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--accent) 45%, transparent)" }}>
														{albumPosition > 0 ? (
															<span className="text-lg font-bold text-white drop-shadow">{albumPosition}</span>
														) : (
															<Check className="h-5 w-5 text-white drop-shadow" />
														)}
													</div>
												) : albumPosition > 0 ? (
													<span className="pointer-events-none absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[11px] font-bold text-[var(--accent-contrast)]">
														{albumPosition}
													</span>
												) : null}

												{item.takenOnGrindr ? (
													<img
														src={freegrindLogo}
														alt=""
														className="absolute bottom-1 left-1 h-4 w-4 rounded-full logo-shine"
													/>
												) : null}

												{!albumEditor && !hasLocalAlbumSelection && <button
													type="button"
													onClick={(event) => void handleDeleteMedia(event, item.id)}
													disabled={deletingMediaId === item.id}
													className="absolute top-0.5 left-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80 disabled:opacity-60"
													aria-label={t("chat_drawer.delete_media")}
													title={t("chat_drawer.delete_media")}
												>
													{deletingMediaId === item.id ? (
														<Loader2 className="h-3 w-3 animate-spin" />
													) : (
														<X className="h-3 w-3" />
													)}
												</button>}
											</div>
										);
									})}
								</div>
							)}
						</div>

						{/* Footer - Album share button */}
						{hasAlbumSelection ? (() => {
							const isSelectedShared = selectedAlbumIds.size > 0 && [...selectedAlbumIds].every(id => sharedAlbumIds.has(id));
							return (
								<div className="mt-3 -mx-4 border-t border-[var(--border)] pt-3 px-4 flex gap-2">
									{isSelectedShared ? (
										<button
											type="button"
											onClick={() => {
												if (selectedAlbumIds.size === 0 || !onStopAlbumShare) return;
												void Promise.all([...selectedAlbumIds].map(id => onStopAlbumShare!(id))).then(() => { setSelectedAlbumIds(new Set()); onBack(); });
											}}
											disabled={isSharingAlbum}
											className="flex-1 inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-orange-500/40 bg-orange-500/10 px-4 text-sm font-semibold text-orange-300 transition hover:bg-orange-500/20 disabled:opacity-60"
										>
											{isSharingAlbum ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
											<span>{t("chat.actions.stop_sharing", { defaultValue: "Stop Sharing" })} ({selectedAlbumIds.size})</span>
										</button>
									) : (
										<>
											<div
												className="relative inline-flex h-11 items-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)]"
												style={{ flex: "0 0 50%" }}
											>
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
											<button
												type="button"
												onClick={() => {
													if (selectedAlbumIds.size === 0 || !onShareAlbum) return;
													void Promise.all([...selectedAlbumIds].map(id => onShareAlbum!(id, albumExpirationType))).then(() => { setSelectedAlbumIds(new Set()); onBack(); });
												}}
												disabled={isSharingAlbum}
												className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)] transition hover:brightness-110 disabled:opacity-60"
												style={{ flex: "0 0 50%" }}
											>
												{isSharingAlbum ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
												<span>{isSharingAlbum ? t("chat_drawer.sending") : `${t("chat.share")} (${selectedAlbumIds.size})`}</span>
											</button>
										</>
									)}
								</div>
							);
						})() : null}
						{/* Footer - Local album editor */}
						{albumEditor ? (
							<div className="mt-3 -mx-4 border-t border-[var(--border)] pt-3 px-4">
								<p className="mb-2 text-center text-xs text-[var(--text-muted)]">{t("chat_drawer.local_album_editor_hint")}</p>
								<div className="flex gap-2">
									<button
										type="button"
										onClick={cancelAlbumEditor}
										disabled={isAdding || isSavingLocalAlbum}
										className="min-w-0 flex-1 inline-flex h-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)] disabled:opacity-60"
									>
										{t("chat.actions.cancel")}
									</button>
									<button
										type="button"
										onClick={() => setIsAlbumNamePromptOpen(true)}
										disabled={isAdding || isSavingLocalAlbum || selectedIds.size === 0}
										className="min-w-0 flex-1 inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)] transition hover:brightness-110 disabled:opacity-60"
									>
										{isSavingLocalAlbum ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
										<span className="truncate">{t("chat_drawer.local_album_save", { count: selectedIds.size })}</span>
									</button>
								</div>
							</div>
						) : null}
						{/* Footer - Send button (selected media or a local album) */}
						{!albumEditor && (hasSelection || hasLocalAlbumSelection) ? (
							<div className="mt-3 -mx-4 border-t border-[var(--border)] pt-3 px-4 flex gap-2">
								<div className="relative inline-flex h-11 min-w-0 flex-1 items-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)]">
									<Hourglass className="pointer-events-none absolute left-3 h-4 w-4 shrink-0" />
									<select
										value={mediaMaxViews}
										onChange={(e) => setMediaMaxViews(Number(e.target.value))}
										className="h-full w-full appearance-none rounded-xl bg-transparent pl-9 pr-3 text-sm font-semibold text-[var(--text)] focus:outline-none cursor-pointer text-center"
									>
										{hasAnyVideo ? (
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
								{selectedLocalAlbum ? (
									<>
										<button
											type="button"
											onClick={() => startEditLocalAlbum(selectedLocalAlbum)}
											disabled={isSending}
											className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)] disabled:opacity-60"
											aria-label={t("chat_drawer.local_album_edit")}
											title={t("chat_drawer.local_album_edit")}
										>
											<Pencil className="h-4 w-4" />
										</button>
										<button
											type="button"
											onClick={() => setConfirmDeleteLocalAlbumId(selectedLocalAlbum.id)}
											disabled={isSending}
											className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] transition hover:border-red-500/60 hover:text-red-400 disabled:opacity-60"
											aria-label={t("chat_drawer.local_album_delete")}
											title={t("chat_drawer.local_album_delete")}
										>
											<Trash2 className="h-4 w-4" />
										</button>
									</>
								) : (
									<button
										type="button"
										onClick={() => setAlbumEditor({ id: null, name: "" })}
										disabled={isSending}
										className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)] disabled:opacity-60"
										aria-label={t("chat_drawer.local_album_from_selection")}
										title={t("chat_drawer.local_album_from_selection")}
									>
										<FolderPlus className="h-4 w-4" />
									</button>
								)}
								<button
									type="button"
									onClick={handleSendSelected}
									disabled={isSending || sendIds.length === 0}
									className="inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)] transition hover:brightness-110 disabled:opacity-60"
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
							</div>
						) : null}
					</>
				)}

				<PromptDialog
					isOpen={isAlbumNamePromptOpen}
					title={t("chat_drawer.local_album_name_title")}
					message={t("chat_drawer.local_album_name_message")}
					defaultValue={albumEditor?.name ?? ""}
					placeholder={t("chat_drawer.local_album_name_placeholder")}
					confirmLabel={t("common.save")}
					cancelLabel={t("chat.actions.cancel")}
					onConfirm={saveLocalAlbum}
					onCancel={() => setIsAlbumNamePromptOpen(false)}
					isProcessing={isSavingLocalAlbum}
					rows={1}
				/>

				<ConfirmDialog
					isOpen={confirmDeleteLocalAlbumId != null}
					title={t("chat_drawer.local_album_delete_confirm_title")}
					message={t("chat_drawer.local_album_delete_confirm_message")}
					confirmLabel={t("chat_drawer.delete_confirm_label")}
					cancelLabel={t("chat.actions.cancel")}
					onConfirm={() => void confirmDeleteLocalAlbum()}
					onCancel={() => setConfirmDeleteLocalAlbumId(null)}
					confirmTone="danger"
				/>

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