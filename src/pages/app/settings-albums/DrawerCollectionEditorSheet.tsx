import { Check, Image as ImageIcon, Loader2, Play, Plus, RefreshCw, Upload, X } from "lucide-react";
import { useCallback, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { BottomSheet, SheetClose } from "../../../components/ui/bottom-sheet";
import { useApiFunctions } from "../../../hooks/useApiFunctions";
import * as chatDb from "../../../services/chatDb";
import type { StoredDrawerCollection } from "../../../services/chatDb";
import { getCachedMediaUri, getDrawerMediaKey } from "../../../services/mediaStore";
import { appLog } from "../../../utils/logger";
import type { DrawerMedia } from "../chat/ChatDrawerPanel";
import { buildBinaryUpload, getVideoDurationSeconds } from "../chat/chatUtils";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

interface DrawerCollectionEditorSheetProps {
	/** Null when creating a new collection. */
	collection: StoredDrawerCollection | null;
	media: DrawerMedia[];
	isLoading: boolean;
	error: string | null;
	/** Refetches the drawer, bypassing the page's already-loaded short-circuit. */
	onReloadMedia: () => Promise<void>;
	onClose: () => void;
	onSaved: (collections: StoredDrawerCollection[]) => void;
	isDesktop: boolean;
}

export function DrawerCollectionEditorSheet({
	collection,
	media,
	isLoading,
	error,
	onReloadMedia,
	onClose,
	onSaved,
	isDesktop,
}: DrawerCollectionEditorSheetProps) {
	const { t } = useTranslation();
	const service = useApiFunctions();
	const [name, setName] = useState(collection?.name ?? "");
	// Insertion order of the Set is the send order. Not filtered against the
	// drawer here — it may still be loading; missing ids are pruned on save.
	const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set(collection?.mediaIds ?? []));
	const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const uploadInputRef = useRef<HTMLInputElement | null>(null);
	const isUploading = uploadProgress != null;
	const isBusy = isUploading || isSaving;

	// Only ids still in the drawer — a collection can outlive some of its media.
	const orderedSelection = Array.from(selectedIds).filter((id) => media.some((m) => m.id === id));

	const toggleSelection = useCallback((id: number) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	// New uploads land in the drawer (collections only reference drawer
	// media) and get appended to the collection being edited.
	const onPickFiles = useCallback(
		async (event: ChangeEvent<HTMLInputElement>) => {
			const files = Array.from(event.target.files ?? []);
			event.target.value = "";
			const valid = files.filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"));
			if (valid.length < files.length) {
				toast.error(t("chat_drawer.invalid_file_type"));
			}
			if (valid.length === 0) return;

			const uploadedIds: number[] = [];
			setUploadProgress({ done: 0, total: valid.length });
			for (const [index, file] of valid.entries()) {
				const isVideo = file.type.startsWith("video/");
				if (file.size > MAX_UPLOAD_BYTES) {
					toast.error(t("chat.attachments.too_large"));
					setUploadProgress({ done: index + 1, total: valid.length });
					continue;
				}
				try {
					const durationSeconds = isVideo ? await getVideoDurationSeconds(file) : undefined;
					const uploaded = await service.uploadChatMedia({
						multipart: await buildBinaryUpload(file),
						options: {
							looping: false,
							takenOnGrindr: false,
							...(durationSeconds != null ? { durationSeconds } : {}),
						},
					});
					await service.addMediaToDrawer(uploaded.mediaId);
					uploadedIds.push(uploaded.mediaId);
				} catch (uploadError) {
					appLog.error("[DrawerCollectionEditorSheet] upload failed", uploadError);
					toast.error(
						uploadError instanceof Error ? uploadError.message : t("chat.errors.upload_media_failed"),
					);
				}
				setUploadProgress({ done: index + 1, total: valid.length });
			}

			try {
				if (uploadedIds.length > 0) await onReloadMedia();
			} finally {
				setSelectedIds((prev) => new Set([...prev, ...uploadedIds]));
				setUploadProgress(null);
			}
		},
		[service, onReloadMedia, t],
	);

	const handleSave = useCallback(async () => {
		const trimmed = name.trim();
		// Prune deleted drawer media only when the drawer actually loaded, so a
		// failed fetch can't wipe a collection.
		const drawerLoaded = !isLoading && !error;
		const mediaIds = drawerLoaded ? orderedSelection : Array.from(selectedIds);
		if (!trimmed || mediaIds.length === 0) return;
		setIsSaving(true);
		try {
			const collections = await chatDb.upsertDrawerCollection({
				id: collection?.id ?? crypto.randomUUID(),
				name: trimmed,
				mediaIds,
			});
			onSaved(collections);
		} catch (saveError) {
			appLog.error("[DrawerCollectionEditorSheet] failed to save collection", saveError);
			toast.error(t("settings_albums.collections_save_failed"));
		} finally {
			setIsSaving(false);
		}
	}, [name, selectedIds, orderedSelection, isLoading, error, collection, onSaved, t]);

	return (
		<BottomSheet
			onClose={isBusy ? () => {} : onClose}
			isProcessing={isBusy}
			isDesktop={isDesktop}
			bg="bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]"
			panelClassName="px-4"
		>
			<div className="mb-4 flex items-center justify-between">
				<h3 className="text-sm font-semibold text-[var(--text)]">
					{collection ? t("settings_albums.collections_edit") : t("settings_albums.collections_new")}
				</h3>
				<SheetClose className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
					<X className="h-4 w-4" />
				</SheetClose>
			</div>

			<input
				type="text"
				value={name}
				onChange={(e) => setName(e.target.value)}
				placeholder={t("settings_albums.collections_name_placeholder")}
				className="input-field mb-2 w-full !min-h-0 !py-2 !px-3 text-sm"
				maxLength={100}
				disabled={isBusy}
			/>
			<p className="mb-3 text-xs text-[var(--text-muted)]">{t("settings_albums.collections_editor_hint")}</p>

			<input type="file" ref={uploadInputRef} onChange={(e) => void onPickFiles(e)} accept="image/*,video/*" multiple className="hidden" />

			<div
				data-lenis-prevent
				className="min-h-0 flex-1 overflow-y-auto max-h-[50vh] rounded-xl border border-[var(--border)] bg-[var(--surface-2)]"
			>
				{isLoading && media.length === 0 ? (
					<div className="flex h-full items-center justify-center py-8">
						<Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" />
					</div>
				) : error && media.length === 0 ? (
					<div className="flex flex-col items-center justify-center gap-3 p-6 text-center py-8">
						<ImageIcon className="h-8 w-8 text-[var(--text-muted)]" />
						<p className="text-xs text-[var(--text-muted)]">{error}</p>
						<button
							type="button"
							onClick={() => void onReloadMedia()}
							className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-readable)]"
						>
							<RefreshCw className="h-3 w-3" />
							{t("chat_drawer.retry")}
						</button>
					</div>
				) : (
					<div className={`grid gap-px bg-[var(--border)] ${isDesktop ? "grid-cols-5" : "grid-cols-3"}`}>
						<button
							type="button"
							onClick={() => uploadInputRef.current?.click()}
							disabled={isBusy}
							className="relative aspect-square bg-[var(--surface)] text-[var(--text-muted)] transition hover:text-[var(--text)] disabled:brightness-75"
							aria-label={t("chat_drawer.upload_photo")}
							title={t("chat_drawer.upload_photo")}
						>
							<div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
								{uploadProgress ? (
									<>
										<Loader2 className="h-5 w-5 animate-spin" />
										<span className="text-[10px] font-medium tabular-nums">
											{uploadProgress.done}/{uploadProgress.total}
										</span>
									</>
								) : (
									<span className="relative inline-flex">
										<Upload className="h-5 w-5" />
										<span className="absolute -bottom-1 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--accent)]">
											<Plus className="h-2.5 w-2.5 stroke-[3] text-[var(--accent-contrast)]" />
										</span>
									</span>
								)}
							</div>
						</button>
						{media.map((item) => {
							const isVideo = item.contentType.startsWith("video/");
							const position = orderedSelection.indexOf(item.id) + 1;
							const isSelected = position > 0;
							const mediaSrc = getCachedMediaUri(getDrawerMediaKey(item.id)) ?? item.url;

							return (
								<div
									key={item.id}
									role="button"
									tabIndex={0}
									onClick={() => { if (!isBusy) toggleSelection(item.id); }}
									onKeyDown={(e) => e.key === "Enter" && !isBusy && toggleSelection(item.id)}
									className="relative aspect-square overflow-hidden transition cursor-pointer"
									style={{
										outline: isSelected ? "2px solid var(--accent)" : "none",
										outlineOffset: "-2px",
									}}
								>
									{isVideo ? (
										<>
											<video src={mediaSrc} preload="metadata" muted className="h-full w-full object-cover" />
											<div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
												<div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm">
													<Play className="h-4 w-4 fill-white text-white" />
												</div>
											</div>
										</>
									) : (
										<img src={mediaSrc} alt={t("chat_drawer.media_alt")} className="h-full w-full object-cover" />
									)}
									{isSelected ? (
										<div className="absolute inset-0 flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--accent) 45%, transparent)" }}>
											<span className="text-lg font-bold text-white drop-shadow">{position}</span>
										</div>
									) : null}
								</div>
							);
						})}
					</div>
				)}
			</div>

			<div className="mt-3 -mx-4 border-t border-[var(--border)] pt-3 px-4">
				<button
					type="button"
					onClick={() => void handleSave()}
					disabled={isBusy || !name.trim() || orderedSelection.length === 0}
					className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)] transition hover:brightness-110 disabled:opacity-60"
				>
					{isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
					<span>{t("settings_albums.collections_save", { count: orderedSelection.length })}</span>
				</button>
			</div>
		</BottomSheet>
	);
}
