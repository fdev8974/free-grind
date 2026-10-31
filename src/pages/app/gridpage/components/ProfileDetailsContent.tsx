import {
	Pencil,
	Compass,
	ExternalLink,
	Globe,
	Hash,
	Heart,
	MessageCircle,
	MessageSquare,
	Music,
	Plane,
	Ruler,
	Scale,
	Search,
	Shield,
	Sparkles,
	Syringe,
	MapPin,
	User,
	ShieldCheck,
	Flame,
	Calendar,
} from "lucide-react";
import { HomeFilled, MapPinFilled } from "../../../../components/icons/FilledIcons";
import { FacebookIcon, InstagramIcon, XIcon } from "../../../../components/icons/BrandIcons";
import { type ReactNode, type RefObject, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import type { ProfileDetail } from "../../GridPage.types";
import type { TravelPlan } from "../../../../types/travel";
import {
	formatDistance,
	formatEnumArray,
	formatEnumValue,
	formatHeightCm,
	formatTimeAgo,
	formatWeightKg,
	shouldHideField,
} from "../utils";
import { reverseGeocodeCityDistrictForGeohash } from "../geocoding";
import { getProfileImageUrl, getThumbImageUrl } from "../../../../utils/media";
import { resolveAvatarSrc } from "../../../../services/avatarStore";
import { ProfileImage } from "../../../../components/ui/profile-image";
import { Chip } from "../../../../components/ui/chip";
import { RightNowIcon } from "../../../../components/icons/RightNowIcon";
import { TapSelector } from "./TapSelector";
import { setCarouselDrag, useCarouselSwipe } from "./useCarouselSwipe";
import type { ChatContactIndexRecord } from "../../../../types/chat-contact-index";
import { formatRelativeTime } from "../../../../utils/relativeTime";
import { usePreferences } from "../../../../contexts/PreferencesContext";
import { formatTravelDateRange } from "../utils";
import { decodeGeohash } from "../../../../utils/geohash";
import { appLog } from "../../../../utils/logger";
import { SEXUAL_POSITION_ICONS } from "../../profile-option-builders";
import { isIos } from "../../../../services/saveMedia";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useProfileSpotifyFavorites } from "../../../../hooks/queries/useProfileQueries";
import { proxyMediaUrl } from "../../../../utils/mediaProxy";
import { haptic } from "../../../../utils/haptics";
import { PRIVACY_BLUR_CLASS, PRIVACY_BLUR_TRANSITION_CLASS, useProfilePhotoPrivacy } from "../../../../hooks/useProfilePhotoPrivacy";
import { useBlurReveal } from "../../../../hooks/useBlurReveal";

type LabelMap = Record<number, string>;

// Profile-written text (About, Right Now): shown in full, line breaks kept,
// long words/links wrapped instead of running off the card.

const PROFILE_TEXT_CLASS =
	"whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--text)] [overflow-wrap:anywhere] select-text";

