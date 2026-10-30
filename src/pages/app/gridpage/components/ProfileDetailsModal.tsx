import { TapFlyBurst, TAP_FLY_BURST_MS, createTapFlyBurst, tapEmoji, tapGlow, type TapFlyBurstState } from "../../../../components/TapFlyBurst";
import { Album, Ban, ChevronDown, ChevronLeft, ChevronUp, EllipsisVertical, Flag, Flame, Images, Loader2, LockKeyhole, MessageCircle, Pencil, Phone, ShieldCheck, Star, Trash2, X } from "lucide-react";
import { BananaFilled, EyeFilled, HomeFilled, MapPinFilled, StickyNoteFilled, EyeOffFilled, LocateFixedFilled, PencilLineFilled, SendHorizontalFilled } from "../../../../components/icons/FilledIcons";
import { RightNowIcon } from "../../../../components/icons/RightNowIcon";
import toast from "react-hot-toast";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDesktopBreakpoint } from "../../../../hooks/useDesktopBreakpoint";
import { openUrl } from "@tauri-apps/plugin-opener";
import { appLog } from "../../../../utils/logger";
import { useTranslation } from "react-i18next";
import {
	createBackdropCloseHandler,
	useModalClose,
} from "../../../../hooks/useModalClose";
import { useTravelPlans } from "../../../../hooks/queries/useProfileQueries";
import type { TravelPlan } from "../../../../types/travel";
import { useApiFunctions } from "../../../../hooks/useApiFunctions";
import { useAuth } from "../../../../contexts/useAuth";
import { profileResponseSchema } from "../../profile-editor/profileEditorUtils";
import type {
	BrowseCard,
	ManagedOption,
	ProfileDetail,
} from "../../GridPage.types";
import {
	getBodyTypeLabelMap,
	getEthnicityLabelMap,
	getHivStatusLabelMap,
	getLookingForLabelMap,
	getMeetAtLabelMap,
	getNsfwLabelMap,
	getRelationshipStatusLabelMap,
	getSexualHealthLabelMap,
	getSexualPositionLabelMap,
	getTribeLabelMap,
	getVaccineLabelMap,
} from "../../profile-option-builders";
import { getProfileImageUrl, validateMediaHash } from "../../../../utils/media";
import { proxyMediaUrl } from "../../../../utils/mediaProxy";
import { resolveAvatarSrc } from "../../../../services/avatarStore";
import { getForbiddenWords, setForbiddenWords } from "../../../../utils/autoblock";
import { ProfileImage } from "../../../../components/ui/profile-image";
import { useProfilePhotoPrivacy } from "../../../../hooks/useProfilePhotoPrivacy";
import { useBlurReveal } from "../../../../hooks/useBlurReveal";
import { PromptDialog } from "../../../../components/ui/prompt-dialog";
import { ReportProfileDialog } from "../../../../components/ReportProfileDialog";
import freegrindLogo from "../../../../images/freegrind-logo.webp";
import { usePreferences } from "../../../../contexts/PreferencesContext";
import { formatDateTime24, formatTakenOnGrindrSentence } from "../../chat/chatUtils";
import { TakenOnGrindrBadge } from "../../chat/TakenOnGrindrBadge";
import { formatRelativeTime } from "../../../../utils/relativeTime";
import { useInterestData } from "../../../../hooks/queries/useInterestQueries";
import { getTapEmoji } from "../../interest/interestUtils";
import {
	formatEstimatedAccountCreation,
	formatDistance,
	formatEnumArray,
	formatEnumValue,
	formatHeightCm,
	formatWeightKg,
	getOnlineStatusMeta,
	getEnumLabel,
	shouldHideField,
} from "../utils";
import { ProfileDetailsContent } from "./ProfileDetailsContent";
import { OwnProfileEditPanel } from "../../profile-editor/OwnProfileEditPanel";
import { ConfirmDialog } from "../../../../components/ui/confirm-dialog";
import { setCachedProfileDetail } from "../cache";
import type { ChatContactIndexRecord } from "../../../../types/chat-contact-index";
import { PhotoViewer, type HeroRect, type PhotoViewerMenuAction } from "../../../../components/PhotoViewer";
import { PhotoActionBar } from "../../../../components/PhotoActionBar";
import { markAlbumContentReacted, useAlbumContentReactions } from "../../../../services/albumReactionStore";
import { AlbumMediaSheet } from "../../../../components/AlbumMediaSheet";
import { useProfileAlbumStatus } from "../../../../hooks/useProfileAlbumStatus";
import { captureAlbum, getLocalAlbum } from "../../../../services/albumStore";
import type { AlbumViewer } from "../../../../types/shared-albums";
import { saveAllAlbumMedia, saveAllMedia } from "../../../../utils/albumMedia";
import { EncounterLogSheet } from "../../sexual-health/EncounterLogSheet";
import type { PickedPerson } from "../../sexual-health/PersonPicker";
import { isLocateEnabled, isSexualHealthEnabled } from "../../../../utils/optionalFeatures";
import { findConversationByProfileId } from "../../../../services/chatDb";
import { setLocalNicknameForProfile } from "../../../../services/chatContactIndex";
import { haptic } from "../../../../utils/haptics";
import { menuTransitionStyle, usePresence } from "../../../../hooks/usePresence";
import { useNicknameNameChange } from "../../../../hooks/useNicknameNameChange";
import { NicknameMenuItemLabel, NicknameNameChangeBadge } from "../../../../components/NicknameNameHint";

type OwnProfileData = { tags: string[] };
const ownProfileDataCache = new Map<string, OwnProfileData>();

// Synthetic hash prepended to the photo carousel when the profile has an
// active Right Now post with an image, so it shows as the first slide.
const RIGHT_NOW_SLIDE_HASH = "__right_now_slide__";

// Synthetic hash appended to the photo carousel when the profile has (or has
// ever had) an album, so it shows as the last slide/indicator dot.
const ALBUM_SLIDE_HASH = "__album_slide__";

// Synthetic hash prepended when the profile has no real photo of its own
// (and no Right Now slide either) — keeps the default-avatar placeholder as
// its own slide instead of just disappearing once an album slide is added.
const DEFAULT_PROFILE_SLIDE_HASH = "__default_profile_slide__";

type ProfileDetailsModalProps = {
	isOpen: boolean;
	onClose: () => void;
	onMessageProfile?: (profileId: string) => void;
	onSendQuickMessage?: (profileId: string, text: string) => void;
	onSendProfilePhotoReply?: (profileId: string, imageHash: string, text: string) => void | Promise<void>;
	onTriangleProfile?: (profileId: string) => void;
	onBlockProfile?: (profileId: string) => void;
	onUnblockProfile?: (profileId: string) => void;
	onHideProfile?: (profileId: string) => void;
	onUnhideProfile?: (profileId: string) => void;
	isHidden?: boolean;
	onToggleFavoriteProfile?: (
		profileId: string,
		currentlyFavorite: boolean,
	) => void | Promise<void>;
	isFavorite?: boolean;
	isTogglingFavorite?: boolean;
	isBlocked?: boolean;
	isBlockedByOther?: boolean;
	isSnapshotProfile?: boolean;
	isChatLinkedProfile?: boolean;
	isBlockingProfile?: boolean;
	/** Locate menu label ("Locating… 45%" while this profile is being located). */
	locateLabel?: string;
	onTapProfile?: (profileId: string, tapId?: number) => void;
	isTappingProfile?: boolean;
	isTapBlocked?: boolean;
	tapVisualState?: { state: "none" | "single" | "mutual"; tapId: number };
	onTagClick?: (tag: string) => void;
	activeProfile: ProfileDetail | null;
	selectedBrowseCard: BrowseCard | null;
	isLoadingActiveProfile: boolean;
	activeProfileError: string | null;
	activeProfilePhotoHashes: string[];
	chatContactStatus?: ChatContactIndexRecord | null;
	localNickname?: string | null;
	/** Enables "Set nickname" in the actions menu; called after the nickname was saved (null = cleared). */
	onLocalNicknameChange?: (profileId: string, nickname: string | null) => void;
	genderOptions: ManagedOption[];
	pronounOptions: ManagedOption[];
	variant?: "modal" | "page";
	onPrevProfile?: () => void;
	onNextProfile?: () => void;
	/** What's already known about the neighbouring profiles, shown beside the page while swiping. */
	prevProfilePreview?: ProfileSwipePreview | null;
	nextProfilePreview?: ProfileSwipePreview | null;
	/** Opens your own profile in edit mode right away (ignored for other profiles). */
	initialEditMode?: boolean;
};

export type ProfileSwipePreview = {
	imageUrl: string | null;
	name: string | null;
	age: number | null;
	distance: number | null;
	lastSeen: number | null;
	onlineUntil: number | null;
	isFavorite: boolean;
	rightNow: "hosting" | "active" | null;
	/** The neighbour's full profile, when an earlier visit cached it. */
	detail: ProfileDetail | null;
};

type ProfileStatusLevel = "online" | "ending_soon" | "recent" | "offline";

/** Status line text ("Online", "Last online 5m ago", …) and dot level for a profile. */
function getProfileStatusDisplay(
	meta: ReturnType<typeof getOnlineStatusMeta>,
	t: ReturnType<typeof useTranslation>["t"],
): { label: string; level: ProfileStatusLevel } {
	const label = meta.isOnline
		? t(meta.labelKey, { count: meta.count })
		: meta.labelKey === "browse_page.status_offline"
			? t(meta.labelKey)
			: t("profile_details.last_online", {
					value: t(meta.labelKey, {
						count: meta.count,
					}),
				});
	const level: ProfileStatusLevel =
		meta.isOnline ? (meta.isEndingSoon ? "ending_soon" : "online")
		: meta.labelKey === "browse_page.status_minutes_ago" && (meta.count ?? 99) <= 10 ? "recent"
		: "offline";
	return { label, level };
}

// Same height as the photo carousel in the page variant.
const PAGE_CAROUSEL_HEIGHT = "min(78dvh, calc(100vw * 1.55))";

