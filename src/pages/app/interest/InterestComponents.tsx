import { useLayoutEffect, useRef, useState, memo, type ComponentType } from "react";
import { Ban, History, MoveHorizontal, Check, RefreshCw, Star } from "lucide-react";
import { ClockFilled, EyeFilled, HomeFilled, LockFilled } from "../../../components/icons/FilledIcons";
import { useTranslation } from "react-i18next";
import { getThumbImageUrl } from "../../../utils/media";
import { ProfileImage } from "../../../components/ui/profile-image";
import { type InterestItem, type InterestTab, formatTimestamp, getTapEmoji, PREVIEW_ID_PREFIX } from "./interestUtils";
import { cn } from "../../../utils/cn";
import { isOnlineEndingSoon } from "../gridpage/utils";
import { useRevealOnScroll } from "../../../hooks/useRevealOnScroll";
import { RightNowIcon } from "../../../components/icons/RightNowIcon";
import { usePreferences } from "../../../contexts/PreferencesContext";
import type { BrowseCard } from "../GridPage.types";

export type InterestTabConfig = {
	key: InterestTab;
	label: string;
	icon: ComponentType<{ className?: string }>;
	/** Total shown next to the label while the tab is active; omitted = no count. */
	total?: number;
	/** New items since last seen — a dot on the icon while the tab is inactive. */
	unread?: number;
	/** Shows a spinner in place of the total while it refreshes. */
	isRefreshing?: boolean;
	/** Tooltip for the total. */
	totalTitle?: string;
};

/** Segmented control: the active tab expands into an accent pill with icon,
 * label and total; inactive tabs collapse to just their icon. */
export const InterestTabs = memo(function InterestTabs({
	activeTab,
	tabs,
	onTabClick,
}: {
	activeTab: InterestTab;
	tabs: InterestTabConfig[];
	onTabClick: (tab: InterestTab) => void;
}) {
	const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
	const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
	const [isReady, setIsReady] = useState(false);

	const totalsKey = tabs.map((tab) => `${tab.total ?? ""}:${tab.isRefreshing ? 1 : 0}`).join(",");

	// Index of the currently active tab in the visual array
	const activeIndex = Math.max(tabs.findIndex((tab) => tab.key === activeTab), 0);

	// Sync indicator with the active tab's position and size in real-time
	useLayoutEffect(() => {
		const activeEl = tabsRef.current[activeIndex];
		if (!activeEl) return;

		const updateIndicator = () => {
			setIndicatorStyle({
				left: activeEl.offsetLeft,
				width: activeEl.offsetWidth,
			});
		};

		// Initial measurement
		updateIndicator();

		// The active tab grows/shrinks as its label and total animate in, and
		// neighbouring tabs shift with it — keep the pill glued to it throughout.
		const resizeObserver = new ResizeObserver(() => {
			updateIndicator();
		});

		// border-box: padding changes must count too, not just the content box.
		resizeObserver.observe(activeEl, { box: "border-box" });

		if (!isReady) {
			requestAnimationFrame(() => {
				requestAnimationFrame(() => setIsReady(true));
			});
		}

		return () => resizeObserver.disconnect();
	}, [activeIndex, isReady, totalsKey]);

	return (
		<div className="glass-pill relative inline-flex items-center gap-0.5 p-1">
			{/*
				The Sliding Pill:
				- Transitions width and position based on the measured active tab.
				- This creates a natural "stretch" look as it moves.
			*/}
			<div
				className={cn(
					"absolute top-1 bottom-1 rounded-full bg-[var(--accent)] shadow-sm",
					isReady ? "transition-all duration-300 ease-out" : "transition-none"
				)}
				style={{
					width: indicatorStyle.width,
					left: indicatorStyle.left,
				}}
			/>

			{tabs.map((tab, i) => {
				const isActive = activeIndex === i;
				const Icon = tab.icon;
				const hasUnread = !isActive && (tab.unread ?? 0) > 0;
				return (
					<button
						key={tab.key}
						ref={(el) => { tabsRef.current[i] = el; }}
						type="button"
						onClick={() => onTabClick(tab.key)}
						aria-label={tab.label}
						aria-pressed={isActive}
						className={cn(
							// Only colour/scale animate: an animated padding would leave the pill measuring a
							// mid-transition width. The sliding pill itself carries the motion.
							"relative z-10 flex h-9 items-center justify-center rounded-full transition-[color,transform] duration-300 ease-out active:scale-95",
							isActive
								? "gap-2 pl-3.5 pr-1.5 text-[var(--accent-contrast)]"
								: "w-10 text-[var(--text-muted)] hover:text-[var(--text)]",
						)}
					>
						<span className="relative flex shrink-0">
							<Icon className="h-[1.15rem] w-[1.15rem]" />
							{hasUnread && (
								<span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[var(--accent)] ring-2 ring-[var(--surface)]" />
							)}
						</span>
						{isActive && (
							<>
								<span className="whitespace-nowrap text-sm font-bold">{tab.label}</span>
								{tab.total != null && (
									<span
										className="relative flex h-6 min-w-[1.75rem] items-center justify-center rounded-full bg-white/20 px-2 text-xs font-bold tabular-nums"
										title={tab.totalTitle}
									>
										<span className={cn("transition-opacity duration-300", tab.isRefreshing ? "opacity-0" : "opacity-100")}>
											{tab.total}
										</span>
										{tab.isRefreshing && (
											<RefreshCw className="absolute h-3 w-3 animate-spin" />
										)}
									</span>
								)}
							</>
						)}
						{!isActive && hasUnread && <span className="sr-only">{tab.unread}</span>}
					</button>
				);
			})}
		</div>
	);
});

