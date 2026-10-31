import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
	ArrowUpDown,
	Crosshair,
	MessageSquare,
	Hourglass,
	List,
	Navigation,
	Star,
	UserRound,
	X,
} from "lucide-react";
import { SlidersHorizontal as PhosphorSlidersHorizontal } from "@phosphor-icons/react";
import { ClockFilled, HomeFilled, LayoutGridFilled, MapFilled } from "../../components/icons/FilledIcons";
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
import { RightNowPostPill } from "./rightnow/RightNowPostPill";
import { useNavStyle } from "../../components/NavBar";
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
import { proxyMediaUrl } from "../../utils/mediaProxy";
import { getProfileImageUrl, validateMediaHash } from "../../utils/media";
import { SHEET_ICON_BUTTON_CLASS, sheetButtonClass } from "../../components/ui/bottom-sheet";
import { PRIVACY_BLUR_CLASS, PRIVACY_BLUR_TRANSITION_CLASS, PRIVACY_HOVER_REVEAL_CLASS, useMediaBlur } from "../../hooks/useProfilePhotoPrivacy";
import { useBlurReveal } from "../../hooks/useBlurReveal";
import { IconTabs, type IconTabConfig } from "../../components/ui/icon-tabs";

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

/** Lucide's list in the weight of the filled icons it sits next to. */
function ListIcon({ className }: { className?: string }) {
	return <List className={className} strokeWidth={2.5} />;
}

function getItemName(item: RightNowFeedItem, t: TFunction): string {
	const name = item.displayName?.trim();
	if (name) return name;
	return t("common.unknown_display_name");
}


function getItemDisplayImageUrl(item: RightNowFeedItem): string | null {
	return getRightNowAvatarUrl(item);
}

