import { memo } from "react";
import { Ban, History, MoveHorizontal, Check, Star, Navigation } from "lucide-react";
import { ClockFilled, EyeFilled, HomeFilled, LockFilled } from "../../../components/icons/FilledIcons";
import { useTranslation } from "react-i18next";
import { getThumbImageUrl } from "../../../utils/media";
import { ProfileImage } from "../../../components/ui/profile-image";
import { type InterestItem, type InterestTab, formatTimestamp, getTapEmoji, PREVIEW_ID_PREFIX } from "./interestUtils";
import { cn } from "../../../utils/cn";
import { formatDistance, isOnlineEndingSoon } from "../gridpage/utils";
import { useRevealOnScroll } from "../../../hooks/useRevealOnScroll";
import { RightNowIcon } from "../../../components/icons/RightNowIcon";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { TILE_HOVER_ZOOM_CLASS, useProfilePhotoPrivacy } from "../../../hooks/useProfilePhotoPrivacy";
import type { BrowseCard } from "../GridPage.types";
import { IconTabs, type IconTabConfig } from "../../../components/ui/icon-tabs";

export type InterestTabConfig = IconTabConfig<InterestTab>;

export const InterestTabs = memo(IconTabs<InterestTab>);

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
	const { unitsPreset } = usePreferences();
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
				"group/reveal relative flex items-center gap-4 border-b border-[var(--surface-2)] pl-4 pr-4 py-3 transition-colors",
				isLocked ? "opacity-75 grayscale-[0.3]" : "hover-fill/40",
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
				<div className="h-15 w-15 rounded-full overflow-hidden drop-shadow-sm bg-[var(--surface-2)]">
					<ProfileImage
						src={imageSrc}
						alt={displayName}
					/>
				</div>
				{isOnline && (
					<span className={`absolute circle-badge-br h-3 w-3 rounded-full border-[1.5px] border-[var(--bg)] shadow-sm z-10 ${isEndingSoon ? "bg-amber-500" : "bg-green-500"}`} />
				)}
				{isLocked && (
					<div className="absolute circle-badge-br flex h-5 w-5 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text-muted)] ring-1 ring-[var(--surface)] z-10">
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
					{/* Meta row styled like the Right Now list: time, then distance. */}
					<div className="mt-0.5 flex items-center gap-3 text-xs font-medium text-[var(--text-muted)]">
						<span className="flex min-w-0 items-center gap-1">
							<ClockFilled className="h-3 w-3 shrink-0" />
							<span className="truncate">{formatTimestamp(item.timestamp, t, now)}</span>
						</span>
						{mode === "taps" && item.distanceMeters != null && (
							<span className="flex shrink-0 items-center gap-1">
								<Navigation className="h-3 w-3 fill-current" />
								<span className="tabular-nums">{formatDistance(item.distanceMeters, t, unitsPreset)}</span>
							</span>
						)}
					</div>
				</button>
			</div>

			{/* Action Area: view count, or the tap emoji (Taps / Sent Taps). */}
			{!isPrivate && mode === "views" && (
				<div
					className="flex h-12 min-w-12 shrink-0 items-center justify-end gap-1 text-sm font-bold text-[var(--text-muted)]"
					title={t("interest_page.total_viewed_count")}
				>
					<EyeFilled className="h-4 w-4" />
					<span className="tabular-nums">{item.viewCount || 1}</span>
				</div>
			)}
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

/** Grid-style tile for the views tab (and, on desktop, taps/sent), modelled on
 * the browse grid's BrowseCardTile: view count or tap emoji top-left, presence
 * top-right, name and time (plus distance for taps) bottom-left, favorite
 * bottom-right. `browseCard` is the profile as last
 * seen in the browse grid (if ever), which is the only source for age and
 * favorite since the views endpoint doesn't carry them. */
export const InterestViewTile = memo(function InterestViewTile({
	item,
	browseCard,
	onOpenProfile,
	now,
	isBlocked = false,
	isDesktop = false,
	mode = "views",
}: {
	item: InterestItem;
	browseCard?: BrowseCard;
	onOpenProfile: (profileId: string) => void;
	now: number;
	isBlocked?: boolean;
	isDesktop?: boolean;
	mode?: InterestTab;
}) {
	const { t } = useTranslation();
	const { unitsPreset } = usePreferences();
	const tapColor = emojiColorMap[item.tapType ?? -1] || "255, 200, 0";
	const photoPrivacy = useProfilePhotoPrivacy("grid");
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
					"group/reveal no-touch-callout touch-manipulation surface-card-grid relative block w-full overflow-hidden text-left transition-transform",
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
							privacyScope="grid"
							placeholder="silhouette"
							className={cn(
								// Locked tiles keep their light blur, also while hovered.
								isLocked
									? (photoPrivacy === "blur" ? "hover:blur-[3px] hover:scale-105 group-hover/reveal:blur-[3px] group-hover/reveal:scale-105" : "blur-[3px] scale-105")
									: TILE_HOVER_ZOOM_CLASS,
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

						{/* Top-left: view count, or the tap emoji (with mutual / read mark) */}
						{mode === "views" ? (
							<span
								className="absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-bold text-white backdrop-blur-sm"
								title={t("interest_page.total_viewed_count")}
							>
								<EyeFilled className="h-3 w-3" />
								<span className="tabular-nums">{item.viewCount || 1}</span>
							</span>
						) : !isPrivate ? (
							<span className="absolute left-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
								<span
									className="select-none text-lg leading-none"
									style={{ filter: `drop-shadow(0 0 3px rgba(${tapColor}, 0.55))` }}
								>
									{getTapEmoji(item.tapType)}
								</span>
								{(mode === "taps" && item.isMutual) || (mode === "sent" && item.isRead) ? (
									<span
										className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-white shadow-md"
										style={{ backgroundColor: `rgb(${tapColor})` }}
										title={mode === "taps" ? t("interest_page.mutual_tap_tooltip") : t("interest_page.sent_read_tooltip")}
									>
										{mode === "taps" ? <MoveHorizontal className="h-2.5 w-2.5" /> : <Check className="h-2.5 w-2.5" />}
									</span>
								) : null}
							</span>
						) : null}

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
									{mode === "taps" && item.distanceMeters != null && (
										<span className="ml-1.5 flex shrink-0 items-center gap-1">
											<Navigation className="h-3 w-3 fill-current" />
											<span className="tabular-nums">{formatDistance(item.distanceMeters, t, unitsPreset)}</span>
										</span>
									)}
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