function TravelPlanRow({
	plan,
	t,
	isDesktopLike,
}: {
	plan: TravelPlan;
	t: ReturnType<typeof useTranslation>["t"];
	isDesktopLike: boolean;
}) {
	const [location, setLocation] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void reverseGeocodeCityDistrictForGeohash(plan.geohash).then((label) => {
			if (!cancelled) {
				setLocation(label);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [plan.geohash]);

	const handleOpenMaps = () => {
		const decoded = decodeGeohash(plan.geohash);
		const lat = (decoded.lat[0] + decoded.lat[1]) / 2;
		const lon = (decoded.lon[0] + decoded.lon[1]) / 2;
		const url = isDesktopLike
			? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
			: isIos()
			? `https://maps.apple.com/?ll=${lat},${lon}&q=${lat},${lon}`
			: `geo:${lat},${lon}?q=${lat},${lon}`;
		openUrl(url).catch((error) => {
			appLog.error("Failed to open map URL", error);
			window.open(url, "_blank");
		});
	};

	return (
		<button
			type="button"
			onClick={handleOpenMaps}
			className="flex w-full items-start gap-2.5 text-left transition hover:opacity-80"
		>
			<Plane className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
			<div className="min-w-0">
				<p className="text-sm text-[var(--text)]">
					{location ?? t("profile_details.travel_resolving_location")}
				</p>
				<p className="text-xs text-[var(--text-muted)]">
					{formatTravelDateRange(plan.startDate, plan.endDate)}
				</p>
				{plan.notes?.trim() && (
					<p className="mt-1 text-sm italic text-[var(--text-muted)]">{plan.notes.trim()}</p>
				)}
			</div>
		</button>
	);
}

type ProfileDetailsContentProps = {
	activeProfile: ProfileDetail;
	activeProfilePhotoHashes: string[];
	isDesktopLike: boolean;
	showMobileCarousel: boolean;
	mobileCarouselRef: RefObject<HTMLDivElement | null>;
	mobileCarouselPhotoIndex: number;
	onPhotoIndexChange?: (index: number) => void;
	openPhotoViewer: (index: number) => void;
	activeProfileName: string;
	estimatedCreatedAt: string;
	travelPlans?: TravelPlan[];
	profileStatusLabel: string;
	profileStatusLevel: "online" | "ending_soon" | "recent" | "offline";
	ownTags?: string[];
	profileDistance: number | null;
	chatContactStatus: ChatContactIndexRecord | null;
	messageProfileId: string | null;
	onMessageProfile?: (profileId: string) => void;
	onTapProfile?: (profileId: string, tapId?: number) => void;
	onTagClick?: (tag: string) => void;
	isTapDisabled: boolean;
	isTapBlocked: boolean;
	isTapActive: boolean;
	tapId: number;
	tapButtonClassName: string;
	hasTagsContent: boolean;
	hasAboutContent: boolean;
	hasExpectationsFields: boolean;
	hasHealthFields: boolean;
	hasStatsFields: boolean;
	hasSocialFields: boolean;
	formattedActiveGenders: string;
	formattedActivePronouns: string;
	lookingForLabels: LabelMap;
	meetAtLabels: LabelMap;
	nsfwLabels: LabelMap;
	tribeLabels: LabelMap;
	hivStatusLabels: LabelMap;
	sexualHealthLabels: LabelMap;
	vaccineLabels: LabelMap;
	sexualPositionLabels: LabelMap;
	bodyTypeLabels: LabelMap;
	ethnicityLabels: LabelMap;
	relationshipStatusLabels: LabelMap;
	extraTopSection?: ReactNode;
	hidePicturesSection?: boolean;
	/** Display-only copy (e.g. a swipe preview): skips its own data fetches. */
	isPreview?: boolean;
	/** The content sits on a native card (the desktop modal) rather than the page. */
	isOnCard?: boolean;
	isChatLinkedProfile?: boolean;
};

export function ProfileDetailsContent({
	activeProfile,
	activeProfilePhotoHashes,
	isDesktopLike,
	showMobileCarousel,
	mobileCarouselRef,
	mobileCarouselPhotoIndex,
	onPhotoIndexChange,
	openPhotoViewer,
	activeProfileName,
	estimatedCreatedAt,
	travelPlans,
	profileStatusLabel,
	profileStatusLevel,
	ownTags = [],
	profileDistance,
	chatContactStatus,
	messageProfileId,
	onMessageProfile,
	onTapProfile,
	onTagClick,
	isTapDisabled,
	isTapBlocked,
	isTapActive,
	tapId,
	tapButtonClassName,
	hasTagsContent,
	hasAboutContent,
	hasExpectationsFields,
	hasHealthFields,
	hasStatsFields,
	hasSocialFields,
	formattedActiveGenders,
	formattedActivePronouns,
	lookingForLabels,
	meetAtLabels,
	nsfwLabels,
	tribeLabels,
	hivStatusLabels,
	sexualHealthLabels,
	vaccineLabels,
	sexualPositionLabels,
	bodyTypeLabels,
	ethnicityLabels,
	relationshipStatusLabels,
	extraTopSection,
	hidePicturesSection = false,
	isPreview = false,
	isOnCard = false,
	isChatLinkedProfile = false,
}: ProfileDetailsContentProps) {
	const { t, i18n } = useTranslation();
	// Only chat partners get their photos locally cached (see avatarStore.ts) —
	// ordinary Grid/Browse viewing stays uncached to avoid storing every photo
	// of every profile a user swipes past.
	const photoSrc = (hash: string, size: "1024x1024" | "320x320") => {
		const url = size === "1024x1024" ? getProfileImageUrl(hash, size) : getThumbImageUrl(hash, size);
		return proxyMediaUrl(resolveAvatarSrc(hash, url, { cache: isChatLinkedProfile, sourceUrl: url }) ?? url);
	};
	const { unitsPreset } = usePreferences();
	// Safe-for-work mode shows the default-profile placeholder instead of the photos.
	const photoPrivacy = useProfilePhotoPrivacy();
	const visiblePhotoHashes = photoPrivacy === "hide" ? [] : activeProfilePhotoHashes;
	// Blurred photos: the first tap unblurs one, the next opens it (like chat media).
	const photoReveal = useBlurReveal(photoPrivacy === "blur");
	const photoTapProps = (hash: string, index: number) => ({
		onClick: () => {
			if (photoReveal.revealOnTap(hash)) return;
			openPhotoViewer(index);
		},
		...photoReveal.hoverProps(hash),
	});
	const { data: spotifyFavorites } = useProfileSpotifyFavorites(activeProfile.profileId, !isPreview);
	const favoriteSongs = spotifyFavorites ?? [];
	const hasChatHistory = Boolean(chatContactStatus?.hasChatted) || (chatContactStatus?.unreadCount ?? 0) > 0;
	const lastMessageLabel = formatRelativeTime(chatContactStatus?.lastMessageTimestamp ?? null);
	const visibleTravelPlans = useMemo(
		() => (travelPlans ?? []).filter((plan) => plan.showOnProfile && plan.endDate >= Date.now()),
		[travelPlans],
	);
	const hasTravelPlans = visibleTravelPlans.length > 0;
	const rightNowTextTrimmed = activeProfile.rightNowText?.trim();
	// rightNowText disappears from the live profile response once the person
	// goes offline, but rightNowPosted (the post's own timestamp) stays put
	// as long as the post itself hasn't expired — that's the actual signal
	// for "does this profile currently have an active Right Now", independent
	// of online/offline status.
	const hasRightNow =
		typeof activeProfile.rightNowPosted === "number" &&
		Number.isFinite(activeProfile.rightNowPosted) &&
		activeProfile.rightNowPosted > 0;
	// The detail block below (header + text box) needs actual text to show —
	// unlike the compact badge next to the name, which only needs an active
	// post (rightNowPosted) and would otherwise render an empty box.
	const hasRightNowDetail = hasRightNow && Boolean(rightNowTextTrimmed);
	const isRightNowHosting = activeProfile.rightNow === "HOSTING";
	const socialNetworks = activeProfile.socialNetworks;
	const socialLinks = [
		{ key: "instagram", handle: socialNetworks?.instagram?.userId, url: `https://instagram.com/${socialNetworks?.instagram?.userId}`, icon: InstagramIcon },
		{ key: "twitter", handle: socialNetworks?.twitter?.userId, url: `https://x.com/${socialNetworks?.twitter?.userId}`, icon: XIcon },
		{ key: "facebook", handle: socialNetworks?.facebook?.userId, url: `https://facebook.com/${socialNetworks?.facebook?.userId}`, icon: FacebookIcon },
	].filter((link): link is typeof link & { handle: string } => Boolean(link.handle));
	const rightNowPostedLabel = hasRightNow ? formatRelativeTime(activeProfile.rightNowPosted ?? null) : null;

	const renderPhotoCreatedBadge = (_hash: string) => null;

	const [tapBurst, setTapBurst] = useState<{ key: number; emoji: string } | null>(null);

	const handleTapWithBurst = (profileId: string, tapIdArg?: number) => {
		const id = tapIdArg ?? 1;
		const emojis: Record<number, string> = { 0: "👋", 1: "🔥", 2: "😈" };
		setTapBurst({ key: Date.now(), emoji: emojis[id] ?? "🔥" });
		onTapProfile?.(profileId, id);
	};
	useEffect(() => {
		const el = mobileCarouselRef.current;
		if (el) setCarouselDrag(el, null);
	}, [activeProfile?.profileId]); // eslint-disable-line react-hooks/exhaustive-deps

	useCarouselSwipe(mobileCarouselRef, {
		enabled: showMobileCarousel && !isDesktopLike,
		count: activeProfilePhotoHashes.length,
		index: mobileCarouselPhotoIndex,
		onIndexChange: onPhotoIndexChange,
	});

	const PositionIcon = activeProfile?.sexualPosition != null
		? (SEXUAL_POSITION_ICONS[activeProfile.sexualPosition] ?? Compass)
		: null;


	return (
		<div className="grid gap-8 @container">
			{tapBurst && (
				<div key={tapBurst.key} className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden>
					<span className="absolute left-1/2 top-1/2 text-7xl animate-tap-burst">
						{tapBurst.emoji}
					</span>
				</div>
			)}
			{!hidePicturesSection && (visiblePhotoHashes.length > 0 || !isDesktopLike) && (
			<div>
				{visiblePhotoHashes.length > 0 ? (
					<>
						{showMobileCarousel && !isDesktopLike ? (
							<>
								<div className="relative sm:hidden -mx-[var(--app-px)]">
									<div
										ref={mobileCarouselRef}
										className="relative h-[min(78dvh,calc(100vw*1.55))] overflow-hidden"
									>
										{visiblePhotoHashes.map((hash, index) => (
											<div
												key={hash}
												style={{
													transform: `translateY(calc(${(index - mobileCarouselPhotoIndex) * 100}% + var(--carousel-drag, 0px)))`,
													transition: "var(--carousel-transition, transform 300ms ease-out)",
												}}
												className="absolute inset-0 overflow-hidden"
											>
												<button
													type="button"
													{...photoTapProps(hash, index)}
													className="absolute inset-0 z-10"
													aria-label={t("profile_details.open_photo", { index: index + 1 })}
												/>
												<img
													src={photoSrc(hash, "1024x1024")}
													alt={t("profile_details.photo_alt", { name: activeProfileName })}
													className={`h-full w-full object-cover ${PRIVACY_BLUR_TRANSITION_CLASS} ${photoReveal.isBlurred(hash) ? PRIVACY_BLUR_CLASS : ""}`}
												/>
												{renderPhotoCreatedBadge(hash)}
											</div>
										))}
										<div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-36 bg-gradient-to-b from-black/65 to-transparent" />
									</div>
									{visiblePhotoHashes.length > 1 && (
										<div className="absolute right-3 inset-y-0 z-20 flex flex-col items-center justify-center">
											<div className="flex flex-col items-center gap-1.5 rounded-full bg-black/30 px-[5px] py-[10px] backdrop-blur-sm">
												{visiblePhotoHashes.map((hash, index) => (
													<button
														key={`${hash}-dot`}
														type="button"
														onClick={() => {
															onPhotoIndexChange?.(index);
														}}
														className="flex items-center justify-center p-1.5 -m-1.5"
														aria-label={t("profile_details.open_photo", { index: index + 1 })}
													>
														<span
															className={`w-1.5 rounded-full transition-[height,background-color] duration-300 ease-out ${index === mobileCarouselPhotoIndex ? "h-3 bg-white" : "h-1.5 bg-white/40"}`}
														/>
													</button>
												))}
											</div>
										</div>
									)}
								</div>

								<div className="hidden grid-cols-3 gap-2 sm:grid sm:grid-cols-4 @3xl:grid-cols-6">
									{visiblePhotoHashes.map((hash, index) => (
										<button
											type="button"
											key={hash}
											{...photoTapProps(hash, index)}
											className="overflow-hidden rounded-xl border border-[var(--border)]"
											aria-label={t("profile_details.open_photo", { index: index + 1 })}
										>
											<div className="relative">
												<img
													src={photoSrc(hash, "320x320")}
													alt={t("profile_details.photo_alt", { name: activeProfileName })}
													className={`aspect-square w-full object-cover ${PRIVACY_BLUR_TRANSITION_CLASS} ${photoReveal.isBlurred(hash) ? PRIVACY_BLUR_CLASS : ""}`}
												/>
												{renderPhotoCreatedBadge(hash)}
											</div>
										</button>
									))}
								</div>
							</>
						) : (
							<div className="grid grid-cols-3 gap-2 sm:grid-cols-4 @3xl:grid-cols-6">
								{visiblePhotoHashes.map((hash, index) => (
									<button
										type="button"
										key={hash}
										{...photoTapProps(hash, index)}
										className="overflow-hidden rounded-xl border border-[var(--border)]"
										aria-label={t("profile_details.open_photo", { index: index + 1 })}
									>
										<div className="relative">
											<img
												src={photoSrc(hash, "320x320")}
												alt={t("profile_details.photo_alt", { name: activeProfileName })}
												className={`aspect-square w-full object-cover ${PRIVACY_BLUR_TRANSITION_CLASS} ${photoReveal.isBlurred(hash) ? PRIVACY_BLUR_CLASS : ""}`}
											/>
											{renderPhotoCreatedBadge(hash)}
										</div>
									</button>
								))}
							</div>
						)}
					</>
				) : (
					<>
						{showMobileCarousel && !isDesktopLike ? (
							<div className="relative sm:hidden -mx-[var(--app-px)]">
								<div className="relative h-[min(78dvh,calc(100vw*1.55))] overflow-hidden">
									<ProfileImage
										alt={t("profile_details.default_profile")}
										className="h-full w-full object-cover"
									/>
								</div>
						</div>
						) : null}
						{!isDesktopLike && (
							<div className={`${showMobileCarousel ? "hidden sm:block" : ""} overflow-hidden rounded-xl border border-[var(--border)]`}>
								<ProfileImage
									alt={t("profile_details.default_profile")}
									className="aspect-square w-full object-cover"
								/>
							</div>
						)}
					</>
				)}
			</div>
			)}

			<div className="px-3">
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0 flex-1">
						<h2 className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
							{activeProfileName}
							{activeProfile.age && Number.isFinite(activeProfile.age) && (
								<span className="ml-2 text-xl font-normal text-[var(--text-muted)] sm:text-2xl">
									{activeProfile.age}
								</span>
							)}
						</h2>
						<div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--text-muted)]">
							{profileStatusLabel && (
								<span className="flex items-center gap-1.5">
									<span className={`h-2 w-2 rounded-full ${
										profileStatusLevel === "online" ? "bg-emerald-400"
										: profileStatusLevel === "ending_soon" ? "bg-amber-400"
										: "bg-[var(--text-muted)]/40"
									}`} />
									{profileStatusLabel}
								</span>
							)}
							{hasRightNow && (
								<span className="flex items-center gap-1 font-semibold" style={{ color: "var(--right-now)" }}>
									{isRightNowHosting ? (
										<>
											<HomeFilled className="h-3.5 w-3.5" />
											{t("right_now.hosting")}
										</>
									) : (
										<>
											<RightNowIcon className="h-3.5 w-3.5" />
											{t("profile_details.right_now")}
										</>
									)}
								</span>
							)}
							{profileDistance !== undefined && profileDistance !== null && (
								<span className="flex items-center gap-1">
									<MapPinFilled className="h-3.5 w-3.5" />
									{formatDistance(profileDistance, t, unitsPreset)}
								</span>
							)}
							{activeProfile.isNew && (
								<span className="flex items-center gap-1 font-semibold text-[var(--accent)]">
									<Sparkles className="h-3.5 w-3.5 fill-current" />
									{t("profile_details.recently_joined")}
								</span>
							)}
						</div>
						{(PositionIcon != null && !shouldHideField(formatEnumValue(activeProfile.sexualPosition, sexualPositionLabels)) || !shouldHideField(formatHeightCm(activeProfile.height, t, unitsPreset)) || !shouldHideField(formatWeightKg(activeProfile.weight, t, unitsPreset)) || !shouldHideField(formatEnumValue(activeProfile.bodyType, bodyTypeLabels, t))) && (
							<div className="mt-1 flex items-center gap-x-3 text-sm text-[var(--text-muted)]">
								{PositionIcon != null && !shouldHideField(formatEnumValue(activeProfile.sexualPosition, sexualPositionLabels)) && (
									<span className="flex items-center gap-1">
										<PositionIcon className="h-3.5 w-3.5 -translate-x-px" />
										{formatEnumValue(activeProfile.sexualPosition, sexualPositionLabels, t)}
									</span>
								)}
								{!shouldHideField(formatHeightCm(activeProfile.height, t, unitsPreset)) && (
									<span className="flex items-center gap-1">
										<Ruler className="h-3.5 w-3.5" />
										{formatHeightCm(activeProfile.height, t, unitsPreset)}
									</span>
								)}
								{!shouldHideField(formatWeightKg(activeProfile.weight, t, unitsPreset)) && (
									<span className="flex items-center gap-1">
										<Scale className="h-3.5 w-3.5" />
										{formatWeightKg(activeProfile.weight, t, unitsPreset)}
									</span>
								)}
								{!shouldHideField(formatEnumValue(activeProfile.bodyType, bodyTypeLabels, t)) && (
									<span className="flex items-center gap-1">
										<User className="h-3.5 w-3.5" />
										{formatEnumValue(activeProfile.bodyType, bodyTypeLabels, t)}
									</span>
								)}
							</div>
						)}
					</div>
				</div>
				{hasChatHistory && (
					<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--text-muted)]">
						<span className="flex items-center gap-1">
							<MessageCircle className="h-3 w-3" />
							{lastMessageLabel
								? t("profile_details.last_message", { time: lastMessageLabel })
								: t("profile_details.chatted_before")
							}
						</span>
					</div>
				)}
				{isDesktopLike && messageProfileId && onMessageProfile ? (
					<div className="mt-3 flex items-center justify-center gap-4 py-1">
						<button
							type="button"
							onClick={() => {
								haptic(10);
								onMessageProfile(messageProfileId);
							}}
							className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)] shadow transition hover:bg-[var(--surface)]"
							aria-label={t("profile_details.message")}
						>
							<MessageCircle className="h-5 w-5" />
						</button>
						<TapSelector
							profileId={messageProfileId}
							onTapProfile={handleTapWithBurst}
							isTapDisabled={isTapDisabled}
							isTapBlocked={isTapBlocked}
							isTapActive={isTapActive}
							tapId={tapId}
							tapButtonClassName={tapButtonClassName}
						/>
					</div>
				) : null}
			</div>

			{extraTopSection}

			{(hasTagsContent || hasAboutContent || hasExpectationsFields || hasHealthFields || hasRightNowDetail || hasStatsFields || hasSocialFields || hasTravelPlans) && (
			<div className="grid gap-8 px-3">
				{(hasTagsContent || hasAboutContent || hasRightNowDetail || hasExpectationsFields || hasHealthFields) && (
				<div className="grid gap-8">
					{hasRightNowDetail && (
						<div>
							<p
								className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em]"
								style={{ color: "var(--right-now)" }}
							>
								{isRightNowHosting ? <HomeFilled className="h-3.5 w-3.5" /> : <RightNowIcon className="h-3.5 w-3.5" />}
								{isRightNowHosting ? t("right_now.hosting") : t("profile_details.right_now")}
								{rightNowPostedLabel && (
									<span className="font-medium normal-case tracking-normal text-[var(--text-muted)]">· {rightNowPostedLabel}</span>
								)}
							</p>
							{/* Same card as the About text, tinted in the Right Now color. */}
							<div
								className="rounded-2xl px-4 py-3"
								style={{ backgroundColor: "color-mix(in srgb, var(--right-now) 14%, var(--surface-2))" }}
							>
								<p className={PROFILE_TEXT_CLASS}>{rightNowTextTrimmed}</p>
							</div>
						</div>
					)}

					{hasTagsContent && (
						<div>
							<p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
								{t("profile_details.tags")}
							</p>
							<div className="flex flex-wrap gap-2">
								{activeProfile.profileTags.map((tag) => {
									const isMatch = ownTags.some(
										(own) => own.toLowerCase() === tag.toLowerCase(),
									);
									return (
										<Chip
											key={tag}
											size="sm"
											// The card color on the page; on a card that would vanish, so the tint.
											fill={isOnCard ? "tint" : "card"}
											selected={isMatch}
											onClick={() => onTagClick?.(tag)}
											className={onTagClick ? undefined : "cursor-default"}
										>
											{tag}
										</Chip>
									);
								})}
							</div>
						</div>
					)}

					{hasAboutContent && (
						<div>
							<p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
								{t("profile_details.about")}
							</p>
							{/* Native card (like SheetCard): no border, the full text as written. */}
							<div className="rounded-2xl bg-[var(--surface-2)] px-4 py-3">
								<p className={PROFILE_TEXT_CLASS}>{activeProfile.aboutMe?.trim()}</p>
							</div>
						</div>
					)}

					{hasExpectationsFields && (
						<div>
							<p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
								{t("profile_details.expectations")}
							</p>
							<div className="space-y-2.5">
								{!shouldHideField(formatEnumArray(activeProfile.lookingFor, lookingForLabels)) && (
									<div className="flex items-start gap-2.5">
										<Search className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
										<p className="text-sm">
											<span className="font-semibold text-[var(--text)]">{t("profile_details.looking_for")}:</span>{" "}
											<span className="text-[var(--text-muted)]">{formatEnumArray(activeProfile.lookingFor, lookingForLabels, t)}</span>
										</p>
									</div>
								)}
								{!shouldHideField(formatEnumArray(activeProfile.meetAt, meetAtLabels, t)) && (
									<div className="flex items-start gap-2.5">
										<MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
										<p className="text-sm">
											<span className="font-semibold text-[var(--text)]">{t("profile_details.meet_at")}:</span>{" "}
											<span className="text-[var(--text-muted)]">{formatEnumArray(activeProfile.meetAt, meetAtLabels, t)}</span>
										</p>
									</div>
								)}
								{activeProfile.nsfw != null && !shouldHideField(formatEnumValue(activeProfile.nsfw, nsfwLabels, t)) && (
									<div className="flex items-start gap-2.5">
										<Shield className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
										<p className="text-sm">
											<span className="font-semibold text-[var(--text)]">{t("profile_details.accept_nsfw")}:</span>{" "}
											<span className="text-[var(--text-muted)]">{formatEnumValue(activeProfile.nsfw, nsfwLabels, t)}</span>
										</p>
									</div>
								)}
								{!shouldHideField(formatEnumArray(activeProfile.grindrTribes, tribeLabels, t)) && (
									<div className="flex items-start gap-2.5">
										<Flame className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
										<p className="text-sm">
											<span className="font-semibold text-[var(--text)]">{t("profile_details.tribes")}:</span>{" "}
											<span className="text-[var(--text-muted)]">{formatEnumArray(activeProfile.grindrTribes, tribeLabels, t)}</span>
										</p>
									</div>
								)}
								{!shouldHideField(formatEnumArray(activeProfile.tribesImInto, tribeLabels, t)) && (
									<div className="flex items-start gap-2.5">
										<Flame className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
										<p className="text-sm">
											<span className="font-semibold text-[var(--text)]">{t("profile_details.tribes_im_into")}:</span>{" "}
											<span className="text-[var(--text-muted)]">{formatEnumArray(activeProfile.tribesImInto, tribeLabels, t)}</span>
										</p>
									</div>
								)}
								{!shouldHideField(formattedActiveGenders) && (
									<div className="flex items-start gap-2.5">
										<User className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
										<p className="text-sm">
											<span className="font-semibold text-[var(--text)]">{t("profile_details.genders")}:</span>{" "}
											<span className="text-[var(--text-muted)]">{formattedActiveGenders}</span>
										</p>
									</div>
								)}
								{!shouldHideField(formattedActivePronouns) && (
									<div className="flex items-start gap-2.5">
										<MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
										<p className="text-sm">
											<span className="font-semibold text-[var(--text)]">{t("profile_details.pronouns")}:</span>{" "}
											<span className="text-[var(--text-muted)]">{formattedActivePronouns}</span>
										</p>
									</div>
								)}
							</div>
						</div>
					)}

					{hasHealthFields && (
						<div>
							<p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
								{t("profile_details.health")}
							</p>
							<div className="space-y-2.5">
								{!shouldHideField(formatEnumValue(activeProfile.hivStatus, hivStatusLabels)) && (
									<div className="flex items-start gap-2.5">
										<Shield className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
										<p className="text-sm">
											<span className="font-semibold text-[var(--text)]">{t("profile_details.hiv_status")}:</span>{" "}
											<span className="text-[var(--text-muted)]">{formatEnumValue(activeProfile.hivStatus, hivStatusLabels, t)}</span>
										</p>
									</div>
								)}
								{activeProfile.lastTestedDate && (
									<div className="flex items-start gap-2.5">
										<Calendar className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
										<p className="text-sm">
											<span className="font-semibold text-[var(--text)]">{t("profile_details.last_tested")}:</span>{" "}
											<span className="text-[var(--text-muted)]">{formatTimeAgo(activeProfile.lastTestedDate, t)}</span>
										</p>
									</div>
								)}
								{!shouldHideField(formatEnumArray(activeProfile.sexualHealth, sexualHealthLabels, t)) && (
									<div className="flex items-start gap-2.5">
										<ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
										<p className="text-sm">
											<span className="font-semibold text-[var(--text)]">{t("profile_details.sexual_health")}:</span>{" "}
											<span className="text-[var(--text-muted)]">{formatEnumArray(activeProfile.sexualHealth, sexualHealthLabels, t)}</span>
										</p>
									</div>
								)}
								{!shouldHideField(formatEnumArray(activeProfile.vaccines, vaccineLabels, t)) && (
									<div className="flex items-start gap-2.5">
										<Syringe className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
										<p className="text-sm">
											<span className="font-semibold text-[var(--text)]">{t("profile_details.vaccines")}:</span>{" "}
											<span className="text-[var(--text-muted)]">{formatEnumArray(activeProfile.vaccines, vaccineLabels, t)}</span>
										</p>
									</div>
								)}
							</div>
						</div>
					)}
				</div>
				)}

				{(hasStatsFields || hasTravelPlans || hasSocialFields) && (
				<div className="grid gap-8">
					{hasStatsFields && (
						<div>
							<p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
								{t("profile_details.stats")}
							</p>
							<div className="space-y-2.5">
								{PositionIcon != null && !shouldHideField(formatEnumValue(activeProfile.sexualPosition, sexualPositionLabels)) && (
									<div className="flex items-center gap-2.5">
										<PositionIcon className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
										<p className="text-sm text-[var(--text-muted)]">{formatEnumValue(activeProfile.sexualPosition, sexualPositionLabels, t)}</p>
									</div>
								)}
								{!shouldHideField(formatHeightCm(activeProfile.height, t, unitsPreset)) && (
									<div className="flex items-center gap-2.5">
										<Ruler className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
										<p className="text-sm text-[var(--text-muted)]">{formatHeightCm(activeProfile.height, t, unitsPreset)}</p>
									</div>
								)}
								{!shouldHideField(formatWeightKg(activeProfile.weight, t, unitsPreset)) && (
									<div className="flex items-center gap-2.5">
										<Scale className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
										<p className="text-sm text-[var(--text-muted)]">{formatWeightKg(activeProfile.weight, t, unitsPreset)}</p>
									</div>
								)}
								{!shouldHideField(formatEnumValue(activeProfile.bodyType, bodyTypeLabels, t)) && (
									<div className="flex items-center gap-2.5">
										<User className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
										<p className="text-sm text-[var(--text-muted)]">{formatEnumValue(activeProfile.bodyType, bodyTypeLabels, t)}</p>
									</div>
								)}
								{!shouldHideField(formatEnumValue(activeProfile.ethnicity, ethnicityLabels, t)) && (
									<div className="flex items-center gap-2.5">
										<Globe className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
										<p className="text-sm text-[var(--text-muted)]">{formatEnumValue(activeProfile.ethnicity, ethnicityLabels, t)}</p>
									</div>
								)}
								{!shouldHideField(formatEnumValue(activeProfile.relationshipStatus, relationshipStatusLabels, t)) && (
									<div className="flex items-center gap-2.5">
										<Heart className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
										<p className="text-sm text-[var(--text-muted)]">{formatEnumValue(activeProfile.relationshipStatus, relationshipStatusLabels, t)}</p>
									</div>
								)}
							</div>
						</div>
					)}

					{hasTravelPlans && (
						<div>
							<p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
								{t("profile_details.travel_plans")}
							</p>
							<div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
								{visibleTravelPlans.map((plan) => (
									<TravelPlanRow key={plan.travelPlanId} plan={plan} t={t} isDesktopLike={isDesktopLike} />
								))}
							</div>
						</div>
					)}

					{hasSocialFields && (
						<div>
							<p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
								{t("profile_details.social")}
							</p>
							{/* One native list card (like the private notes): a row per network,
							    inset dividers, opened through the opener like the Spotify songs. */}
							<div className="overflow-hidden rounded-2xl bg-[var(--surface-2)]">
								{socialLinks.map((link, index) => (
									<div key={link.key}>
										{index > 0 && <div className="ml-11 h-px bg-[var(--border)]" />}
										<button
											type="button"
											onClick={() => {
												openUrl(link.url).catch((error) => appLog.error("Failed to open social link", error));
											}}
											className="flex min-h-12 w-full items-center gap-3 px-4 text-left transition active:bg-[var(--surface)]"
										>
											<link.icon className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
											<span className="min-w-0 flex-1 truncate text-[15px] text-[var(--text)]">{link.handle}</span>
											<ExternalLink className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
										</button>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
				)}
			</div>
			)}

			{favoriteSongs.length > 0 && (
				<div className="px-3">
					<p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
						{t("profile_details.spotify.title")}
					</p>
					<div className="grid grid-cols-5 gap-2">
						{favoriteSongs.map((song) => {
							const artistLabel = song.artists.join(", ");
							return (
								<button
									key={song.id}
									type="button"
									disabled={!song.externalUrl}
									onClick={() => {
										if (song.externalUrl) {
											void openUrl(song.externalUrl);
										}
									}}
									className="group min-w-0 text-left disabled:cursor-default"
								>
									<span className="relative block aspect-square w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-2)] transition group-hover:border-[var(--accent)] group-enabled:group-hover:shadow-lg">
										{song.albumImageUrl ? (
											<img
												src={song.albumImageUrl}
												alt=""
												loading="lazy"
												className="h-full w-full object-cover"
											/>
										) : (
											<span className="flex h-full w-full items-center justify-center bg-[var(--surface-3)]">
												<Music className="h-5 w-5 text-[var(--text-muted)]" />
											</span>
										)}
										{song.externalUrl && (
											<span className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 opacity-0 transition group-hover:opacity-100">
												<ExternalLink className="h-3 w-3 text-white" />
											</span>
										)}
									</span>
									<span className="mt-1 block truncate text-xs font-medium text-[var(--text)]">{song.name}</span>
									{artistLabel && (
										<span className="block truncate text-[10px] leading-tight text-[var(--text-muted)]">{artistLabel}</span>
									)}
								</button>
							);
						})}
					</div>
				</div>
			)}

			<div className="px-3">
				<p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
					{t("profile_details.account_info")}
				</p>
				<div className="space-y-2.5">
					<button
						type="button"
						onClick={async () => {
							try {
								await navigator.clipboard.writeText(String(activeProfile.profileId));
								haptic(10);
								toast.success(t("profile_details.profile_id_copied"));
							} catch (error) {
								appLog.error("Failed to copy profile ID to clipboard", error);
							}
						}}
						className="flex cursor-pointer items-center gap-2.5 text-left"
					>
						<Hash className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
						<p className="text-sm text-[var(--text-muted)] select-text">{activeProfile.profileId}</p>
					</button>
					<div className="flex items-center gap-2.5">
						<Calendar className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
						<p className="text-sm text-[var(--text-muted)]">{t("profile_details.estimated_joined", { date: estimatedCreatedAt })}</p>
					</div>
					{typeof activeProfile.lastUpdatedTime === "number" && activeProfile.lastUpdatedTime > 0 && (
						<div className="flex items-center gap-2.5">
							<Pencil className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
							<p className="text-sm text-[var(--text-muted)]">
								{t("profile_details.last_updated", { date: new Date(activeProfile.lastUpdatedTime).toLocaleDateString(i18n.language) })}
							</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}