const emojiColorMap: Record<number, string> = {
	0: "255, 200, 0", // 👋
	1: "255, 140, 0", // 🔥
	2: "168, 85, 247", // 😈
};

export const InterestRow = memo(function InterestRow({
	item,
	mode,
	onOpenProfile,
	now,
	isBlocked = false,
}: {
	item: InterestItem;
	mode: InterestTab;
	onOpenProfile: (profileId: string) => void;
	now: number;
	isBlocked?: boolean;
}) {
	const { t } = useTranslation();
	const { ref, revealClass } = useRevealOnScroll();
	const imageSrc = item.imageHash ? getThumbImageUrl(item.imageHash, "320x320") : null;

	const isPrivate = !item.canOpenProfile;
	const isLocked = isPrivate || isBlocked;
	const isRecovered = !!item.isFromCache && !isPrivate && !item.profileId.startsWith(PREVIEW_ID_PREFIX);
	const isOnline = typeof item.onlineUntil === "number" && item.onlineUntil > now;
	const isEndingSoon = isOnline && isOnlineEndingSoon(item.onlineUntil, now);

	const displayName = item.displayName
		? item.displayName
		: isPrivate
			? t("interest_page.unknown_profile")
			: t("common.unknown_display_name");

	return (
		<div
			ref={ref}
			className={cn(
				"relative flex items-center gap-4 border-b border-[var(--surface-2)] pl-4 pr-4 py-3 transition-colors",
				isLocked ? "opacity-75 grayscale-[0.3]" : "hover:bg-[var(--surface-2)]/40",
				revealClass
			)}
		>
			{/* Avatar */}
			<button
				type="button"
				onClick={() => !isLocked && onOpenProfile(item.profileId)}
				disabled={isLocked}
				className="relative shrink-0"
			>
				<div className="h-15 w-15 squircle drop-shadow-sm bg-[var(--surface-2)]">
					<ProfileImage
						src={imageSrc}
						alt={displayName}
					/>
				</div>
				{isOnline && (
					<span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-[1.5px] border-[var(--bg)] shadow-sm z-10 ${isEndingSoon ? "bg-amber-500" : "bg-green-500"}`} />
				)}
				{isLocked && (
					<div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text-muted)] ring-1 ring-[var(--surface)] z-10">
						{isPrivate ? <LockFilled className="h-3 w-3" /> : (
							<span title={t("interest_page.blocked_profile")}>
								<Ban className="h-3 w-3" />
							</span>
						)}
					</div>
				)}
			</button>

			{/* Info */}
			<div className="min-w-0 flex-1">
				<button
					type="button"
					onClick={() => !isLocked && onOpenProfile(item.profileId)}
					disabled={isLocked}
					className="w-full text-left"
				>
					<div className="flex items-center gap-1.5">
						<p className={`truncate text-sm font-bold ${isLocked ? "text-[var(--text-muted)]" : "text-[var(--text)]"}`}>
							{displayName}
						</p>
						{isRecovered && (
							<span title={t("interest_page.recovered_tooltip")}>
								<History className="h-3 w-3 text-[var(--accent)]" />
							</span>
						)}
						{item.rightNow === "HOSTING" && (
							<span title={t("right_now.hosting")}>
								<HomeFilled className="h-3.5 w-3.5 shrink-0 text-[var(--right-now)]" />
							</span>
						)}
						{item.rightNow === "NOT_HOSTING" && (
							<span title={t("right_now.not_hosting", { defaultValue: "Right Now" })}>
								<RightNowIcon className="h-3.5 w-3.5 shrink-0 text-[var(--right-now)]" />
							</span>
						)}
					</div>
					{/* Meta row styled like the Right Now list: time, then view count. */}
					<div className="mt-0.5 flex items-center gap-3 text-xs font-medium text-[var(--text-muted)]">
						<span className="flex min-w-0 items-center gap-1">
							<ClockFilled className="h-3 w-3 shrink-0" />
							<span className="truncate">{formatTimestamp(item.timestamp, t, now)}</span>
						</span>
						{mode === "views" && !isPrivate && (
							<span className="flex shrink-0 items-center gap-1">
								<EyeFilled className="h-3 w-3" />
								<span className="tabular-nums">{item.viewCount || 1}</span>
							</span>
						)}
					</div>
				</button>
			</div>

			{/* Action Area (Taps or Sent Taps); views show their count in the meta row. */}
			{!isPrivate && (mode === "taps" || mode === "sent") && (
				<div className="shrink-0 flex items-center justify-end h-12 w-12">
					<div className="relative flex h-12 w-12 items-center justify-center">
						<span
							className="text-2xl leading-none select-none"
							style={{
								filter: `drop-shadow(0 0 3px rgba(${emojiColorMap[item.tapType ?? -1] || "255, 200, 0"}, 0.55)) drop-shadow(0 0 7px rgba(${emojiColorMap[item.tapType ?? -1] || "255, 200, 0"}, 0.3))`,
							}}
						>
							{getTapEmoji(item.tapType)}
						</span>
						{mode === "taps" && item.isMutual && (
							<span
								className="absolute -bottom-0.5 -right-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full text-white shadow-md"
								style={{ backgroundColor: `rgb(${emojiColorMap[item.tapType ?? -1] || "255, 200, 0"})` }}
								title={t("interest_page.mutual_tap_tooltip")}
							>
								<MoveHorizontal className="h-2.5 w-2.5" />
							</span>
						)}
						{mode === "sent" && item.isRead && (
							<span
								className="absolute -bottom-0.5 -right-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full text-white shadow-md"
								style={{ backgroundColor: `rgb(${emojiColorMap[item.tapType ?? -1] || "255, 200, 0"})` }}
								title={t("interest_page.sent_read_tooltip")}
							>
								<Check className="h-2.5 w-2.5" />
							</span>
						)}
					</div>
				</div>
			)}
		</div>
	);
});

const TILE_ICON_SHADOW = "drop-shadow-[0_1px_1.5px_rgba(0,0,0,1)] drop-shadow-[0_0_0.8px_rgba(0,0,0,1)]";

/** Grid-style tile for the views tab, modelled on the browse grid's
 * BrowseCardTile: view count top-left, presence top-right, name and
 * time bottom-left, favorite bottom-right. `browseCard` is the profile as last
 * seen in the browse grid (if ever), which is the only source for age and
 * favorite since the views endpoint doesn't carry them. */
export const InterestViewTile = memo(function InterestViewTile({
	item,
	browseCard,
	onOpenProfile,
	now,
	isBlocked = false,
	isDesktop = false,
}: {
	item: InterestItem;
	browseCard?: BrowseCard;
	onOpenProfile: (profileId: string) => void;
	now: number;
	isBlocked?: boolean;
	isDesktop?: boolean;
}) {
	const { t } = useTranslation();
	const { blurGridProfilePictures } = usePreferences();
	const { ref, revealClass } = useRevealOnScroll();
	const imageSrc = item.imageHash ? getThumbImageUrl(item.imageHash, "320x320") : null;

	const isPrivate = !item.canOpenProfile;
	const isLocked = isPrivate || isBlocked;
	const isRecovered = !!item.isFromCache && !isPrivate && !item.profileId.startsWith(PREVIEW_ID_PREFIX);
	const onlineUntil = item.onlineUntil ?? browseCard?.onlineUntil ?? null;
	const isOnline = typeof onlineUntil === "number" && onlineUntil > now;
	const isEndingSoon = isOnline && isOnlineEndingSoon(onlineUntil, now);
	const rightNow = item.rightNow ?? browseCard?.rightNow ?? null;
	const isRightNow = rightNow === "HOSTING" || rightNow === "NOT_HOSTING";
	const age = !isPrivate && typeof browseCard?.age === "number" && browseCard.age > 0 ? browseCard.age : null;
	const isFavorite = !isPrivate && browseCard?.favorite === true;

	// Private viewers stay nameless — the blurred photo and lock say enough.
	const displayName = item.displayName
		? item.displayName
		: isPrivate
			? null
			: t("common.unknown_display_name");

	return (
		<div ref={ref} className={cn(!isDesktop && "bg-black rounded-[4px] overflow-hidden", revealClass)}>
			<button
				type="button"
				onClick={() => !isLocked && onOpenProfile(item.profileId)}
				disabled={isLocked}
				className={cn(
					"no-touch-callout touch-manipulation surface-card-grid relative block w-full overflow-hidden text-left transition-transform",
					!isLocked && "active:scale-95",
					isRightNow ? "p-[2px]" : "p-0",
					isDesktop ? "rounded-xl shadow-sm" : "rounded-[4px]",
				)}
			>
				{isRightNow && (
					<div
						className="absolute inset-0 z-0 rounded-[inherit] animate-pulse"
						style={{ background: "var(--right-now)", boxShadow: "0 0 8px 1px var(--right-now)" }}
					/>
				)}

				{/* h-0 pb-[100%] instead of aspect-ratio — see BrowseCardTile for why. */}
				<div className="relative z-10 h-0 w-full overflow-hidden rounded-[inherit] bg-[var(--surface-2)] pb-[100%] ring-1 ring-inset ring-white/10">
					<div className="absolute inset-0">
						<ProfileImage
							src={imageSrc}
							alt={displayName ?? ""}
							className={cn(
								blurGridProfilePictures ? "blur-md scale-110" : isLocked && "blur-[3px] scale-105",
							)}
						/>

						{/* Locked tiles: lightly blurred and darkened photo. */}
						{isLocked && (
							<div
								className="absolute inset-0 bg-black/30"
								title={isPrivate ? undefined : t("interest_page.blocked_profile")}
							/>
						)}

						<div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/70 via-black/25 to-transparent" />

						{/* Top-left: view count */}
						<span
							className="absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-bold text-white backdrop-blur-sm"
							title={t("interest_page.total_viewed_count")}
						>
							<EyeFilled className="h-3 w-3" />
							<span className="tabular-nums">{item.viewCount || 1}</span>
						</span>

						{/* Top-right: presence */}
						<div className="absolute right-2 top-2 z-10 flex h-5 items-center gap-1">
							{isRightNow && (
								<span className="inline-flex" title={rightNow === "HOSTING" ? t("right_now.hosting") : t("right_now.not_hosting", { defaultValue: "Right Now" })}>
									<RightNowIcon className={cn("h-4 w-4 text-[var(--right-now)]", TILE_ICON_SHADOW)} />
								</span>
							)}
							{isOnline && (
								<span className={cn("block h-3 w-3 rounded-full shadow-lg ring-2 ring-black/30", isEndingSoon ? "bg-amber-500" : "bg-green-500")} />
							)}
						</div>

						{/* Bottom: name + time on the left, favorite/recovered on the right */}
						<div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/75 via-black/30 to-transparent" />
						<div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-1 p-2 text-white">
							<div className="min-w-0 flex-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
								{displayName && (
									<p className="truncate text-sm font-bold leading-tight">
										{displayName}
										{age && <span className="ml-1 font-semibold text-white/90">{age}</span>}
									</p>
								)}
								<p className={cn("flex items-center gap-1 text-[11px] font-semibold text-white/80", displayName && "mt-0.5")}>
									<ClockFilled className="h-3 w-3 shrink-0" />
									<span className="truncate">{formatTimestamp(item.timestamp, t, now)}</span>
								</p>
							</div>
							{(isFavorite || isRecovered || isPrivate) && (
								<div className="flex shrink-0 items-center gap-1">
									{isFavorite && (
										<div className="flex h-5 w-5 items-center justify-center">
											<Star className={cn("h-3.5 w-3.5 fill-current text-yellow-500", TILE_ICON_SHADOW)} />
										</div>
									)}
									{/* Still-locked preview: neither the free unlocked viewer nor
										recovered via a browse-grid photo match. */}
									{isPrivate && (
										<div className="flex h-5 w-5 items-center justify-center">
											<LockFilled className={cn("h-3.5 w-3.5 text-white", TILE_ICON_SHADOW)} />
										</div>
									)}
									{isRecovered && (
										<div className="flex h-5 w-5 items-center justify-center" title={t("interest_page.recovered_tooltip")}>
											<History className={cn("h-3.5 w-3.5 text-[var(--accent)]", TILE_ICON_SHADOW)} strokeWidth={2.5} />
										</div>
									)}
								</div>
							)}
						</div>
					</div>
				</div>
			</button>
		</div>
	);
});
