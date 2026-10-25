import {
	Album as AlbumIcon,
	ChevronRight,
	Film,
	HardDrive,
	Images,
	Share2,
} from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApiFunctions } from "../../hooks/useApiFunctions";
import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";
import { BottomSheet } from "../../components/ui/bottom-sheet";
import {
	ErrorState,
	LoadingState,
} from "../../components/ui/states";
import {
	type Album,
	type AlbumDetail,
	type AlbumLimits,
} from "../../types/albums";
import { countAlbumMedia, formatMs } from "./settings-albums/settingsAlbumsUtils";
import { AlbumEditorSheet } from "./settings-albums/AlbumEditorSheet";
import { DrawerCollectionsSection } from "./settings-albums/DrawerCollectionsSection";
import { useOwnDrawerMedia } from "./settings-albums/useOwnDrawerMedia";
import { useCreateAlbum } from "./settings-albums/useCreateAlbum";
import { EmptyStateCreateButton, NATIVE_SHEET_BG, SectionAddButton } from "../../components/ui/action-sheet";
import { SheetSection } from "../../components/ui/sheet-section";
import { DrawerEmptyState, DrawerHeader } from "./chat/drawerUi";
import { useNavigate, useLocation } from "react-router-dom";
import { proxyMediaUrl } from "../../utils/mediaProxy";

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

export function SettingsAlbumsPage() {
	const { t } = useTranslation();
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
	const { createAlbum, isCreating } = useCreateAlbum();
	const [openAlbumId, setOpenAlbumId] = useState<string | null>(null);
	// Covers and counts for the list; kept up to date by the editor sheet.
	const [albumDetails, setAlbumDetails] = useState<Record<string, AlbumDetail>>({});
	const [albumShareCounts, setAlbumShareCounts] = useState<Record<string, number>>({});
	const { drawerMedia, isLoadingDrawerMedia, drawerMediaError, loadDrawerMedia } = useOwnDrawerMedia();

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

	// Restore the open album after the initial load.
	const restoredRef = useRef(false);
	useEffect(() => {
		if (isLoading || albums.length === 0 || restoredRef.current) return;
		restoredRef.current = true;
		const savedId = sessionStorage.getItem("settings-albums-open");
		if (savedId && albums.some((a) => String(a.albumId) === savedId)) setOpenAlbumId(savedId);
	}, [isLoading, albums]);

	const canCreateAlbum = useMemo(() => albums.length < maxAlbums, [albums.length, maxAlbums]);

	// Created as "Album" and opened right away, to be named and filled there.
	const handleCreateAlbum = async () => {
		const album = await createAlbum();
		if (!album) return;
		setAlbums((previous) => [...previous, album]);
		setOpenAlbumId(album.albumId);
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
								onClick={() => void handleCreateAlbum()}
								disabled={!canCreateAlbum || isCreating}
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
								const shareCount = albumShareCounts[album.albumId];

								return (
									<button
										key={album.albumId}
										type="button"
										onClick={() => setOpenAlbumId(album.albumId)}
										className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)]"
									>
										{/* Same 40px tile as the settings list's icons. */}
										{coverUrl ? (
											<img src={proxyMediaUrl(coverUrl)} alt="" className="h-10 w-10 shrink-0 rounded-2xl object-cover" />
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
												{formatAlbumMeta(detail ? mediaCounts : null, shareCount ?? 0) || `#${album.albumId}`}
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
										onClick={() => void handleCreateAlbum()}
										disabled={!canCreateAlbum || isCreating}
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
				return (
					<AlbumEditorSheet
						key={album.albumId}
						album={album}
						limits={limits}
						initialDetail={albumDetails[album.albumId]}
						onClose={() => setOpenAlbumId(null)}
						onRenamed={(albumId, albumName) =>
							setAlbums((previous) => previous.map((item) => item.albumId === albumId ? { ...item, albumName } : item))}
						onDeleted={(albumId) => setAlbums((previous) => previous.filter((item) => item.albumId !== albumId))}
						onDetailChange={(albumId, detail) => setAlbumDetails((previous) => ({ ...previous, [albumId]: detail }))}
						onSharesChange={(albumId, profiles) => setAlbumShareCounts((previous) => ({ ...previous, [albumId]: profiles.length }))}
						onOpenProfile={(profileId) => {
							// Re-remember the album (closing it clears that) so coming back reopens it.
							sessionStorage.setItem("settings-albums-open", album.albumId);
							navigate(`/profile/${profileId}`, { state: { returnTo: location.pathname } });
						}}
						isDesktop={isDesktop}
					/>
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
									<span className="rounded-full accent-tint-15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--accent)]">
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
		</section>
	);
}
