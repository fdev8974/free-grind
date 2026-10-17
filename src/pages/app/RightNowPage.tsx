import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
	ArrowUpDown,
	Crosshair,
	List,
	Map as MapIcon,
	MessageSquare,
	Hourglass,
	Navigation,
	Star,
	UserRound,
	X,
} from "lucide-react";
import { SlidersHorizontal as PhosphorSlidersHorizontal } from "@phosphor-icons/react";
import { ClockFilled, HomeFilled } from "../../components/icons/FilledIcons";
import { useRightNowFeed } from "../../hooks/queries/useRightNowQueries";
import { useFeatureFlag } from "../../services/assignmentsStore";
import { decodeGeohash } from "../../utils/geohash";
import { simulateRightNowMapFeed } from "./rightnow/rightnow-simulation";
import type { RightNowFeedItem } from "../../services/apiFunctions";
import { formatDistance, isOnlineEndingSoon } from "./gridpage/utils";
import { formatRelativeTime } from "../../utils/relativeTime";
import { cn } from "../../utils/cn";
import { getRightNowLastSeen, markRightNowSeen } from "../../services/seenStore";
import { ProfileImage } from "../../components/ui/profile-image";
import { useRevealOnScroll } from "../../hooks/useRevealOnScroll";
import { PullToRefreshContainer } from "./components/PullToRefreshContainer";
import {
	type RightNowFiltersDraft,
	type RightNowSortOption,
	type RightNowViewMode,
	loadRightNowFiltersDraft,
	saveRightNowFiltersDraft,
} from "./rightnow/rightnow-filters-storage";
import { getSexualPositionFilterOptions } from "./profile-option-builders";
import { usePreferences } from "../../contexts/PreferencesContext";
import { RightNowPostFAB, type RightNowFABPhase } from "./rightnow/RightNowPostFAB";
import { RightNowPostPage } from "./rightnow/RightNowPostPage";
import { RightNowFiltersPage } from "./RightNowFiltersPage";
import { PhotoViewer } from "../../components/PhotoViewer";
import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";
import {
	SCROLL_RESTORATION_TIMEOUT_MS,
} from "../../config/ui-constants";
import { PageHeaderBackground } from "../../components/ui/PageHeaderBackground";
import { FeedScrollContainer } from "../../components/ui/FeedScrollContainer";
import { RightNowMap, getRightNowAvatarUrl, getRightNowItemKey, getRightNowProfileImageUrl, hasMapPosition } from "./rightnow/RightNowMap";

type SortOption = RightNowSortOption;

// Stable fallback while the feed is loading/failed: a fresh `[]` per render
// would rebuild `items` every render (test mode then fills it with synthetic
// posts stamped with Date.now()), and the "mark as seen" effect below would
// set state on each one — an infinite render loop.
const EMPTY_FEED: RightNowFeedItem[] = [];

function parseFiltersFromLocationState(
	state: unknown,
	current: RightNowFiltersDraft,
): RightNowFiltersDraft {
	if (typeof state !== "object" || state === null) {
		return current;
	}

	const safe = state as { rightNowFiltersDraft?: Partial<RightNowFiltersDraft> };
	const draft = safe.rightNowFiltersDraft;
	if (!draft) {
		return current;
	}

	const nextAgeMin =
		typeof draft.ageMin === "number" && Number.isFinite(draft.ageMin)
			? Math.max(18, Math.min(99, draft.ageMin))
			: current.ageMin;
	const nextAgeMax =
		typeof draft.ageMax === "number" && Number.isFinite(draft.ageMax)
			? Math.max(nextAgeMin, Math.min(99, draft.ageMax))
			: current.ageMax;

	return {
		ageMin: nextAgeMin,
		ageMax: nextAgeMax,
		positionFilter:
			typeof draft.positionFilter === "string"
				? draft.positionFilter
				: current.positionFilter,
		hostingOnly: typeof draft.hostingOnly === "boolean" ? draft.hostingOnly : current.hostingOnly,
		favoritesOnly: typeof draft.favoritesOnly === "boolean" ? draft.favoritesOnly : current.favoritesOnly,
	};
}

function getItemName(item: RightNowFeedItem, t: TFunction): string {
	const name = item.displayName?.trim();
	if (name) return name;
	return t("common.unknown_display_name");
}


function getItemDisplayImageUrl(item: RightNowFeedItem): string | null {
	return getRightNowAvatarUrl(item);
}

function isItemOnline(item: RightNowFeedItem): boolean {
	return typeof item.onlineUntil === "number" && item.onlineUntil > Date.now();
}

