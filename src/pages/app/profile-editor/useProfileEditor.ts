import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { useQueryClient } from "@tanstack/react-query";
import z from "zod";
import { centerCrop, makeAspectCrop, type Crop, type PixelCrop } from "react-image-crop";
import { useAuth } from "../../../contexts/useAuth";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { useApiFunctions } from "../../../hooks/useApiFunctions";
import {
	useManagedGenders,
	useManagedPronouns,
	useManagedTagCategories,
	useMySettings,
	useProfileSpotifyFavorites,
	useUpdateSpotifyFavorites,
	useTravelPlans,
	useCreateTravelPlan,
	useUpdateTravelPlan,
	useDeleteTravelPlan,
} from "../../../hooks/queries/useProfileQueries";
import type { TravelPlan } from "../../../types/travel";
import type { SpotifyTrack } from "../../../services/spotify";
import { BannedTermsError } from "../../../services/apiHelpers";
import type { MySettings } from "../../../types/api-functions";
import { validateMediaHash } from "../../../utils/media";
import { sanitizeUploadFile } from "../../../services/uploadSanitize";
import { buildTagLabelMap } from "../../../utils/tags";
import {
	getBodyTypeOptions,
	getEthnicityOptions,
	getHivStatusOptions,
	getLookingForOptions,
	getMeetAtOptions,
	getNsfwOptions,
	getRelationshipStatusOptions,
	getSexualHealthOptions,
	getSexualPositionOptions,
	getTribeOptions,
	getVaccineOptions,
	buildGenderOptions,
	getPrimaryGenderIds,
} from "../profile-option-builders";
import type { ToggleMultiValueKey } from "./ProfileEditorFormSections";
import { sameTrackIds } from "./SpotifyFavoritesSection";
import type { ProfilePoolImage } from "./ProfilePictureDrawer";
import {
	MAX_GENDERS,
	MAX_PROFILE_PHOTOS,
	MAX_PROFILE_TAGS,
	MEDIA_MODERATION_STATE,
	type ProfileDraft,
	buildSquareThumbCoords,
	buildThumbCoordsFromFraction,
	cropImageFile,
	type FractionalCrop,
	emptyDraft,
	parseMonthInput,
	parseNullableInteger,
	parseNullableHeightToCm,
	parseNullableWeightToGrams,
	normalizeTagList,
	profileSchema,
	profileToDraft,
	unwrapOwnProfile,
} from "./profileEditorUtils";

/** Same trips with the same details, in the same order. */
function sameTravelPlans(a: TravelPlan[], b: TravelPlan[]) {
	const key = (plan: TravelPlan) =>
		[plan.travelPlanId, plan.geohash, plan.startDate, plan.endDate, plan.showOnProfile, plan.notes ?? null].join("|");
	return a.length === b.length && a.every((plan, i) => key(plan) === key(b[i]));
}

// Grindr caps how many of each of these a profile can carry — enforced
// client-side here since the multi-select toggle is the only way to add one.
const MULTI_VALUE_MAX: Partial<Record<ToggleMultiValueKey, number>> = {
	genders: MAX_GENDERS,
	pronouns: 3,
	grindrTribes: 3,
	tribesImInto: 3,
};

/** Everything behind editing your own profile: loading it, the unsaved draft
 * (profile fields, Spotify favorites, map/Right Now settings), saving, and the
 * photo pool / upload flow. Shared by the profile editor page and the edit
 * mode of your own profile view, which only differ in how they lay it out. */