/** The avatar shows the post's own photo when it has one — blurred like the rest of the post media then. */
function useAvatarPostMediaClass(item: RightNowFeedItem, avatarUrl: string | null): string | undefined {
	const { rightNow: blurRightNowMedia } = useMediaBlur();
	return blurRightNowMedia && avatarUrl != null && avatarUrl !== getRightNowProfileImageUrl(item)
		? `${PRIVACY_BLUR_CLASS} ${PRIVACY_HOVER_REVEAL_CLASS}`
		: undefined;
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
	const { rightNow: blurRightNowMedia } = useMediaBlur();
	const { isBlurred, revealOnTap, hoverProps } = useBlurReveal(blurRightNowMedia);
	if (!media || media.length === 0) return null;

	const items = media.slice(0, 3);
	const count = items.length;
	const mediaClassName = (index: number) => cn(
		"h-full w-full object-cover",
		PRIVACY_BLUR_TRANSITION_CLASS,
		isBlurred(String(index)) ? PRIVACY_BLUR_CLASS : "active:scale-105",
	);
	// A blurred photo is revealed by the first tap, like chat media.
	const tileProps = (index: number) => ({
		onClick: () => {
			if (revealOnTap(String(index))) return;
			onOpenPhoto(index);
		},
		...hoverProps(String(index)),
	});

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
						{...tileProps(0)}
					>
						<img
							src={proxyMediaUrl(items[0].data?.thumbnailUrl ?? items[0].data?.fullImageUrl ?? "")}
							className={mediaClassName(0)}
							alt=""
						/>
					</button>
				)}

				{count === 2 && (
					<>
						<button
							type="button"
							className="flex-1 overflow-hidden"
							{...tileProps(0)}
						>
							<img
								src={proxyMediaUrl(items[0].data?.thumbnailUrl ?? items[0].data?.fullImageUrl ?? "")}
								className={mediaClassName(0)}
								alt=""
							/>
						</button>
						<button
							type="button"
							className="flex-1 overflow-hidden"
							{...tileProps(1)}
						>
							<img
								src={proxyMediaUrl(items[1].data?.thumbnailUrl ?? items[1].data?.fullImageUrl ?? "")}
								className={mediaClassName(1)}
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
							{...tileProps(0)}
						>
							<img
								src={proxyMediaUrl(items[0].data?.thumbnailUrl ?? items[0].data?.fullImageUrl ?? "")}
								className={mediaClassName(0)}
								alt=""
							/>
						</button>
						<div className="flex w-[40%] flex-col gap-[2px]">
							<button
								type="button"
								className="flex-1 overflow-hidden"
								{...tileProps(1)}
							>
								<img
									src={proxyMediaUrl(items[1].data?.thumbnailUrl ?? items[1].data?.fullImageUrl ?? "")}
									className={mediaClassName(1)}
									alt=""
								/>
							</button>
							<button
								type="button"
								className="flex-1 overflow-hidden"
								{...tileProps(2)}
							>
								<img
									src={proxyMediaUrl(items[2].data?.thumbnailUrl ?? items[2].data?.fullImageUrl ?? "")}
									className={mediaClassName(2)}
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
	const avatarClassName = useAvatarPostMediaClass(item, imageUrl);

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
				"group/reveal flex items-center gap-4 pl-4 pr-4 py-3 border-b border-[var(--surface-2)]",
				revealClass,
				className,
			)}
		>
			<button
				type="button"
				className="relative shrink-0"
				onClick={() => onSelect(item.profileId)}
			>
				<div className="h-15 w-15 rounded-full overflow-hidden drop-shadow-sm bg-[var(--surface-2)]">
					<ProfileImage src={imageUrl} alt={name || ""} className={avatarClassName} />
				</div>
				{isOnline ? (
					<span className={`absolute circle-badge-br h-3 w-3 rounded-full border-[1.5px] border-[var(--bg)] shadow-sm z-10 ${isEndingSoon ? "bg-amber-500" : "bg-green-500"}`} />
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


/** Desktop grid tile, modelled on RightNowMapCard (photo on top,
 * avatar with session countdown ring, hosting tag) but kept light for a
 * dense grid: the whole tile opens the profile and messaging is a single icon
 * button instead of two full-width actions. */
function RightNowTile({
	item,
	onMessage,
	onSelect,
	onOpenPhoto,
}: {
	item: RightNowFeedItem;
	onMessage: (profileId: string) => void;
	onSelect: (profileId: string) => void;
	onOpenPhoto: (photos: string[], index: number, profileId: string) => void;
}) {
	const { t } = useTranslation();
	const { unitsPreset } = usePreferences();
	const { ref, revealClass } = useRevealOnScroll();
	const { rightNow: blurRightNowMedia } = useMediaBlur();
	const heroReveal = useBlurReveal(blurRightNowMedia);
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

	// As on the map card: a post photo becomes the hero and the avatar shows the
	// profile photo; without one, the profile photo fills the hero slot too.
	const heroSrc = photos[0] ?? null;
	// The name sits on the photo edge, so it needs white text over a scrim when there's one.
	const hasCover = heroSrc != null || avatarUrl != null;
	const headerAvatarUrl = heroSrc ? getRightNowProfileImageUrl(item) ?? avatarUrl : avatarUrl;
	const headerAvatarClassName = useAvatarPostMediaClass(item, headerAvatarUrl);
	const avatarClassName = useAvatarPostMediaClass(item, avatarUrl);
	const profilePhotoFullUrl =
		item.profileImageMediaHash && validateMediaHash(item.profileImageMediaHash)
			? getProfileImageUrl(item.profileImageMediaHash, "1024x1024")
			: null;

	return (
		<div
			ref={ref}
			className={cn(
				"group/reveal native-card relative flex h-full cursor-pointer flex-col overflow-hidden !rounded-3xl transition-transform hover:-translate-y-0.5",
				revealClass,
				// The reveal animation's `both` fill would keep filter: blur(0) on the
				// tile after it ends; lifting a filtered tile re-rasterizes it, which
				// blurs it and shows a seam at the photo's edge.
				"[animation-fill-mode:backwards]!",
			)}
			// Hover lift like the shared album cards; every tile here is Right Now,
			// so the browse grid's Right Now glow would carry no meaning.
			onClick={() => onSelect(item.profileId)}
		>
			{/* No --surface-2 fill behind the photo: while the hover lift lands on a
			    fractional pixel, the clipped bottom edge is antialiased and a lighter
			    fill shows through as a line. */}
			<div className="relative h-40 w-full shrink-0 overflow-hidden">
				<div className="absolute inset-0">
					{heroSrc ? (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								// A blurred photo is revealed by the first click, like chat media.
								if (heroReveal.revealOnTap(heroSrc)) return;
								onOpenPhoto(photos, 0, item.profileId);
							}}
							{...heroReveal.hoverProps(heroSrc)}
							className="block h-full w-full"
						>
							<img
								src={proxyMediaUrl(heroSrc)}
								alt=""
								className={cn("h-full w-full object-cover", PRIVACY_BLUR_TRANSITION_CLASS, heroReveal.isBlurred(heroSrc) && PRIVACY_BLUR_CLASS)}
								draggable={false}
							/>
						</button>
					) : avatarUrl ? (
						// Profile photo as the cover: opens full size in the viewer too.
						<button
							type="button"
							onClick={(e) => {
								if (!profilePhotoFullUrl) return;
								e.stopPropagation();
								onOpenPhoto([profilePhotoFullUrl], 0, item.profileId);
							}}
							className="block h-full w-full"
						>
							<ProfileImage src={avatarUrl} alt={name} className={avatarClassName} placeholder="silhouette" />
						</button>
					) : (
						// No photo at all: the map card's Right Now glow instead of a second
						// placeholder icon above the avatar's.
						<div
							aria-hidden="true"
							className="h-full w-full"
							style={{ background: "radial-gradient(ellipse 80% 90% at 50% 0%, color-mix(in srgb, var(--right-now) 28%, transparent), transparent)" }}
						/>
					)}
				</div>
				{/* Dark scrim behind the name, like the browse tiles' vignette; the photo
				    itself ends with a hard edge instead of fading into the card. */}
				{hasCover ? (
					<div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent" />
				) : null}
				{item.hosting ? (
					<span className="pointer-events-none absolute left-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--right-now)_85%,black)] px-2.5 py-1 text-[11px] font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,0.35)]">
						<HomeFilled className="h-3 w-3" />
						{t("right_now.hosting")}
					</span>
				) : null}
				{photos.length > 1 ? (
					<span className="pointer-events-none absolute bottom-12 right-3 z-10 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-md">
						+{photos.length - 1}
					</span>
				) : null}
			</div>

			<div className="relative -mt-7 flex flex-1 flex-col px-4 pb-4">
				{/* Centered on the edge between photo and content: name on the photo,
				    stats below it, avatar and message button straddling the edge. */}
				<div className="flex items-center gap-3">
					<div className="relative shrink-0">
						<div className="h-14 w-14 overflow-hidden rounded-full border border-[var(--bg)] bg-[var(--surface-2)] shadow-lg">
							<ProfileImage src={headerAvatarUrl} alt={name} className={headerAvatarClassName} />
						</div>
						{/* Session countdown ring, same as the map card and markers */}
						<svg className="pointer-events-none absolute -inset-[3px] h-[calc(100%+6px)] w-[calc(100%+6px)] -rotate-90 overflow-visible" viewBox="0 0 64 64" aria-hidden="true">
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
					</div>

					<div className="min-w-0 flex-1">
						<div className="flex min-w-0 items-center gap-1.5">
							<p className={cn("truncate text-base font-bold", hasCover ? "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" : "text-[var(--text)]")}>{name}</p>
							{item.isFavorite && <Star className="h-3.5 w-3.5 shrink-0 fill-current text-[var(--accent)]" />}
						</div>
						{/* Below the photo edge, beside the avatar; one line in every tile. */}
						<div className="mt-1 flex h-5 items-center gap-3 overflow-hidden whitespace-nowrap text-xs text-[var(--text-muted)]">
							{distance && distance !== "hidden" ? (
								<span className="inline-flex items-center gap-1">
									<Navigation className="h-3 w-3 fill-current" />
									{distance}
								</span>
							) : null}
							{minutesLeft != null ? (
								<span className="inline-flex items-center gap-1 tabular-nums">
									<Hourglass className="h-3 w-3" />
									{minutesLeft}m
								</span>
							) : null}
						</div>
					</div>

					{/* Neutral ink-tint fill like the sheet icon buttons; only the icon carries the Right Now color. */}
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onMessage(item.profileId);
						}}
						className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ink-tint-8 text-[var(--right-now)] transition active:scale-90 active:ink-tint-16 hover:ink-tint-12"
						aria-label={t("right_now.message_aria", { name: name || "" })}
					>
						<MessageSquare className="h-4 w-4" />
					</button>
				</div>
				{/* Always two lines tall, so every tile has the same layout. */}
				<p className="mt-3 line-clamp-2 h-11 text-sm leading-[22px] text-[var(--text)]">{item.text}</p>
			</div>
		</div>
	);
}