function PostMediaGrid({
	media,
	onOpenPhoto,
}: {
	media: RightNowFeedItem["media"];
	onOpenPhoto: (index: number) => void;
}) {
	const isDesktop = useDesktopBreakpoint();
	if (!media || media.length === 0) return null;

	const items = media.slice(0, 3);
	const count = items.length;

	return (
		<div
			className={cn(
				"mt-1.5 overflow-hidden rounded-md bg-[var(--surface-2)]",
				isDesktop ? "w-[380px]" : "w-full sm:max-w-[260px]"
			)}
		>
			<div className="relative aspect-video w-full flex gap-[2px]">
				{count === 1 && (
					<button
						type="button"
						className="h-full w-full overflow-hidden"
						onClick={() => onOpenPhoto(0)}
					>
						<img
							src={items[0].data?.thumbnailUrl ?? items[0].data?.fullImageUrl ?? ""}
							className="h-full w-full object-cover transition-transform active:scale-105"
							alt=""
						/>
					</button>
				)}

				{count === 2 && (
					<>
						<button
							type="button"
							className="flex-1 overflow-hidden"
							onClick={() => onOpenPhoto(0)}
						>
							<img
								src={items[0].data?.thumbnailUrl ?? items[0].data?.fullImageUrl ?? ""}
								className="h-full w-full object-cover transition-transform active:scale-105"
								alt=""
							/>
						</button>
						<button
							type="button"
							className="flex-1 overflow-hidden"
							onClick={() => onOpenPhoto(1)}
						>
							<img
								src={items[1].data?.thumbnailUrl ?? items[1].data?.fullImageUrl ?? ""}
								className="h-full w-full object-cover transition-transform active:scale-105"
								alt=""
							/>
						</button>
					</>
				)}

				{count === 3 && (
					<>
						<button
							type="button"
							className="w-[60%] overflow-hidden"
							onClick={() => onOpenPhoto(0)}
						>
							<img
								src={items[0].data?.thumbnailUrl ?? items[0].data?.fullImageUrl ?? ""}
								className="h-full w-full object-cover transition-transform active:scale-105"
								alt=""
							/>
						</button>
						<div className="flex w-[40%] flex-col gap-[2px]">
							<button
								type="button"
								className="flex-1 overflow-hidden"
								onClick={() => onOpenPhoto(1)}
							>
								<img
									src={items[1].data?.thumbnailUrl ?? items[1].data?.fullImageUrl ?? ""}
									className="h-full w-full object-cover transition-transform active:scale-105"
									alt=""
								/>
							</button>
							<button
								type="button"
								className="flex-1 overflow-hidden"
								onClick={() => onOpenPhoto(2)}
							>
								<img
									src={items[2].data?.thumbnailUrl ?? items[2].data?.fullImageUrl ?? ""}
									className="h-full w-full object-cover transition-transform active:scale-105"
									alt=""
								/>
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}

function RightNowRow({
	item,
	onMessage,
	onSelect,
	onOpenPhoto,
	className,
}: {
	item: RightNowFeedItem;
	onMessage: (profileId: string) => void;
	onSelect: (profileId: string) => void;
	onOpenPhoto: (photos: string[], index: number, profileId: string) => void;
	className?: string;
}) {
	const { t } = useTranslation();
	const { unitsPreset } = usePreferences();
	const { ref, revealClass } = useRevealOnScroll();
	const name = getItemName(item, t);
	const isHosting = item.hosting;
	const imageUrl = getItemDisplayImageUrl(item);

	const timeAgo = formatRelativeTime(item.postedAt);
	const distance =
		item.distanceMeters != null
			? formatDistance(item.distanceMeters, t, unitsPreset)
			: null;
	const isOnline = isItemOnline(item);
	const isEndingSoon = isOnline && isOnlineEndingSoon(item.onlineUntil);

	const photos = useMemo(() => {
		return (item.media || [])
			.map((m) => m.data?.fullImageUrl || m.data?.thumbnailUrl || "")
			.filter(Boolean);
	}, [item.media]);

	return (
		<div
			ref={ref}
			className={cn(
				"flex items-center gap-4 pl-4 pr-4 py-3 border-b border-[var(--surface-2)]",
				revealClass,
				className,
			)}
		>
			<button
				type="button"
				className="relative shrink-0"
				onClick={() => onSelect(item.profileId)}
			>
				<div className="h-15 w-15 squircle drop-shadow-sm bg-[var(--surface-2)]">
					<ProfileImage src={imageUrl} alt={name || ""} />
				</div>
				{isOnline ? (
					<span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-[1.5px] border-[var(--bg)] shadow-sm z-10 ${isEndingSoon ? "bg-amber-500" : "bg-green-500"}`} />
				) : null}
			</button>

			<div className="min-w-0 flex-1">
				<button
					type="button"
					className="w-full text-left"
					onClick={() => onSelect(item.profileId)}
				>
					{item.text && (
						<p className="line-clamp-3 text-sm font-bold text-[var(--text)] mb-0.5">
							{item.text}
						</p>
					)}

					<div className="flex items-center gap-3">
						{timeAgo ? (
							<span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
								<ClockFilled className="h-3 w-3" />
								{timeAgo}
							</span>
						) : null}
						{distance && distance !== "hidden" ? (
							<span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
								<Navigation className="h-3 w-3 fill-current" />
								{distance}
							</span>
						) : null}
						{isHosting && (
							<span className="flex items-center gap-1 text-xs text-[var(--right-now)]">
								<HomeFilled className="h-3.5 w-3.5" />
							</span>
						)}
					</div>

					<div className="mt-0.5 flex items-center justify-between gap-2">
						<div className="flex min-w-0 items-center gap-1">
							<p className="truncate text-xs text-[var(--text-muted)] font-medium">
								{name}
							</p>
							{item.isFavorite && (
								<span title={t("chat.favorite")}>
									<Star className="h-3 w-3 shrink-0 fill-current text-[var(--accent)]" />
								</span>
							)}
						</div>
						{item.premiumType && item.premiumType !== "locked" && (
							<span className="shrink-0 text-[10px] font-medium text-[var(--text-muted)] opacity-50 uppercase tracking-wider">
								{item.premiumType.split("_")[0]}
							</span>
						)}
					</div>
				</button>

				<PostMediaGrid
					media={item.media}
					onOpenPhoto={(index) => onOpenPhoto(photos, index, item.profileId)}
				/>
			</div>

			<button
				type="button"
				onClick={() => onMessage(item.profileId)}
				className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--right-now)]/35 text-[var(--right-now)] transition-all active:scale-95 hover:border-[var(--right-now)]/45"
				style={{
					backgroundColor: "color-mix(in srgb, var(--right-now), transparent 92%)",
					boxShadow: "0 2px 8px color-mix(in srgb, var(--right-now), transparent 94%)"
				}}
				aria-label={t("right_now.message_aria", { name: name || "" })}
			>
				<MessageSquare className="h-4 w-4" />
			</button>
		</div>
	);
}

const AVATAR_RING_CIRCUMFERENCE = 2 * Math.PI * 30.75;

/** Preview of the post selected on the map — sheet-style glass card with the
 * post, its session countdown and profile / message actions. */
function RightNowMapCard({
	item,
	onMessage,
	onSelect,
	onOpenPhoto,
	onClose,
}: {
	item: RightNowFeedItem;
	onMessage: (profileId: string) => void;
	onSelect: (profileId: string) => void;
	onOpenPhoto: (photos: string[], index: number, profileId: string) => void;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const { unitsPreset } = usePreferences();
	const name = getItemName(item, t);
	const avatarUrl = getItemDisplayImageUrl(item);
	const distance = item.distanceMeters != null ? formatDistance(item.distanceMeters, t, unitsPreset) : null;
	const isOnline = isItemOnline(item);
	const isEndingSoon = isOnline && isOnlineEndingSoon(item.onlineUntil);
	const photos = useMemo(
		() => (item.media || []).map((m) => m.data?.fullImageUrl || m.data?.thumbnailUrl || "").filter(Boolean),
		[item.media],
	);

	const now = Date.now();
	const sessionFraction =
		item.postedAt != null && item.expiresAt != null && item.expiresAt > item.postedAt
			? Math.max(0, Math.min(1, (item.expiresAt - now) / (item.expiresAt - item.postedAt)))
			: null;
	const minutesLeft = item.expiresAt != null ? Math.max(0, Math.ceil((item.expiresAt - now) / 60_000)) : null;

	// A post photo becomes the card's hero image; the avatar then shows the
	// profile photo so the two don't repeat.
	const heroSrc = photos[0] ?? null;
	const headerAvatarUrl = heroSrc ? getRightNowProfileImageUrl(item) ?? avatarUrl : avatarUrl;

	return (
		<div className="relative mx-auto max-w-xl overflow-hidden rounded-3xl border border-[color-mix(in_srgb,var(--border)_60%,transparent)] bg-[color-mix(in_srgb,var(--surface)_86%,transparent)] shadow-[0_24px_48px_-12px_rgba(0,0,0,0.55),0_8px_16px_-6px_rgba(0,0,0,0.35)] backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4 duration-300">
			{/* Close, pinned to the card's corner (over the photo when there is one) */}
			<button
				type="button"
				onClick={onClose}
				aria-label={t("common.close")}
				className={cn(
					"absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full transition",
					heroSrc
						? "bg-black/45 text-white backdrop-blur-md hover:bg-black/60"
						: "text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]",
				)}
			>
				<X className="h-4 w-4" />
			</button>

			{heroSrc ? (
				<button
					type="button"
					onClick={() => onOpenPhoto(photos, 0, item.profileId)}
					className="relative block h-40 w-full overflow-hidden"
				>
					<img src={heroSrc} alt="" className="h-full w-full object-cover" draggable={false} />
					{/* Fades the photo into the card */}
					<div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[color-mix(in_srgb,var(--surface)_92%,transparent)]" />
					{photos.length > 1 ? (
						<span className="absolute bottom-12 right-3 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-md">
							+{photos.length - 1}
						</span>
					) : null}
				</button>
			) : (
				/* Right Now glow along the top edge */
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-0 top-0 h-24"
					style={{ background: "radial-gradient(ellipse 70% 100% at 50% 0%, color-mix(in srgb, var(--right-now) 22%, transparent), transparent)" }}
				/>
			)}

			<div className={cn("relative p-4", heroSrc && "-mt-10 pt-0")}>
				{/* Header: avatar, name, meta, close */}
				<div className="flex items-end gap-3">
					<button type="button" onClick={() => onSelect(item.profileId)} className="relative shrink-0">
						<div className="h-14 w-14 overflow-hidden rounded-full border-2 border-[var(--surface)] bg-[var(--surface-2)] shadow-lg">
							<ProfileImage src={headerAvatarUrl} alt={name} />
						</div>
						{/* Session countdown ring, same as the map markers */}
						<svg className="pointer-events-none absolute -inset-1 h-[calc(100%+0.5rem)] w-[calc(100%+0.5rem)] -rotate-90" viewBox="0 0 64 64" aria-hidden="true">
							<circle cx="32" cy="32" r="30.75" fill="none" stroke="color-mix(in srgb, var(--right-now) 22%, transparent)" strokeWidth="2.5" />
							<circle
								cx="32"
								cy="32"
								r="30.75"
								fill="none"
								stroke="var(--right-now)"
								strokeWidth="2.5"
								strokeLinecap="round"
								strokeDasharray={AVATAR_RING_CIRCUMFERENCE}
								strokeDashoffset={AVATAR_RING_CIRCUMFERENCE * (1 - (sessionFraction ?? 1))}
								style={{ filter: "drop-shadow(0 0 3px var(--right-now))" }}
							/>
						</svg>
						{isOnline ? (
							<span className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[var(--surface)] ${isEndingSoon ? "bg-amber-500" : "bg-green-500"}`} />
						) : null}
					</button>

					<button type="button" onClick={() => onSelect(item.profileId)} className={cn("min-w-0 flex-1 pb-0.5 text-left", !heroSrc && "pr-8")}>
						<div className="flex min-w-0 items-center gap-1.5">
							<p className="truncate text-base font-bold text-[var(--text)]">{name}</p>
							{item.isFavorite && <Star className="h-3.5 w-3.5 shrink-0 fill-current text-[var(--accent)]" />}
						</div>
						<div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-muted)]">
							{minutesLeft != null ? (
								<span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--right-now)_16%,transparent)] px-2 py-0.5 font-semibold tabular-nums text-[var(--right-now)]">
									<Hourglass className="h-3 w-3" />
									{minutesLeft}m
								</span>
							) : null}
							{distance && distance !== "hidden" ? (
								<span className="inline-flex items-center gap-1">
									<Navigation className="h-3 w-3 fill-current" />
									{distance}
								</span>
							) : null}
							{item.hosting ? (
								<span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--right-now)_16%,transparent)] px-2 py-0.5 font-semibold text-[var(--right-now)]">
									<HomeFilled className="h-3 w-3" />
									{t("right_now.hosting")}
								</span>
							) : null}
						</div>
					</button>
				</div>

				{item.text ? (
					<p className="mt-3 line-clamp-4 text-sm leading-relaxed text-[var(--text)]">{item.text}</p>
				) : null}

				{/* Actions */}
				<div className="mt-4 flex gap-2">
					<button
						type="button"
						onClick={() => onSelect(item.profileId)}
						className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 text-sm font-semibold text-[var(--text)] transition hover:brightness-110 active:scale-[0.98]"
					>
						<UserRound className="h-4 w-4" />
						{t("chat.view_profile")}
					</button>
					<button
						type="button"
						onClick={() => onMessage(item.profileId)}
						className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--right-now)] px-4 text-sm font-semibold text-white shadow-lg shadow-[var(--right-now)]/30 transition hover:brightness-110 active:scale-[0.98]"
					>
						<MessageSquare className="h-4 w-4" />
						{t("profile_details.message")}
					</button>
				</div>
			</div>
		</div>
	);
}