export function useProfileEditor() {
	const { t, i18n } = useTranslation();
	const { userId } = useAuth();
	const apiFunctions = useApiFunctions();
	const queryClient = useQueryClient();
	const { unitsPreset } = usePreferences();
	const [profile, setProfile] = useState<z.infer<typeof profileSchema> | null>(
		null,
	);
	// Raw, un-stripped profile JSON as returned by the server. Used as the base
	// for full-profile-replace saves so fields our local schema doesn't know
	// about (travel plans, right-now status, etc.) aren't lost on save.
	const [rawProfile, setRawProfile] = useState<Record<string, any> | null>(
		null,
	);
	const [isLoadingProfile, setIsLoadingProfile] = useState(true);
	const [profileError, setProfileError] = useState<string | null>(null);
	const [draft, setDraft] = useState<ProfileDraft>(emptyDraft);
	const [isSaving, setIsSaving] = useState(false);
	const [isSavingPhotos, setIsSavingPhotos] = useState(false);
	const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
	const [isPhotoDrawerOpen, setIsPhotoDrawerOpen] = useState(false);
	const [poolImages, setPoolImages] = useState<ProfilePoolImage[]>([]);
	const [isPoolLoading, setIsPoolLoading] = useState(false);
	const [poolError, setPoolError] = useState<string | null>(null);
	const [deletingPoolHash, setDeletingPoolHash] = useState<string | null>(null);
	const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);
	const [pendingPhotoTakenOnGrindr, setPendingPhotoTakenOnGrindr] = useState(false);
	// Two steps: "crop" cuts the uploaded photo itself (free aspect), then
	// "thumbnail" picks the square thumbnail region on the cropped result.
	const [photoUploadStep, setPhotoUploadStep] = useState<"crop" | "thumbnail">("crop");
	const [croppedPhotoFile, setCroppedPhotoFile] = useState<File | null>(null);
	const [isCroppingPhoto, setIsCroppingPhoto] = useState(false);
	const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
	const [photoCrop, setPhotoCrop] = useState<Crop | undefined>(undefined);
	const [photoCompletedCrop, setPhotoCompletedCrop] = useState<PixelCrop | undefined>(undefined);
	const [isDraggingPhotoCrop, setIsDraggingPhotoCrop] = useState(false);
	const photoImgRef = useRef<HTMLImageElement | null>(null);

	const photoPreviewFile = photoUploadStep === "thumbnail" ? croppedPhotoFile : pendingPhotoFile;
	useEffect(() => {
		if (!photoPreviewFile) {
			setPhotoPreviewUrl(null);
			setPhotoCrop(undefined);
			setPhotoCompletedCrop(undefined);
			return;
		}
		const url = URL.createObjectURL(photoPreviewFile);
		setPhotoPreviewUrl(url);
		setPhotoCrop(undefined);
		setPhotoCompletedCrop(undefined);
		return () => URL.revokeObjectURL(url);
	}, [photoPreviewFile]);

	// The crop step starts on the whole image (free aspect); the thumbnail step
	// is square-only — the server always renders thumbnails as squares. Seeds
	// photoCompletedCrop immediately (not just photoCrop) so confirming without
	// dragging still has a valid pixel rect — react-image-crop only fires its
	// own onComplete after a user-driven drag.
	const handlePhotoImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
		const { width, height } = event.currentTarget;
		const percentCrop: Crop = photoUploadStep === "crop"
			? { unit: "%", x: 0, y: 0, width: 100, height: 100 }
			: centerCrop(makeAspectCrop({ unit: "%", width: 90 }, 1, width, height), width, height);
		setPhotoCrop(percentCrop);
		setPhotoCompletedCrop({
			unit: "px",
			x: (percentCrop.x / 100) * width,
			y: (percentCrop.y / 100) * height,
			width: (percentCrop.width / 100) * width,
			height: (percentCrop.height / 100) * height,
		});
	}, [photoUploadStep]);

	// Tracks each photo's last-seen moderation state across reloads, so a
	// background poll can toast when one changes (e.g. pending -> approved)
	// instead of just silently updating the UI. Null until the first load.
	const previousModerationByHashRef = useRef<Map<string, number | null> | null>(null);

	const { data: managedGenders } = useManagedGenders();
	const { data: managedPronouns } = useManagedPronouns();
	const { data: managedTagCategories } = useManagedTagCategories(i18n.language);
	// The picker selects/stores tags by their catalog `key` (what the server
	// expects on save) — this resolves a key back to display text wherever a
	// tag needs to render as a chip (the "my tags" preview below).
	const tagLabelByKey = useMemo(
		() => buildTagLabelMap((managedTagCategories ?? []).flatMap((category) => category.tags)),
		[managedTagCategories],
	);

	const genderOptions = useMemo(() => buildGenderOptions(managedGenders), [managedGenders]);
	const defaultGenderIds = useMemo(() => getPrimaryGenderIds(managedGenders), [managedGenders]);

	const pronounOptions = useMemo(() => {
		if (!userId) return [];
		return managedPronouns?.map((item) => ({ value: item.pronounId, label: item.pronoun })) ?? [];
	}, [managedPronouns, userId]);

	const relationshipStatusOptions = useMemo(
		() => getRelationshipStatusOptions(t),
		[t],
	);

	const bodyTypeOptions = useMemo(
		() => getBodyTypeOptions(t),
		[t],
	);

	const ethnicityOptions = useMemo(
		() => getEthnicityOptions(t),
		[t],
	);

	const positionOptions = useMemo(
		() => getSexualPositionOptions(t),
		[t],
	);

	const lookingForOptions = useMemo(
		() => getLookingForOptions(t),
		[t],
	);

	const meetAtOptions = useMemo(
		() => getMeetAtOptions(t),
		[t],
	);

	const hivStatusOptions = useMemo(
		() => getHivStatusOptions(t),
		[t],
	);

	const nsfwOptions = useMemo(
		() => getNsfwOptions(t),
		[t],
	);

	const sexualHealthOptions = useMemo(
		() => getSexualHealthOptions(t),
		[t],
	);

	const vaccineOptions = useMemo(
		() => getVaccineOptions(t),
		[t],
	);

	const tribeOptions = useMemo(
		() => getTribeOptions(t),
		[t],
	);

	const loadProfile = useCallback(async (options?: { silent?: boolean }) => {
		if (!userId) {
			setProfile(null);
			setIsLoadingProfile(false);
			return;
		}

		try {
			if (!options?.silent) {
				setIsLoadingProfile(true);
			}
			setProfileError(null);
			// Read through /v4/me/profile (the counterpart of the /v4 + /v3
			// "me/profile*" endpoints used to save edits below) rather than
			// /v7/profiles/:id — that's a different read path used for viewing
			// other people's profiles, and can lag behind writes made here.
			const raw = await apiFunctions.getMyOwnProfile();
			const rawProfileObject = unwrapOwnProfile(raw);
			const parsed = profileSchema.parse(rawProfileObject);
			setProfile(parsed);
			setRawProfile(rawProfileObject);

			const nextModerationByHash = new Map<string, number | null>();
			for (const item of parsed.medias ?? []) {
				if (item.mediaHash) {
					nextModerationByHash.set(item.mediaHash, item.state ?? null);
				}
			}
			const previous = previousModerationByHashRef.current;
			if (previous) {
				for (const [hash, prevState] of previous) {
					const nextState = nextModerationByHash.get(hash);
					if (nextState === undefined || nextState === prevState) {
						continue;
					}
					if (nextState === MEDIA_MODERATION_STATE.APPROVED) {
						toast.success(t("profile_editor.toasts.photo_approved", { defaultValue: "One of your photos was approved." }));
					} else if (nextState === MEDIA_MODERATION_STATE.REJECTED) {
						toast.error(t("profile_editor.toasts.photo_rejected", { defaultValue: "One of your photos was rejected." }));
					} else if (nextState === MEDIA_MODERATION_STATE.PENDING) {
						toast(t("profile_editor.toasts.photo_pending_again", { defaultValue: "One of your photos is pending review again." }));
					}
				}
			}
			previousModerationByHashRef.current = nextModerationByHash;
		} catch (error) {
			setProfile(null);
			setRawProfile(null);
			setProfileError(
				error instanceof Error ? error.message : t("profile_editor.error_load"),
			);
		} finally {
			setIsLoadingProfile(false);
		}
	}, [apiFunctions, userId, t]);

	useEffect(() => {
		void loadProfile();
	}, [loadProfile]);

	const hasPendingPhotoModeration = useMemo(
		() => (profile?.medias ?? []).some((item) => item.state === MEDIA_MODERATION_STATE.PENDING),
		[profile?.medias],
	);

	// Periodically re-check moderation status while this page stays open and
	// at least one photo is still pending review — reviews can land while
	// the user is sitting here, and a silent reload (no loading spinner) is
	// the only way to surface that without a manual refresh. Once nothing is
	// pending anymore there's nothing left to learn from polling, so it
	// stops. Slower while the tab is hidden since there's nothing to show.
	useEffect(() => {
		if (!userId || !hasPendingPhotoModeration) {
			return;
		}
		const intervalId = window.setInterval(() => {
			void loadProfile({ silent: true });
		}, document.hidden ? 60_000 : 20_000);
		return () => window.clearInterval(intervalId);
	}, [userId, hasPendingPhotoModeration, loadProfile]);

	useEffect(() => {
		setDraft(profileToDraft(profile, unitsPreset));
	}, [profile, unitsPreset]);

	const savedDraft = useMemo(() => profileToDraft(profile, unitsPreset), [profile, unitsPreset]);

	const hasProfileChanges = useMemo(
		() => JSON.stringify(draft) !== JSON.stringify(savedDraft),
		[draft, savedDraft],
	);

	// Favorite songs live on their own endpoint but save and reset together
	// with the rest of the draft. null = untouched, so the saved list shows.
	const ownProfileId = profile?.profileId ?? userId;
	const spotifyProfileId = ownProfileId != null ? String(ownProfileId) : null;
	const { data: savedSpotifyTracks, isLoading: isLoadingSpotify } = useProfileSpotifyFavorites(spotifyProfileId);
	const updateSpotifyFavorites = useUpdateSpotifyFavorites(spotifyProfileId);
	const [spotifyDraft, setSpotifyDraft] = useState<SpotifyTrack[] | null>(null);
	const spotifyTracks = spotifyDraft ?? savedSpotifyTracks ?? [];
	const hasSpotifyChanges = spotifyDraft !== null && !sameTrackIds(spotifyDraft, savedSpotifyTracks ?? []);

	// Trips too: edited as a draft (null = untouched), applied on save as the
	// deletes / updates / creates that turn the saved list into the draft.
	const travelProfileId = ownProfileId != null ? Number(ownProfileId) : null;
	const { data: savedTravelPlans, isLoading: isLoadingTravelPlans } = useTravelPlans(travelProfileId);
	const createTravelPlan = useCreateTravelPlan();
	const updateTravelPlan = useUpdateTravelPlan();
	const deleteTravelPlan = useDeleteTravelPlan();
	const [travelDraft, setTravelDraft] = useState<TravelPlan[] | null>(null);
	const travelPlans = travelDraft ?? savedTravelPlans ?? [];
	const hasTravelChanges = travelDraft !== null && !sameTravelPlans(travelDraft, savedTravelPlans ?? []);

	// Map / Right Now prefs are account settings (/v3/me/prefs/settings), not
	// profile fields, but they're edited and saved along with the draft.
	const { data: mySettings } = useMySettings();
	const [settingsDraft, setSettingsDraft] = useState<Partial<MySettings>>({});
	const settingsForEditor = mySettings ? { ...mySettings, ...settingsDraft } : undefined;
	const changedSettings = useMemo(() => {
		if (!mySettings) return {};
		return Object.fromEntries(
			Object.entries(settingsDraft).filter(([key, value]) => mySettings[key as keyof MySettings] !== value),
		) as Partial<MySettings>;
	}, [mySettings, settingsDraft]);
	const hasSettingsChanges = Object.keys(changedSettings).length > 0;
	const handleSettingsChange = useCallback((patch: Partial<MySettings>) => {
		setSettingsDraft((current) => ({ ...current, ...patch }));
	}, []);

	const hasChanges = hasProfileChanges || hasSpotifyChanges || hasTravelChanges || hasSettingsChanges;

	const tagList = useMemo(
		() => normalizeTagList(draft.profileTagsText),
		[draft.profileTagsText],
	);

	const tagsError = useMemo(() => {
		if (tagList.length > MAX_PROFILE_TAGS) {
			return t("profile_editor.errors.max_selection", { count: MAX_PROFILE_TAGS });
		}
		return null;
	}, [tagList, t]);

	const profilePhotoHashes = useMemo(() => {
		const fromMedias = (profile?.medias ?? [])
			.map((item) => item.mediaHash ?? "")
			.filter((hash): hash is string => validateMediaHash(hash));

		const hashes = [...fromMedias];

		// profileImageMediaHash can lag behind medias after deleting every
		// photo — the server doesn't always clear it once medias is empty —
		// so only trust it as a primary-photo fallback when at least one real
		// media entry backs it up. Otherwise a deleted photo keeps reappearing
		// here even though medias correctly reports none left.
		if (
			hashes.length > 0 &&
			profile?.profileImageMediaHash &&
			validateMediaHash(profile.profileImageMediaHash) &&
			!hashes.includes(profile.profileImageMediaHash)
		) {
			hashes.unshift(profile.profileImageMediaHash);
		}

		return hashes.slice(0, MAX_PROFILE_PHOTOS);
	}, [profile?.medias, profile?.profileImageMediaHash]);

	const photoModerationByHash = useMemo(() => {
		const map = new Map<string, { state: number | null; reason: string | null }>();
		for (const item of profile?.medias ?? []) {
			if (item.mediaHash) {
				map.set(item.mediaHash, { state: item.state ?? null, reason: item.reason ?? null });
			}
		}
		return map;
	}, [profile?.medias]);

	// Text the server rejected for banned terms, with the terms it named. The
	// error shows (and blocks saving) until that field's text is changed.
	const [rejectedText, setRejectedText] = useState<{
		displayName?: { value: string; terms: string[] };
		aboutMe?: { value: string; terms: string[] };
	}>({});
	const bannedTermsMessage = useCallback(
		(terms: string[]) =>
			terms.length > 0
				? t("profile_editor.errors.banned_terms", {
						defaultValue: "Contains words that aren't allowed: {{terms}}",
						terms: terms.join(", "),
					})
				: t("profile_editor.errors.banned_terms_unknown", { defaultValue: "Contains words that aren't allowed." }),
		[t],
	);

	const displayNameError = useMemo(() => {
		const value = draft.displayName.trim();
		if (!value) {
			return null;
		}

		if (value.length > 15) {
			return t("profile_editor.errors.display_name_length");
		}

		if (rejectedText.displayName && value === rejectedText.displayName.value) {
			return bannedTermsMessage(rejectedText.displayName.terms);
		}

		return null;
	}, [draft.displayName, rejectedText.displayName, bannedTermsMessage, t]);

	const aboutMeError = useMemo(() => {
		if (draft.aboutMe.length > 255) {
			return t("profile_editor.errors.about_me_length");
		}

		if (rejectedText.aboutMe && draft.aboutMe.trim() === rejectedText.aboutMe.value) {
			return bannedTermsMessage(rejectedText.aboutMe.terms);
		}

		return null;
	}, [draft.aboutMe, rejectedText.aboutMe, bannedTermsMessage, t]);

	const canSave = hasChanges && !isSaving && !displayNameError && !aboutMeError && !tagsError;

	const handleDraftChange = <K extends keyof ProfileDraft>(
		key: K,
		value: ProfileDraft[K],
	) => {
		setDraft((current) => ({ ...current, [key]: value }));
	};

	const toggleMultiValue = (key: ToggleMultiValueKey, value: number) => {
		setDraft((current) => {
			const currentValues = current[key] as number[];
			const isSelected = currentValues.includes(value);
			const max = MULTI_VALUE_MAX[key];
			if (!isSelected && max != null && currentValues.length >= max) {
				toast.error(t("profile_editor.errors.max_selection", { count: max }));
				return current;
			}
			return {
				...current,
				[key]: isSelected
					? currentValues.filter((item) => item !== value)
					: [...currentValues, value].sort((left, right) => left - right),
			};
		});
	};

	/** Resolves true once everything changed was saved. */
	const handleSaveProfile = async (): Promise<boolean> => {
		if (!userId || !canSave) {
			return false;
		}

		setIsSaving(true);

		try {
			if (hasProfileChanges) {
				const payload: Record<string, any> = {};

				// Helper to compare and add simple values
				const addIfChanged = (key: keyof ProfileDraft, payloadKey: string, transform: (v: any) => any = (v) => v) => {
					const draftValue = transform(draft[key]);
					const savedValue = transform(savedDraft[key]);
					if (JSON.stringify(draftValue) !== JSON.stringify(savedValue)) {
						payload[payloadKey] = draftValue;
					}
				};

				addIfChanged("displayName", "displayName", (v) => v.trim());
				addIfChanged("aboutMe", "aboutMe", (v) => v.trim() || null);
				addIfChanged("showAge", "showAge");
				addIfChanged("age", "age", parseNullableInteger);
				addIfChanged("height", "height", (v) => parseNullableHeightToCm(v, unitsPreset));
				addIfChanged("weight", "weight", (v) => parseNullableWeightToGrams(v, unitsPreset));
				addIfChanged("ethnicity", "ethnicity", parseNullableInteger);
				addIfChanged("bodyType", "bodyType", parseNullableInteger);
				addIfChanged("showPosition", "showPosition");
				addIfChanged("sexualPosition", "sexualPosition", parseNullableInteger);
				addIfChanged("showTribes", "showTribes");
				addIfChanged("grindrTribes", "grindrTribes");
				addIfChanged("tribesImInto", "tribesImInto");
				addIfChanged("relationshipStatus", "relationshipStatus", parseNullableInteger);
				addIfChanged("lookingFor", "lookingFor");
				addIfChanged("meetAt", "meetAt");
				addIfChanged("nsfw", "nsfw", parseNullableInteger);
				addIfChanged("genders", "genders");
				addIfChanged("pronouns", "pronouns");
				addIfChanged("hivStatus", "hivStatus", parseNullableInteger);
				addIfChanged("lastTestedDate", "lastTestedDate", parseMonthInput);
				addIfChanged("sexualHealth", "sexualHealth");
				addIfChanged("vaccines", "vaccines");

				// Handle tags separately due to different structure — tagList
				// already holds catalog keys (see TagsPickerDialog), which is what
				// the server expects here too.
				const savedTags = profile?.profileTags ?? [];
				if (JSON.stringify(tagList) !== JSON.stringify(savedTags)) {
					payload.profileTags = tagList;
				}

				// Handle social networks selectively
				const social: Record<string, any> = {};
				if (draft.instagram.trim() !== (profile?.socialNetworks?.instagram?.userId ?? "")) {
					social.instagram = { userId: draft.instagram.trim() || null };
				}
				if (draft.twitter.trim() !== (profile?.socialNetworks?.twitter?.userId ?? "")) {
					social.twitter = { userId: draft.twitter.trim() || null };
				}
				if (draft.facebook.trim() !== (profile?.socialNetworks?.facebook?.userId ?? "")) {
					social.facebook = { userId: draft.facebook.trim() || null };
				}

				if (Object.keys(social).length > 0) {
					payload.socialNetworks = social;
				}

				if (Object.keys(payload).length > 0) {
					// Full replace instead of PATCH: the server silently ignores
					// explicit nulls meant to clear a field (e.g. bodyType/ethnicity
					// back to "not set") on the partial-update endpoint. Merging
					// onto the last-fetched raw profile keeps fields we don't model
					// (travel plans, right-now status, etc.) intact.
					const mergedProfile: Record<string, any> = {
						...rawProfile,
						...payload,
					};
					if (payload.socialNetworks) {
						mergedProfile.socialNetworks = {
							...rawProfile?.socialNetworks,
							...payload.socialNetworks,
						};
					}

					await apiFunctions.replaceMyProfile(mergedProfile);

					setRawProfile(mergedProfile);
					// Update local profile state immediately
					setProfile((current) => {
						if (!current) return null;
						return {
							...current,
							...payload,
						};
					});
				}
			}

			if (hasSettingsChanges) {
				await apiFunctions.updateMySettings(changedSettings);
				queryClient.setQueryData(["my-settings"], { ...mySettings, ...changedSettings });
				setSettingsDraft({});
			}

			if (hasSpotifyChanges && spotifyDraft) {
				await updateSpotifyFavorites.mutateAsync(spotifyDraft.map((track) => track.id));
				// Show the saved list right away instead of the stale cache until the refetch.
				queryClient.setQueryData(["spotify-favorites", spotifyProfileId], spotifyDraft);
				setSpotifyDraft(null);
			}

			if (hasTravelChanges && travelDraft && travelProfileId != null) {
				const saved = savedTravelPlans ?? [];
				const draftIds = new Set(travelDraft.map((plan) => plan.travelPlanId));
				for (const plan of saved) {
					if (!draftIds.has(plan.travelPlanId)) {
						await deleteTravelPlan.mutateAsync({ travelPlanId: plan.travelPlanId, profileId: travelProfileId });
					}
				}
				for (const plan of travelDraft) {
					const payload = {
						profileId: travelProfileId,
						geohash: plan.geohash,
						startDate: plan.startDate,
						endDate: plan.endDate,
						showOnProfile: plan.showOnProfile,
						notes: plan.notes ?? null,
					};
					const before = saved.find((item) => item.travelPlanId === plan.travelPlanId);
					if (!before) {
						await createTravelPlan.mutateAsync(payload);
					} else if (!sameTravelPlans([before], [plan])) {
						await updateTravelPlan.mutateAsync({ ...payload, travelPlanId: plan.travelPlanId });
					}
				}
				setTravelDraft(null);
			}

			// Keeps the grid/chat header avatar, account switcher, and the HIV
			// test reminder in sync with whatever just changed here, instead of
			// waiting out useMyOwnProfile's 5-minute staleTime.
			void queryClient.invalidateQueries({ queryKey: ["my-own-profile"] });

			toast.success(t("profile_editor.toasts.updated"));
			return true;
		} catch (error) {
			if (error instanceof BannedTermsError) {
				const { displayName, aboutMe } = error.fields;
				setRejectedText({
					displayName: displayName ? { value: draft.displayName.trim(), terms: displayName } : undefined,
					aboutMe: aboutMe ? { value: draft.aboutMe.trim(), terms: aboutMe } : undefined,
				});
			}
			const message =
				error instanceof Error
					? error.message
					: t("profile_editor.toasts.error_update");
			toast.error(message);
			return false;
		} finally {
			setIsSaving(false);
		}
	};

	const persistProfilePhotos = useCallback(
		async (
			nextHashes: string[],
			options?: {
				deletedHashes?: string[];
				successMessage?: string;
			},
		) => {
			if (!userId) {
				return;
			}

			const sanitized = Array.from(
				new Set(nextHashes.filter((hash) => validateMediaHash(hash))),
			).slice(0, MAX_PROFILE_PHOTOS);

			const [primaryImageHash, ...secondaryImageHashes] = sanitized;

			setIsSavingPhotos(true);

			try {
				await apiFunctions.updateMyProfileImages({
					primaryImageHash: primaryImageHash ?? null,
					secondaryImageHashes,
				});

				const deletedHashes =
					options?.deletedHashes?.filter((hash) => validateMediaHash(hash)) ??
					[];

				if (deletedHashes.length > 0) {
					await apiFunctions.deleteMyProfileImages(deletedHashes);
				}

				// The grid/chat header avatar and account switcher read
				// useMyOwnProfile's shared cache — without invalidating it here
				// they'd keep showing a deleted/old photo until its 5-minute
				// staleTime lapses.
				void queryClient.invalidateQueries({ queryKey: ["my-own-profile"] });

				await loadProfile();
				toast.success(
					options?.successMessage ?? t("profile_editor.toasts.photos_updated"),
				);
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: t("profile_editor.toasts.error_photos");
				toast.error(message);
			} finally {
				setIsSavingPhotos(false);
			}
		},
		[apiFunctions, loadProfile, userId, t],
	);

	// Picking a file always happens from inside the picture drawer now — it
	// only adds the upload to the server-side pool, it doesn't select it into
	// the profile's photo slots (see uploadPhotoFile), so there's no need to
	// gate this on the slot count the way the old direct-upload flow did.
	const handleDrawerUploadFile = (file: File) => {
		if (!file.type.startsWith("image/")) {
			toast.error(t("profile_editor.toasts.error_upload_type"));
			return;
		}

		setPendingPhotoTakenOnGrindr(false);
		setPhotoUploadStep("crop");
		setCroppedPhotoFile(null);
		setPendingPhotoFile(file);
	};

	const loadPoolImages = useCallback(async () => {
		setIsPoolLoading(true);
		setPoolError(null);
		try {
			const images = await apiFunctions.getProfileImages();
			setPoolImages(images);
		} catch (error) {
			setPoolError(
				error instanceof Error ? error.message : t("profile_editor.toasts.error_photos"),
			);
		} finally {
			setIsPoolLoading(false);
		}
	}, [apiFunctions, t]);

	useEffect(() => {
		if (isPhotoDrawerOpen) {
			void loadPoolImages();
		}
	}, [isPhotoDrawerOpen, loadPoolImages]);

	const photoDrawerCloseRef = useRef<(() => void) | null>(null);
	const handleAddSelectedImages = useCallback(
		async (hashes: string[]) => {
			const newHashes = hashes.filter(
				(hash) => validateMediaHash(hash) && !profilePhotoHashes.includes(hash),
			);
			if (newHashes.length === 0) {
				return;
			}
			const remainingSlots = MAX_PROFILE_PHOTOS - profilePhotoHashes.length;
			if (remainingSlots <= 0) {
				toast.error(t("profile_editor.toasts.error_photo_limit"));
				return;
			}
			await persistProfilePhotos(
				[...profilePhotoHashes, ...newHashes.slice(0, remainingSlots)],
				{ successMessage: t("profile_editor.toasts.photo_added") },
			);
			// Animated close; falls back to unmounting if the drawer is already gone.
			if (photoDrawerCloseRef.current) photoDrawerCloseRef.current();
			else setIsPhotoDrawerOpen(false);
		},
		[profilePhotoHashes, persistProfilePhotos, t],
	);

	// Deleting from the drawer is a real server-side delete (unlike removing a
	// photo from the grid below, which only unlinks it) — if the image being
	// deleted also happens to be one of the profile's active slots, it has to
	// be unlinked from there in the same step so the profile doesn't keep
	// pointing at a now-nonexistent hash.
	const handleDeletePoolImage = useCallback(
		async (hash: string) => {
			setDeletingPoolHash(hash);
			try {
				if (profilePhotoHashes.includes(hash)) {
					await persistProfilePhotos(
						profilePhotoHashes.filter((currentHash) => currentHash !== hash),
						{ deletedHashes: [hash], successMessage: t("profile_photo_drawer.deleted") },
					);
				} else {
					await apiFunctions.deleteMyProfileImages([hash]);
					toast.success(t("profile_photo_drawer.deleted"));
				}
				// The pool endpoint only ever returns up to 10 images, so deleting
				// one can bring an older image that was previously cut off back
				// into view — a local filter of the current list can't reveal
				// that, only a full reload can.
				await loadPoolImages();
			} catch (error) {
				const message =
					error instanceof Error ? error.message : t("profile_editor.toasts.error_photos");
				toast.error(message);
			} finally {
				setDeletingPoolHash(null);
			}
		},
		[apiFunctions, persistProfilePhotos, profilePhotoHashes, t, loadPoolImages],
	);

	const cancelPendingPhotoUpload = () => {
		if (isUploadingPhoto) {
			return;
		}
		setPendingPhotoFile(null);
	};

	const uploadPhotoFile = async (file: File, crop?: FractionalCrop) => {
		setIsUploadingPhoto(true);

		try {
			// Metadata stripped and downscaled (see uploadSanitize); thumbCoords
			// are in the normalized photo's pixels.
			const upload = await sanitizeUploadFile(file);
			const body = new Uint8Array(await upload.arrayBuffer());
			const thumbCoords = crop
				? await buildThumbCoordsFromFraction(upload, crop)
				: await buildSquareThumbCoords(upload);
			const contentType = upload.type;

			// Primary: the media upload (signed /v5 for in-app captures, unsigned
			// /v4 otherwise — picked Rust-side). Fallback: the older, unsigned
			// /v3/me/profile/images path, unchanged.
			const uploadAttempts = [
				() =>
					apiFunctions.uploadProfilePhoto({
						body,
						contentType,
						thumbCoords,
						takenOnGrindr: pendingPhotoTakenOnGrindr,
					}),
				() =>
					apiFunctions.uploadProfileImage({
						path: "/v3/me/profile/images",
						body,
						contentType,
					}),
			];

			let uploadedHash: string | null = null;
			const failedMessages: string[] = [];

			for (const attempt of uploadAttempts) {
				try {
					const uploaded = await attempt();
					uploadedHash =
						uploaded.hash ??
						uploaded.mediaHash ??
						uploaded.imageSizes?.find((item) => item.mediaHash)?.mediaHash ??
						null;
					if (uploadedHash) {
						break;
					}
				} catch (error) {
					failedMessages.push(
						error instanceof Error ? error.message : "upload failed",
					);
				}
			}

			if (!uploadedHash) {
				throw new Error(
					`Failed to upload image (${failedMessages.join(" -> ")})`,
				);
			}

			if (!uploadedHash || !validateMediaHash(uploadedHash)) {
				throw new Error(
					"Upload completed but no valid media hash was returned",
				);
			}

			// Uploading only lands the image in the server-side pool — it doesn't
			// select it into a profile slot. The drawer reappears (isPhotoDrawerOpen
			// stays true) once pendingPhotoFile clears below, showing the new image
			// as a pickable, not-yet-used tile.
			setPoolImages((prev) => [
				{ mediaHash: uploadedHash, type: 0, state: MEDIA_MODERATION_STATE.PENDING },
				...prev.filter((image) => image.mediaHash !== uploadedHash),
			]);
			toast.success(t("profile_editor.toasts.photo_uploaded"));
			setPendingPhotoFile(null);
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: t("profile_editor.toasts.error_upload");
			toast.error(message);
		} finally {
			setIsUploadingPhoto(false);
		}
	};

	const getFractionalPhotoCrop = (): FractionalCrop | undefined => {
		const img = photoImgRef.current;
		if (!photoCompletedCrop?.width || !photoCompletedCrop.height || !img) return undefined;
		return {
			left: photoCompletedCrop.x / img.width,
			top: photoCompletedCrop.y / img.height,
			right: (photoCompletedCrop.x + photoCompletedCrop.width) / img.width,
			bottom: (photoCompletedCrop.y + photoCompletedCrop.height) / img.height,
		};
	};

	// Step 1 cuts the photo itself (client-side, see cropImageFile). Step 2's
	// selection is only used to tell the server which square region of that
	// cropped photo to render the thumbnail from (thumbCoords).
	const confirmPendingPhotoUpload = async () => {
		if (!pendingPhotoFile) return;

		if (photoUploadStep === "crop") {
			const crop = getFractionalPhotoCrop();
			setIsCroppingPhoto(true);
			try {
				setCroppedPhotoFile(crop ? await cropImageFile(pendingPhotoFile, crop) : pendingPhotoFile);
			} catch {
				// Webview can't decode it (e.g. HEIC outside Apple) — upload uncropped.
				setCroppedPhotoFile(pendingPhotoFile);
			} finally {
				setIsCroppingPhoto(false);
			}
			setPhotoUploadStep("thumbnail");
			return;
		}

		await uploadPhotoFile(croppedPhotoFile ?? pendingPhotoFile, getFractionalPhotoCrop());
	};

	// Removing a photo here only unlinks it from the profile's active slots
	// (plain PUT) — the underlying upload stays on the server and can still be
	// picked again from the picture drawer. Permanently deleting it from the
	// server is a separate, explicit action there (handleDeletePoolImage).
	const handleRemovePhoto = async (hash: string) => {
		if (!validateMediaHash(hash) || isSavingPhotos || isUploadingPhoto) {
			return;
		}

		await persistProfilePhotos(
			profilePhotoHashes.filter((currentHash) => currentHash !== hash),
			{
				successMessage: t("profile_editor.toasts.photo_removed"),
			},
		);
	};

	const handleReorderPhotos = async (newHashes: string[]) => {
		if (isSavingPhotos || isUploadingPhoto) return;
		await persistProfilePhotos(newHashes, {
			successMessage: t("profile_editor.toasts.photos_reordered"),
		});
	};

	const handleResetDraft = () => {
		setDraft(savedDraft);
		setSpotifyDraft(null);
		setTravelDraft(null);
		setSettingsDraft({});
	};

	const isLoaded = !(isLoadingProfile && !profile) && !(profileError && !profile);

	return {
		profile,
		profileId: profile?.profileId ?? userId,
		isLoadingProfile,
		profileError,
		isLoaded,
		unitsPreset,
		draft,
		handleDraftChange,
		toggleMultiValue,
		displayNameError,
		aboutMeError,
		tagsError,
		tagList,
		tagLabelByKey,
		options: {
			ethnicity: ethnicityOptions,
			bodyType: bodyTypeOptions,
			position: positionOptions,
			relationshipStatus: relationshipStatusOptions,
			tribe: tribeOptions,
			lookingFor: lookingForOptions,
			meetAt: meetAtOptions,
			nsfw: nsfwOptions,
			gender: genderOptions,
			defaultGenderIds,
			pronoun: pronounOptions,
			hivStatus: hivStatusOptions,
			sexualHealth: sexualHealthOptions,
			vaccine: vaccineOptions,
		},
		spotifyTracks,
		isLoadingSpotify,
		setSpotifyDraft,
		travelPlans,
		isLoadingTravelPlans,
		setTravelDraft,
		settings: settingsForEditor,
		handleSettingsChange,
		hasChanges,
		canSave,
		isSaving,
		handleSaveProfile,
		handleResetDraft,
		photos: {
			hashes: profilePhotoHashes,
			moderationByHash: photoModerationByHash,
			isSaving: isSavingPhotos,
			isUploading: isUploadingPhoto,
			isCropping: isCroppingPhoto,
			handleRemove: handleRemovePhoto,
			handleReorder: handleReorderPhotos,
			isDrawerOpen: isPhotoDrawerOpen,
			setIsDrawerOpen: setIsPhotoDrawerOpen,
			drawerCloseRef: photoDrawerCloseRef,
			poolImages,
			isPoolLoading,
			poolError,
			loadPoolImages,
			deletingPoolHash,
			handleAddSelectedImages,
			handleDeletePoolImage,
			handleDrawerUploadFile,
			pendingFile: pendingPhotoFile,
			cancelPendingUpload: cancelPendingPhotoUpload,
			confirmPendingUpload: confirmPendingPhotoUpload,
			uploadStep: photoUploadStep,
			setUploadStep: setPhotoUploadStep,
			previewUrl: photoPreviewUrl,
			crop: photoCrop,
			setCrop: setPhotoCrop,
			setCompletedCrop: setPhotoCompletedCrop,
			isDraggingCrop: isDraggingPhotoCrop,
			setIsDraggingCrop: setIsDraggingPhotoCrop,
			imgRef: photoImgRef,
			handleImageLoad: handlePhotoImageLoad,
			takenOnGrindr: pendingPhotoTakenOnGrindr,
			setTakenOnGrindr: setPendingPhotoTakenOnGrindr,
		},
	};
}

export type ProfileEditorState = ReturnType<typeof useProfileEditor>;
