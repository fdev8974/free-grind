import { ChevronRight, FolderPlus, Images, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { SHEET_ICON_BUTTON_CLASS } from "../../../components/ui/bottom-sheet";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import * as chatDb from "../../../services/chatDb";
import type { StoredDrawerCollection } from "../../../services/chatDb";
import { getCachedMediaUri, getDrawerMediaKey } from "../../../services/mediaStore";
import { appLog } from "../../../utils/logger";
import type { DrawerMedia } from "../chat/ChatDrawerPanel";
import { DrawerCollectionEditorSheet } from "./DrawerCollectionEditorSheet";
import { SheetActionList, afterSheetClose } from "./SheetActionList";

interface DrawerCollectionsSectionProps {
	drawerMedia: DrawerMedia[];
	isLoadingDrawerMedia: boolean;
	drawerMediaError: string | null;
	loadDrawerMedia: (forceRefresh?: boolean) => Promise<void>;
	isDesktop: boolean;
}

/**
 * Collections: local-only, named and ordered groups of drawer media. They
 * are created and edited only here; the chat drawer just lists them for
 * sending, each item as its own message, one after another.
 */
export function DrawerCollectionsSection({
	drawerMedia,
	isLoadingDrawerMedia,
	drawerMediaError,
	loadDrawerMedia,
	isDesktop,
}: DrawerCollectionsSectionProps) {
	const { t } = useTranslation();
	const [collections, setCollections] = useState<StoredDrawerCollection[]>([]);
	// undefined = closed, null = creating a new one.
	const [editing, setEditing] = useState<StoredDrawerCollection | null | undefined>(undefined);
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);
	const [actionSheetId, setActionSheetId] = useState<string | null>(null);

	// Reloads on changes from elsewhere too, e.g. a collection emptied by
	// deleting its last media in a drawer sheet.
	useEffect(() => {
		let cancelled = false;
		const load = () => {
			chatDb
				.getDrawerCollections()
				.then((items) => {
					if (!cancelled) setCollections(items);
				})
				.catch((error) => appLog.warn("[DrawerCollectionsSection] failed to load collections", error));
		};
		load();
		const unsubscribe = chatDb.subscribeToDrawerCollections(load);
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);

	// A collection handed over via navigation state (the chat drawer's edit
	// button on a collection tile) opens its editor once the list is there.
	const location = useLocation();
	const openedFromNavigationRef = useRef(false);
	useEffect(() => {
		if (openedFromNavigationRef.current) return;
		const requestedId = (location.state as { openCollectionId?: unknown } | null)?.openCollectionId;
		if (typeof requestedId !== "string") return;
		const requested = collections.find((collection) => collection.id === requestedId);
		if (!requested) return;
		openedFromNavigationRef.current = true;
		void loadDrawerMedia();
		setEditing(requested);
	}, [collections, location.state, loadDrawerMedia]);

	// Covers and counts need the drawer; loadDrawerMedia is a no-op once loaded.
	useEffect(() => {
		if (collections.length > 0) void loadDrawerMedia();
	}, [collections.length, loadDrawerMedia]);

	const openEditor = (collection: StoredDrawerCollection | null) => {
		void loadDrawerMedia();
		setEditing(collection);
	};

	const confirmDelete = async () => {
		if (!confirmDeleteId) return;
		setIsDeleting(true);
		try {
			setCollections(await chatDb.deleteDrawerCollection(confirmDeleteId));
		} catch (error) {
			appLog.error("[DrawerCollectionsSection] failed to delete collection", error);
			toast.error(t("settings_albums.collections_delete_failed"));
		} finally {
			setIsDeleting(false);
			setConfirmDeleteId(null);
		}
	};

	return (
		<div>
			<div className="mb-2 flex items-center gap-2 px-1">
				<p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
					{t("settings_albums.collections_title")}
				</p>
				{collections.length > 0 && (
					<span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-bold tabular-nums text-[var(--text-muted)]">
						{collections.length}
					</span>
				)}
			</div>

			<div className="surface-card overflow-hidden">
				<div className="flex items-start gap-3 p-4">
					<div className="shrink-0 rounded-2xl bg-sky-500/15 p-2.5 text-sky-400">
						<FolderPlus className="h-5 w-5" />
					</div>
					<div className="min-w-0 flex-1">
						<p className="text-sm font-semibold leading-snug">{t("settings_albums.collections_new")}</p>
						<p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">
							{t("settings_albums.collections_description")}
						</p>
						<button
							type="button"
							onClick={() => openEditor(null)}
							className="mt-3 inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)] transition hover:brightness-110 active:scale-[0.98]"
						>
							<Plus className="h-3.5 w-3.5" />
							{t("settings_albums.collections_create")}
						</button>
					</div>
				</div>

				{collections.length > 0 && (
					<div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
						{collections.map((collection) => {
							const presentIds = collection.mediaIds.filter((id) => drawerMedia.some((m) => m.id === id));
							const coverItem = drawerMedia.find((m) => m.id === presentIds[0]);
							const coverSrc = coverItem
								? getCachedMediaUri(getDrawerMediaKey(coverItem.id)) ?? coverItem.url
								: null;
							// Before the drawer has loaded, show the stored count rather than 0.
							const count = drawerMedia.length > 0 ? presentIds.length : collection.mediaIds.length;

							return (
								<div key={collection.id} className="flex items-center gap-3 p-4">
									{/* Tap the row to edit; ⋯ opens the collection's action sheet. */}
									<button
										type="button"
										onClick={() => openEditor(collection)}
										className="-m-2 flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-2 text-left transition active:bg-[var(--surface-2)]"
									>
									{coverSrc && coverItem?.contentType.startsWith("image/") ? (
										<img src={coverSrc} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
									) : coverSrc ? (
										<video src={coverSrc} preload="metadata" muted className="h-12 w-12 shrink-0 rounded-xl object-cover" />
									) : (
										<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-2)] text-[var(--text-muted)]">
											<Images className="h-5 w-5 opacity-40" />
										</div>
									)}
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-semibold">{collection.name}</p>
											<p className="text-xs text-[var(--text-muted)]">
												{t("settings_albums.collections_item_count", { count })}
											</p>
										</div>
										<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)] opacity-50" />
									</button>
									<button
										type="button"
										onClick={() => setActionSheetId(collection.id)}
										className={SHEET_ICON_BUTTON_CLASS}
										aria-label={t("settings_albums.collections_actions", { defaultValue: "Collection actions" })}
									>
										<MoreHorizontal className="h-4 w-4" />
									</button>
								</div>
							);
						})}
					</div>
				)}
			</div>

			{editing !== undefined ? (
				<DrawerCollectionEditorSheet
					collection={editing}
					media={drawerMedia}
					isLoading={isLoadingDrawerMedia}
					error={drawerMediaError}
					onReloadMedia={() => loadDrawerMedia(true)}
					onClose={() => setEditing(undefined)}
					// The sheet closes itself (animated) after saving; onClose then clears `editing`.
					onSaved={(items) => setCollections(items)}
					isDesktop={isDesktop}
				/>
			) : null}

			{actionSheetId && (() => {
				const collection = collections.find((item) => item.id === actionSheetId);
				if (!collection) return null;
				return (
					<SheetActionList
						title={collection.name}
						onClose={() => setActionSheetId(null)}
						isDesktop={isDesktop}
						actions={[
							{
								key: "edit",
								icon: Pencil,
								iconClassName: "bg-sky-500/15 text-sky-400",
								label: t("settings_albums.collections_edit"),
								onSelect: () => afterSheetClose(() => openEditor(collection)),
							},
							{
								key: "delete",
								icon: Trash2,
								tone: "danger",
								label: t("settings_albums.collections_delete"),
								onSelect: () => setConfirmDeleteId(collection.id),
							},
						]}
					/>
				);
			})()}

			<ConfirmDialog
				isOpen={confirmDeleteId !== null}
				title={t("settings_albums.collections_delete_confirm_title")}
				message={t("settings_albums.collections_delete_confirm_message")}
				confirmLabel={t("settings_albums.delete")}
				cancelLabel={t("settings_albums.cancel")}
				onConfirm={() => void confirmDelete()}
				onCancel={() => setConfirmDeleteId(null)}
				isProcessing={isDeleting}
				confirmTone="danger"
			/>
		</div>
	);
}
