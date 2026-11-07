import { useEffect, useRef, useState } from "react";
import { TriangleAlert, UserRoundPen } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { NATIVE_SHEET_BG } from "./ui/action-sheet";
import { SHEET_FOOTER_CLASS, sheetButtonClass } from "./ui/bottom-sheet";
import { ControlledBottomSheet } from "./ui/controlled-sheet";
import { SHEET_GROUP_CLASS } from "./ui/sheet-section";
import { ToggleRow } from "./ui/toggle-row";
import { useAuth } from "../contexts/useAuth";
import { useApiFunctions } from "../hooks/useApiFunctions";
import { useDesktopBreakpoint } from "../hooks/useDesktopBreakpoint";
import {
	applyRestoredProfileDetails,
	dismissRestoredProfileDetails,
	hasRestoredProfileDetails,
	keepRestoredProfileDetailsIfChanged,
} from "../services/ownProfileDetails";
import {
	countPendingRestoredProfilePhotos,
	dismissRestoredProfilePhotos,
	keepRestoredProfilePhotosIfChanged,
	profilePhotoHashes,
	uploadRestoredProfilePhotos,
} from "../services/ownProfilePhotos";
import { unwrapOwnProfile } from "../pages/app/profile-editor/profileEditorUtils";
import { SHOW_RESTORED_PROFILE_PROMPT_EVENT } from "../services/restoreStatus";
import { appLog } from "../utils/logger";

type Pending = { details: boolean; photos: number };

/**
 * Asks whether to apply the profile details and photos a backup of another
 * profile brought along (see ownProfileDetails.ts / ownProfilePhotos.ts), each
 * one opt-in, warning that Grindr may recognize a banned account's profile.
 * "Don't apply" discards both; just closing the sheet asks again next start.
 * Applying runs in the background; whatever fails is kept and asked again.
 */
