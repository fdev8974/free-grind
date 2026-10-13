import { useLayoutEffect, useRef, useState, memo, type CSSProperties } from "react";
import { Eye, Lock, Ban, History, MoveHorizontal, Home, Zap, Check, RefreshCw, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getThumbImageUrl } from "../../../utils/media";
import { ProfileImage } from "../../../components/ui/profile-image";
import { type InterestItem, type InterestTab, formatTimestamp, getTapEmoji, PREVIEW_ID_PREFIX } from "./interestUtils";
import { cn } from "../../../utils/cn";
import { isOnlineEndingSoon } from "../gridpage/utils";
import { useRevealOnScroll } from "../../../hooks/useRevealOnScroll";

export type InterestTabConfig = {
	key: InterestTab;
	label: string;
	icon: LucideIcon;
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
						{isPrivate ? <Lock className="h-3 w-3" /> : (
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
								<Home className="h-3.5 w-3.5 shrink-0 text-[var(--right-now)]" />
							</span>
						)}
						{item.rightNow === "NOT_HOSTING" && (
							<span title={t("right_now.not_hosting", { defaultValue: "Right Now" })}>
								<Zap className="h-3.5 w-3.5 shrink-0 text-[var(--right-now)]" />
							</span>
						)}
					</div>
					<p className="mt-0.5 truncate text-xs text-[var(--text-muted)] font-medium">
						{formatTimestamp(item.timestamp, t, now)}
					</p>
				</button>
			</div>

			{/* Action Area (Views, Taps, or Sent Taps) */}
			{!isPrivate && (
				<div className="shrink-0 flex items-center justify-end h-12 w-12">
					{mode === "taps" || mode === "sent" ? (
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
					) : (
						<div
							className="glass-pill flex h-8 items-center gap-1.5 px-3"
							style={{ "--pill-color": "var(--text-muted)" } as CSSProperties}
						>
							<Eye className="h-3.5 w-3.5 text-[var(--text-muted)]" />
							<span className="text-xs font-bold leading-none tabular-nums text-[var(--text)]">
								{item.viewCount || 1}
							</span>
						</div>
					)}
				</div>
			)}
		</div>
	);
});