function RightNowSkeleton() {
	return (
		<div className="flex items-center gap-4 border-b border-[var(--surface-2)] py-3 pl-4 pr-4">
			<div className="h-15 w-15 shrink-0 squircle animate-pulse bg-[var(--surface-2)]" />
			<div className="flex flex-1 flex-col gap-2">
				<div className="flex items-center justify-between gap-3">
					<div className="h-3 w-28 animate-pulse rounded-full bg-[var(--surface-2)]" />
					<div className="h-2.5 w-10 animate-pulse rounded-full bg-[var(--border)]" />
				</div>
				<div className="h-2.5 w-40 animate-pulse rounded-full bg-[var(--border)]" />
			</div>
			<div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-[var(--surface-2)]" />
		</div>
	);
}

export function RightNowPage() {
	const { t } = useTranslation();
	const location = useLocation();
	const navigate = useNavigate();
	const persistedFilters = useMemo(() => loadRightNowFiltersDraft(), []);

	const [sort, setSort] = useState<SortOption>(persistedFilters.sort);
	const [hostingOnly, setHostingOnly] = useState(persistedFilters.hostingOnly);
	const [favoritesOnly, setFavoritesOnly] = useState(persistedFilters.favoritesOnly);
	const [viewMode, setViewMode] = useState<RightNowViewMode>(persistedFilters.viewMode);
	const [selectedMapKey, setSelectedMapKey] = useState<string | null>(null);
	const [ageMin, setAgeMin] = useState(persistedFilters.ageMin);
	const [ageMax, setAgeMax] = useState(persistedFilters.ageMax);
	const [positionFilter, setPositionFilter] = useState<string>(
		persistedFilters.positionFilter,
	);
	const [hasRestoredScroll, setHasRestoredScroll] = useState(false);
	const [lastSeenRightNow, setLastSeenRightNow] = useState(() => getRightNowLastSeen());

	const queryParams = useMemo(() => ({
		sort,
		hosting: hostingOnly ? true : undefined,
		ageMin: ageMin > 18 ? ageMin : undefined,
		ageMax: ageMax < 99 ? ageMax : undefined,
		sexualPositions: positionFilter || undefined,
	}), [sort, hostingOnly, ageMin, ageMax, positionFilter]);

	const { data: feedItems = EMPTY_FEED, isLoading, error, refetch } = useRightNowFeed(queryParams);
	const { activeRightNowId, activeRightNowExpiresAt, rightNowRemaining, setPreferences, developerMode, showDebugInfo, rightNowTestMode, geohash } = usePreferences();

	// Test mode feeds the map simulated positions around the browse location
	// so its UI can be checked without real posts that share a location.
	const testModeCenter = useMemo(() => {
		if (geohash) {
			try {
				const { lat, lon } = decodeGeohash(geohash);
				return { lat: (lat[0] + lat[1]) / 2, lon: (lon[0] + lon[1]) / 2 };
			} catch {
				// fall through
			}
		}
		return { lat: 52.52, lon: 13.405 };
	}, [geohash]);
	const items = useMemo(() => {
		const source = rightNowTestMode ? simulateRightNowMapFeed(feedItems, testModeCenter, hostingOnly) : feedItems;
		// Favorites is filtered here — the feed API has no parameter for it.
		return favoritesOnly ? source.filter((item) => item.isFavorite) : source;
	}, [rightNowTestMode, feedItems, testModeCenter, hostingOnly, favoritesOnly]);
	const queryClient = useQueryClient();

	const [viewerPhotos, setViewerPhotos] = useState<string[]>([]);
	const [viewerIndex, setViewerIndex] = useState(0);
	const [isViewerOpen, setIsViewerOpen] = useState(false);
	const [viewerProfileId, setViewerProfileId] = useState<string | null>(null);

	// The viewer gets its own history entry so system back closes it instead
	// of leaving the Right Now page.
	const viewerHistoryPushedRef = useRef(false);

	const openPhotoViewer = useCallback((photos: string[], index: number, profileId: string) => {
		setViewerPhotos(photos);
		setViewerIndex(index);
		setViewerProfileId(profileId);
		setIsViewerOpen(true);
		if (!viewerHistoryPushedRef.current) {
			window.history.pushState({ ...window.history.state, rightNowViewer: true }, "");
			viewerHistoryPushedRef.current = true;
		}
	}, []);

	const closePhotoViewer = useCallback(() => {
		setIsViewerOpen(false);
		if (viewerHistoryPushedRef.current) {
			// Cleared first so our own popstate handler ignores this pop.
			viewerHistoryPushedRef.current = false;
			window.history.back();
		}
	}, []);

	useEffect(() => {
		const handlePopState = () => {
			if (!viewerHistoryPushedRef.current) return;
			viewerHistoryPushedRef.current = false;
			setIsViewerOpen(false);
		};
		window.addEventListener("popstate", handlePopState);
		return () => window.removeEventListener("popstate", handlePopState);
	}, []);

	const [isPosting, setIsPosting] = useState(false);
	const [isModalMounted, setIsModalMounted] = useState(false);
	const [isFiltersOpen, setIsFiltersOpen] = useState(false);
	const [isFiltersMounted, setIsFiltersMounted] = useState(false);
	const [fabPhase, setFabPhase] = useState<RightNowFABPhase>("idle");
	const feedContainerRef = useRef<HTMLDivElement | null>(null);
	const headerRef = useRef<HTMLElement | null>(null);
	// Viewport y of the header's bottom edge. The map is pulled up by exactly
	// this much so it reaches the screen top (behind .app-screen's top padding
	// and the header, whose pill row can wrap), and its overlays sit below it.
	const [headerBottom, setHeaderBottom] = useState(0);

	useLayoutEffect(() => {
		const header = headerRef.current;
		if (!header) return;
		const measure = () => setHeaderBottom(Math.round(header.getBoundingClientRect().bottom));
		measure();
		const observer = "ResizeObserver" in window ? new ResizeObserver(measure) : null;
		observer?.observe(header);
		window.addEventListener("resize", measure);
		return () => {
			observer?.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, []);

	const handlePostClick = useCallback(() => {
		setIsPosting(true);
		setIsModalMounted(true);
	}, []);

	const handlePostSuccess = useCallback((isEdit: boolean) => {
		if (!isEdit) {
			setFabPhase("loading");
		}
		setIsPosting(false);
		// Reload the feed (every filter variant) so the new/edited own post and
		// its photo show up. Once more shortly after, in case the server hadn't
		// picked up the change yet on the first fetch.
		const refreshFeed = () => void queryClient.invalidateQueries({ queryKey: ["rightnow", "feed"] });
		refreshFeed();
		setTimeout(refreshFeed, 2000);
		// Unmounting happens in handleCloseModal once the sheet has animated out.
	}, [queryClient]);

	// The sheet only calls this once its close animation has finished.
	const handleCloseModal = useCallback(() => {
		setIsPosting(false);
		setIsModalMounted(false);
	}, []);

	const positionFilterOptions = useMemo(
		() => getSexualPositionFilterOptions(t, t("right_now.any_position")),
		[t],
	);

	const ageLabel = `${ageMin}-${ageMax}${ageMax >= 99 ? "+" : ""}`;
	const activePositionFilter =
		positionFilterOptions.find((option) => option.value === positionFilter) ??
		positionFilterOptions[0];
	const hasAdvancedFilters =
		hostingOnly || favoritesOnly || positionFilter.length > 0 || ageMin !== 18 || ageMax !== 99;
	const activeFilterCount =
		(hostingOnly ? 1 : 0) +
		(favoritesOnly ? 1 : 0) +
		(positionFilter.length > 0 ? 1 : 0) +
		(ageMin !== 18 || ageMax !== 99 ? 1 : 0);
	const filterSummary = useMemo(
		() =>
			t("right_now.filter_summary", {
				position: activePositionFilter.label,
				age: ageLabel,
			}),
		[activePositionFilter.label, ageLabel, t],
	);

	useEffect(() => {
		const next = parseFiltersFromLocationState(location.state, {
			ageMin,
			ageMax,
			positionFilter,
			hostingOnly,
			favoritesOnly,
		});

		if (
			next.ageMin !== ageMin ||
			next.ageMax !== ageMax ||
			next.positionFilter !== positionFilter ||
			next.hostingOnly !== hostingOnly ||
			next.favoritesOnly !== favoritesOnly
		) {
			setAgeMin(next.ageMin);
			setAgeMax(next.ageMax);
			setPositionFilter(next.positionFilter);
			setHostingOnly(next.hostingOnly);
			setFavoritesOnly(next.favoritesOnly);

			const safeState =
				typeof location.state === "object" && location.state !== null
					? (location.state as Record<string, unknown>)
					: {};
			navigate(location.pathname + location.search, {
				replace: true,
				state: { ...safeState, rightNowFiltersDraft: undefined },
			});
		}
	}, [location.key, location.state, navigate, location.pathname, location.search, ageMin, ageMax, positionFilter, hostingOnly, favoritesOnly]);

	useEffect(() => {
		saveRightNowFiltersDraft({
			sort,
			hostingOnly,
			favoritesOnly,
			viewMode,
			ageMin,
			ageMax,
			positionFilter,
		});
	}, [sort, hostingOnly, favoritesOnly, viewMode, ageMin, ageMax, positionFilter]);

	// Only posts shared with "Show me on map" carry lat/lon; everyone else is
	// list-only.
	const mapItems = useMemo(() => items.filter(hasMapPosition), [items]);
	const mapFitKey = useMemo(() => JSON.stringify(queryParams), [queryParams]);
	const selectedMapItem = useMemo(
		() => (selectedMapKey ? mapItems.find((item) => getRightNowItemKey(item) === selectedMapKey) ?? null : null),
		[mapItems, selectedMapKey],
	);
	// Grindr rolls the map out per account; without the assignment (or test
	// mode) the page stays list-only (the stored choice is kept for when it
	// turns on).
	const isMapFlagOn = useFeatureFlag("right-now-map");
	const isMapAvailable = isMapFlagOn || rightNowTestMode;
	const isMapView = isMapAvailable && viewMode === "map";
	const isMapCardOpen = isMapView && selectedMapItem !== null;
	// Set by RightNowMap; the header's Center pill frames all markers through it.
	const mapRecenterRef = useRef<(() => void) | null>(null);


	const isSessionActive = useMemo(() => {
		if (!activeRightNowId || !activeRightNowExpiresAt) return false;
		return Date.now() < activeRightNowExpiresAt;
	}, [activeRightNowId, activeRightNowExpiresAt]);

	useEffect(() => {
		const isClearlyActive = activeRightNowId && activeRightNowExpiresAt && (Date.now() < activeRightNowExpiresAt - 2000);

		if (isClearlyActive && fabPhase === "idle" && !isPosting) {
			setFabPhase("countdown");
		} else if (!isSessionActive && fabPhase === "countdown" && !isPosting) {
			setFabPhase("idle");
		}
	}, [isSessionActive, fabPhase, isPosting, activeRightNowId, activeRightNowExpiresAt]);

	useEffect(() => {
		if (!isSessionActive && activeRightNowId) {
			void setPreferences({
				activeRightNowId: null,
				activeRightNowExpiresAt: null,
				activeRightNowHidden: false,
			});
		}
	}, [isSessionActive, activeRightNowId, setPreferences]);

	// Mark as seen whenever the user is on this page so the NavBar dot clears
	useEffect(() => {
		if (items.length > 0) {
			const maxTs = Math.max(...items.map(i => i.postedAt ?? 0));
			const at = Math.max(Date.now(), maxTs);
			markRightNowSeen(at);
			setLastSeenRightNow(at);
		}
	}, [items]);

	// Clear scroll memory for RightNow when NEW activity is detected in real-time
	const prevMaxPostedAt = useRef(lastSeenRightNow);

	useEffect(() => {
		const maxPostedAt = items.length > 0 ? Math.max(...items.map(i => i.postedAt ?? 0)) : 0;
		if (maxPostedAt > prevMaxPostedAt.current) {
			sessionStorage.removeItem("rightnow-scroll");
			feedContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
		}
		if (maxPostedAt > 0) prevMaxPostedAt.current = maxPostedAt;
	}, [items]);

	// Scroll Memory logic
	useEffect(() => {
		const container = feedContainerRef.current;
		if (!container) return;

		const handleScroll = () => {
			const scrollData = {
				top: container.scrollTop,
				timestamp: Date.now()
			};
			sessionStorage.setItem("rightnow-scroll", JSON.stringify(scrollData));
		};

		container.addEventListener("scroll", handleScroll, { passive: true });
		return () => container.removeEventListener("scroll", handleScroll);
	}, [viewMode]);

	useLayoutEffect(() => {
		if (items.length > 0 && !isLoading && !hasRestoredScroll && feedContainerRef.current) {
			const storageKey = "rightnow-scroll";

			// If there's new activity since the last time we "saw" this page,
			// don't restore the scroll position - stay at the top.
			const maxTs = Math.max(...items.map(i => i.postedAt ?? 0));
			if (maxTs > lastSeenRightNow) {
				sessionStorage.removeItem(storageKey);
				feedContainerRef.current.scrollTop = 0;
				setHasRestoredScroll(true);
				return;
			}

			const saved = sessionStorage.getItem(storageKey);
			if (saved) {
				try {
					const parsed = JSON.parse(saved);
					// Safety check: is it our new object format or just an old number?
					if (parsed && typeof parsed === "object" && "top" in parsed) {
						const { top, timestamp } = parsed as { top: number; timestamp: number };
						if (Date.now() - timestamp < SCROLL_RESTORATION_TIMEOUT_MS) {
							feedContainerRef.current.scrollTop = top;
						} else {
							sessionStorage.removeItem(storageKey);
							feedContainerRef.current.scrollTop = 0;
						}
					} else {
						// Old numeric format, clear it
						sessionStorage.removeItem(storageKey);
						feedContainerRef.current.scrollTop = 0;
					}
				} catch (e) {
					sessionStorage.removeItem(storageKey);
					feedContainerRef.current.scrollTop = 0;
				}
			} else {
				// No saved scroll, ensure we start at the top
				feedContainerRef.current.scrollTop = 0;
			}
			setHasRestoredScroll(true);
		}
	}, [items.length, isLoading, hasRestoredScroll, lastSeenRightNow, items]);


	const handleMessage = useCallback(
		(profileId: string) => {
			const params = new URLSearchParams();
			params.set("targetProfileId", profileId);
			navigate(`/chat?${params.toString()}`);
		},
		[navigate],
	);

	const handleSelect = useCallback(
		(profileId: string) => {
			navigate(`/profile/${profileId}`, {
				state: { returnTo: location.pathname },
			});
		},
		[navigate, location.pathname],
	);

	const toggleSort = useCallback(() => {
		setSort((prev) => (prev === "DISTANCE" ? "RECENCY" : "DISTANCE"));
		sessionStorage.removeItem("rightnow-scroll");
		setHasRestoredScroll(true);
		feedContainerRef.current?.scrollTo(0, 0);
	}, []);

	const toggleHostingOnly = useCallback(() => {
		setHostingOnly((previous) => !previous);
		sessionStorage.removeItem("rightnow-scroll");
		setHasRestoredScroll(true);
		feedContainerRef.current?.scrollTo(0, 0);
	}, []);

	const toggleViewMode = useCallback(() => {
		setViewMode((previous) => (previous === "map" ? "list" : "map"));
		setSelectedMapKey(null);
	}, []);

	const openFilters = useCallback(() => {
		setIsFiltersOpen(true);
		setIsFiltersMounted(true);
	}, []);

	const handleApplyFilters = useCallback((draft: RightNowFiltersDraft) => {
		setAgeMin(draft.ageMin);
		setAgeMax(draft.ageMax);
		setPositionFilter(draft.positionFilter);
		setHostingOnly(draft.hostingOnly);
		setFavoritesOnly(draft.favoritesOnly);
		sessionStorage.removeItem("rightnow-scroll");
		setHasRestoredScroll(true);
		feedContainerRef.current?.scrollTo(0, 0);
	}, []);

	// The sheet only calls this once its close animation has finished.
	const handleCloseFilters = useCallback(() => {
		setIsFiltersOpen(false);
		setIsFiltersMounted(false);
	}, []);

	return (
		<>
		<PullToRefreshContainer
			className="app-screen flex h-dvh flex-col w-full !px-0 !pb-0 overflow-x-hidden"
			contentClassName="flex flex-1 flex-col min-h-0"
			style={{ overflow: "visible", overflowX: "hidden" }}
			onRefresh={() => {
				sessionStorage.removeItem("rightnow-scroll");
				setHasRestoredScroll(true);
				feedContainerRef.current?.scrollTo(0, 0);
				void refetch();
			}}
			isDisabled={isLoading || isMapView}
			isAtTop={() => (feedContainerRef.current?.scrollTop ?? 0) <= 0}
			refreshingLabel={t("right_now.refreshing")}
			spinnerColor="var(--right-now)"
			spinnerIconColor="white"
		>
			<header ref={headerRef} className="relative z-20 grid gap-3 pointer-events-none">
				<PageHeaderBackground color="var(--right-now)" />
				<div className="pointer-events-auto grid gap-3 mx-auto w-full max-w-4xl px-[var(--app-px)]">
					<h1 className="app-title">{t("right_now.title")}</h1>

					<div className="flex flex-wrap items-center gap-2 pb-4">
						{isMapAvailable && (
						<button
							type="button"
							onClick={toggleViewMode}
							title={isMapView ? t("right_now.view_list", { defaultValue: "List" }) : t("right_now.view_map", { defaultValue: "Map" })}
							aria-label={isMapView ? t("right_now.view_list", { defaultValue: "List" }) : t("right_now.view_map", { defaultValue: "Map" })}
							// Icon-only, keeping the text line height so it matches the label pills.
							className="glass-pill inline-flex shrink-0 items-center justify-center px-[11px] py-2 text-sm font-bold text-[var(--right-now)] hover:border-[var(--right-now)]/60 hover:bg-[var(--right-now)]/20 active:scale-95"
							style={{ "--pill-color": "var(--right-now)" } as React.CSSProperties}
						>
							<span className="flex h-5 items-center">
								{isMapView ? <List className="h-3.5 w-3.5" /> : <MapIcon className="h-3.5 w-3.5" />}
							</span>
						</button>
						)}

						<button
							type="button"
							onClick={openFilters}
							title={t("right_now.filters")}
							aria-label={hasAdvancedFilters ? `${t("right_now.filters")}: ${filterSummary}` : t("right_now.filters")}
							className={cn(
								"glass-pill inline-flex shrink-0 items-center justify-center gap-1.5 py-2 text-sm font-bold active:scale-95",
								// Icon-only keeps the text line height so it matches the label pills (same as the grid).
								hasAdvancedFilters ? "px-3" : "px-[11px]",
								hasAdvancedFilters
									? "bg-[var(--right-now)] border-[var(--right-now)] text-white shadow-lg shadow-[var(--right-now)]/40"
									: "text-[var(--right-now)] hover:border-[var(--right-now)]/60 hover:bg-[var(--right-now)]/20",
							)}
							style={!hasAdvancedFilters ? {
								"--pill-color": "var(--right-now)",
							} as React.CSSProperties : undefined}
						>
							<span className="flex h-5 items-center">
								<PhosphorSlidersHorizontal weight="fill" className="h-3.5 w-3.5" />
							</span>
							{hasAdvancedFilters ? (
								<span className="ml-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-white px-1 text-[9px] font-bold text-[var(--right-now)]">
									{activeFilterCount}
								</span>
							) : null}
						</button>

						{/* Order only matters in the list; the map shows everyone at once. */}
						{!isMapView && (
						<button
							type="button"
							onClick={toggleSort}
							className={cn(
								"flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-bold transition-all active:scale-95",
								"bg-[var(--right-now)] border-[var(--right-now)] text-white shadow-lg shadow-[var(--right-now)]/40",
							)}
						>
							<ArrowUpDown className="h-3.5 w-3.5" />
							{sort === "DISTANCE" ? t("right_now.distance") : t("right_now.recent")}
						</button>
						)}

						<button
							type="button"
							onClick={toggleHostingOnly}
							className={cn(
								"glass-pill inline-flex shrink-0 items-center gap-1.5 px-4 py-2 text-sm font-bold active:scale-95",
								hostingOnly
									? "bg-[var(--right-now)] border-[var(--right-now)] text-white shadow-lg shadow-[var(--right-now)]/40"
									: "text-[var(--right-now)] hover:border-[var(--right-now)]/60 hover:bg-[var(--right-now)]/20",
							)}
							style={!hostingOnly ? {
								"--pill-color": "var(--right-now)",
							} as React.CSSProperties : undefined}
						>
							<HomeFilled className="h-3.5 w-3.5" />
							{t("right_now.hosting")}
						</button>

						{isMapView && mapItems.length > 0 && (
						<button
							type="button"
							onClick={() => mapRecenterRef.current?.()}
							title={t("right_now.map_recenter")}
							className="glass-pill inline-flex shrink-0 items-center gap-1.5 px-4 py-2 text-sm font-bold text-[var(--right-now)] hover:border-[var(--right-now)]/60 hover:bg-[var(--right-now)]/20 active:scale-95"
							style={{ "--pill-color": "var(--right-now)" } as React.CSSProperties}
						>
							<Crosshair className="h-3.5 w-3.5" />
							{t("right_now.map_center", { defaultValue: "Center" })}
						</button>
						)}
					</div>
				</div>
			</header>

			{isMapView && !error ? (
				<div
					className="relative flex-1 min-h-0"
					style={{ marginTop: -headerBottom }}
				>
					<RightNowMap
						items={mapItems}
						selectedKey={selectedMapItem ? selectedMapKey : null}
						onSelectKey={setSelectedMapKey}
						fitKey={mapFitKey}
						topInset={headerBottom}
						recenterRef={mapRecenterRef}
					/>

					{!isLoading && mapItems.length === 0 && (
						<div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-8">
							<p className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/90 px-4 py-3 text-center text-sm text-[var(--text-muted)] shadow-lg backdrop-blur">
								{items.length === 0
									? t("right_now.empty")
									: t("right_now.map_no_positions", {
										defaultValue: "Nobody nearby is sharing their location on the map right now.",
									})}
							</p>
						</div>
					)}

					{selectedMapItem && (
						<div className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+96px)] z-20 px-3">
							<RightNowMapCard
								key={selectedMapKey}
								item={selectedMapItem}
								onMessage={handleMessage}
								onSelect={handleSelect}
								onOpenPhoto={openPhotoViewer}
								onClose={() => setSelectedMapKey(null)}
							/>
						</div>
					)}
				</div>
			) : (
			<FeedScrollContainer ref={feedContainerRef}>
				{isLoading ? (
					<div className="mx-auto max-w-4xl divide-y divide-[var(--surface-2)] pb-[calc(env(safe-area-inset-bottom,0px)+120px)]">
						{Array.from({ length: 6 }).map((_, i) => (
							<div key={i}>
								<RightNowSkeleton />
							</div>
						))}
					</div>
				) : error ? (
					<div className="px-[var(--app-px)] py-8 text-center">
						<p className="mb-3 text-sm text-[var(--text-muted)]">{error instanceof Error ? error.message : String(error)}</p>
						<button
							type="button"
							onClick={() => void refetch()}
							className="rounded-full border border-[var(--right-now)]/30 px-4 py-2 text-sm font-bold text-[var(--right-now)]/70 transition-all hover:border-[var(--right-now)]/50 hover:text-[var(--right-now)] active:scale-95"
							style={{ backgroundColor: "color-mix(in srgb, var(--right-now), transparent 95%)" }}
						>
							{t("right_now.try_again")}
						</button>
					</div>
				) : items.length === 0 ? (
					<div className="px-[var(--app-px)] py-16 text-center">
						<p className="text-sm text-[var(--text-muted)]">{t("right_now.empty")}</p>
					</div>
				) : (
					<div className="mx-auto max-w-4xl pb-[calc(env(safe-area-inset-bottom,0px)+120px)]">
						{items.map((item) => (
							<div key={`${item.id}-${item.profileId}`} className="px-0">
								<RightNowRow
									item={item}
									onMessage={handleMessage}
									onSelect={handleSelect}
									onOpenPhoto={openPhotoViewer}
								/>
							</div>
						))}
					</div>
				)}
			</FeedScrollContainer>
			)}
		</PullToRefreshContainer>

		<div className="fixed inset-x-0 bottom-36 z-[60] pointer-events-none md:bottom-40">
			<div className="relative mx-auto h-full w-full max-w-4xl px-4 md:px-10">
				{developerMode && showDebugInfo && (
					<div
						className={cn(
							"absolute bottom-0 left-4 transition-all duration-300 pointer-events-auto",
							(isPosting || isFiltersOpen || isMapCardOpen) ? "pointer-events-none opacity-0 translate-y-4" : "opacity-100 translate-y-0",
						)}
					>
						<button
							type="button"
							onClick={() => void setPreferences({ rightNowTestMode: !rightNowTestMode })}
							className={cn(
								"flex h-12 items-center gap-2 rounded-full border px-4 text-xs font-black shadow-xl transition-all active:scale-90",
								rightNowTestMode
									? "bg-blue-600 border-blue-600 text-white shadow-blue-600/40"
									: "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text)]"
							)}
						>
							<div className={cn(
								"h-2 w-2 rounded-full",
								rightNowTestMode ? "bg-white animate-pulse" : "bg-blue-500"
							)} />
							{rightNowTestMode ? "TEST MODE" : "LIVE MODE"}
						</button>
					</div>
				)}

				<div
					className={cn(
						"absolute bottom-0 right-[16%] translate-x-1/2 transition-opacity duration-300 pointer-events-auto",
						(isPosting || isFiltersOpen || isMapCardOpen) ? "pointer-events-none opacity-0" : "opacity-100",
					)}
				>
					<RightNowPostFAB
						onClick={handlePostClick}
						phase={fabPhase}
						onPhaseChange={setFabPhase}
						isEditMode={isSessionActive}
						expiresAt={activeRightNowExpiresAt}
						rightNowRemaining={rightNowRemaining}
						isTestMode={rightNowTestMode}
					/>
				</div>
			</div>
		</div>
		{isModalMounted && (
			<RightNowPostPage
				onClose={handleCloseModal}
				onPost={handlePostSuccess}
			/>
		)}
		{isFiltersMounted && (
			<RightNowFiltersPage
				initialDraft={{ ageMin, ageMax, positionFilter, hostingOnly, favoritesOnly }}
				onClose={handleCloseFilters}
				onApply={handleApplyFilters}
			/>
		)}
		{isViewerOpen && (
			<PhotoViewer
				isOpen={true}
				onClose={closePhotoViewer}
				photos={viewerPhotos}
				initialIndex={viewerIndex}
				conversationId={viewerProfileId}
			/>
		)}
	</>
	);
}