export function RestoredProfilePrompt({ userId }: { userId: number }) {
	const { t } = useTranslation();
	const { settingsReady } = useAuth();
	const apiFunctions = useApiFunctions();
	const isDesktop = useDesktopBreakpoint();
	const [pending, setPending] = useState<Pending | null>(null);
	const [applyDetails, setApplyDetails] = useState(true);
	const [applyPhotos, setApplyPhotos] = useState(true);
	const userIdRef = useRef(userId);
	userIdRef.current = userId;
	// Bumped to check again on request, e.g. from the restore status sheet.
	const [checkNonce, setCheckNonce] = useState(0);

	useEffect(() => {
		const handleShow = () => setCheckNonce((n) => n + 1);
		window.addEventListener(SHOW_RESTORED_PROFILE_PROMPT_EVENT, handleShow);
		return () => window.removeEventListener(SHOW_RESTORED_PROFILE_PROMPT_EVENT, handleShow);
	}, []);

	useEffect(() => {
		if (!settingsReady) return;
		let cancelled = false;
		const check = async (): Promise<Pending | null> => {
			let [details, photos] = await Promise.all([hasRestoredProfileDetails(), countPendingRestoredProfilePhotos()]);
			if (!details && photos === 0) return null;
			// A backup of this same profile brings along what's on it already:
			// only ask about what differs. Without the current profile (offline,
			// banned) everything restored is offered.
			const current = await apiFunctions
				.getMyOwnProfile()
				.then(unwrapOwnProfile)
				.catch((error: unknown) => {
					appLog.warn("[RestoredProfilePrompt] loading current profile failed", error);
					return null;
				});
			if (current && userIdRef.current === userId) {
				if (details) {
					const [currentSongIds, currentTravelPlans] = await Promise.all([
						apiFunctions.getSpotifyFavoriteSongIds(String(userId)).catch(() => null),
						apiFunctions.getTravelPlans(userId).catch(() => null),
					]);
					details = await keepRestoredProfileDetailsIfChanged(current, currentSongIds, currentTravelPlans);
				}
				if (photos > 0) photos = await keepRestoredProfilePhotosIfChanged(profilePhotoHashes(current));
			}
			return details || photos > 0 ? { details, photos } : null;
		};
		check()
			.then((next) => {
				if (!cancelled && next) setPending(next);
			})
			.catch((error: unknown) => appLog.warn("[RestoredProfilePrompt] checking restored profile failed", error));
		return () => {
			cancelled = true;
		};
	}, [settingsReady, userId, checkNonce]);

	const isOpen = pending != null;
	const close = () => setPending(null);

	const handleDiscard = () => {
		close();
		void Promise.all([dismissRestoredProfileDetails(), dismissRestoredProfilePhotos()]).catch((error: unknown) =>
			appLog.warn("[RestoredProfilePrompt] discarding restored profile failed", error),
		);
	};

	const handleApply = () => {
		if (!pending) return;
		const withDetails = pending.details && applyDetails;
		const withPhotos = pending.photos > 0 && applyPhotos;
		close();
		const isCurrent = () => userIdRef.current === userId;
		const toastId = toast.loading(t("restored_profile.applying", { defaultValue: "Restoring your profile…" }));
		void (async () => {
			let failed = false;
			if (pending.details) {
				try {
					if (withDetails) await applyRestoredProfileDetails(apiFunctions, userId, isCurrent);
					else await dismissRestoredProfileDetails();
				} catch (error) {
					appLog.error("[RestoredProfilePrompt] restoring profile details failed", error);
					failed = true;
				}
			}
			if (pending.photos > 0) {
				try {
					if (withPhotos) await uploadRestoredProfilePhotos(apiFunctions, isCurrent);
					else await dismissRestoredProfilePhotos();
				} catch (error) {
					appLog.error("[RestoredProfilePrompt] restoring profile photos failed", error);
					failed = true;
				}
			}
			if (failed) {
				toast.error(t("restored_profile.failed", { defaultValue: "Couldn't restore everything. You'll be asked again next time." }), {
					id: toastId,
				});
			} else {
				toast.success(t("restored_profile.success", { defaultValue: "Profile restored." }), { id: toastId });
			}
		})();
	};

	const nothingSelected = !(pending?.details && applyDetails) && !((pending?.photos ?? 0) > 0 && applyPhotos);

	return (
		<ControlledBottomSheet isOpen={isOpen} onDismiss={close} isDesktop={isDesktop} bg={NATIVE_SHEET_BG} panelClassName="max-h-[92dvh] px-4">
			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
				<div className="flex flex-col items-center px-2 pt-2 text-center">
					<span className="flex h-14 w-14 items-center justify-center rounded-full accent-tint-15 text-[var(--accent)]">
						<UserRoundPen className="h-7 w-7" />
					</span>
					<h3 className="mt-4 text-base font-semibold text-[var(--text)]">
						{t("restored_profile.title", { defaultValue: "Take over your previous profile?" })}
					</h3>
					<p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
						{t("restored_profile.message", {
							defaultValue: "Your backup contains your previous profile. Choose what to use for this profile.",
						})}
					</p>
				</div>
				<div className={`mt-5 ${SHEET_GROUP_CLASS}`}>
					{pending?.details ? (
						<ToggleRow
							padding="px-4 py-3"
							label={t("restored_profile.details", { defaultValue: "Profile details" })}
							description={t("restored_profile.details_desc", {
								defaultValue: "Name, about me, tags, looking for, stats, Spotify songs and the rest of your profile info.",
							})}
							checked={applyDetails}
							onChange={setApplyDetails}
						/>
					) : null}
					{pending && pending.photos > 0 ? (
						<ToggleRow
							padding="px-4 py-3"
							label={t("restored_profile.photos", { defaultValue: "Profile photos" })}
							description={t("restored_profile.photos_desc", {
								defaultValue: "{{count}} photos, uploaded again and set in the same order.",
								count: pending.photos,
							})}
							checked={applyPhotos}
							onChange={setApplyPhotos}
						/>
					) : null}
				</div>
				<div role="alert" className="mt-4 flex items-start gap-3 rounded-2xl bg-red-500/10 px-4 py-3">
					<TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
					<p className="text-sm font-medium leading-relaxed text-red-500">
						{t("restored_profile.warning", {
							defaultValue: "Grindr may recognize a banned account's photos and profile text, which can get this profile banned too.",
						})}
					</p>
				</div>
			</div>
			<div className={SHEET_FOOTER_CLASS}>
				<button type="button" onClick={handleDiscard} className={sheetButtonClass("secondary")}>
					{t("restored_profile.discard", { defaultValue: "Don't take over" })}
				</button>
				<button type="button" onClick={handleApply} disabled={nothingSelected} className={sheetButtonClass()}>
					<span className="truncate">{t("restored_profile.apply", { defaultValue: "Take over" })}</span>
				</button>
			</div>
		</ControlledBottomSheet>
	);
}