/** Neighbouring profile's photo and name, sitting just off-screen next to the swipeable page. */
function ProfileSwipePreviewPanel({
	preview,
	side,
	renderDetails,
}: {
	preview: ProfileSwipePreview;
	side: "prev" | "next";
	/** Renders the full profile body when the neighbour's details are already cached. */
	renderDetails: (detail: ProfileDetail) => ReactNode;
}) {
	const { t } = useTranslation();
	const { unitsPreset } = usePreferences();
	const src = proxyMediaUrl(preview.imageUrl);
	const hasStatus = preview.lastSeen != null || preview.onlineUntil != null;
	const status = hasStatus ? getProfileStatusDisplay(getOnlineStatusMeta(preview.lastSeen, preview.onlineUntil), t) : null;
	const name = preview.name?.trim() || t("profile_details.anonymous", "Someone");
	const hasAge = preview.age != null && Number.isFinite(preview.age);
	const distanceLabel = preview.distance != null ? formatDistance(preview.distance, t, unitsPreset) : null;
	const headerSubtitle = [status?.label, distanceLabel].filter(Boolean).join(" · ");

	useEffect(() => {
		if (!src) return;
		// Warm the cache so the photo is there by the time the swipe lands.
		const img = new Image();
		img.src = src;
	}, [src]);

	return (
		<div
			className="pointer-events-none absolute inset-y-0 w-full overflow-hidden bg-[var(--bg)]"
			style={{ left: side === "prev" ? "-100%" : "100%" }}
			aria-hidden="true"
		>
			<div className="relative overflow-hidden bg-black" style={{ height: PAGE_CAROUSEL_HEIGHT }}>
				<ProfileImage src={preview.imageUrl} alt="" className="h-full w-full object-cover" />
				<div
					className="absolute inset-x-0 top-0"
					style={{ height: "12rem", background: "linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, transparent 100%)" }}
				/>
				{/* Same layout as the page's floating header (unscrolled state). */}
				<div
					className="absolute inset-x-0 top-0 flex items-center gap-3 px-[var(--app-px)]"
					style={{ paddingTop: "calc(var(--header-icon-center) - 1.25rem)", paddingBottom: "0.75rem" }}
				>
					<span className="header-icon-btn header-icon-btn--back shrink-0 rounded-xl border border-white/45 p-2 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
						<ChevronLeft className="h-4 w-4" />
					</span>
					<div className="min-w-0 flex-1 drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)]">
						<div className="flex min-w-0 items-center gap-1.5">
							<p className="truncate text-base font-semibold leading-tight text-white">{name}</p>
							{hasAge && <span className="shrink-0 text-sm text-white/70">{preview.age}</span>}
						</div>
						{headerSubtitle && <p className="text-xs leading-tight text-white/70">{headerSubtitle}</p>}
					</div>
					{/* Look-alikes of the header actions; the real ones appear once the profile loads. */}
					<div className="flex shrink-0 items-center gap-0.5">
						<span className={`header-icon-btn inline-flex shrink-0 items-center justify-center rounded-xl border p-2 shadow-[0_10px_28px_-18px_rgba(0,0,0,0.95)] drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)] ${
							preview.isFavorite
								? "header-icon-btn--active border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]"
								: "border-white/45 text-white"
						}`}>
							<Star className={`h-4 w-4 ${preview.isFavorite ? "fill-current" : ""}`} />
						</span>
						<span className="header-icon-btn inline-flex shrink-0 items-center justify-center rounded-xl border border-red-500 p-2 text-red-500 shadow-[0_10px_28px_-18px_rgba(0,0,0,0.95)] drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
							<Ban className="h-4 w-4" />
						</span>
						<span className="header-icon-btn inline-flex shrink-0 items-center justify-center rounded-xl border border-white/45 p-2 text-white shadow-[0_10px_28px_-18px_rgba(0,0,0,0.95)] drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
							<EllipsisVertical className="h-4 w-4" />
						</span>
					</div>
				</div>
			</div>
			{preview.detail ? (
				// Cached details: shown as they were; the page reloads the current
				// state once the swipe lands.
				<div className="p-4 sm:p-5">{renderDetails(preview.detail)}</div>
			) : (
				<>
				<div className="px-7 pt-4 sm:px-8 sm:pt-5">
					<h2 className="truncate text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
						{name}
						{hasAge && (
							<span className="ml-2 text-xl font-normal text-[var(--text-muted)] sm:text-2xl">{preview.age}</span>
						)}
					</h2>
					{/* Same status line as ProfileDetailsContent's header. */}
					{(status || preview.rightNow || distanceLabel) && (
						<div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--text-muted)]">
							{status && (
								<span className="flex items-center gap-1.5">
									<span className={`h-2 w-2 rounded-full ${
										status.level === "online" ? "bg-emerald-400"
										: status.level === "ending_soon" ? "bg-amber-400"
										: "bg-[var(--text-muted)]/40"
									}`} />
									{status.label}
								</span>
							)}
							{preview.rightNow && (
								<span className="flex items-center gap-1 font-semibold" style={{ color: "var(--right-now)" }}>
									{preview.rightNow === "hosting" ? (
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
							{distanceLabel && (
								<span className="flex items-center gap-1">
									<MapPinFilled className="h-3.5 w-3.5" />
									{distanceLabel}
								</span>
							)}
						</div>
					)}
					{/* Stand-in for the position/height/weight line (mt-1, text-sm line height). */}
					<div className="mt-1 flex h-5 animate-pulse items-center gap-x-3" aria-hidden="true">
						<div className="h-3 w-14 rounded-full bg-[var(--surface-2)]" />
						<div className="h-3 w-12 rounded-full bg-[var(--surface-2)]" />
						<div className="h-3 w-12 rounded-full bg-[var(--surface-2)]" />
					</div>
				</div>
				{/* The rest of the profile isn't known yet — placeholders hint that it follows. */}
				<div className="mt-8 px-4 sm:px-5">
					<ProfileDetailsSkeleton withHeader={false} />
				</div>
				</>
			)}
		</div>
	);
}

function normalizeMediaCreatedAt(value: unknown): number | null {
	if (typeof value !== "number" && typeof value !== "string") {
		return null;
	}

	const numeric = typeof value === "number" ? value : Number(value.trim());
	if (!Number.isFinite(numeric) || numeric <= 0) {
		return null;
	}

	// Most API timestamps are in milliseconds; seconds are normalized.
	return numeric < 1_000_000_000_000 ? Math.round(numeric * 1000) : Math.round(numeric);
}

type ProfileContentLabels = {
	lookingForLabels: Record<number, string>;
	meetAtLabels: Record<number, string>;
	nsfwLabels: Record<number, string>;
	tribeLabels: Record<number, string>;
	hivStatusLabels: Record<number, string>;
	sexualHealthLabels: Record<number, string>;
	vaccineLabels: Record<number, string>;
	sexualPositionLabels: Record<number, string>;
	bodyTypeLabels: Record<number, string>;
	ethnicityLabels: Record<number, string>;
	relationshipStatusLabels: Record<number, string>;
};

/** Which ProfileDetailsContent sections a profile has content for. */
function getProfileContentFlags(
	profile: ProfileDetail | null,
	labels: ProfileContentLabels,
	genderOptions: ManagedOption[],
	pronounOptions: ManagedOption[],
	t: ReturnType<typeof useTranslation>["t"],
	unitsPreset: ReturnType<typeof usePreferences>["unitsPreset"],
) {
	const formattedActiveGenders = profile?.genders.length
		? profile.genders.map((genderId) => getEnumLabel(genderId, genderOptions)).join(", ")
		: "Not set";
	const formattedActivePronouns = profile?.pronouns.length
		? profile.pronouns.map((pronounId) => getEnumLabel(pronounId, pronounOptions)).join(", ")
		: "Not set";
	if (!profile) {
		return {
			formattedActiveGenders,
			formattedActivePronouns,
			hasExpectationsFields: false,
			hasHealthFields: false,
			hasStatsFields: false,
			hasSocialFields: false,
			hasTagsContent: false,
			hasAboutContent: false,
		};
	}
	return {
		formattedActiveGenders,
		formattedActivePronouns,
		hasExpectationsFields:
			!shouldHideField(formatEnumArray(profile.lookingFor, labels.lookingForLabels, t)) ||
			!shouldHideField(formatEnumArray(profile.meetAt, labels.meetAtLabels, t)) ||
			!shouldHideField(formatEnumArray(profile.grindrTribes, labels.tribeLabels, t)) ||
			!shouldHideField(formattedActiveGenders) ||
			!shouldHideField(formattedActivePronouns),
		hasHealthFields:
			!shouldHideField(formatEnumValue(profile.hivStatus, labels.hivStatusLabels, t)) ||
			Boolean(profile.lastTestedDate) ||
			!shouldHideField(formatEnumArray(profile.sexualHealth, labels.sexualHealthLabels, t)) ||
			!shouldHideField(formatEnumArray(profile.vaccines, labels.vaccineLabels, t)),
		hasStatsFields:
			!shouldHideField(formatEnumValue(profile.sexualPosition, labels.sexualPositionLabels, t)) ||
			!shouldHideField(formatHeightCm(profile.height, t, unitsPreset)) ||
			!shouldHideField(formatWeightKg(profile.weight, t, unitsPreset)) ||
			!shouldHideField(formatEnumValue(profile.bodyType, labels.bodyTypeLabels, t)) ||
			!shouldHideField(formatEnumValue(profile.ethnicity, labels.ethnicityLabels, t)) ||
			!shouldHideField(formatEnumValue(profile.relationshipStatus, labels.relationshipStatusLabels, t)),
		hasSocialFields: Boolean(
			profile.socialNetworks?.instagram?.userId ||
			profile.socialNetworks?.twitter?.userId ||
			profile.socialNetworks?.facebook?.userId,
		),
		hasTagsContent: profile.profileTags.length > 0,
		hasAboutContent: Boolean(profile.aboutMe?.trim()),
	};
}

/** Photo hashes of a profile in carousel order (primary first), as the
 * parents derive them for the `activeProfilePhotoHashes` prop. */
function getProfileDetailPhotoHashes(profile: ProfileDetail): string[] {
	const hashes = profile.medias
		.map((item) => item.mediaHash ?? "")
		.filter((hash): hash is string => validateMediaHash(hash));
	if (
		profile.profileImageMediaHash &&
		validateMediaHash(profile.profileImageMediaHash) &&
		!hashes.includes(profile.profileImageMediaHash)
	) {
		hashes.unshift(profile.profileImageMediaHash);
	}
	return hashes;
}

/** `withHeader={false}` leaves out the name/status lines, for when those are already known. */
function ProfileDetailsSkeleton({ withHeader = true }: { withHeader?: boolean }) {
	return (
		<div className="animate-pulse space-y-8 px-3" aria-hidden="true">
			{withHeader && <div>
				<div className="h-7 w-2/5 rounded-full bg-[var(--surface-2)]" />
				<div className="mt-2.5 flex flex-wrap items-center gap-3">
					<div className="h-3 w-20 rounded-full bg-[var(--surface-2)]" />
					<div className="h-3 w-16 rounded-full bg-[var(--surface-2)]" />
				</div>
				<div className="mt-2 flex flex-wrap items-center gap-3">
					<div className="h-3 w-12 rounded-full bg-[var(--surface-2)]" />
					<div className="h-3 w-12 rounded-full bg-[var(--surface-2)]" />
					<div className="h-3 w-12 rounded-full bg-[var(--surface-2)]" />
				</div>
			</div>}

			<div className="flex flex-wrap gap-2">
				<div className="h-6 w-16 rounded-full bg-[var(--surface-2)]" />
				<div className="h-6 w-20 rounded-full bg-[var(--surface-2)]" />
				<div className="h-6 w-14 rounded-full bg-[var(--surface-2)]" />
				<div className="h-6 w-24 rounded-full bg-[var(--surface-2)]" />
			</div>

			<div className="space-y-2.5">
				<div className="h-3 w-full rounded-full bg-[var(--surface-2)]" />
				<div className="h-3 w-5/6 rounded-full bg-[var(--surface-2)]" />
				<div className="h-3 w-2/3 rounded-full bg-[var(--surface-2)]" />
			</div>

			<div className="space-y-3">
				{Array.from({ length: 4 }).map((_, i) => (
					<div key={i} className="flex items-center gap-2.5">
						<div className="h-4 w-4 shrink-0 rounded bg-[var(--surface-2)]" />
						<div className="h-3 w-1/3 rounded-full bg-[var(--surface-2)]" />
					</div>
				))}
			</div>
		</div>
	);
}

export function ProfileDetailsModal({
	isOpen,
	onClose,
	onMessageProfile,
	onSendQuickMessage,
	onSendProfilePhotoReply,
	onTriangleProfile,
	onBlockProfile,
	onUnblockProfile,
	onHideProfile,
	onUnhideProfile,
	isHidden = false,
	onToggleFavoriteProfile,
	isFavorite = false,
	isTogglingFavorite = false,
	isBlocked = false,
	isBlockedByOther = false,
	isSnapshotProfile = false,
	isChatLinkedProfile = false,
	isBlockingProfile = false,
	locateLabel,
	onTapProfile,
	isTappingProfile = false,
	isTapBlocked = false,
	tapVisualState = { state: "none", tapId: 1 },
	onTagClick,
	activeProfile: activeProfileProp,
	selectedBrowseCard,
	isLoadingActiveProfile,
	activeProfileError,
	activeProfilePhotoHashes: activeProfilePhotoHashesProp,
	chatContactStatus,
	localNickname,
	onLocalNicknameChange,
	genderOptions,
	pronounOptions,
	variant = "modal",
	onPrevProfile,
	onNextProfile,
	prevProfilePreview,
	nextProfilePreview,
	initialEditMode = false,
}: ProfileDetailsModalProps) {
	const { t } = useTranslation();
	const { unitsPreset, showAlbumSensitiveContentWarning, openAlbumAsBottomSheet } = usePreferences();
	const { userId } = useAuth();
	const apiFunctions = useApiFunctions();
	// Own profile only: edit mode swaps the details for the editor sections.
	// Leaving it re-reads the profile here, since the parent only fetches it
	// when the opened profile changes.
	const [isEditingOwnProfile, setIsEditingOwnProfile] = useState(initialEditMode);
	const [hasUnsavedOwnEdits, setHasUnsavedOwnEdits] = useState(false);
	const [isDiscardEditsPromptOpen, setIsDiscardEditsPromptOpen] = useState(false);
	const [refreshedOwnProfile, setRefreshedOwnProfile] = useState<ProfileDetail | null>(null);
	// Photo edits save immediately; the editor reports the saved order so the
	// carousel follows right away. It also wins over the reload on leaving edit
	// mode, which reads /v7/profiles and can lag behind the write.
	const [editedOwnPhotoHashes, setEditedOwnPhotoHashes] = useState<string[] | null>(null);
	const openedProfileId = activeProfileProp?.profileId;
	// Reset only when switching from one loaded profile to another — not when
	// the first one arrives, which would undo `initialEditMode`.
	const previousOpenedProfileIdRef = useRef(openedProfileId);
	useEffect(() => {
		const previous = previousOpenedProfileIdRef.current;
		previousOpenedProfileIdRef.current = openedProfileId;
		if (previous == null || previous === openedProfileId) return;
		setRefreshedOwnProfile(null);
		setEditedOwnPhotoHashes(null);
		setIsEditingOwnProfile(false);
	}, [openedProfileId]);
	const activeProfile = refreshedOwnProfile ?? activeProfileProp;
	const activeProfilePhotoHashes = useMemo(
		() => editedOwnPhotoHashes
			?? (refreshedOwnProfile ? getProfileDetailPhotoHashes(refreshedOwnProfile) : activeProfilePhotoHashesProp),
		[editedOwnPhotoHashes, refreshedOwnProfile, activeProfilePhotoHashesProp],
	);
	const [ownTags, setOwnTags] = useState<string[]>(() => (userId ? (ownProfileDataCache.get(String(userId))?.tags ?? []) : []));
	useEffect(() => {
		if (!userId) return;
		if (ownProfileDataCache.has(String(userId))) {
			setOwnTags(ownProfileDataCache.get(String(userId))!.tags);
			return;
		}
		apiFunctions.getRawProfile(userId).then((raw) => {
			const parsed = profileResponseSchema.safeParse(raw);
			if (parsed.success) {
				const p = parsed.data.profiles[0];
				const data: OwnProfileData = { tags: p?.profileTags ?? [] };
				ownProfileDataCache.set(String(userId), data);
				setOwnTags(data.tags);
			}
		}).catch(() => {});
	}, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
	const activeProfileName = useMemo(() => {
		if (!activeProfile) {
			return t("profile_details.title");
		}

		const nickname = localNickname?.trim();
		if (nickname) {
			return nickname;
		}

		const value = activeProfile.displayName?.trim();
		if (value) {
			return value;
		}

		return t("profile_details.anonymous", "Someone");
	}, [activeProfile, localNickname, t]);

	const messageProfileId = activeProfile?.profileId ?? selectedBrowseCard?.profileId ?? null;
	const isOwnProfile = userId != null && messageProfileId != null && String(userId) === String(messageProfileId);

	const finishOwnProfileEdit = useCallback(() => {
		setIsEditingOwnProfile(false);
		setHasUnsavedOwnEdits(false);
		setIsDiscardEditsPromptOpen(false);
		if (userId == null) return;
		const ownId = String(userId);
		apiFunctions.getProfileDetail(ownId).then((fresh) => {
			setRefreshedOwnProfile(fresh);
			setCachedProfileDetail(ownId, fresh);
			ownProfileDataCache.set(ownId, { tags: fresh.profileTags ?? [] });
		}).catch((error) => appLog.warn("Failed to reload own profile after editing", error));
	}, [apiFunctions, userId]);
	const toggleOwnProfileEdit = () => {
		if (!isEditingOwnProfile) setIsEditingOwnProfile(true);
		else if (hasUnsavedOwnEdits) setIsDiscardEditsPromptOpen(true);
		else finishOwnProfileEdit();
	};
	const ownProfileEditLabel = isEditingOwnProfile
		? t("profile_editor.stop_editing", { defaultValue: "Stop editing" })
		: t("profile_editor.edit_profile", { defaultValue: "Edit profile" });
	const discardEditsDialog = (
		<ConfirmDialog
			isOpen={isDiscardEditsPromptOpen}
			title={t("profile_editor.discard.title", { defaultValue: "Discard changes?" })}
			message={t("profile_editor.discard.message", { defaultValue: "Your unsaved profile changes will be lost." })}
			confirmLabel={t("profile_editor.discard.confirm", { defaultValue: "Discard" })}
			cancelLabel={t("common.cancel")}
			onConfirm={finishOwnProfileEdit}
			onCancel={() => setIsDiscardEditsPromptOpen(false)}
		/>
	);
	const profileDistance =
		activeProfile?.distance ?? selectedBrowseCard?.distanceMeters ?? null;
	const profileOnlineUntil = isOwnProfile
		? Date.now() + 60 * 60 * 1000
		: (activeProfile?.onlineUntil ?? selectedBrowseCard?.onlineUntil ?? null);
	const profileLastSeen = activeProfile?.seen ?? selectedBrowseCard?.lastOnline ?? null;
	const profileStatusMeta = getOnlineStatusMeta(
		profileLastSeen,
		profileOnlineUntil,
	);
	const { label: profileStatusLabel, level: profileStatusLevel } = getProfileStatusDisplay(profileStatusMeta, t);
	const estimatedCreatedAt = formatEstimatedAccountCreation(activeProfile?.profileId, t);
	const { data: travelPlans } = useTravelPlans(activeProfile?.profileId);
	const visualStateValue = typeof tapVisualState === "string" ? tapVisualState : tapVisualState.state;
	const effectiveTapVisualState = isTappingProfile ? "single" : visualStateValue;
	const isTapActive = effectiveTapVisualState !== "none";
	const isProfileUnavailable = isBlocked || isSnapshotProfile;
	const isTapDisabled = isOwnProfile || !onTapProfile || isTappingProfile || isTapBlocked || isProfileUnavailable;
	const isTriangleDisabled =
		!onTriangleProfile || !messageProfileId || isProfileUnavailable;
	const tapButtonClassName =
		isTapActive
			? "inline-flex h-16 w-16 items-center justify-center rounded-full border-2 border-[var(--accent)] bg-[var(--surface)] text-4xl leading-none text-[var(--text)] hover:brightness-110 overflow-hidden relative"
			: "inline-flex h-16 w-16 items-center justify-center rounded-full border border-[var(--text-muted)] bg-transparent text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)]";
	const lookingForLabels = useMemo(() => getLookingForLabelMap(t), [t]);
	const meetAtLabels = useMemo(() => getMeetAtLabelMap(t), [t]);
	const nsfwLabels = useMemo(() => getNsfwLabelMap(t), [t]);
	const tribeLabels = useMemo(() => getTribeLabelMap(t), [t]);
	const hivStatusLabels = useMemo(() => getHivStatusLabelMap(t), [t]);
	const sexualHealthLabels = useMemo(() => getSexualHealthLabelMap(t), [t]);
	const vaccineLabels = useMemo(() => getVaccineLabelMap(t), [t]);
	const sexualPositionLabels = useMemo(() => getSexualPositionLabelMap(t), [t]);
	const bodyTypeLabels = useMemo(() => getBodyTypeLabelMap(t), [t]);
	const ethnicityLabels = useMemo(() => getEthnicityLabelMap(t), [t]);
	const relationshipStatusLabels = useMemo(() => getRelationshipStatusLabelMap(t),[t]);

	const contentLabels = useMemo<ProfileContentLabels>(() => ({
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
	}), [lookingForLabels, meetAtLabels, nsfwLabels, tribeLabels, hivStatusLabels, sexualHealthLabels, vaccineLabels, sexualPositionLabels, bodyTypeLabels, ethnicityLabels, relationshipStatusLabels]);

	const getContentFlags = useCallback(
		(profile: ProfileDetail | null) =>
			getProfileContentFlags(profile, contentLabels, genderOptions, pronounOptions, t, unitsPreset),
		[contentLabels, genderOptions, pronounOptions, t, unitsPreset],
	);

	const {
		formattedActiveGenders,
		formattedActivePronouns,
		hasExpectationsFields,
		hasHealthFields,
		hasStatsFields,
		hasSocialFields,
		hasTagsContent,
		hasAboutContent,
	} = useMemo(() => getContentFlags(activeProfile), [getContentFlags, activeProfile]);

	const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(
		null,
	);

	const [mobileCarouselPhotoIndex, setMobileCarouselPhotoIndex] = useState(0);
	const isDesktopLike = useDesktopBreakpoint();
	const [isModalSplit, setIsModalSplit] = useState(() =>
		typeof window !== "undefined" && window.innerWidth >= 900
	);
	const mobileCarouselRef = useRef<HTMLDivElement | null>(null);
	const carouselIndexRef = useRef(0);
	const carouselTotalRef = useRef(0);
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const pageWrapRef = useRef<HTMLDivElement | null>(null);
	const profileSwipeRef = useRef({ startX: 0, startY: 0, decided: false, horizontal: false, dragging: false, lastDelta: 0, pastThreshold: false });
	// Gestures write straight to the DOM (header fade, profile swipe) instead
	// of state, so a frame of finger movement doesn't re-render the whole modal.
	const headerBgRef = useRef<HTMLDivElement | null>(null);
	const [inlineScrolled, setInlineScrolled] = useState(false);
	const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
	const actionsMenuPresence = usePresence(isActionsMenuOpen);
	const [banBioPrompt, setBanBioPrompt] = useState<{ text: string } | null>(null);
	const [banNamePrompt, setBanNamePrompt] = useState<{ text: string } | null>(null);
	const [quickMessageDraft, setQuickMessageDraft] = useState("");
	const [barTapPickerOpen, setBarTapPickerOpen] = useState(false);
	const [barInputVisible, setBarInputVisible] = useState(true);
	const [barTapHoverId, setBarTapHoverId] = useState<number | null>(null);
	const [barTapFlyEmoji, setBarTapFlyEmoji] = useState<TapFlyBurstState | null>(null);
	const barTapLongPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const barTapStickyRef = useRef(false);
	const barTapSkipUpRef = useRef(false);
	const barInputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const barTapOptionsRef = useRef<HTMLDivElement>(null);
	const barTapButtonRef = useRef<HTMLButtonElement>(null);
	const controlsBarRef = useRef<HTMLDivElement>(null);
	const actionsMenuRef = useRef<HTMLDivElement>(null);

	const [profileNote, setProfileNote] = useState("");
	const [profilePhoneNumber, setProfilePhoneNumber] = useState("");
	const [isLoadingNote, setIsLoadingNote] = useState(false);
	const [isEditingNote, setIsEditingNote] = useState(false);
	const [noteDraft, setNoteDraft] = useState("");
	const [phoneNumberDraft, setPhoneNumberDraft] = useState("");
	const [isSavingNote, setIsSavingNote] = useState(false);

	useEffect(() => {
		if (!messageProfileId || isOwnProfile || !isFavorite) {
			setProfileNote("");
			setProfilePhoneNumber("");
			setIsEditingNote(false);
			return;
		}

		let cancelled = false;
		setIsLoadingNote(true);
		setProfileNote("");
		setProfilePhoneNumber("");
		setIsEditingNote(false);

		apiFunctions.getProfileNote(String(messageProfileId))
			.then((data) => {
				if (!cancelled) {
					setProfileNote(data.notes ?? "");
					setProfilePhoneNumber(data.phoneNumber ?? "");
				}
			})
			.catch(() => {})
			.finally(() => {
				if (!cancelled) setIsLoadingNote(false);
			});

		return () => { cancelled = true; };
	}, [messageProfileId, isOwnProfile, isFavorite]); // eslint-disable-line react-hooks/exhaustive-deps

	const handleSaveNote = async () => {
		if (!messageProfileId) return;
		setIsSavingNote(true);
		try {
			await apiFunctions.saveProfileNote(String(messageProfileId), {
				notes: noteDraft,
				phoneNumber: phoneNumberDraft,
			});
			setProfileNote(noteDraft);
			setProfilePhoneNumber(phoneNumberDraft);
			setIsEditingNote(false);
			toast.success(t("favorites.note_saved"));
		} catch {
			toast.error(t("favorites.save_note_failed"));
		} finally {
			setIsSavingNote(false);
		}
	};

	const handleDeleteNote = async () => {
		if (!messageProfileId) return;
		setIsSavingNote(true);
		try {
			await apiFunctions.deleteProfileNote(String(messageProfileId));
			setProfileNote("");
			setProfilePhoneNumber("");
			setIsEditingNote(false);
			toast.success(t("favorites.note_deleted"));
		} catch {
			toast.error(t("favorites.delete_note_failed"));
		} finally {
			setIsSavingNote(false);
		}
	};

	const hasBio = Boolean(activeProfile?.aboutMe?.trim());

	const handleBanBioPhrase = () => {
		setIsActionsMenuOpen(false);
		const bio = activeProfile?.aboutMe || "";
		if (!bio.trim()) { return; }
		setBanBioPrompt({ text: bio });
	};

	const actualProfileName = activeProfile?.displayName?.trim() || "";

	const handleBanProfileName = () => {
		setIsActionsMenuOpen(false);
		if (!actualProfileName) { return; }
		setBanNamePrompt({ text: actualProfileName });
	};

	// Grows with the note while editing, so it's always shown in full.
	const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null);
	useLayoutEffect(() => {
		const el = noteTextareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${el.scrollHeight}px`;
	}, [noteDraft, isEditingNote]);

	// Native list look (like SheetCard rows): the note and the phone number as
	// rows of one card with inset dividers, plain text actions in the header.
	const noteHeaderButtonClass = "-my-1.5 rounded-lg px-2 py-1.5 text-sm transition active:opacity-60 disabled:opacity-40";
	const notesSectionJsx = isFavorite && !isOwnProfile ? (
		<div className="px-3">
			<div className="mb-2 flex min-h-5 items-center justify-between">
				<div className="flex items-center gap-2">
					<p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
						{t("favorites.note_section_title")}
					</p>
					{(isLoadingNote || isSavingNote) && (
						<Loader2 className="h-3 w-3 animate-spin text-[var(--text-muted)]" />
					)}
				</div>
				{isEditingNote ? (
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={() => setIsEditingNote(false)}
							disabled={isSavingNote}
							className={`${noteHeaderButtonClass} font-medium text-[var(--text-muted)]`}
						>
							{t("common.cancel")}
						</button>
						<button
							type="button"
							onClick={handleSaveNote}
							disabled={isSavingNote}
							className={`${noteHeaderButtonClass} font-semibold text-[var(--accent)]`}
						>
							{t("common.save")}
						</button>
					</div>
				) : profileNote || profilePhoneNumber ? (
					<button
						type="button"
						onClick={() => { setNoteDraft(profileNote); setPhoneNumberDraft(profilePhoneNumber); setIsEditingNote(true); }}
						disabled={isLoadingNote}
						className={`${noteHeaderButtonClass} font-semibold text-[var(--accent)]`}
					>
						{t("common.edit")}
					</button>
				) : null}
			</div>

			<div className="overflow-hidden rounded-2xl bg-[var(--surface-2)]">
				{isEditingNote ? (
					<>
						<label className="flex items-start gap-3 px-4 py-3">
							<StickyNoteFilled className="mt-[3px] h-4 w-4 shrink-0 text-[var(--text-muted)]" />
							<textarea
								ref={noteTextareaRef}
								autoFocus
								value={noteDraft}
								onChange={(e) => setNoteDraft(e.target.value)}
								placeholder={t("favorites.note_placeholder")}
								rows={2}
								className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent text-[15px] leading-relaxed text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none"
							/>
						</label>
						<div className="ml-11 h-px bg-[var(--border)]" />
						<label className="flex min-h-12 items-center gap-3 px-4">
							<Phone className="h-4 w-4 shrink-0 fill-current text-[var(--text-muted)]" />
							<input
								type="tel"
								value={phoneNumberDraft}
								onChange={(e) => setPhoneNumberDraft(e.target.value)}
								placeholder={t("favorites.phone_number_placeholder")}
								className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none"
							/>
						</label>
						{(profileNote || profilePhoneNumber) && (
							<>
								<div className="h-px bg-[var(--border)]" />
								<button
									type="button"
									onClick={handleDeleteNote}
									disabled={isSavingNote}
									className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-[15px] text-red-400 transition active:bg-red-500/10 disabled:opacity-50"
								>
									<Trash2 className="h-4 w-4 shrink-0" />
									{t("favorites.delete_note")}
								</button>
							</>
						)}
					</>
				) : profileNote || profilePhoneNumber ? (
					<>
						{profileNote && (
							<div className="flex items-start gap-3 px-4 py-3">
								<StickyNoteFilled className="mt-[3px] h-4 w-4 shrink-0 text-[var(--text-muted)]" />
								<p className="min-w-0 flex-1 whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--text)] [overflow-wrap:anywhere] select-text">
									{profileNote}
								</p>
							</div>
						)}
						{profileNote && profilePhoneNumber && <div className="ml-11 h-px bg-[var(--border)]" />}
						{profilePhoneNumber && (
							// Tapping the number starts a call (through the opener, like
							// other external links — a plain tel: link isn't handed on by the webview).
							<button
								type="button"
								onClick={() => {
									const url = `tel:${profilePhoneNumber.replace(/[^\d+]/g, "")}`;
									openUrl(url).catch((error) => appLog.error("Failed to open phone link", error));
								}}
								className="flex min-h-12 w-full items-center gap-3 px-4 text-left transition active:bg-[var(--surface)]"
							>
								<Phone className="h-4 w-4 shrink-0 fill-current text-[var(--text-muted)]" />
								<span className="min-w-0 flex-1 truncate text-[15px] text-[var(--accent)]">{profilePhoneNumber}</span>
							</button>
						)}
					</>
				) : (
					<button
						type="button"
						onClick={() => { setNoteDraft(""); setPhoneNumberDraft(""); setIsEditingNote(true); }}
						disabled={isLoadingNote}
						className="flex min-h-12 w-full items-center gap-3 px-4 text-left transition active:bg-[var(--surface)] disabled:opacity-50"
					>
						<StickyNoteFilled className="h-4 w-4 shrink-0 text-[var(--accent)]" />
						<span className="text-[15px] text-[var(--text-muted)]">{t("favorites.note_empty")}</span>
					</button>
				)}
			</div>
		</div>
	) : null;

	const barTapEmoji = tapEmoji;
	const barTapGlow = tapGlow;

	const isDesktopBar = variant !== "page";

	const handleBarTapPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
		if (isTapDisabled) return;
		if (barTapPickerOpen && isDesktopBar) {
			// Button acts as close (X) when picker already open on desktop
			barTapSkipUpRef.current = true;
			setBarTapPickerOpen(false);
			setBarTapHoverId(null);
			barTapStickyRef.current = false;
			barInputTimerRef.current = setTimeout(() => setBarInputVisible(true), 210);
			return;
		}
		e.currentTarget.setPointerCapture(e.pointerId);
		barTapLongPressRef.current = setTimeout(() => {
			barTapStickyRef.current = isDesktopBar;
			setBarTapPickerOpen(true);
			setBarInputVisible(false);
			if (barInputTimerRef.current) clearTimeout(barInputTimerRef.current);
			haptic(10);
		}, 300);
	};

	const handleBarTapPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
		if (!barTapPickerOpen || barTapStickyRef.current) return;
		const container = barTapOptionsRef.current;
		let newId: number | null = null;
		if (container) {
			const rect = container.getBoundingClientRect();
			if (e.clientX >= rect.left && e.clientX <= rect.right) {
				const ids = [0, 2, 1];
				const index = Math.min(Math.floor((e.clientX - rect.left) / (rect.width / 3)), 2);
				newId = ids[index];
			}
		}
		if (newId !== barTapHoverId) {
			setBarTapHoverId(newId);
			if (newId !== null) {
				haptic(8);
			}
		}
	};

	const fireTap = (tapId: number) => {
		if (!onTapProfile || !messageProfileId || isTapBlocked) return;
		haptic(30, [15, 10, 25]);
		onTapProfile(String(messageProfileId), tapId);
		setBarTapFlyEmoji(createTapFlyBurst(tapId, barTapButtonRef.current));
		setBarTapPickerOpen(false);
		setBarTapHoverId(null);
		barTapStickyRef.current = false;
		barInputTimerRef.current = setTimeout(() => setBarInputVisible(true), 210);
	};

	const handleBarTapPointerUp = (_e: React.PointerEvent<HTMLButtonElement>) => {
		if (isTapDisabled) return;
		if (barTapSkipUpRef.current) {
			barTapSkipUpRef.current = false;
			return;
		}
		if (barTapLongPressRef.current) {
			clearTimeout(barTapLongPressRef.current);
			barTapLongPressRef.current = null;
		}
		if (barTapPickerOpen && !barTapStickyRef.current) {
			if (barTapHoverId !== null) {
				fireTap(barTapHoverId);
			} else {
				setBarTapPickerOpen(false);
				setBarTapHoverId(null);
				barInputTimerRef.current = setTimeout(() => setBarInputVisible(true), 210);
			}
		} else if (!barTapPickerOpen && !isTapActive) {
			fireTap(1);
		}
	};

	useEffect(() => {
		if (!barTapFlyEmoji) return;
		const timer = setTimeout(() => setBarTapFlyEmoji(null), TAP_FLY_BURST_MS);
		return () => clearTimeout(timer);
	}, [barTapFlyEmoji]);

	useEffect(() => {
		if (!isActionsMenuOpen) return;
		const handler = (e: MouseEvent) => {
			if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
				setIsActionsMenuOpen(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [isActionsMenuOpen]);

	useEffect(() => {
		const el = scrollContainerRef.current;
		if (!el || (variant === "modal" && isModalSplit)) return;
		const setHeaderBg = (opacity: number, fadeMs: number) => {
			const bg = headerBgRef.current;
			if (!bg) return;
			bg.style.transition = `opacity ${fadeMs}ms ease-out`;
			bg.style.opacity = String(opacity);
		};
		setHeaderBg(0, 0);
		setInlineScrolled(false);
		let lastScrollTop = 0;
		const onScroll = () => {
			const scrollTop = el.scrollTop;
			const scrollingDown = scrollTop > lastScrollTop;
			lastScrollTop = scrollTop;
			const opacity = Math.min(scrollTop / 150, 1);
			setHeaderBg(opacity, scrollingDown ? 0 : 400);
			// Only re-renders when crossing the threshold (same value bails out).
			setInlineScrolled(opacity > 0.5);
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			el.removeEventListener("scroll", onScroll);
			setHeaderBg(0, 0);
			setInlineScrolled(false);
		};
	}, [isOpen, isModalSplit, variant]); // eslint-disable-line react-hooks/exhaustive-deps

	// Kept in refs so the touch listeners don't re-subscribe on every render
	// (the hosts pass fresh closures each time).
	const onPrevProfileRef = useRef(onPrevProfile);
	onPrevProfileRef.current = onPrevProfile;
	const onNextProfileRef = useRef(onNextProfile);
	onNextProfileRef.current = onNextProfile;
	const hasProfileNeighbors = Boolean(onPrevProfile || onNextProfile);
	// Set once a swipe has slid the neighbour's preview fully in. The preview
	// stays on screen as the loading state; the offset is only reset once the
	// new profile has loaded, so neither the old profile nor the skeleton flashes.
	const pendingSwipeResetRef = useRef(false);
	const swipeFromProfileIdRef = useRef<string | null>(null);
	// The preview the swipe landed on, frozen: after the switch the host passes
	// the new profile's neighbours, which would otherwise replace it on screen.
	const [swipeLanding, setSwipeLanding] = useState<{ side: "prev" | "next"; preview: ProfileSwipePreview } | null>(null);
	const prevProfilePreviewRef = useRef(prevProfilePreview);
	prevProfilePreviewRef.current = prevProfilePreview;
	const nextProfilePreviewRef = useRef(nextProfilePreview);
	nextProfilePreviewRef.current = nextProfilePreview;
	const swipeResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const resetProfileSwipeOffset = useCallback(() => {
		pendingSwipeResetRef.current = false;
		setSwipeLanding(null);
		if (swipeResetTimerRef.current) {
			clearTimeout(swipeResetTimerRef.current);
			swipeResetTimerRef.current = null;
		}
		const el = pageWrapRef.current;
		if (!el) return;
		el.style.transition = "none";
		el.style.transform = "";
	}, []);

	const currentProfileId = activeProfile?.profileId != null ? String(activeProfile.profileId) : null;
	useLayoutEffect(() => {
		if (!pendingSwipeResetRef.current) return;
		if (isLoadingActiveProfile || currentProfileId === swipeFromProfileIdRef.current) return;
		resetProfileSwipeOffset();
	}, [currentProfileId, isLoadingActiveProfile, resetProfileSwipeOffset]);

	useEffect(() => resetProfileSwipeOffset, [resetProfileSwipeOffset]);

	const currentProfileIdRef = useRef(currentProfileId);
	currentProfileIdRef.current = currentProfileId;

	useEffect(() => {
		const el = pageWrapRef.current;

		if (
			!el ||
			!isOpen ||
			selectedPhotoIndex !== null ||
			variant !== "page" ||
			!hasProfileNeighbors
		) {
			return;
		}

		const SWIPE_THRESHOLD = 80;
		const s = profileSwipeRef.current;

		const setOffset = (dx: number, animate: boolean) => {
			el.style.transition = animate ? "transform 250ms ease-out" : "none";
			el.style.transform = dx === 0 ? "" : `translateX(${dx}px)`;
		};

		const onStart = (e: TouchEvent) => {
			if (controlsBarRef.current?.contains(e.target as Node)) return;
			if (pendingSwipeResetRef.current) return;
			s.startX = e.touches[0].clientX;
			s.startY = e.touches[0].clientY;
			s.decided = false;
			s.horizontal = false;
			s.dragging = false;
			s.lastDelta = 0;
			s.pastThreshold = false;
		};

		const onMove = (e: TouchEvent) => {
			if (pendingSwipeResetRef.current) return;
			const dx = e.touches[0].clientX - s.startX;
			const dy = e.touches[0].clientY - s.startY;
			if (!s.decided) {
				if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
				s.decided = true;
				s.horizontal = Math.abs(dx) >= Math.abs(dy);
			}
			if (!s.horizontal) return;
			e.preventDefault();
			s.dragging = true;
			const target = dx < 0 ? onNextProfileRef.current : onPrevProfileRef.current;
			// Rubber-band when there's no profile on that side.
			const offset = target ? dx : dx * 0.25;
			s.lastDelta = offset;
			const past = Boolean(target) && Math.abs(dx) > SWIPE_THRESHOLD;
			if (past !== s.pastThreshold) {
				s.pastThreshold = past;
				if (past) haptic(8);
			}
			setOffset(offset, false);
		};

		const onEnd = () => {
			if (!s.dragging) return;
			s.dragging = false;
			s.horizontal = false;
			const dx = s.lastDelta;
			s.lastDelta = 0;
			const go = s.pastThreshold ? (dx < 0 ? onNextProfileRef.current : onPrevProfileRef.current) : undefined;
			s.pastThreshold = false;
			if (!go) {
				setOffset(0, true);
				return;
			}
			// Finish the slide so the neighbour's preview fills the screen, then
			// switch; the layout effect above snaps back once it has rendered.
			const width = el.offsetWidth;
			el.style.transition = "transform 200ms ease-out";
			el.style.transform = `translateX(${dx < 0 ? -width : width}px)`;
			pendingSwipeResetRef.current = true;
			swipeFromProfileIdRef.current = currentProfileIdRef.current;
			const side = dx < 0 ? "next" : "prev";
			const landingPreview = side === "next" ? nextProfilePreviewRef.current : prevProfilePreviewRef.current;
			if (landingPreview) setSwipeLanding({ side, preview: landingPreview });
			swipeResetTimerRef.current = setTimeout(() => {
				go();
				// Fallback in case loading hangs or nothing we watch changes.
				swipeResetTimerRef.current = setTimeout(resetProfileSwipeOffset, 10_000);
			}, 200);
		};

		el.addEventListener("touchstart", onStart, { passive: true });
		el.addEventListener("touchmove", onMove, { passive: false });
		el.addEventListener("touchend", onEnd, { passive: true });
		el.addEventListener("touchcancel", onEnd, { passive: true });
		return () => {
			el.removeEventListener("touchstart", onStart);
			el.removeEventListener("touchmove", onMove);
			el.removeEventListener("touchend", onEnd);
			el.removeEventListener("touchcancel", onEnd);
		};
	}, [
		isOpen,
		selectedPhotoIndex,
		variant,
		hasProfileNeighbors,
		resetProfileSwipeOffset,
	]);

	useModalClose({ isOpen, onClose });
	const handleBackdropClose = useMemo(
		() => createBackdropCloseHandler(onClose),
		[onClose],
	);

	useEffect(() => {
		if (!isOpen) {
			setSelectedPhotoIndex(null);
		}
	}, [isOpen]);

	useEffect(() => {
		setSelectedPhotoIndex(null);
		setMobileCarouselPhotoIndex(0);
	}, [activeProfile?.profileId, activeProfilePhotoHashes.length]);

	useEffect(() => {
		const update = () => setIsModalSplit(window.innerWidth >= 900);
		window.addEventListener("resize", update);
		return () => window.removeEventListener("resize", update);
	}, []);

	// Keep refs in sync so the wheel handler always sees current values
	carouselIndexRef.current = mobileCarouselPhotoIndex;

	useEffect(() => {
		const el = mobileCarouselRef.current;
		if (!el || isModalSplit) return;
		const onWheel = (e: WheelEvent) => {
			const idx = carouselIndexRef.current;
			const total = carouselTotalRef.current;
			if (e.deltaY > 0 && idx < total - 1) {
				e.preventDefault();
				setMobileCarouselPhotoIndex((i) => Math.min(i + 1, total - 1));
			} else if (e.deltaY < 0 && idx > 0) {
				e.preventDefault();
				setMobileCarouselPhotoIndex((i) => Math.max(i - 1, 0));
			}
			// At boundary: don't preventDefault → scroll propagates normally
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [isModalSplit]);

	const photoCreatedAtByHash = useMemo(() => {
		if (!activeProfile) {
			return {} as Record<string, { createdAt: number | null; takenOnGrindr: boolean | null }>;
		}

		const createdMap: Record<string, { createdAt: number | null; takenOnGrindr: boolean | null }> = {};
		for (const media of activeProfile.medias) {
			const hash = media.mediaHash;
			if (!hash) {
				continue;
			}

			createdMap[hash] = {
				createdAt: normalizeMediaCreatedAt(media.createdAt),
				takenOnGrindr: media.takenOnGrindr ?? null,
			};
		}

		return createdMap;
	}, [activeProfile]);

	const hasRightNowSlide = !!(
		activeProfile &&
		!shouldHideField(activeProfile.rightNowText?.trim()) &&
		(activeProfile.rightNowFullImageUrl || activeProfile.rightNowThumbnailUrl)
	);
	const rightNowSlideUrl = activeProfile?.rightNowFullImageUrl || activeProfile?.rightNowThumbnailUrl || null;

	// Lazily checked once this profile's detail view is open (not per grid
	// tile) — hasAlbum is sticky (stays true once we've ever locally cached
	// an album for this profile), hasSharedWithMe always reflects the latest
	// live check and drives the lock-vs-cover decision on the slide.
	const albumStatus = useProfileAlbumStatus(
		messageProfileId != null ? String(messageProfileId) : null,
		!isOwnProfile && messageProfileId != null,
	);

	// True only when there's genuinely nothing photo-like to show for this
	// profile yet — mirrors the pre-album condition that used to gate the
	// standalone default-avatar placeholder, so that behavior (no separate
	// placeholder once a Right Now slide already fills that role) is unchanged.
	const showDefaultProfileSlide = activeProfilePhotoHashes.length === 0 && !hasRightNowSlide;

	// The photo set shown in both carousels and the full-screen viewer: the
	// default-avatar placeholder (if there's no real photo or Right Now slide
	// to show instead) first, then the Right Now post's image (if any), then
	// the profile's own photos, then the album slide (if any) last.
	const carouselHashes = useMemo(() => {
		const base = hasRightNowSlide ? [RIGHT_NOW_SLIDE_HASH, ...activeProfilePhotoHashes] : activeProfilePhotoHashes;
		const withDefault = showDefaultProfileSlide ? [DEFAULT_PROFILE_SLIDE_HASH, ...base] : base;
		return albumStatus.hasAlbum ? [...withDefault, ALBUM_SLIDE_HASH] : withDefault;
	}, [hasRightNowSlide, activeProfilePhotoHashes, albumStatus.hasAlbum, showDefaultProfileSlide]);
	const getSlideImageUrl = (hash: string) => {
		if (hash === RIGHT_NOW_SLIDE_HASH) return rightNowSlideUrl ?? "";
		if (hash === ALBUM_SLIDE_HASH) return albumStatus.coverUrl ?? "";
		if (hash === DEFAULT_PROFILE_SLIDE_HASH) return "";
		const url = getProfileImageUrl(hash, "1024x1024");
		return resolveAvatarSrc(hash, url, { cache: isChatLinkedProfile, sourceUrl: url }) ?? url;
	};
	// Same as getSlideImageUrl but for the smaller sizes used in the shared
	// album locked-state backdrop — kept separate since a real hash is
	// guaranteed here (no sentinel slide hashes to special-case).
	const getPhotoUrlAtSize = (hash: string, size: "1024x1024" | "320x320") => {
		const url = getProfileImageUrl(hash, size);
		return resolveAvatarSrc(hash, url, { cache: isChatLinkedProfile, sourceUrl: url }) ?? url;
	};
	const isRightNowSlideActive = carouselHashes[mobileCarouselPhotoIndex] === RIGHT_NOW_SLIDE_HASH;
	carouselTotalRef.current = carouselHashes.length;

	// Excludes the album and default-avatar slides (always last/first, if
	// present) — neither opens this generic photo viewer (album opens the
	// album viewer, the default slide has no real photo to show fullscreen),
	// and since PhotoViewer wraps navigation with modulo, leaving them in
	// would let swiping past the boundary land on an unstyled "photo".
	const photoUrls = useMemo(() => {
		return carouselHashes
			.filter((hash) => hash !== ALBUM_SLIDE_HASH && hash !== DEFAULT_PROFILE_SLIDE_HASH)
			.map((hash) => getSlideImageUrl(hash));
	}, [carouselHashes, rightNowSlideUrl]);

	const renderPhotoExtraInfo = useCallback(
		(index: number) => {
			const hash = carouselHashes[index];

			if (hash === RIGHT_NOW_SLIDE_HASH) {
				return (
					<p
						className="inline-flex items-center gap-1 rounded-full bg-black/50 px-3 py-1 text-xs font-semibold shadow-[0_2px_8px_rgba(0,0,0,0.3)] backdrop-blur-md"
						style={{ color: "var(--right-now)" }}
					>
						<RightNowIcon className="h-3.5 w-3.5" />
						<span>{t("profile_details.right_now")}</span>
					</p>
				);
			}

			const meta = photoCreatedAtByHash[hash];
			if (!meta?.takenOnGrindr && !meta?.createdAt) return null;

			return (
				<p className="inline-flex items-center gap-1 rounded-full bg-black/50 px-3 py-1 text-xs font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,0.3)] backdrop-blur-md">
                    <style>{`
                        @keyframes logo-shine { 0%, 100% { filter: drop-shadow(0 0 2px rgba(255,140,0,0.3)) brightness(1); } 50% { filter: drop-shadow(0 0 7px rgba(255,140,0,0.95)) brightness(1.25); } }
                        .logo-shine { animation: logo-shine 2.8s ease-in-out infinite; }
                    `}</style>
					{meta.takenOnGrindr ? (
						<img
							src={freegrindLogo}
							alt={t("chat.thread.taken_on_grindr")}
							className="h-3.5 w-3.5 rounded-full logo-shine"
						/>
					) : null}
					{meta.createdAt ? (
						<span>{formatDateTime24(meta.createdAt)}</span>
					) : null}
				</p>
			);
		},
		[carouselHashes, photoCreatedAtByHash, t],
	);

	// The profile payload's tapType is the one we sent; the received type
	// only comes with the interest list.
	const { data: interestData } = useInterestData();
	const receivedTapType = useMemo(() => {
		const profileId = activeProfile?.profileId;
		if (!profileId) return null;
		return interestData?.taps?.find((item) => item.profileId === String(profileId))?.tapType ?? null;
	}, [interestData?.taps, activeProfile?.profileId]);

	// Bottom left of the profile carousel: "taken on Grindr" for the photo in
	// view, then when they last tapped you, as matching glass pills.
	const renderCarouselCornerBadges = () => {
		const meta = photoCreatedAtByHash[carouselHashes[mobileCarouselPhotoIndex]];
		const tapTimestamp = activeProfile?.lastReceivedTapTimestamp ?? null;
		if (!meta?.takenOnGrindr && tapTimestamp == null) return null;
		return (
			<div className="pointer-events-none absolute bottom-3 left-3 z-20 flex flex-row items-center gap-1.5">
				{meta?.takenOnGrindr ? (
					<TakenOnGrindrBadge variant="pill" label={meta.createdAt ? formatTakenOnGrindrSentence(meta.createdAt, Date.now(), t) : null} />
				) : null}
				{tapTimestamp != null ? (
					<div className="flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1.5 backdrop-blur-sm">
						<span className="text-sm leading-none select-none">{getTapEmoji(receivedTapType)}</span>
						<span className="text-xs font-medium text-white">{formatRelativeTime(tapTimestamp)}</span>
					</div>
				) : null}
			</div>
		);
	};

	const renderPhotoFooter = useCallback(
		(index: number) => {
			const hash = carouselHashes[index];
			if (hash === RIGHT_NOW_SLIDE_HASH || !onSendProfilePhotoReply || !messageProfileId || isOwnProfile) {
				return null;
			}
			return (
				<PhotoActionBar
					onSendText={(text) => onSendProfilePhotoReply(String(messageProfileId), hash, text)}
				/>
			);
		},
		[carouselHashes, onSendProfilePhotoReply, messageProfileId, isOwnProfile],
	);

	// The photo viewer gets its own history entry so system back closes it
	// instead of leaving the profile. The flag is merged into the existing
	// state so the router still sees the same location underneath.
	const photoViewerHistoryPushedRef = useRef(false);

	// Where the opened photo sits on screen, so the viewer can fly it in from there.
	const [photoViewerHeroRect, setPhotoViewerHeroRect] = useState<HeroRect | null>(null);

	// Safe-for-work mode: the slides show placeholders, so there's no photo to open.
	const profilePhotoPrivacy = useProfilePhotoPrivacy();
	// Blurred photos: the first tap unblurs a slide, the next opens it (like chat media).
	const photoReveal = useBlurReveal(profilePhotoPrivacy === "blur");
	const openPhotoViewer = (index: number, heroRect?: HeroRect | null) => {
		if (profilePhotoPrivacy === "hide") return;
		setPhotoViewerHeroRect(heroRect ?? null);
		setSelectedPhotoIndex(index);
		if (!photoViewerHistoryPushedRef.current) {
			window.history.pushState({ ...(window.history.state as object | null), profilePhotoViewer: true }, "");
			photoViewerHistoryPushedRef.current = true;
		}
	};

	const closePhotoViewer = () => {
		setSelectedPhotoIndex(null);
		if (!photoViewerHistoryPushedRef.current) return;
		// Cleared first so our own popstate handler ignores this pop.
		photoViewerHistoryPushedRef.current = false;
		if (variant === "page") {
			window.history.back();
		} else {
			// Modal over the grid (desktop): popping would make the router
			// re-render the grid route, so just drop the flag in place.
			const state = window.history.state as Record<string, unknown> | null;
			if (state?.profilePhotoViewer) {
				const { profilePhotoViewer: _omit, ...rest } = state;
				window.history.replaceState(rest, "");
			}
		}
	};

	useEffect(() => {
		const onPopState = () => {
			if (!photoViewerHistoryPushedRef.current) return;
			if ((window.history.state as { profilePhotoViewer?: boolean } | null)?.profilePhotoViewer) return;
			photoViewerHistoryPushedRef.current = false;
			setSelectedPhotoIndex(null);
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	useEffect(() => {
		// Profile closed underneath an open viewer — forget the entry.
		if (!isOpen) photoViewerHistoryPushedRef.current = false;
	}, [isOpen]);

	// Own profile pictures aren't worth their own subfolder — there's only
	// ever one "me" to organize by. Someone else's photos get filed under
	// their profile id so saved pictures land sorted by person instead of
	// all dumped in one flat folder.
	const photoViewerFolderKey = !isOwnProfile && messageProfileId != null ? String(messageProfileId) : null;

	const [isSavingAllPhotos, setIsSavingAllPhotos] = useState(false);

	const handleSaveAllPhotos = useCallback(async () => {
		if (isSavingAllPhotos || photoUrls.length === 0) return;
		setIsSavingAllPhotos(true);
		try {
			await saveAllMedia(
				photoUrls.map((url) => ({ url, type: "image" as const })),
				photoViewerFolderKey,
				t,
			);
		} finally {
			setIsSavingAllPhotos(false);
		}
	}, [isSavingAllPhotos, photoUrls, photoViewerFolderKey, t]);

	const photoMenuActions = useMemo<PhotoViewerMenuAction[]>(() => [
		{
			key: "save-all",
			label: t("profile_details.save_all"),
			icon: Images,
			onClick: () => void handleSaveAllPhotos(),
			disabled: isSavingAllPhotos || photoUrls.length === 0,
		},
	], [t, handleSaveAllPhotos, isSavingAllPhotos, photoUrls.length]);

	const photoViewerOverlay = selectedPhotoIndex !== null && (
		<PhotoViewer
			isOpen={true}
			onClose={closePhotoViewer}
			photos={photoUrls}
			initialIndex={selectedPhotoIndex}
			renderExtraInfo={renderPhotoExtraInfo}
			renderFooter={renderPhotoFooter}
			conversationId={photoViewerFolderKey}
			menuActions={photoMenuActions}
			heroRect={photoViewerHeroRect}
		/>
	);

	// Opening the album shared with this profile — mirrors
	// SharedAlbumsPage.tsx's openViewer: mark it opened, fetch full content,
	// fall back to whatever's already cached locally if the live fetch fails,
	// and eagerly capture it so it survives the share later expiring.
	const [albumViewer, setAlbumViewer] = useState<AlbumViewer | null>(null);
	const hasReactedToAlbumContent = useAlbumContentReactions(userId, albumViewer !== null);
	const [albumViewerIndex, setAlbumViewerIndex] = useState(0);
	const [isOpeningAlbum, setIsOpeningAlbum] = useState(false);
	const [isSavingAllAlbumMedia, setIsSavingAllAlbumMedia] = useState(false);
	// Browse-first sheet (openAlbumAsBottomSheet) — the full-screen viewer is
	// only shown once an item is picked, and closing it returns to the sheet.
	const [isAlbumSheetOpen, setIsAlbumSheetOpen] = useState(false);
	const [isAlbumViewerShown, setIsAlbumViewerShown] = useState(false);
	const albumViewerShownRef = useRef(false);
	albumViewerShownRef.current = albumViewer != null && isAlbumViewerShown;
	const albumSheetOpenRef = useRef(false);
	albumSheetOpenRef.current = isAlbumSheetOpen;

	// The album an open is in flight for; cleared when the viewer closes.
	const pendingAlbumOpenIdRef = useRef<number | null>(null);
	const resetAlbumViewerState = useCallback(() => {
		// Closed while still loading: the pending open is dropped.
		pendingAlbumOpenIdRef.current = null;
		setIsOpeningAlbum(false);
		setAlbumViewer(null);
		setAlbumViewerIndex(0);
		setIsAlbumSheetOpen(false);
		setIsAlbumViewerShown(false);
	}, []);

	// Pushes the viewer's own history entry. Keeps the router state but drops
	// an open sheet's tag, so the locked sheet underneath can tell this entry
	// isn't its own and hands Android back to it.
	const pushAlbumViewerHistory = useCallback(() => {
		const state = window.history.state as Record<string, unknown> | null;
		if (state?.profileAlbumViewer) return;
		const { bottomSheet: _sheet, bottomSheetId: _sheetId, ...rest } = state ?? {};
		window.history.pushState({ ...rest, profileAlbumViewer: true }, "");
	}, []);

	useEffect(() => {
		const onPopState = () => {
			// While only the sheet is showing it handles its own history entry.
			if (!albumViewerShownRef.current) return;
			if ((window.history.state as { profileAlbumViewer?: boolean } | null)?.profileAlbumViewer) return;
			if (albumSheetOpenRef.current) {
				setIsAlbumViewerShown(false);
				return;
			}
			resetAlbumViewerState();
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, [resetAlbumViewerState]);

	// Where the tapped tile sits in the album sheet, for the viewer's hero open.
	const [albumViewerHeroRect, setAlbumViewerHeroRect] = useState<HeroRect | null>(null);
	const handleSelectAlbumContent = useCallback((index: number, heroRect?: HeroRect | null) => {
		setAlbumViewerHeroRect(heroRect ?? null);
		setAlbumViewerIndex(index);
		setIsAlbumViewerShown(true);
		pushAlbumViewerHistory();
	}, [pushAlbumViewerHistory]);

	const closeAlbumViewer = useCallback(() => {
		const state = window.history.state as Record<string, unknown> | null;
		if (isAlbumSheetOpen) {
			// Back to the sheet — the entry sits on top of the sheet's own one
			// on the same route, so popping it is safe in both variants.
			if (state?.profileAlbumViewer) window.history.back();
			setIsAlbumViewerShown(false);
			return;
		}
		if (state?.profileAlbumViewer) {
			if (variant === "page") {
				// Pop the entry instead of leaving a stale duplicate behind,
				// which made the next system back appear to do nothing. The
				// popstate handler above just re-applies the close below.
				window.history.back();
			} else {
				// Modal over the grid (desktop): popping would make the router
				// re-render the grid route, so just drop the flag in place.
				const { profileAlbumViewer: _omit, ...rest } = state;
				window.history.replaceState(rest, "");
			}
		}
		resetAlbumViewerState();
	}, [variant, isAlbumSheetOpen, resetAlbumViewerState]);

	const handleAlbumViewerIndexChange = useCallback((index: number) => {
		setAlbumViewerIndex((prev) => (prev === index ? prev : index));
	}, []);

	const handleSaveAllAlbumMedia = useCallback(async () => {
		if (!albumViewer || isSavingAllAlbumMedia) return;
		setIsSavingAllAlbumMedia(true);
		try {
			await saveAllAlbumMedia(albumViewer, t);
		} finally {
			setIsSavingAllAlbumMedia(false);
		}
	}, [albumViewer, isSavingAllAlbumMedia, t]);

	const albumMenuActions = useMemo<PhotoViewerMenuAction[]>(() => {
		if (!albumViewer) return [];
		return [
			{
				key: "save-all",
				label: t("profile_details.save_all"),
				icon: Images,
				onClick: () => void handleSaveAllAlbumMedia(),
				disabled: isSavingAllAlbumMedia || albumViewer.content.length === 0,
			},
		];
	}, [albumViewer, isSavingAllAlbumMedia, t, handleSaveAllAlbumMedia]);

	const sendAlbumContentReaction = useCallback(
		async (albumId: number, albumContentId: number, targetProfileId: number) => {
			try {
				await apiFunctions.sendMessage({
					type: "AlbumContentReaction",
					target: { type: "Direct", targetId: targetProfileId },
					body: { albumId, albumContentId },
				});
				markAlbumContentReacted(albumId, albumContentId);
				toast.success(t("chat.toasts.album_reaction_sent", { defaultValue: "Reaction sent" }));
			} catch (error) {
				toast.error(error instanceof Error ? error.message : t("chat.errors.send_failed"));
			}
		},
		[apiFunctions, t],
	);

	const sendAlbumContentReply = useCallback(
		async (
			albumId: number,
			albumContentId: number,
			contentType: string | null | undefined,
			targetProfileId: number,
			text: string,
		) => {
			try {
				await apiFunctions.sendMessage({
					type: "AlbumContentReply",
					target: { type: "Direct", targetId: targetProfileId },
					body: { albumId, albumContentId, albumContentReply: text, contentType: contentType ?? "image/jpeg" },
				});
				toast.success(t("chat.toasts.album_reply_sent", { defaultValue: "Reply sent" }));
			} catch (error) {
				toast.error(error instanceof Error ? error.message : t("chat.errors.send_failed"));
			}
		},
		[apiFunctions, t],
	);

	const albumHeader = useMemo(() => {
		if (!albumViewer) return undefined;
		return {
			avatarUrl: albumViewer.profileMediaHash
				? getProfileImageUrl(albumViewer.profileMediaHash, "320x320")
				: null,
			name: albumViewer.profileName,
			subtitle: [profileStatusLabel, profileDistance != null ? formatDistance(profileDistance, t, unitsPreset) : null]
				.filter(Boolean)
				.join(" · ") || null,
			isOnline: profileStatusMeta.isOnline,
			isOnlineEndingSoon: profileStatusMeta.isEndingSoon,
		};
	}, [albumViewer, profileStatusLabel, profileDistance, profileStatusMeta.isOnline, profileStatusMeta.isEndingSoon, t, unitsPreset]);

	const handleAlbumSlideClick = useCallback(async () => {
		if (!albumStatus.hasSharedWithMe || albumStatus.albumId == null || isOpeningAlbum || messageProfileId == null) {
			return;
		}
		const albumId = albumStatus.albumId;
		const profileIdNum = Number(messageProfileId);
		// Either straight into the full-screen viewer, or into the browse-first
		// sheet, which pushes its own history entry.
		const presentAlbum = () => {
			setAlbumViewerIndex(0);
			if (openAlbumAsBottomSheet) {
				setIsAlbumSheetOpen(true);
				setIsAlbumViewerShown(false);
				return;
			}
			setIsAlbumViewerShown(true);
			pushAlbumViewerHistory();
		};
		const meta = {
			albumId,
			albumName: null,
			profileId: profileIdNum,
			profileName: activeProfileName,
			profileMediaHash: activeProfilePhotoHashes[0] ?? null,
			onlineUntil: profileOnlineUntil,
			distanceMetres: profileDistance,
			conversationId: null,
		};
		// Open right away; the viewer or sheet shows its own loading state
		// until the content arrives.
		pendingAlbumOpenIdRef.current = albumId;
		setIsOpeningAlbum(true);
		setAlbumViewer({ ...meta, content: [] });
		presentAlbum();
		// Ignored once the album was closed meanwhile.
		const isStillOpening = () => pendingAlbumOpenIdRef.current === albumId;
		try {
			await apiFunctions.openSharedAlbum({ albumId });
			const details = await apiFunctions.getAlbum(albumId);
			if (isStillOpening()) {
				setAlbumViewer({ ...meta, albumId: details.albumId, albumName: details.albumName, content: details.content });
			}
			void captureAlbum({
				albumId: details.albumId,
				albumName: details.albumName,
				content: details.content,
				ownerProfileId: String(messageProfileId),
				conversationId: null,
				sharedViaMessageId: null,
				remainingViews: null,
				isViewable: true,
			});
		} catch (error) {
			const local = await getLocalAlbum(albumId).catch(() => null);
			if (!isStillOpening()) return;
			if (local && local.content.length > 0) {
				setAlbumViewer({ ...meta, albumId: local.albumId, albumName: local.albumName, content: local.content });
			} else {
				if (openAlbumAsBottomSheet) resetAlbumViewerState();
				else closeAlbumViewer();
				toast.error(error instanceof Error ? error.message : t("shared_albums.error_open_fallback"));
			}
		} finally {
			if (isStillOpening()) {
				pendingAlbumOpenIdRef.current = null;
				setIsOpeningAlbum(false);
			}
		}
	}, [albumStatus.hasSharedWithMe, albumStatus.albumId, isOpeningAlbum, apiFunctions, messageProfileId, activeProfileName, activeProfilePhotoHashes, profileOnlineUntil, profileDistance, t, openAlbumAsBottomSheet, pushAlbumViewerHistory, resetAlbumViewerState, closeAlbumViewer]);

	const albumViewerPhotos = useMemo(() => {
		if (!albumViewer) return [];
		return albumViewer.content.map((item) => ({
			url: item.url || item.thumbUrl || item.coverUrl || "",
			type: (item.contentType?.startsWith("video/") ? "video" : "image") as "image" | "video",
		}));
	}, [albumViewer]);

	// "We just hooked up" — same encounter logging as the chat header
	// menu, gated by the same Sexual Health optional-feature toggle.
	const [showSexualHealth] = useState(isSexualHealthEnabled);
	const [showLocate] = useState(isLocateEnabled);
	const [encounterPrefill, setEncounterPrefill] = useState<PickedPerson | null>(null);
	const canLogEncounter = showSexualHealth && messageProfileId != null && !isOwnProfile;

	const handleLogEncounter = async () => {
		setIsActionsMenuOpen(false);
		if (messageProfileId == null) return;
		const profileId = String(messageProfileId);
		const conversation = await findConversationByProfileId(profileId).catch(() => null);
		const avatarHash = activeProfilePhotoHashes[0] ?? null;
		setEncounterPrefill({
			profileId,
			conversationId: conversation?.conversationId ?? null,
			displayName: activeProfileName,
			avatarSrc: avatarHash ? resolveAvatarSrc(avatarHash, getProfileImageUrl(avatarHash, "320x320")) : null,
		});
	};

	// Same local nickname as the chat header menu's "Set nickname" — an
	// empty value clears it.
	const [isNicknamePromptOpen, setIsNicknamePromptOpen] = useState(false);
	const [isSavingNickname, setIsSavingNickname] = useState(false);
	// Snapshot profiles are stored copies, so their name may be outdated.
	const nicknameNameChange = useNicknameNameChange(
		isOwnProfile ? null : messageProfileId,
		localNickname,
		isSnapshotProfile ? null : actualProfileName,
	);
	const { acknowledge: acknowledgeNicknameNameChange } = nicknameNameChange;
	// Opening the menu shows the rename (in the nickname item), so it counts as seen.
	useEffect(() => {
		if (isActionsMenuOpen) acknowledgeNicknameNameChange();
	}, [isActionsMenuOpen, acknowledgeNicknameNameChange]);

	const handleEditNickname = () => {
		setIsActionsMenuOpen(false);
		if (messageProfileId == null || !onLocalNicknameChange) return;
		setIsNicknamePromptOpen(true);
	};

	const handleSaveNickname = async (value: string) => {
		if (messageProfileId == null || !onLocalNicknameChange) return;
		const profileId = String(messageProfileId);
		const normalized = value.trim() || null;
		setIsSavingNickname(true);
		try {
			await setLocalNicknameForProfile(profileId, normalized);
			onLocalNicknameChange(profileId, normalized);
			toast.success(normalized ? t("chat.nicknames.saved") : t("chat.nicknames.cleared"));
			setIsNicknamePromptOpen(false);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t("chat.nicknames.save_failed"));
		} finally {
			setIsSavingNickname(false);
		}
	};

	const nicknameMenuItem =
		onLocalNicknameChange && messageProfileId != null && !isOwnProfile ? (
			<button
				type="button"
				onClick={handleEditNickname}
				className="flex items-center rounded-sm px-2 py-2 text-left text-sm text-[var(--text)] transition hover:bg-[var(--surface-2)]"
			>
				<PencilLineFilled className="mr-2 h-4 w-4 opacity-70" />
				<NicknameMenuItemLabel
					label={localNickname ? t("chat.nicknames.edit") : t("chat.nicknames.set")}
					realName={nicknameNameChange.realName}
					previousName={nicknameNameChange.previousName}
				/>
			</button>
		) : null;
	const nicknameNameChangeBadge = nicknameNameChange.hasUnseenChange ? <NicknameNameChangeBadge /> : null;

	const encounterMenuItem = canLogEncounter ? (
		<button
			type="button"
			onClick={() => void handleLogEncounter()}
			className="flex items-center rounded-sm px-2 py-2 text-left text-sm text-[var(--text)] transition hover:bg-[var(--surface-2)]"
		>
			<BananaFilled className="mr-2 h-4 w-4 opacity-70" />
			{t("chat.log_encounter", { defaultValue: "We just hooked up" })}
		</button>
	) : null;

	const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
	const closeReportDialog = useCallback(() => setIsReportDialogOpen(false), []);

	const reportMenuItem =
		messageProfileId != null && !isOwnProfile && !isSnapshotProfile ? (
			<>
			<div className="h-px shrink-0 bg-[var(--border)]" />
			<div className="flex flex-col gap-1 px-2">
			<button
				type="button"
				onClick={() => { setIsActionsMenuOpen(false); setIsReportDialogOpen(true); }}
				className="flex items-center rounded-sm px-2 py-2 text-left text-sm text-red-400 transition hover:bg-[var(--surface-2)]"
			>
				<Flag className="mr-2 h-4 w-4 fill-current opacity-70" />
				{t("profile_details.report.menu_item")}
			</button>
			</div>
			</>
		) : null;

	const reportDialog = messageProfileId != null ? (
		<ReportProfileDialog
			isOpen={isReportDialogOpen}
			profileId={String(messageProfileId)}
			onClose={closeReportDialog}
			onBlock={onBlockProfile && !isBlocked ? () => onBlockProfile(String(messageProfileId)) : undefined}
		/>
	) : null;

	const nicknamePrompt = (
		<PromptDialog
			isOpen={isNicknamePromptOpen}
			title={localNickname ? t("chat.nicknames.edit") : t("chat.nicknames.set")}
			message={t("chat.nicknames.prompt")}
			defaultValue={localNickname || actualProfileName}
			placeholder={actualProfileName || undefined}
			confirmLabel={t("common.save", { defaultValue: "Save" })}
			cancelLabel={t("chat.actions.cancel")}
			onConfirm={handleSaveNickname}
			onCancel={() => setIsNicknamePromptOpen(false)}
			isProcessing={isSavingNickname}
			allowEmpty
			rows={1}
		/>
	);

	const encounterSheet = encounterPrefill ? (
		<EncounterLogSheet
			prefill={encounterPrefill}
			onClose={() => setEncounterPrefill(null)}
		/>
	) : null;

	const albumViewerOverlay = albumViewer && (
		<>
		{isAlbumSheetOpen ? (
			<AlbumMediaSheet
				albumName={albumViewer.albumName}
				content={albumViewer.content}
				onClose={resetAlbumViewerState}
				onSelect={handleSelectAlbumContent}
				locked={isAlbumViewerShown}
				isLoading={isOpeningAlbum}
			/>
		) : null}
		<PhotoViewer
			isOpen={isAlbumViewerShown}
			onClose={closeAlbumViewer}
			photos={albumViewerPhotos}
			initialIndex={albumViewerIndex}
			onIndexChange={handleAlbumViewerIndexChange}
			menuActions={albumMenuActions}
			albumHeader={albumHeader}
			isLoading={isOpeningAlbum}
			heroRect={albumViewerHeroRect}
			// Only gate directly-opened albums — the sheet already showed the
			// album's contents, so the warning would be redundant per item.
			contentWarning={showAlbumSensitiveContentWarning && !isAlbumSheetOpen}
			renderFooter={(idx) => {
				const item = albumViewer.content[idx];
				if (!item || messageProfileId == null || isOwnProfile) return null;
				const targetProfileId = Number(messageProfileId);
				return (
					<PhotoActionBar
						onSendText={(text) =>
							sendAlbumContentReply(albumViewer.albumId, item.contentId, item.contentType, targetProfileId, text)
						}
						onReact={() => sendAlbumContentReaction(albumViewer.albumId, item.contentId, targetProfileId)}
						reacted={hasReactedToAlbumContent(albumViewer.albumId, item.contentId)}
					/>
				);
			}}
		/>
		</>
	);

	// Shared between both the mobile/inline and split-desktop carousel
	// blocks below — renders a slide's tappable content for a given hash,
	// swapping in the album cover/lock overlay in place of a plain photo.
	const renderCarouselSlideContent = (hash: string, index: number) => {
		if (hash === DEFAULT_PROFILE_SLIDE_HASH) {
			// Non-interactive, same as the old standalone placeholder — there's
			// no real photo behind this slide to open a viewer for.
			return (
				<ProfileImage alt={t("profile_details.default_profile")} className="h-full w-full object-cover" />
			);
		}

		if (hash === ALBUM_SLIDE_HASH) {
			const isLocked = !albumStatus.hasSharedWithMe;
			const primaryPhotoHash = activeProfilePhotoHashes[0];
			const showAlbumCover = !isLocked && !!albumStatus.coverUrl;
			return (
				<>
					<button
						type="button"
						onClick={() => void handleAlbumSlideClick()}
						className="absolute inset-0 z-10"
						aria-label={t(isLocked ? "profile_details.album_locked" : "profile_details.open_shared_album")}
					/>
					{showAlbumCover ? (
						<img
							src={proxyMediaUrl(albumStatus.coverUrl) ?? undefined}
							alt=""
							className="h-full w-full scale-110 object-cover blur-[2px] brightness-[0.55]"
						/>
					) : (
						<>
							{/* Locked (or cover not loaded yet) — frosted-glass backdrop of
							the profile's own picture (or the default avatar) instead of a
							flat black background. */}
							<ProfileImage
								src={primaryPhotoHash ? getPhotoUrlAtSize(primaryPhotoHash, "1024x1024") : null}
								alt=""
								className="h-full w-full scale-110 object-cover blur-2xl brightness-[0.55]"
							/>
							<div className="pointer-events-none absolute inset-0 bg-black/25 backdrop-blur-sm" aria-hidden="true" />
						</>
					)}
					<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
						{isLocked ? (
							<div className="flex flex-col items-center gap-8">
								<LockKeyhole className="h-10 w-10 text-white/90 drop-shadow-lg" />
								<span className="text-xs font-bold uppercase tracking-wide text-white/90 drop-shadow-lg">
									{t("profile_details.album_locked_label")}
								</span>
							</div>
						) : (
							<div className="h-20 w-20 overflow-hidden rounded-full ring-2 ring-white/80 shadow-xl">
								<ProfileImage
									src={primaryPhotoHash ? getPhotoUrlAtSize(primaryPhotoHash, "320x320") : null}
									alt=""
									className="h-full w-full object-cover"
								/>
							</div>
						)}
					</div>
				</>
			);
		}

		return (
			<>
				<button
					type="button"
					// The button covers the whole (object-cover) slide: its rect is the photo's visible area.
					onClick={(e) => {
						if (photoReveal.revealOnTap(hash)) return;
						openPhotoViewer(index, e.currentTarget.getBoundingClientRect());
					}}
					{...photoReveal.hoverProps(hash)}
					className="absolute inset-0 z-10"
					aria-label={t("profile_details.open_photo", { index: index + 1 })}
				/>
				<ProfileImage
					src={getSlideImageUrl(hash)}
					alt={t("profile_details.photo_alt", { name: activeProfileName })}
					className="h-full w-full object-cover"
					revealed={!photoReveal.isBlurred(hash)}
				/>
			</>
		);
	};

	// Floating bar to message or tap the profile: one frosted pill hovering
	// over the content, like the location sheet's search (MapSheetSearch).
	// Message turns into a filled send button once there's text.
	const renderQuickMessageBar = (paddingBottom: string) => {
		const sendDraft = () => {
			if (!quickMessageDraft.trim()) return;
			onSendQuickMessage?.(String(messageProfileId), quickMessageDraft.trim());
			setQuickMessageDraft("");
		};
		const hasDraft = quickMessageDraft.trim().length > 0;
		return (
			// The dark fade stays from before; only the pill takes touches.
			<div
				className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-3"
				style={{
					paddingTop: "5rem",
					paddingBottom,
					background: "linear-gradient(to top, rgba(0,0,0,0.80) 0%, rgba(0,0,0,0.7) 45%, transparent 100%)",
				}}
			>
				{isProfileUnavailable ? (
					<div className="flex items-center justify-center gap-2 pb-1">
						<ShieldCheck className="h-4 w-4 text-white/60" />
						<p className="text-sm font-medium text-white/70">{t("profile_details.snapshot_banner.title")}</p>
					</div>
				) : (
					<div
						ref={controlsBarRef}
						className="pointer-events-auto flex items-center gap-1"
						onPointerDown={(e) => e.stopPropagation()}
					>
						{/* Just the field floats as a pill; tap and chat sit next to it.
						    It fades out while the tap picker is open. */}
						<div
							className="min-w-0 flex-1 rounded-full bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] p-1 shadow-[0_2px_6px_rgba(0,0,0,0.18),0_8px_28px_rgba(0,0,0,0.32)] ring-1 ring-[var(--border)]/50 backdrop-blur-xl focus-within:ring-2 focus-within:ring-[var(--accent)]"
							style={{
								pointerEvents: barInputVisible ? "auto" : "none",
								opacity: barInputVisible ? 1 : 0,
								transition: barInputVisible ? "opacity 0.25s" : "opacity 0.12s",
							}}
						>
							<input
								type="text"
								value={quickMessageDraft}
								onChange={(e) => setQuickMessageDraft(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") sendDraft();
								}}
								enterKeyHint="send"
								placeholder={t("profile_details.quick_message_placeholder", "Message...")}
								className="h-10 w-full bg-transparent px-4 text-[15px] text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none"
							/>
						</div>
						<div
							className="transition-[max-width] duration-200 ease-out"
							style={{ maxWidth: barTapPickerOpen ? `${3 * 52}px` : "0px", overflowX: barTapPickerOpen ? "visible" : "clip", overflowY: "visible" }}
						>
							<div ref={barTapOptionsRef} className="flex items-center">
								{[0, 2, 1].map((id) => (
									<div
										key={id}
										data-tap-id={id}
										onClick={() => fireTap(id)}
										onMouseEnter={() => setBarTapHoverId(id)}
										onMouseLeave={() => setBarTapHoverId(null)}
										className={`flex h-12 w-13 cursor-pointer items-center justify-center text-2xl leading-none transition-all duration-150 ${barTapHoverId === id ? "origin-bottom scale-[2] opacity-100" : "opacity-60"}`}
										style={barTapHoverId === id ? { filter: barTapGlow(id) } : undefined}
									>
										{barTapEmoji(id)}
									</div>
								))}
							</div>
						</div>
						<button
							ref={barTapButtonRef}
							type="button"
							onPointerDown={handleBarTapPointerDown}
							onPointerMove={handleBarTapPointerMove}
							onPointerUp={handleBarTapPointerUp}
							onPointerCancel={() => { setBarTapPickerOpen(false); setBarTapHoverId(null); barTapStickyRef.current = false; if (barTapLongPressRef.current) clearTimeout(barTapLongPressRef.current); barInputTimerRef.current = setTimeout(() => setBarInputVisible(true), 210); }}
							disabled={isTapDisabled}
							aria-label={t("profile_details.tap", { defaultValue: "Tap" })}
							className={`tap-btn-base bar-icon-btn relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-none bg-transparent text-2xl leading-none transition-all active:scale-90 touch-none select-none ${isTappingProfile ? "opacity-40" : ""} ${barTapPickerOpen ? "text-white/70" : isTapActive || barTapHoverId !== null ? "text-white" : "text-white/70"}`}
							style={isTapBlocked ? { filter: barTapGlow(tapVisualState.tapId) } : !barTapPickerOpen && barTapHoverId !== null ? { filter: barTapGlow(barTapHoverId) } : undefined}
						>
							{barTapPickerOpen
								? <X className="h-5 w-5" strokeWidth={2} />
								: barTapHoverId !== null
									? barTapEmoji(barTapHoverId)
									: isTapActive
										? barTapEmoji(tapVisualState.tapId)
										: <Flame className="h-5 w-5" strokeWidth={1.8} />
							}
						</button>
						{(onMessageProfile || onSendQuickMessage) && (
							<button
								type="button"
								onClick={() => {
									haptic(10);
									if (hasDraft) sendDraft();
									else onMessageProfile?.(String(messageProfileId));
								}}
								aria-label={hasDraft ? t("chat.send") : t("profile_details.message")}
								className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition active:scale-90 ${hasDraft ? "bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-80" : "bar-icon-btn text-[var(--accent)]"}`}
							>
								{hasDraft ? (
									<SendHorizontalFilled className="h-5 w-5" />
								) : (
									<span className="relative inline-flex">
										<MessageCircle className="h-5 w-5" strokeWidth={1.8} />
										{(chatContactStatus?.unreadCount ?? 0) > 0 && (
											<span className="absolute -top-1.5 -right-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[9px] font-bold text-[var(--accent-contrast)] shadow-sm">
												{chatContactStatus?.unreadCount}
											</span>
										)}
									</span>
								)}
							</button>
						)}
					</div>
				)}
			</div>
		);
	};

	// A swipe preview's body: the cached profile through the same content
	// component, without anything that would fetch (notes, Spotify, …) or react
	// to input — the panel is display-only.
	const queryClient = useQueryClient();
	const previewCarouselRef = useRef<HTMLDivElement | null>(null);
	const renderPreviewDetails = (detail: ProfileDetail) => {
		const flags = getContentFlags(detail);
		const meta = getOnlineStatusMeta(detail.seen, detail.onlineUntil);
		const status = getProfileStatusDisplay(meta, t);
		return (
			<ProfileDetailsContent
				activeProfile={detail}
				activeProfilePhotoHashes={[]}
				isDesktopLike={isDesktopLike}
				showMobileCarousel={false}
				mobileCarouselRef={previewCarouselRef}
				mobileCarouselPhotoIndex={0}
				openPhotoViewer={() => {}}
				activeProfileName={detail.displayName?.trim() || t("profile_details.anonymous", "Someone")}
				estimatedCreatedAt={formatEstimatedAccountCreation(detail.profileId, t)}
				travelPlans={queryClient.getQueryData<TravelPlan[]>(["travel-plans", String(detail.profileId)])}
				profileStatusLabel={status.label}
				profileStatusLevel={status.level}
				ownTags={ownTags}
				profileDistance={detail.distance ?? null}
				chatContactStatus={null}
				messageProfileId={String(detail.profileId)}
				isTapDisabled
				isTapBlocked={false}
				isTapActive={false}
				tapId={1}
				tapButtonClassName=""
				{...flags}
				{...contentLabels}
				hidePicturesSection
				isPreview
			/>
		);
	};

	const renderInlineLayout = () => (
		<>
			{/* Floating header — transparent over carousel, opaque after scrolling */}
			<div
				className="pointer-events-none absolute inset-x-0 top-0 z-40 px-[var(--app-px)]"
				style={{
					// 40px button row centred on the shared header line (see --header-icon-center).
					paddingTop: variant === "page" ? "calc(var(--header-icon-center) - 1.25rem)" : "0.75rem",
					paddingBottom: "0.75rem",
				}}
			>
				<div
					// Frosted like the other headers (86% + blur) instead of turning fully solid.
					ref={headerBgRef}
					// Opacity is driven by the scroll handler above.
					className={`absolute inset-0 opacity-0 backdrop-blur-xl ${variant === "page" ? "bg-[color-mix(in_srgb,var(--bg)_86%,transparent)]" : "bg-[color-mix(in_srgb,var(--surface-2)_86%,transparent)]"}${inlineScrolled ? " border-b border-[var(--border)]/60" : ""}`}
					aria-hidden="true"
				/>
				<div className="pointer-events-auto relative flex w-full items-center gap-3">
					<button
						type="button"
						onClick={onClose}
						className={`header-icon-btn header-icon-btn--back shrink-0 rounded-xl border p-2 transition-colors ${inlineScrolled ? "border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)]" : "border-white/45 bg-transparent text-white shadow-[0_10px_28px_-18px_rgba(0,0,0,0.95)] backdrop-blur-md drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"}`}
						aria-label={t(variant === "page" ? "settings.back_to_browse" : "profile_details.close_profile_details")}
					>
						<ChevronLeft className="h-4 w-4" />
					</button>
					<div className={`min-w-0 flex-1${inlineScrolled ? "" : " drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)]"}`}>
						<div className="flex items-center gap-1.5 min-w-0">
							<p className={`truncate text-base font-semibold leading-tight${inlineScrolled ? "" : " text-white"}`}>{activeProfileName}</p>
							{activeProfile?.age != null && Number.isFinite(activeProfile.age) && (
								<span className={`shrink-0 text-sm${inlineScrolled ? " text-[var(--text-muted)]" : " text-white/70"}`}>{activeProfile.age}</span>
							)}
						</div>
						<p className={`text-xs leading-tight${inlineScrolled ? " text-[var(--text-muted)]" : " text-white/70"}`}>
							{[profileStatusLabel, profileDistance != null ? formatDistance(profileDistance, t, unitsPreset) : null].filter(Boolean).join(" · ")}
						</p>
					</div>
					{isOwnProfile && (
						<button
							type="button"
							onClick={toggleOwnProfileEdit}
							className={`header-icon-btn inline-flex shrink-0 items-center justify-center rounded-xl border p-2 transition-colors ${inlineScrolled ? "border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)]" : "border-white/45 bg-transparent text-white shadow-[0_10px_28px_-18px_rgba(0,0,0,0.95)] backdrop-blur-md drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"}`}
							aria-label={ownProfileEditLabel}
							title={ownProfileEditLabel}
						>
							{isEditingOwnProfile ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
						</button>
					)}
					{messageProfileId && !isOwnProfile && (
						<div className="flex shrink-0 items-center gap-0.5">
							{onToggleFavoriteProfile && !isProfileUnavailable && (
								<button
									type="button"
									onClick={() => { haptic(10); void onToggleFavoriteProfile(String(messageProfileId), isFavorite); }}
									disabled={isTogglingFavorite}
									className={`header-icon-btn inline-flex shrink-0 items-center justify-center rounded-xl border p-2 transition-colors disabled:opacity-60 ${
										isFavorite
											? `header-icon-btn--active border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)] ${inlineScrolled ? "" : "shadow-[0_10px_28px_-18px_rgba(0,0,0,0.95)] backdrop-blur-md drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"}`
											: inlineScrolled ? "border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)]" : "border-white/45 bg-transparent text-white shadow-[0_10px_28px_-18px_rgba(0,0,0,0.95)] backdrop-blur-md drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"
									}`}
									aria-label={isFavorite ? t("chat.unfavorite") : t("chat.favorite")}
								>
									<Star className={`h-4 w-4 ${isFavorite ? "fill-current" : ""}`} />
								</button>
							)}
							{(onBlockProfile || onUnblockProfile) && !isBlockedByOther && (isBlocked || !isSnapshotProfile) && (
								<button
									type="button"
									onClick={() => isBlocked ? onUnblockProfile?.(String(messageProfileId)) : (messageProfileId && onBlockProfile?.(String(messageProfileId)))}
									disabled={isBlockingProfile}
									className={`header-icon-btn inline-flex shrink-0 items-center justify-center rounded-xl border p-2 transition-colors disabled:opacity-60 ${
										isBlocked
											? inlineScrolled ? "border-emerald-500 bg-transparent text-emerald-500" : "border-emerald-500 bg-transparent text-emerald-500 shadow-[0_10px_28px_-18px_rgba(0,0,0,0.95)] backdrop-blur-md drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"
											: inlineScrolled ? "border-red-500 bg-transparent text-red-500" : "border-red-500 bg-transparent text-red-500 shadow-[0_10px_28px_-18px_rgba(0,0,0,0.95)] backdrop-blur-md drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"
									}`}
									aria-label={isBlocked ? t("profile_details.unblock") : t("profile_details.block")}
								>
									{isBlocked ? <ShieldCheck className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
								</button>
							)}
							<div ref={actionsMenuRef} className="relative">
								<button
									type="button"
									onClick={() => setIsActionsMenuOpen((v) => !v)}
									className={`header-icon-btn inline-flex shrink-0 items-center justify-center rounded-xl border p-2 transition-colors ${inlineScrolled ? "border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--text)]" : "border-white/45 bg-transparent text-white shadow-[0_10px_28px_-18px_rgba(0,0,0,0.95)] backdrop-blur-md drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"}`}
									aria-label={t("profile_details.more_actions", { defaultValue: "More actions" })}
									aria-expanded={isActionsMenuOpen}
								>
									<EllipsisVertical className="h-4 w-4" />
								</button>
								{nicknameNameChangeBadge}
								{actionsMenuPresence.rendered && (
									<div data-lenis-prevent style={menuTransitionStyle(actionsMenuPresence.visible)} className="absolute right-0 top-full z-50 mt-1 flex max-h-[calc(100dvh-8rem)] min-w-[190px] flex-col gap-2 overflow-y-auto overscroll-contain rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2 shadow-lg">
										<div className="flex flex-col gap-1 px-2">
										{showLocate && (
										<button
											type="button"
											disabled={isTriangleDisabled}
											onClick={() => { setIsActionsMenuOpen(false); if (messageProfileId) onTriangleProfile?.(String(messageProfileId)); }}
											className="flex items-center rounded-sm px-2 py-2 text-left text-sm text-[var(--text)] transition hover:bg-[var(--surface-2)] disabled:opacity-50"
										>
											<LocateFixedFilled className="mr-2 h-4 w-4 opacity-70" />
											{locateLabel ?? t("profile_details.locate")}
										</button>
										)}
										{(onHideProfile || onUnhideProfile) && (
										<button
											type="button"
											disabled={isProfileUnavailable}
											onClick={() => { setIsActionsMenuOpen(false); if (!messageProfileId || isProfileUnavailable) return; isHidden ? onUnhideProfile?.(String(messageProfileId)) : onHideProfile?.(String(messageProfileId)); }}
											className="flex items-center rounded-sm px-2 py-2 text-left text-sm text-[var(--text)] transition hover:bg-[var(--surface-2)] disabled:opacity-50"
										>
											{isHidden ? <EyeFilled className="mr-2 h-4 w-4 opacity-70" /> : <EyeOffFilled className="mr-2 h-4 w-4 opacity-70" />}
											{isHidden ? t("profile_details.unhide") : t("profile_details.hide")}
										</button>
										)}
										{nicknameMenuItem}
										{encounterMenuItem}
										</div>
										{(hasBio || actualProfileName) && <div className="h-px shrink-0 bg-[var(--border)]" />}
										{(hasBio || actualProfileName) && (
										<div className="flex flex-col gap-1 px-2">
										{hasBio && (
											<button
												type="button"
												onClick={handleBanBioPhrase}
												className="flex items-center rounded-sm px-2 py-2 text-left text-sm text-[var(--text)] transition hover:bg-[var(--surface-2)]"
											>
												<Ban className="mr-2 h-4 w-4 opacity-70" />
												<span className="flex flex-col">
													<span>{t("profile_details.ban_bio_title")}</span>
													<span className="text-xs text-[var(--text-muted)]">{t("profile_details.ban_keyword_source_bio", { defaultValue: "Bio phrase" })}</span>
												</span>
											</button>
										)}
										{actualProfileName && (
											<button
												type="button"
												onClick={handleBanProfileName}
												className="flex items-center rounded-sm px-2 py-2 text-left text-sm text-[var(--text)] transition hover:bg-[var(--surface-2)]"
											>
												<Ban className="mr-2 h-4 w-4 opacity-70" />
												<span className="flex flex-col">
													<span>{t("profile_details.ban_bio_title")}</span>
													<span className="text-xs text-[var(--text-muted)]">{t("profile_details.ban_keyword_source_name", { defaultValue: "Profile name" })}</span>
												</span>
											</button>
										)}
										</div>
										)}
										{reportMenuItem}
									</div>
								)}
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Scrollable content — carousel first, profile details below */}
			<div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-lenis-prevent>
				{isLoadingActiveProfile && (
					<div
						className="animate-pulse bg-[var(--surface-2)]"
						style={{ height: variant === "page" ? PAGE_CAROUSEL_HEIGHT : "min(55dvh, calc((100vw - 3rem) * 1.25))" }}
						aria-hidden="true"
					/>
				)}
				{!isLoadingActiveProfile && !activeProfileError && activeProfile && (
					<div
						ref={mobileCarouselRef}
						className="relative overflow-hidden bg-black"
						style={{ height: variant === "page" ? PAGE_CAROUSEL_HEIGHT : "min(55dvh, calc((100vw - 3rem) * 1.25))" }}
					>
						{isRightNowSlideActive && (
							<div
								className="pointer-events-none absolute inset-0 z-30"
								style={{ boxShadow: "inset 0 0 34px -10px color-mix(in srgb, color-mix(in srgb, var(--right-now), black 25%), transparent 35%)" }}
								aria-hidden="true"
							/>
						)}
						<div
							className="pointer-events-none absolute inset-x-0 top-0 z-10"
							style={{ height: "12rem", background: "linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, transparent 100%)" }}
							aria-hidden="true"
						/>
						{carouselHashes.map((hash, index) => (
							<div
								key={hash}
								className="absolute inset-0 overflow-hidden"
								style={{
									// --carousel-drag / --carousel-transition are set on the
									// carousel by ProfileDetailsContent's touch handler.
									transform: `translateY(calc(${(index - mobileCarouselPhotoIndex) * 100}% + var(--carousel-drag, 0px)))`,
									transition: "var(--carousel-transition, transform 300ms ease-out)",
								}}
							>
								{renderCarouselSlideContent(hash, index)}
							</div>
						))}
						{renderCarouselCornerBadges()}
						{carouselHashes.length > 1 && (
							<div className="absolute inset-y-0 right-3 z-20 flex flex-col items-center justify-center">
								<div className="flex flex-col items-center gap-1.5 rounded-full bg-black/30 px-[5px] py-[10px] backdrop-blur-sm">
									{carouselHashes.map((hash, index) => (
										<button
											key={`${hash}-dot`}
											type="button"
											onClick={() => {
												if (index !== mobileCarouselPhotoIndex) haptic(8);
												setMobileCarouselPhotoIndex(index);
											}}
											className="flex items-center justify-center p-1.5 -m-1.5"
											aria-label={t("profile_details.open_photo", { index: index + 1 })}
										>
											{hash === RIGHT_NOW_SLIDE_HASH ? (
												<span
													className="flex w-1.5 shrink-0 items-center justify-center overflow-visible transition-[height] duration-300 ease-out"
													style={{ height: index === mobileCarouselPhotoIndex ? "12px" : "6px" }}
												>
													<RightNowIcon
														className="h-3 w-3 shrink-0 scale-[0.55] transition-colors duration-150 ease-out"
														style={{ color: index === mobileCarouselPhotoIndex ? "var(--right-now)" : "rgba(255,255,255,0.4)" }}
														fill="currentColor"
													/>
												</span>
											) : hash === ALBUM_SLIDE_HASH ? (
												<span
													className="flex w-1.5 shrink-0 items-center justify-center overflow-visible transition-[height] duration-300 ease-out"
													style={{ height: index === mobileCarouselPhotoIndex ? "12px" : "6px" }}
												>
													<Album
														className="h-3 w-3 shrink-0 scale-[0.6] transition-colors duration-150 ease-out"
														style={{ color: index === mobileCarouselPhotoIndex ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.4)" }}
													/>
												</span>
											) : (
												<span
													className={`w-1.5 rounded-full transition-[height,background-color] duration-300 ease-out ${
														index === mobileCarouselPhotoIndex ? "h-3 bg-white" : "h-1.5 bg-white/40"
													}`}
												/>
											)}
										</button>
									))}
								</div>
							</div>
						)}
					</div>
				)}
				<div className={`p-4 sm:p-5 ${isEditingOwnProfile ? "pb-0 sm:pb-0" : variant === "page" ? "pb-[calc(env(safe-area-inset-bottom,0px)+6rem)] sm:pb-[calc(env(safe-area-inset-bottom,0px)+6rem)]" : "pb-28"}`}>
					{isLoadingActiveProfile ? (
						<ProfileDetailsSkeleton />
					) : activeProfileError ? (
						<p className="text-sm text-[var(--text-muted)]">{activeProfileError}</p>
					) : activeProfile && isOwnProfile && isEditingOwnProfile ? (
						<OwnProfileEditPanel onDone={finishOwnProfileEdit} onDirtyChange={setHasUnsavedOwnEdits} onPhotoHashesChange={setEditedOwnPhotoHashes} />
					) : activeProfile ? (
						<ProfileDetailsContent
							activeProfile={activeProfile}
							activeProfilePhotoHashes={carouselHashes}
							isDesktopLike={isDesktopLike}
							showMobileCarousel={true}
							mobileCarouselRef={mobileCarouselRef}
							mobileCarouselPhotoIndex={mobileCarouselPhotoIndex}
							openPhotoViewer={openPhotoViewer}
							activeProfileName={activeProfileName}
							estimatedCreatedAt={estimatedCreatedAt}
							travelPlans={travelPlans}
							profileStatusLabel={profileStatusLabel}
							profileStatusLevel={profileStatusLevel}
							// No "in common" highlight on your own profile — every tag would match.
							ownTags={isOwnProfile ? undefined : ownTags}
							profileDistance={profileDistance}
							chatContactStatus={chatContactStatus ?? null}
							messageProfileId={messageProfileId}
							onMessageProfile={variant === "page" && !isOwnProfile ? onMessageProfile : undefined}
							onTapProfile={variant === "page" && !isOwnProfile ? onTapProfile : undefined}
							onTagClick={onTagClick}
							onPhotoIndexChange={setMobileCarouselPhotoIndex}
							isTapDisabled={isTapDisabled}
							isTapBlocked={isTapBlocked}
							isTapActive={isTapActive}
							tapId={tapVisualState.tapId}
							tapButtonClassName={tapButtonClassName}
							hasTagsContent={hasTagsContent}
							hasAboutContent={hasAboutContent}
							hasExpectationsFields={hasExpectationsFields}
							hasHealthFields={hasHealthFields}
							hasStatsFields={hasStatsFields}
							hasSocialFields={hasSocialFields}
							formattedActiveGenders={formattedActiveGenders}
							formattedActivePronouns={formattedActivePronouns}
							lookingForLabels={lookingForLabels}
							meetAtLabels={meetAtLabels}
							nsfwLabels={nsfwLabels}
							tribeLabels={tribeLabels}
							hivStatusLabels={hivStatusLabels}
							sexualHealthLabels={sexualHealthLabels}
							vaccineLabels={vaccineLabels}
							sexualPositionLabels={sexualPositionLabels}
							bodyTypeLabels={bodyTypeLabels}
							ethnicityLabels={ethnicityLabels}
							relationshipStatusLabels={relationshipStatusLabels}
							extraTopSection={notesSectionJsx}
							isChatLinkedProfile={isChatLinkedProfile}
							hidePicturesSection={true}
							isOnCard={variant !== "page"}
						/>
					) : null}
				</div>
			</div>

			{/* Floating message bar, like the chat's composer */}
			{messageProfileId && !isOwnProfile &&
				renderQuickMessageBar(variant === "page" ? "calc(env(safe-area-inset-bottom,0px) + 0.75rem)" : "0.75rem")}
		</>
	);

	if (!isOpen) {
		return null;
	}

	if (variant === "page") {
		return (
			<div className="app-screen relative flex h-dvh flex-col w-full !px-0 !pb-0 !pt-0 overflow-x-hidden bg-[var(--bg)]">
				<div
					ref={pageWrapRef}
					// translateX is driven by the profile swipe handler.
					className="relative flex h-full flex-col"
				>
				{swipeLanding?.side === "prev" ? (
					<ProfileSwipePreviewPanel preview={swipeLanding.preview} side="prev" renderDetails={renderPreviewDetails} />
				) : prevProfilePreview && onPrevProfile ? (
					<ProfileSwipePreviewPanel preview={prevProfilePreview} side="prev" renderDetails={renderPreviewDetails} />
				) : null}
				{swipeLanding?.side === "next" ? (
					<ProfileSwipePreviewPanel preview={swipeLanding.preview} side="next" renderDetails={renderPreviewDetails} />
				) : nextProfilePreview && onNextProfile ? (
					<ProfileSwipePreviewPanel preview={nextProfilePreview} side="next" renderDetails={renderPreviewDetails} />
				) : null}
				{renderInlineLayout()}
				{photoViewerOverlay}
				{albumViewerOverlay}
				{encounterSheet}
				{nicknamePrompt}
				{reportDialog}
				{discardEditsDialog}
				<PromptDialog
					isOpen={banBioPrompt !== null}
					title={t("profile_details.ban_bio_title")}
					message={t("profile_details.ban_bio_prompt")}
					defaultValue={banBioPrompt?.text ?? ""}
					confirmLabel={t("chat.actions.ban_word_confirm", { defaultValue: "Add" })}
					cancelLabel={t("chat.actions.cancel")}
					onConfirm={(wordToBan) => {
						const currentList = getForbiddenWords();
						const newList = currentList ? `${currentList}, ${wordToBan}` : wordToBan;
						void setForbiddenWords(newList);
						toast.success(t("profile_details.ban_bio_added", { word: wordToBan }));
						setBanBioPrompt(null);
					}}
					onCancel={() => setBanBioPrompt(null)}
				/>
				<PromptDialog
					isOpen={banNamePrompt !== null}
					title={t("profile_details.ban_bio_title")}
					message={t("chat.actions.ban_name_prompt", {
						defaultValue: "Trim this down to the exact name or phrase you want to ban:",
					})}
					defaultValue={banNamePrompt?.text ?? ""}
					confirmLabel={t("chat.actions.ban_word_confirm", { defaultValue: "Add" })}
					cancelLabel={t("chat.actions.cancel")}
					onConfirm={(wordToBan) => {
						const currentList = getForbiddenWords();
						const newList = currentList ? `${currentList}, ${wordToBan}` : wordToBan;
						void setForbiddenWords(newList);
						toast.success(t("profile_details.ban_bio_added", { word: wordToBan }));
						setBanNamePrompt(null);
					}}
					onCancel={() => setBanNamePrompt(null)}
				/>
				{barTapFlyEmoji && <TapFlyBurst burst={barTapFlyEmoji} />}
				</div>
			</div>
		);
	}

	return (
		<div
			className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6"
			onClick={handleBackdropClose}
		>
			<div
				className="native-card flex w-full max-w-[min(80vw,1300px)] overflow-hidden rounded-2xl"
				style={{
					flexDirection: isModalSplit ? "row" : "column",
					maxHeight: isModalSplit ? "calc(100dvh - 8rem)" : "calc(100dvh - 1.5rem)",
					height: isModalSplit ? "calc(100dvh - 8rem)" : undefined,
				}}
				onClick={(event) => event.stopPropagation()}
			>
				{/* Left panel: full-height photo carousel (split mode only) */}
				{isModalSplit && isLoadingActiveProfile && (
					<div className="relative shrink-0 animate-pulse overflow-hidden bg-[var(--surface-2)]" style={{ width: "54%" }} aria-hidden="true" />
				)}
				{isModalSplit && !isLoadingActiveProfile && !activeProfileError && activeProfile && (
					<div
						className="relative shrink-0 overflow-hidden bg-black"
						style={{ width: "54%" }}
						onWheel={(e) => {
							e.preventDefault();
							if (e.deltaY > 0) setMobileCarouselPhotoIndex((i) => Math.min(i + 1, carouselHashes.length - 1));
							else if (e.deltaY < 0) setMobileCarouselPhotoIndex((i) => Math.max(i - 1, 0));
						}}
					>
						{isRightNowSlideActive && (
							<div
								className="pointer-events-none absolute inset-0 z-30"
								style={{ boxShadow: "inset 0 0 34px -10px color-mix(in srgb, color-mix(in srgb, var(--right-now), black 25%), transparent 35%)" }}
								aria-hidden="true"
							/>
						)}
						{carouselHashes.map((hash, index) => (
							<div
								key={hash}
								className="absolute inset-0 overflow-hidden"
								style={{
									transform: `translateY(${(index - mobileCarouselPhotoIndex) * 100}%)`,
									transition: "transform 300ms ease-out",
								}}
							>
								{renderCarouselSlideContent(hash, index)}
							</div>
						))}
						{renderCarouselCornerBadges()}
						{carouselHashes.length > 1 && (
							<>
								<button
									type="button"
									onClick={() => setMobileCarouselPhotoIndex((i) => Math.max(i - 1, 0))}
									disabled={mobileCarouselPhotoIndex === 0}
									aria-label={t("profile_details.previous_photo")}
									className="absolute left-1/2 top-3 z-20 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/60 disabled:opacity-0 disabled:pointer-events-none"
								>
									<ChevronUp className="h-4 w-4" />
								</button>
								<button
									type="button"
									onClick={() => setMobileCarouselPhotoIndex((i) => Math.min(i + 1, carouselHashes.length - 1))}
									disabled={mobileCarouselPhotoIndex === carouselHashes.length - 1}
									aria-label={t("profile_details.next_photo")}
									className="absolute bottom-3 left-1/2 z-20 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/60 disabled:opacity-0 disabled:pointer-events-none"
								>
									<ChevronDown className="h-4 w-4" />
								</button>
							</>
						)}
						{carouselHashes.length > 1 && (
							<div className="absolute inset-y-0 right-4 z-20 flex flex-col items-center justify-center">
								<div className="flex flex-col items-center gap-2 rounded-full bg-black/30 px-[7px] py-[14px] backdrop-blur-sm">
									{carouselHashes.map((hash, index) => (
										<button
											key={`${hash}-dot`}
											type="button"
											onClick={() => {
												if (index !== mobileCarouselPhotoIndex) haptic(8);
												setMobileCarouselPhotoIndex(index);
											}}
											className="flex items-center justify-center p-1.5 -m-1.5"
											aria-label={t("profile_details.open_photo", { index: index + 1 })}
										>
											{hash === RIGHT_NOW_SLIDE_HASH ? (
												<span
													className="flex w-2 shrink-0 items-center justify-center overflow-visible transition-[height] duration-300 ease-out"
													style={{ height: index === mobileCarouselPhotoIndex ? "16px" : "8px" }}
												>
													<RightNowIcon
														className="h-4 w-4 shrink-0 scale-[0.55] transition-colors duration-150 ease-out"
														style={{ color: index === mobileCarouselPhotoIndex ? "var(--right-now)" : "rgba(255,255,255,0.4)" }}
														fill="currentColor"
													/>
												</span>
											) : hash === ALBUM_SLIDE_HASH ? (
												<span
													className="flex w-2 shrink-0 items-center justify-center overflow-visible transition-[height] duration-300 ease-out"
													style={{ height: index === mobileCarouselPhotoIndex ? "16px" : "8px" }}
												>
													<Album
														className="h-4 w-4 shrink-0 scale-[0.65] transition-colors duration-150 ease-out"
														style={{ color: index === mobileCarouselPhotoIndex ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.4)" }}
													/>
												</span>
											) : (
												<span
													className={`w-2 rounded-full transition-[height,background-color] duration-300 ease-out ${
														index === mobileCarouselPhotoIndex ? "h-4 bg-white" : "h-2 bg-white/40"
													}`}
												/>
											)}
										</button>
									))}
								</div>
							</div>
						)}
					</div>
				)}

				{/* Right column (or full width on non-split): header + content + footer */}
				<div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
					{!isModalSplit ? renderInlineLayout() : (
						<>
							{/* Solid split-mode header */}
							<div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] p-3">
								<div className="flex w-full items-center gap-3">
									<button type="button" onClick={onClose} className="header-icon-btn header-icon-btn--back shrink-0 rounded-xl text-[var(--text-muted)] transition-colors hover:text-[var(--text)]" aria-label={t("profile_details.close_profile_details")}>
										<ChevronLeft className="h-4 w-4" />
									</button>
									<div className="min-w-0 flex-1">
										<p className="truncate text-base font-semibold">{activeProfileName}</p>
									</div>
									{isOwnProfile && (
										<button type="button" onClick={toggleOwnProfileEdit} className="header-icon-btn shrink-0 rounded-xl text-[var(--text-muted)] transition-colors hover:text-[var(--text)]" aria-label={ownProfileEditLabel} title={ownProfileEditLabel}>
											{isEditingOwnProfile ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
										</button>
									)}
									{messageProfileId && !isOwnProfile && (
										<div className="flex shrink-0 items-center gap-0.5">
											{onToggleFavoriteProfile && !isProfileUnavailable && (
												<button type="button" onClick={() => { haptic(10); void onToggleFavoriteProfile(String(messageProfileId), isFavorite); }} disabled={isTogglingFavorite}
													className={`header-icon-btn shrink-0 rounded-xl transition-colors disabled:opacity-60 ${isFavorite ? "header-icon-btn--active" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}
													aria-label={isFavorite ? t("chat.unfavorite") : t("chat.favorite")}>
													<Star className={`h-4 w-4 ${isFavorite ? "fill-current" : ""}`} />
												</button>
											)}
											{(onBlockProfile || onUnblockProfile) && !isBlockedByOther && (isBlocked || !isSnapshotProfile) && (
												<button type="button" onClick={() => isBlocked ? onUnblockProfile?.(String(messageProfileId)) : (messageProfileId && onBlockProfile?.(String(messageProfileId)))} disabled={isBlockingProfile}
													className={`header-icon-btn shrink-0 rounded-xl transition-colors disabled:opacity-60 ${isBlocked ? "text-emerald-500" : "text-red-500"}`}
													aria-label={isBlocked ? t("profile_details.unblock") : t("profile_details.block")}>
													{isBlocked ? <ShieldCheck className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
												</button>
											)}
											<div ref={actionsMenuRef} className="relative">
												<button type="button" onClick={() => setIsActionsMenuOpen((v) => !v)}
													className="header-icon-btn shrink-0 rounded-xl text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
													aria-label={t("profile_details.more_actions", { defaultValue: "More actions" })} aria-expanded={isActionsMenuOpen}>
													<EllipsisVertical className="h-4 w-4" />
												</button>
												{nicknameNameChangeBadge}
												{actionsMenuPresence.rendered && (
													<div data-lenis-prevent style={menuTransitionStyle(actionsMenuPresence.visible)} className="absolute right-0 top-full z-50 mt-1 flex max-h-[calc(100dvh-8rem)] min-w-[190px] flex-col gap-2 overflow-y-auto overscroll-contain rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2 shadow-lg">
														<div className="flex flex-col gap-1 px-2">
														{showLocate && (
														<button type="button" disabled={isTriangleDisabled}
															onClick={() => { setIsActionsMenuOpen(false); if (messageProfileId) onTriangleProfile?.(String(messageProfileId)); }}
															className="flex items-center rounded-sm px-2 py-2 text-left text-sm text-[var(--text)] transition hover:bg-[var(--surface-2)] disabled:opacity-50">
															<LocateFixedFilled className="mr-2 h-4 w-4 opacity-70" />
															{locateLabel ?? t("profile_details.locate")}
														</button>
														)}
														{(onHideProfile || onUnhideProfile) && (
														<button
															type="button"
															disabled={isProfileUnavailable}
															onClick={() => { setIsActionsMenuOpen(false); if (!messageProfileId || isProfileUnavailable) return; isHidden ? onUnhideProfile?.(String(messageProfileId)) : onHideProfile?.(String(messageProfileId)); }}
															className="flex items-center rounded-sm px-2 py-2 text-left text-sm text-[var(--text)] transition hover:bg-[var(--surface-2)] disabled:opacity-50"
														>
															{isHidden ? <EyeFilled className="mr-2 h-4 w-4 opacity-70" /> : <EyeOffFilled className="mr-2 h-4 w-4 opacity-70" />}
															{isHidden ? t("profile_details.unhide") : t("profile_details.hide")}
														</button>
														)}
														{nicknameMenuItem}
														{encounterMenuItem}
														</div>
														{(hasBio || actualProfileName) && <div className="h-px shrink-0 bg-[var(--border)]" />}
														{(hasBio || actualProfileName) && (
														<div className="flex flex-col gap-1 px-2">
														{hasBio && (
															<button
																type="button"
																onClick={handleBanBioPhrase}
																className="flex items-center rounded-sm px-2 py-2 text-left text-sm text-[var(--text)] transition hover:bg-[var(--surface-2)]"
															>
																<Ban className="mr-2 h-4 w-4 opacity-70" />
																<span className="flex flex-col">
																	<span>{t("profile_details.ban_bio_title")}</span>
																	<span className="text-xs text-[var(--text-muted)]">{t("profile_details.ban_keyword_source_bio", { defaultValue: "Bio phrase" })}</span>
																</span>
															</button>
														)}
														{actualProfileName && (
															<button
																type="button"
																onClick={handleBanProfileName}
																className="flex items-center rounded-sm px-2 py-2 text-left text-sm text-[var(--text)] transition hover:bg-[var(--surface-2)]"
															>
																<Ban className="mr-2 h-4 w-4 opacity-70" />
																<span className="flex flex-col">
																	<span>{t("profile_details.ban_bio_title")}</span>
																	<span className="text-xs text-[var(--text-muted)]">{t("profile_details.ban_keyword_source_name", { defaultValue: "Profile name" })}</span>
																</span>
															</button>
														)}
														</div>
														)}
														{reportMenuItem}
													</div>
												)}
											</div>
										</div>
									)}
								</div>
							</div>
							{/* Split-mode content */}
							<div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-lenis-prevent>
								<div className={`p-4 sm:p-5 ${isEditingOwnProfile ? "pb-0 sm:pb-0" : "pb-28 sm:pb-28"}`}>
									{isLoadingActiveProfile ? (
										<ProfileDetailsSkeleton />
									) : activeProfileError ? (
										<p className="text-sm text-[var(--text-muted)]">{activeProfileError}</p>
									) : activeProfile && isOwnProfile && isEditingOwnProfile ? (
										<OwnProfileEditPanel onDone={finishOwnProfileEdit} onDirtyChange={setHasUnsavedOwnEdits} onPhotoHashesChange={setEditedOwnPhotoHashes} />
									) : activeProfile ? (
										<ProfileDetailsContent
											activeProfile={activeProfile}
											activeProfilePhotoHashes={carouselHashes}
											isDesktopLike={isDesktopLike}
											showMobileCarousel={false}
											mobileCarouselRef={mobileCarouselRef}
											mobileCarouselPhotoIndex={mobileCarouselPhotoIndex}
											openPhotoViewer={openPhotoViewer}
											activeProfileName={activeProfileName}
											estimatedCreatedAt={estimatedCreatedAt}
											travelPlans={travelPlans}
											profileStatusLabel={profileStatusLabel}
											profileStatusLevel={profileStatusLevel}
											// No "in common" highlight on your own profile — every tag would match.
											ownTags={isOwnProfile ? undefined : ownTags}
											profileDistance={profileDistance}
											chatContactStatus={chatContactStatus ?? null}
											messageProfileId={messageProfileId}
											onMessageProfile={undefined}
											onTapProfile={undefined}
											onTagClick={onTagClick}
											isTapDisabled={isTapDisabled}
											isTapBlocked={isTapBlocked}
											isTapActive={isTapActive}
											tapId={tapVisualState.tapId}
											tapButtonClassName={tapButtonClassName}
											hasTagsContent={hasTagsContent}
											hasAboutContent={hasAboutContent}
											hasExpectationsFields={hasExpectationsFields}
											hasHealthFields={hasHealthFields}
											hasStatsFields={hasStatsFields}
											hasSocialFields={hasSocialFields}
											formattedActiveGenders={formattedActiveGenders}
											formattedActivePronouns={formattedActivePronouns}
											lookingForLabels={lookingForLabels}
											meetAtLabels={meetAtLabels}
											nsfwLabels={nsfwLabels}
											tribeLabels={tribeLabels}
											hivStatusLabels={hivStatusLabels}
											sexualHealthLabels={sexualHealthLabels}
											vaccineLabels={vaccineLabels}
											sexualPositionLabels={sexualPositionLabels}
											bodyTypeLabels={bodyTypeLabels}
											ethnicityLabels={ethnicityLabels}
											relationshipStatusLabels={relationshipStatusLabels}
											extraTopSection={notesSectionJsx}
											isChatLinkedProfile={isChatLinkedProfile}
											hidePicturesSection={true}
											isOnCard
										/>
									) : null}
								</div>
							</div>
							{/* Split-mode footer */}
							{messageProfileId && !isOwnProfile && renderQuickMessageBar("0.75rem")}
						</>
					)}
				</div>
			</div>
			{barTapFlyEmoji && <TapFlyBurst burst={barTapFlyEmoji} />}
			{photoViewerOverlay}
			{albumViewerOverlay}
			{encounterSheet}
			{nicknamePrompt}
			{reportDialog}
			{discardEditsDialog}
			<PromptDialog
				isOpen={banBioPrompt !== null}
				title={t("profile_details.ban_bio_title")}
				message={t("profile_details.ban_bio_prompt")}
				defaultValue={banBioPrompt?.text ?? ""}
				confirmLabel={t("chat.actions.ban_word_confirm", { defaultValue: "Add" })}
				cancelLabel={t("chat.actions.cancel")}
				onConfirm={(wordToBan) => {
					const currentList = getForbiddenWords();
					const newList = currentList ? `${currentList}, ${wordToBan}` : wordToBan;
					void setForbiddenWords(newList);
					toast.success(t("profile_details.ban_bio_added", { word: wordToBan }));
					setBanBioPrompt(null);
				}}
				onCancel={() => setBanBioPrompt(null)}
			/>
			<PromptDialog
				isOpen={banNamePrompt !== null}
				title={t("profile_details.ban_bio_title")}
				message={t("chat.actions.ban_name_prompt", {
					defaultValue: "Trim this down to the exact name or phrase you want to ban:",
				})}
				defaultValue={banNamePrompt?.text ?? ""}
				confirmLabel={t("chat.actions.ban_word_confirm", { defaultValue: "Add" })}
				cancelLabel={t("chat.actions.cancel")}
				onConfirm={(wordToBan) => {
					const currentList = getForbiddenWords();
					const newList = currentList ? `${currentList}, ${wordToBan}` : wordToBan;
					void setForbiddenWords(newList);
					toast.success(t("profile_details.ban_bio_added", { word: wordToBan }));
					setBanNamePrompt(null);
				}}
				onCancel={() => setBanNamePrompt(null)}
			/>
		</div>
	);
}