// Fades into the page background, so it doesn't read as a dark smudge in light mode.
const BOTTOM_SCRIM_GRADIENT =
	"linear-gradient(to top, color-mix(in srgb, var(--bg) 92%, transparent) 0%, color-mix(in srgb, var(--bg) 55%, transparent) 45%, transparent 100%)";

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
	const { rightNow: blurRightNowMedia } = useMediaBlur();
	const heroReveal = useBlurReveal(blurRightNowMedia);
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
	const headerAvatarClassName = useAvatarPostMediaClass(item, headerAvatarUrl);

	return (
		<div className="relative mx-auto max-w-xl overflow-hidden rounded-3xl border border-[color-mix(in_srgb,var(--border)_60%,transparent)] bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] shadow-[0_24px_48px_-12px_rgba(0,0,0,0.55),0_8px_16px_-6px_rgba(0,0,0,0.35)] backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4 duration-300">
			{/* Close, pinned to the card's corner (over the photo when there is one).
			    Positioned by a wrapper: SHEET_ICON_BUTTON_CLASS's ink-tint sets
			    position: relative, which would override an absolute on the button. */}
			<div className="absolute right-3 top-3 z-10">
				<button
					type="button"
					onClick={onClose}
					aria-label={t("common.close")}
					className={
						heroSrc
							? "inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition hover:bg-black/60"
							: SHEET_ICON_BUTTON_CLASS
					}
				>
					<X className="h-4 w-4" />
				</button>
			</div>

			{heroSrc ? (
				<button
					type="button"
					onClick={() => {
						// A blurred photo is revealed by the first tap, like chat media.
						if (heroReveal.revealOnTap(heroSrc)) return;
						onOpenPhoto(photos, 0, item.profileId);
					}}
					{...heroReveal.hoverProps(heroSrc)}
					className="relative block h-40 w-full overflow-hidden"
				>
					<img src={proxyMediaUrl(heroSrc)} alt="" className={cn("h-full w-full object-cover", PRIVACY_BLUR_TRANSITION_CLASS, heroReveal.isBlurred(heroSrc) && PRIVACY_BLUR_CLASS)} draggable={false} />
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
						<div className="h-14 w-14 overflow-hidden rounded-full border border-[var(--bg)] bg-[var(--surface-2)] shadow-lg">
							<ProfileImage src={headerAvatarUrl} alt={name} className={headerAvatarClassName} />
						</div>
						{/* Session countdown ring, same as the map markers */}
						{/* overflow-visible: an SVG clips to its box by default, which cut off the ring's glow. */}
						<svg className="pointer-events-none absolute -inset-[3px] h-[calc(100%+6px)] w-[calc(100%+6px)] -rotate-90 overflow-visible" viewBox="0 0 64 64" aria-hidden="true">
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
							{minutesLeft != null ? (
								<span className="inline-flex items-center gap-1 tabular-nums">
									<Hourglass className="h-3 w-3" />
									{minutesLeft}m
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
						className={sheetButtonClass("secondary")}
					>
						<UserRound className="h-4 w-4" />
						{t("chat.view_profile")}
					</button>
					<button
						type="button"
						onClick={() => onMessage(item.profileId)}
						className={cn(sheetButtonClass("primary"), "shadow-[0_4px_14px_color-mix(in_srgb,var(--right-now)_35%,transparent)]")}
						style={{ backgroundColor: "var(--right-now)", color: "white" }}
					>
						<MessageSquare className="h-4 w-4" />
						{t("profile_details.message")}
					</button>
				</div>
			</div>
		</div>
	);
}

function RightNowTileSkeleton() {
	return (
		<div className="native-card overflow-hidden !rounded-3xl">
			<div className="h-40 w-full animate-pulse bg-[var(--surface-2)]" />
			<div className="-mt-7 flex items-center gap-3 px-4">
				<div className="h-14 w-14 shrink-0 animate-pulse rounded-full border border-[var(--bg)] bg-[var(--surface-2)]" />
				<div className="flex flex-1 flex-col gap-2">
					<div className="h-3.5 w-2/3 animate-pulse rounded-full bg-[var(--surface-2)]" />
					<div className="h-2.5 w-1/3 animate-pulse rounded-full bg-[var(--border)]" />
				</div>
			</div>
			<div className="mx-4 mb-4 mt-3 h-11" />
		</div>
	);
}

function RightNowSkeleton() {
	return (
		<div className="flex items-center gap-4 border-b border-[var(--surface-2)] py-3 pl-4 pr-4">
			<div className="h-15 w-15 shrink-0 rounded-full overflow-hidden animate-pulse bg-[var(--surface-2)]" />
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
	// Desktop shows the feed as a tile grid instead of rows.
	const isDesktop = useDesktopBreakpoint();
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
	const mapFitKey = useMemo(() => JSON.stringify([queryParams, geohash]), [queryParams, geohash]);
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
	// The map runs on under the desktop nav rail; markers are framed beside it.
	const railWidth = isDesktop
		? parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-rail-width")) || 0
		: 0;
	const isMapCardOpen = isMapView && selectedMapItem !== null;
	const { fullWidth: navFullWidth } = useNavStyle();
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
				state: {
					returnTo: location.pathname,
					// On desktop the profile is a modal over Right Now — keep the page
					// rendered underneath (see App.tsx) so closing it doesn't reload it,
					// same as the inbox.
					...(isDesktop ? { backgroundLocation: location } : {}),
				},
			});
		},
		[isDesktop, navigate, location],
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

	const changeViewMode = useCallback((mode: RightNowViewMode) => {
		setViewMode(mode);
		setSelectedMapKey(null);
	}, []);

	const viewModeTabs: IconTabConfig<RightNowViewMode>[] = useMemo(
		() => [
			// Desktop shows the feed as a card grid, not a list.
			isDesktop
				? { key: "list", label: t("right_now.view_grid", { defaultValue: "Grid" }), icon: LayoutGridFilled }
				: { key: "list", label: t("right_now.view_list", { defaultValue: "List" }), icon: ListIcon },
			{ key: "map", label: t("right_now.view_map", { defaultValue: "Map" }), icon: MapFilled },
		],
		[t, isDesktop],
	);

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
			className="right-now-scope app-screen flex h-dvh flex-col w-full !px-0 !pb-0 overflow-x-hidden"
			contentClassName="flex flex-1 flex-col min-h-0"
			style={{ overflow: "visible", overflowX: "hidden" }}
			onRefresh={async () => {
				sessionStorage.removeItem("rightnow-scroll");
				setHasRestoredScroll(true);
				feedContainerRef.current?.scrollTo(0, 0);
				// Awaited so the spinner stays until the feed is actually back.
				await refetch();
			}}
			isDisabled={isLoading || isMapView}
			isAtTop={() => (feedContainerRef.current?.scrollTop ?? 0) <= 0}
			refreshingLabel={t("right_now.refreshing")}
			spinnerColor="var(--right-now)"
			spinnerIconColor="white"
		>
			<header ref={headerRef} className="relative z-20 grid gap-3 pointer-events-none">
				<PageHeaderBackground color="var(--right-now)" />
				{/* Only the controls take clicks: the map runs on behind the whole header,
				    so its markers stay clickable around the title and pills. */}
				<div className="grid gap-3 mx-auto w-full max-w-4xl rail:max-w-none px-[var(--app-px)]">
					<h1 className="app-title">{t("right_now.title")}</h1>

					<div className="flex flex-wrap items-center gap-2 pb-4 [&>*]:pointer-events-auto">
						{isMapAvailable && (
							// Same segmented control as the Interest tabs, in Right Now color.
							<IconTabs
								activeTab={isMapView ? "map" : "list"}
								tabs={viewModeTabs}
								onTabClick={changeViewMode}
								color="var(--right-now)"
								contrastColor="white"
							/>
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
					// Full bleed, running up behind the header and, on desktop, on under
					// the (unfilled) nav rail instead of being cut off at its edge.
					className="relative flex-1 min-h-0 rail:-ml-[var(--nav-rail-width)]"
					style={{ marginTop: -headerBottom }}
				>
					<RightNowMap
						items={mapItems}
						selectedKey={selectedMapItem ? selectedMapKey : null}
						onSelectKey={setSelectedMapKey}
						fitKey={mapFitKey}
						topInset={headerBottom}
						leftInset={railWidth}
						recenterRef={mapRecenterRef}
					/>

					{/* Keeps the rail's tabs readable over the map, like the mobile nav bar's fade. */}
					<div
						aria-hidden="true"
						className="pointer-events-none absolute inset-y-0 left-0 z-10 hidden w-[calc(var(--nav-rail-width)+4rem)] rail:block"
						style={{ background: "linear-gradient(to right, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.75) 55%, transparent 100%)" }}
					/>
					{/* The page's bottom scrim behind the action pill, here inside the map so it
					    spans the full bleed (under the rail too) instead of starting at the rail. */}
					<div
						aria-hidden="true"
						className="pointer-events-none absolute inset-x-0 bottom-0 z-10 hidden h-36 rail:block"
						style={{ background: BOTTOM_SCRIM_GRADIENT }}
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
						<div
							className={cn(
								// Desktop: centered in the part of the map beside the rail.
								"absolute inset-x-0 z-20 px-3 rail:pl-[calc(var(--nav-rail-width)+0.75rem)]",
								// Clear of the nav bar, a bit more room above the floating one.
								navFullWidth
									? "bottom-[calc(var(--nav-height,env(safe-area-inset-bottom,0px))+0.75rem)]"
									: "bottom-[calc(var(--nav-height,env(safe-area-inset-bottom,0px))+1rem)]",
							)}
						>
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
				{isLoading && isDesktop ? (
					<div className="grid grid-cols-[repeat(auto-fill,minmax(max(300px,calc((100%-4*0.75rem)/5)),1fr))] gap-3 px-[var(--app-px)] pb-[calc(env(safe-area-inset-bottom,0px)+120px)] rail:pb-[calc(var(--page-bottom)+4rem)]">
						{Array.from({ length: 12 }).map((_, i) => (
							<RightNowTileSkeleton key={i} />
						))}
					</div>
				) : isLoading ? (
					<div className="mx-auto max-w-4xl divide-y divide-[var(--surface-2)] pb-[calc(env(safe-area-inset-bottom,0px)+120px)] rail:pb-[calc(var(--page-bottom)+4rem)]">
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
				) : isDesktop ? (
					<div className="grid grid-cols-[repeat(auto-fill,minmax(max(300px,calc((100%-4*0.75rem)/5)),1fr))] gap-3 px-[var(--app-px)] pb-[calc(env(safe-area-inset-bottom,0px)+120px)] rail:pb-[calc(var(--page-bottom)+4rem)]">
						{items.map((item) => (
							<RightNowTile
								key={`${item.id}-${item.profileId}`}
								item={item}
								onMessage={handleMessage}
								onSelect={handleSelect}
								onOpenPhoto={openPhotoViewer}
							/>
						))}
					</div>
				) : (
					<div className="mx-auto max-w-4xl pb-[calc(env(safe-area-inset-bottom,0px)+120px)] rail:pb-[calc(var(--page-bottom)+4rem)]">
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

		{/* Desktop: darken the bottom edge behind the action pill, like a bottom
		    sheet's scrim, so the pill stands out from the feed scrolling under it. */}
		<div
			aria-hidden="true"
			// The map view draws its own, full-bleed one.
			className={cn("pointer-events-none fixed bottom-0 left-[var(--nav-rail-width,0px)] right-0 z-[55] hidden h-36", !isMapView && "rail:block")}
			style={{ background: BOTTOM_SCRIM_GRADIENT }}
		/>
		<div className="fixed left-[var(--nav-rail-width,0px)] right-0 bottom-[calc(var(--nav-height,env(safe-area-inset-bottom,0px))+0.75rem)] rail:bottom-[var(--page-bottom)] z-[60] pointer-events-none">
			<div className="relative mx-auto h-full w-full max-w-4xl rail:max-w-none px-4 md:px-10">
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
						// Mobile: round button above the bottom nav, thumb-reachable; desktop: a
						// labelled pill centered at the bottom.
						"absolute bottom-0 right-[16%] translate-x-1/2 rail:right-1/2 transition-opacity duration-300 pointer-events-auto",
						(isPosting || isFiltersOpen || isMapCardOpen) ? "pointer-events-none opacity-0" : "opacity-100",
					)}
				>
					{isDesktop ? (
						<RightNowPostPill
							onClick={handlePostClick}
							phase={fabPhase}
							onPhaseChange={setFabPhase}
							isEditMode={isSessionActive}
							expiresAt={activeRightNowExpiresAt ?? null}
							rightNowRemaining={rightNowRemaining}
							isTestMode={rightNowTestMode}
						/>
					) : (
						<RightNowPostFAB
							onClick={handlePostClick}
							phase={fabPhase}
							onPhaseChange={setFabPhase}
							isEditMode={isSessionActive}
							expiresAt={activeRightNowExpiresAt}
							rightNowRemaining={rightNowRemaining}
							isTestMode={rightNowTestMode}
						/>
					)}
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
