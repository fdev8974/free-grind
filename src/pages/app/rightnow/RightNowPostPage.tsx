import { X, ImagePlus, Loader2, CheckCircle2, Lock, Hourglass, VenetianMask, MapPin, Navigation, EyeOff, ListChecks, ChevronRight, Crosshair } from "lucide-react";
import { HomeFilled } from "../../../components/icons/FilledIcons";
import { RightNowIcon } from "../../../components/icons/RightNowIcon";
import { useEffect, useState, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { appLog } from "../../../utils/logger";
import toast from "react-hot-toast";
import { cn } from "../../../utils/cn";
import { BottomSheet, useBottomSheetClose, SheetCloseButton, SHEET_FOOTER_CLASS, sheetButtonClass } from "../../../components/ui/bottom-sheet";
import { useDesktopBreakpoint } from "../../../hooks/useDesktopBreakpoint";
import { ToggleRow } from "../../../components/ui/toggle-row";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { createPortal } from "react-dom";
import { MediaEditSheet } from "../chat/MediaEditSheet";
import type { MediaEdit } from "../chat/MediaEditStep";
import { sanitizeUploadFile } from "../../../services/uploadSanitize";
import { useApiFunctions } from "../../../hooks/useApiFunctions";
import {
	NoFreeRightNowPostsError,
	RightNowDiscreetSetupError,
	RightNowPostAlreadyRunningError,
	RightNowSessionEndedError,
	type RightNowCreatePostRequest,
	type RightNowUpdatePostRequest,
} from "../../../services/apiFunctions";
import { RIGHT_NOW_UNLIMITED_POSTS, getRightNowSessionDuration } from "./rightnow-constants";
import { useQueryClient } from "@tanstack/react-query";
import { DrawerEmptyState } from "../chat/drawerUi";
import { triggerRightNowStarted } from "../../../components/RightNowStartedOverlay";
import { SHEET_GROUP_CLASS, SheetSection } from "../../../components/ui/sheet-section";
import { SelectRow } from "../../../components/ui/select-row";
import { Slider } from "../../../components/ui/range-slider";
import type { SelectSheetOption } from "../../../components/ui/select-sheet";
import { ManagedOptionsPickerDialog } from "../profile-editor/ManagedOptionsPickerDialog";
import { useFeatureFlag } from "../../../services/assignmentsStore";
import { formatDistance } from "../gridpage/utils";
import {
	RIGHT_NOW_LOCATION_RADIUS_MAX,
	RIGHT_NOW_SHARED_FIELDS,
	approximateRightNowRadiusMeters,
	type RightNowShareLocation,
	type RightNowSharedField,
} from "../../../types/right-now";
import { simulateCreatePost, simulateEndSession, simulateFetchActivePost, simulateUpdatePost, simulateUploadMedia } from "./rightnow-simulation";
import { proxyMediaUrl } from "../../../utils/mediaProxy";

interface RightNowPostPageProps {
	onClose: () => void;
	onPost: (isEdit: boolean) => void;
}

export function RightNowPostPage({ onClose, onPost }: RightNowPostPageProps) {
	const isDesktop = useDesktopBreakpoint();
	return (
		<BottomSheet
			onClose={onClose}
			isDesktop={isDesktop}
			// Same glass as the bottom navigation: translucent surface + 24px blur.
			bg="bg-[color-mix(in_srgb,var(--surface)_80%,transparent)] backdrop-blur-[24px]"
			panelClassName="relative max-h-[92dvh] px-4"
			accentColor="var(--right-now)"
		>
			<RightNowPostSheetContent onPost={onPost} />
		</BottomSheet>
	);
}

function RightNowPostSheetContent({ onPost }: Pick<RightNowPostPageProps, "onPost">) {
	const { t } = useTranslation();
	const apiFunctions = useApiFunctions();
	const isDesktop = useDesktopBreakpoint();
	const { setPreferences, activeRightNowId, activeRightNowExpiresAt, developerMode, showDebugInfo, rightNowRemaining, rightNowTestMode, autoFocusRightNowText } = usePreferences();
	// Closes through the sheet so it animates out and pops its history entry.
	const handleClose = useBottomSheetClose();

	const [text, setText] = useState("");
	const [isHosting, setIsHosting] = useState(false);
	const [isHidden, setIsHidden] = useState(false);
	// Hidden state as last loaded from the server; hiding goes through its own endpoint.
	const loadedHiddenRef = useRef(false);
	const [shareLocation, setShareLocation] = useState<RightNowShareLocation>("DISTANCE_ONLY");
	// 0 = most precise, 100 = least; starts at the least precise like the official client.
	const [locationRadius, setLocationRadius] = useState(RIGHT_NOW_LOCATION_RADIUS_MAX);
	const [isDiscreet, setIsDiscreet] = useState(false);
	const [sharedFields, setSharedFields] = useState<RightNowSharedField[]>(["AGE", "POSITION"]);
	// The post as last loaded, so edits only send what changed (a new
	// locationRadius moves the shown position; isDiscreet can't be undone).
	const loadedPostRef = useRef<{
		shareLocation: RightNowShareLocation;
		locationRadius: number;
		isDiscreet: boolean;
		sharedFields: RightNowSharedField[];
	} | null>(null);
	const showOnMap = shareLocation === "DISTANCE_AND_MAP";

	// Grindr rolls these out per account.
	const isMapFlagOn = useFeatureFlag("right-now-map") || rightNowTestMode;
	const isDiscreetFlagOn = useFeatureFlag("right-now-discreet") || rightNowTestMode;
	const isDiscreetLocked = loadedPostRef.current?.isDiscreet === true;
	const [mediaId, setMediaId] = useState<number | null>(null);
	const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
	const [isUploading, setIsUploading] = useState(false);
	const [isDraggingPhoto, setIsDraggingPhoto] = useState(false);
	const [isPosting, setIsPosting] = useState(false);
	const [isEnding, setIsEnding] = useState(false);

	const [debugInfo, setDebugInfo] = useState<{ time: string; data: any } | null>(null);
	const [debugId, setDebugId] = useState("");
	const [debugExpires, setDebugExpires] = useState("");
	const [debugClickCount, setDebugClickCount] = useState(0);

	const sessionDuration = getRightNowSessionDuration(rightNowTestMode);
	const initialMins = Math.floor(sessionDuration / 60000);
	const [timeLeft, setTimeLeft] = useState<{ mins: number; percent: number }>({ mins: initialMins, percent: 100 });
	const [displayMins, setDisplayMins] = useState(initialMins);

	const fileInputRef = useRef<HTMLInputElement>(null);
	const maxChars = 140;

	const isEditMode = useMemo(() => {
		if (!activeRightNowId || !activeRightNowExpiresAt) return false;
		return Date.now() < activeRightNowExpiresAt;
	}, [activeRightNowId, activeRightNowExpiresAt]);

	const canPost = useMemo(() => isEditMode || rightNowRemaining > 0, [isEditMode, rightNowRemaining]);
	const isUnlimited = rightNowRemaining >= RIGHT_NOW_UNLIMITED_POSTS;
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!isEditMode) return;

		const fetchActivePost = async () => {
			try {
				let post: any;
				if (rightNowTestMode) {
					const mockResponse = await simulateFetchActivePost(text, isHosting, showOnMap, mediaId, thumbnailUrl, isHidden);
					setDebugInfo({ time: new Date().toLocaleTimeString(), data: mockResponse });
					post = mockResponse.post;
				} else {
					const response = await apiFunctions.getActiveRightNowPost();
					post = response.post;
				}

				setText(post.activeText || "");
				setIsHosting(post.hosting);
				setIsHidden(post.postStatus === "HIDDEN");
				loadedHiddenRef.current = post.postStatus === "HIDDEN";
				void setPreferences({ activeRightNowHidden: post.postStatus === "HIDDEN" });
				const loadedShareLocation: RightNowShareLocation =
					post.shareLocation === "DISTANCE_AND_MAP" || post.shareLocation === "NONE" ? post.shareLocation : "DISTANCE_ONLY";
				const loadedRadius =
					typeof post.locationRadius === "number" ? post.locationRadius : RIGHT_NOW_LOCATION_RADIUS_MAX;
				const loadedDiscreet = post.isDiscreet === "TRUE" || post.isDiscreet === true;
				const loadedFields = (Array.isArray(post.sharedFields) ? post.sharedFields : []).filter(
					(field: unknown): field is RightNowSharedField =>
						typeof field === "string" && (RIGHT_NOW_SHARED_FIELDS as readonly string[]).includes(field),
				);
				setShareLocation(loadedShareLocation);
				setLocationRadius(loadedRadius);
				setIsDiscreet(loadedDiscreet);
				if (loadedDiscreet) setSharedFields(loadedFields);
				loadedPostRef.current = {
					shareLocation: loadedShareLocation,
					locationRadius: loadedRadius,
					isDiscreet: loadedDiscreet,
					sharedFields: loadedFields,
				};

				if (post.media && post.media.length > 0) {
					const m = post.media[0];
					// Handle both nested (simulation) and flat (real API) structures
					setMediaId(m.data?.mediaId ?? m.mediaId);
					// Use fullImageUrl for full image preview
					setThumbnailUrl(m.data?.fullImageUrl ?? m.fullImageUrl ?? m.data?.thumbnailUrl ?? m.thumbnailUrl);
				}
			} catch (error) {
				appLog.error("Failed to fetch active post:", error);
				toast.error(t("right_now.error_fetch_session"));
				setDebugInfo({
					time: new Date().toLocaleTimeString(),
					data: { error: error instanceof Error ? error.message : "Unknown error" }
				});
			}
		};

		void fetchActivePost();
	}, [isEditMode, apiFunctions]);

	useEffect(() => {
		if (!isEditMode || !activeRightNowExpiresAt) return;

		const update = (initial = false) => {
			const now = Date.now();
			if (now >= activeRightNowExpiresAt) {
				handleClose();
				void setPreferences({
					activeRightNowId: null,
					activeRightNowExpiresAt: null,
					activeRightNowHidden: false,
				});
				toast.error(t("right_now.session_expired"), { id: "right-now-expired" });
				return;
			}

			const total = sessionDuration;
			const remaining = activeRightNowExpiresAt - now;
			const targetMins = Math.max(0, Math.ceil(remaining / 60000));
			const percent = Math.max(0, Math.min(100, (remaining / total) * 100));
			setTimeLeft({ mins: targetMins, percent });

			if (initial) {
				const duration = 1000;
				const start = Date.now();
				const startMins = Math.floor(sessionDuration / 60000);

				const animate = () => {
					const elapsed = Date.now() - start;
					const progress = Math.min(elapsed / duration, 1);
					const easedProgress = 1 - Math.pow(1 - progress, 3);
					const current = Math.round(startMins - (startMins - targetMins) * easedProgress);
					setDisplayMins(current);

					if (progress < 1) {
						requestAnimationFrame(animate);
					}
				};
				requestAnimationFrame(animate);
			} else {
				setDisplayMins(targetMins);
			}
		};

		update(true);
		const interval = setInterval(() => update(false), 10000);
		return () => clearInterval(interval);
	}, [isEditMode, activeRightNowExpiresAt]);

	// A picked photo goes through the shared edit sheet first (crop, rotate,
	// then the square thumbnail), like the chat drawer and profile photos.
	const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
	const pendingEditRef = useRef<MediaEdit | null>(null);

	const uploadEdit = async (edit: MediaEdit) => {
		if (isUploading) return;
		setIsUploading(true);

		try {
			if (rightNowTestMode) {
				const result = await simulateUploadMedia(edit.file);
				setMediaId(result.mediaId);
				setThumbnailUrl(result.thumbnailUrl);
			} else {
				// Metadata stripped, upright, at most 1024px (see uploadSanitize);
				// the thumbnail square is in the normalized photo's pixels.
				const upload = await sanitizeUploadFile(edit.file);
				const bitmap = await createImageBitmap(upload);
				const { width, height } = bitmap;
				bitmap.close();
				const thumbnail = edit.thumbnail
					? {
							left: edit.thumbnail.left * width,
							top: edit.thumbnail.top * height,
							right: edit.thumbnail.right * width,
							bottom: edit.thumbnail.bottom * height,
						}
					: undefined;
				const result = await apiFunctions.uploadRightNowMedia({
					body: new Uint8Array(await upload.arrayBuffer()),
					contentType: upload.type,
					width,
					height,
					thumbnail,
				});
				setMediaId(result.mediaId);
				// Only shown once the server has it.
				setThumbnailUrl(result.thumbnailUrl);
			}
		} catch (error) {
			appLog.error("Upload failed", error);
			toast.error(error instanceof Error && error.message ? error.message : t("right_now.error_upload"));
		} finally {
			setIsUploading(false);
		}
	};

	const pickPhoto = (file: File) => {
		if (isUploading) return;
		pendingEditRef.current = null;
		setPendingPhoto(file);
	};

	const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) pickPhoto(file);
		// The same file can be picked again after cancelling.
		e.target.value = "";
	};

	const handleFileDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDraggingPhoto(false);
		const file = e.dataTransfer.files?.[0];
		if (file && file.type.startsWith("image/")) pickPhoto(file);
	};

	const finishPhotoEdit = (confirmed: boolean) => {
		const edit = pendingEditRef.current;
		pendingEditRef.current = null;
		setPendingPhoto(null);
		if (confirmed && edit) void uploadEdit(edit);
	};

	const handlePost = async () => {
		if (isPosting || !canPost) return;

		setIsPosting(true);

		try {
			if (isEditMode && activeRightNowId) {
				const updatePayload: RightNowUpdatePostRequest = {
					text: text.trim(),
					hosting: isHosting,
					media: mediaId
						? [
								{
									type: "image_v1",
									data: { id: mediaId },
								},
						  ]
						: [],
				};
				const loaded = loadedPostRef.current;
				if (!loaded || shareLocation !== loaded.shareLocation) updatePayload.shareLocation = shareLocation;
				if (showOnMap && (!loaded || loaded.shareLocation !== "DISTANCE_AND_MAP" || locationRadius !== loaded.locationRadius)) {
					updatePayload.locationRadius = locationRadius;
				}
				// isDiscreet and sharedFields only take effect on v5.
				const useV5 = isDiscreetFlagOn;
				if (useV5) {
					if (isDiscreet && !loaded?.isDiscreet) updatePayload.isDiscreet = true;
					if (isDiscreet && (!loaded || sharedFields.join() !== loaded.sharedFields.join())) {
						updatePayload.sharedFields = sharedFields;
					}
				}

				if (rightNowTestMode) {
					await simulateUpdatePost(activeRightNowId, { ...updatePayload, hidden: isHidden });
				} else {
					await apiFunctions.updateRightNowPost(activeRightNowId, updatePayload, useV5 ? "v5" : "v4");
					if (isHidden !== loadedHiddenRef.current) {
						await apiFunctions.setRightNowPostHidden(activeRightNowId, isHidden);
						loadedHiddenRef.current = isHidden;
					}
				}
				loadedPostRef.current = {
					shareLocation,
					locationRadius,
					isDiscreet: isDiscreet || loaded?.isDiscreet === true,
					sharedFields: isDiscreet ? sharedFields : loaded?.sharedFields ?? [],
				};
				await setPreferences({ activeRightNowHidden: isHidden });
			} else {
				const createPayload: RightNowCreatePostRequest = {
					text: text.trim(),
					shareLocation,
					locationRadius: showOnMap ? locationRadius : null,
					media: mediaId
						? [
								{
									type: "image_v1",
									data: { id: mediaId },
								},
						  ]
						: [],
					hosting: isHosting,
				};

				if (rightNowTestMode) {
					const { id, expiresAt } = await simulateCreatePost(createPayload);
					await setPreferences({
						activeRightNowId: id,
						activeRightNowExpiresAt: expiresAt,
						activeRightNowHidden: false,
						rightNowRemaining: isUnlimited ? rightNowRemaining : Math.max(0, rightNowRemaining - 1),
					});
				} else {
					const response = await apiFunctions.createRightNowPost(
						createPayload,
						isDiscreetFlagOn && isDiscreet ? { discreet: { sharedFields } } : undefined,
					);
					// Fallback to local duration if server doesn't provide expiration
					const expiresAt = response.post.expiration || (Date.now() + sessionDuration);
					await setPreferences({
						activeRightNowId: response.post.id,
						activeRightNowExpiresAt: expiresAt,
						activeRightNowHidden: false,
						rightNowRemaining: isUnlimited ? rightNowRemaining : Math.max(0, rightNowRemaining - 1),
					});
					// The count depends on the area and refills over time: ask the server again.
					void queryClient.invalidateQueries({ queryKey: ["entitlements"] });
				}
			}

			// A new session gets the full-screen celebration instead of a toast.
			if (isEditMode) {
				toast.success(t("right_now.session_updated"), {
					icon: <CheckCircle2 className="w-5 h-5 text-[var(--right-now)]" />,
				});
			}

			onPost(isEditMode);
			handleClose();
			if (!isEditMode) triggerRightNowStarted();
		} catch (error) {
			appLog.error("Failed to post:", error);
			if (error instanceof RightNowDiscreetSetupError) {
				// The post exists, hidden: keep it as the running session so it can be fixed by editing.
				const post = error.created.post;
				await setPreferences({
					activeRightNowId: post.id,
					activeRightNowExpiresAt: post.expiration || Date.now() + sessionDuration,
					activeRightNowHidden: true,
					rightNowRemaining: isUnlimited ? rightNowRemaining : Math.max(0, rightNowRemaining - 1),
				});
				void queryClient.invalidateQueries({ queryKey: ["entitlements"] });
				toast.error(t("right_now.error_discreet_setup", {
					defaultValue: "Your post was created but kept hidden, because it couldn't be made discreet. Edit it to try again.",
				}));
				handleClose();
			} else if (error instanceof NoFreeRightNowPostsError) {
				await setPreferences({ rightNowRemaining: 0 });
				toast.error(t("right_now.limit_reached_desc"));
			} else if (error instanceof RightNowPostAlreadyRunningError) {
				toast.error(t("right_now.error_already_running", { defaultValue: "You already have a Right Now session running." }));
				void queryClient.invalidateQueries({ queryKey: ["rightnow", "feed"] });
			} else if (error instanceof RightNowSessionEndedError) {
				await setPreferences({ activeRightNowId: null, activeRightNowExpiresAt: null, activeRightNowHidden: false });
				toast.error(t("right_now.session_expired"), { id: "right-now-expired" });
				handleClose();
			} else {
				toast.error(isEditMode ? t("right_now.error_session_update_failed") : t("right_now.error_session_failed"));
			}
		} finally {
			setIsPosting(false);
		}
	};

	const handleEndSession = async () => {
		if (!activeRightNowId || isEnding) return;

		setIsEnding(true);

		try {
			// Always call simulation in test mode, ignore API if not available
			if (rightNowTestMode) {
				await simulateEndSession(activeRightNowId);
			} else {
				// We only have API support for ending in test mode or if it's explicitly supported
				// If you want to support it via API, it needs to be in apiFunctions
				// For now, we only clear local state if not in test mode
			}

			await setPreferences({
				activeRightNowId: null,
				activeRightNowExpiresAt: null,
				activeRightNowHidden: false,
			});

			toast.success(t("right_now.session_ended"), {
				icon: <CheckCircle2 className="w-5 h-5 text-[var(--right-now)]" />,
			});
			handleClose();
		} catch (error) {
			appLog.error("Failed to end session:", error);
			toast.error(t("right_now.error_end_failed"));
		} finally {
			setIsEnding(false);
		}
	};



	const weeklyMax = Math.max(2, rightNowRemaining);
	const remainingLabel = isUnlimited ? "∞" : `${rightNowRemaining}/${weeklyMax}`;

	return (
		<>
			{/* Stacked over this sheet, outside its (transformed) panel. */}
			{pendingPhoto
				? createPortal(
						<MediaEditSheet
							files={[pendingPhoto]}
							photoLabel={t("right_now.edit_photo_title", { defaultValue: "Edit photo" })}
							videoLabel={t("right_now.edit_photo_title", { defaultValue: "Edit photo" })}
							confirmLabel={t("right_now.edit_photo_confirm", { defaultValue: "Use photo" })}
							showTakenOnGrindr={false}
							showLooping={false}
							allowVideoSplit={false}
							thumbnailStep={{
								title: t("profile_editor.photo_upload.thumbnail_title", { defaultValue: "Select Thumbnail" }),
								backLabel: t("profile_editor.photo_upload.back", { defaultValue: "Back" }),
							}}
							isDesktop={isDesktop}
							zIndex="z-[70]"
							onConfirmFile={(edit) => {
								pendingEditRef.current = edit;
							}}
							onDone={finishPhotoEdit}
						/>,
						document.body,
					)
				: null}
			{/* Right Now's signature glow, bleeding down from the top edge of the sheet and slowly breathing. */}
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-x-0 top-0 h-48 origin-top animate-glow-breathe motion-reduce:animate-none"
				style={{ background: "radial-gradient(ellipse 70% 100% at 50% 0%, color-mix(in srgb, var(--right-now) 26%, transparent), transparent)" }}
			/>

			{/* Header: title + status line, weekly sessions highlighted on the right */}
			<div className="relative mb-4 flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h3 className="text-sm font-semibold text-[var(--text)]">
						{isEditMode ? t("right_now.edit_session_title") : t("right_now.create_session_title")}
					</h3>
					{isEditMode && activeRightNowExpiresAt ? (
						<p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-[var(--right-now)]">
							<Hourglass className="h-3 w-3 shrink-0 animate-hourglass-rotate" />
							<span className="tabular-nums">
								{displayMins}m {t("right_now.remaining")}
							</span>
						</p>
					) : (
						<p className="mt-0.5 text-xs text-[var(--text-muted)]">
							{t("right_now.create_session_subtitle", { defaultValue: "Show people nearby what you're up to." })}
						</p>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<div
						title={t("right_now.weekly_limit")}
						aria-label={`${t("right_now.weekly_limit")}: ${remainingLabel}`}
						className={cn(
							"flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5",
							rightNowRemaining > 0
								? "bg-[color-mix(in_srgb,var(--right-now)_16%,var(--surface-2))] shadow-md shadow-[var(--right-now)]/20"
								: "bg-[var(--surface-2)]",
						)}
					>
						<span
							className={cn(
								"flex h-5 w-5 items-center justify-center rounded-full",
								rightNowRemaining > 0 ? "bg-[var(--right-now)] text-white" : "bg-[var(--surface)] text-[var(--text-muted)]",
							)}
						>
							<RightNowIcon className="h-3 w-3" />
						</span>
						<span className="text-xs font-bold tabular-nums text-[var(--text)]">
							{remainingLabel}
						</span>
					</div>
					<SheetCloseButton />
				</div>
			</div>

			{/* Remaining time bar (edit mode) */}
			{isEditMode && activeRightNowExpiresAt && (
				<div className="relative mb-4 h-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
					<div
						className="h-full rounded-full bg-[var(--right-now)] shadow-[0_0_8px_var(--right-now)] transition-all duration-1000 ease-out"
						style={{ width: `${timeLeft.percent}%` }}
					/>
				</div>
			)}

			<div className="relative -mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
				<div className="space-y-5">
					{!canPost ? (
						/* Weekly limit used up — the chat drawer's empty state (plain, no tile stack), tinted Right Now orange. */
						<div style={{ "--accent": "var(--right-now)", "--accent-contrast": "#fff" } as React.CSSProperties}>
							<DrawerEmptyState
								icon={<Lock className="h-5 w-5" />}
								fanned={false}
								title={t("right_now.limit_reached_title")}
								hint={t("right_now.limit_reached_desc")}
							>
								<p className="text-xs text-[var(--text-muted)]">
									{t("right_now.next_refresh")}: <span className="font-semibold text-[var(--text)]">{t("right_now.refresh_time")}</span>
								</p>
							</DrawerEmptyState>
						</div>
					) : (
						<>
							{/* The post itself: text and photo as one card. */}
							<div className={SHEET_GROUP_CLASS}>
								<div className="relative">
									<textarea
										autoFocus={autoFocusRightNowText}
										value={text}
										onChange={(e) => setText(e.target.value.slice(0, maxChars))}
										placeholder={t("right_now.session_placeholder")}
										aria-label={t("right_now.section_message", { defaultValue: "Message" })}
										className="block min-h-[96px] w-full resize-none bg-transparent px-4 pb-7 pt-3.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
									/>
									<div className="pointer-events-none absolute bottom-2.5 right-4 text-[10px] font-medium tabular-nums text-[var(--text-muted)]">
										{t("right_now.char_limit", { count: text.length })}
									</div>
								</div>
								<PostPhotoRow
									thumbnailUrl={thumbnailUrl}
									isUploading={isUploading}
									isDragging={isDraggingPhoto}
									onPick={() => fileInputRef.current?.click()}
									onRemove={() => {
										setMediaId(null);
										setThumbnailUrl(null);
									}}
									onDragOver={(e) => {
										e.preventDefault();
										if (!isUploading) setIsDraggingPhoto(true);
									}}
									onDragLeave={() => setIsDraggingPhoto(false)}
									onDrop={handleFileDrop}
								/>
							</div>
							<input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="image/*" className="hidden" />

							<SheetSection title={t("right_now.section_options", { defaultValue: "Options" })}>
								<div className={SHEET_GROUP_CLASS}>
									{isEditMode && (
										<ToggleRow
											icon={<RightNowIcon className="h-5 w-5" />}
											iconClass={ROW_ICON_CLASS}
											label={t("right_now.visibility")}
											description={
												isHidden
													? t("right_now.visibility_hidden_desc", { defaultValue: "Paused, nobody nearby can see your session" })
													: t("right_now.visibility_visible_desc", { defaultValue: "Your session shows up in the Right Now feed" })
											}
											checked={!isHidden}
											onChange={(checked) => setIsHidden(!checked)}
											activeColor="var(--right-now)"
											activeThumbColor="#fff"
										/>
									)}
									<PostLocationRow
										shareLocation={shareLocation}
										onShareLocationChange={setShareLocation}
										locationRadius={locationRadius}
										onLocationRadiusChange={setLocationRadius}
										allowMap={isMapFlagOn || showOnMap}
									/>
									{(isDiscreetFlagOn || isDiscreet) && (
										<PostDiscreetRow
											isDiscreet={isDiscreet}
											onDiscreetChange={(next) => {
												// A discreet post can't be made public again.
												if (!next && isDiscreetLocked) return;
												setIsDiscreet(next);
											}}
											isLocked={isDiscreetLocked}
											sharedFields={sharedFields}
											onSharedFieldsChange={setSharedFields}
										/>
									)}
									<ToggleRow
										icon={<HomeFilled className="h-5 w-5" />}
										iconClass={ROW_ICON_CLASS}
										label={t("right_now.i_am_hosting")}
										description={t("right_now.i_am_hosting_desc")}
										checked={isHosting}
										onChange={setIsHosting}
										activeColor="var(--right-now)"
										activeThumbColor="#fff"
									/>
								</div>
							</SheetSection>
						</>
					)}

					{/* Debug Info Box - Visible when Developer Mode is on. Explicitly z-20 to stay above the background glow. */}
					{developerMode && showDebugInfo && (
						<div className="relative z-20 mt-6 rounded-xl border border-blue-500/30 bg-blue-500/5 p-3 font-mono text-[10px] text-blue-500">
							<div className="mb-2 flex items-center justify-between border-b border-blue-500/20 pb-1">
								<div
									className="font-bold uppercase tracking-wider cursor-pointer select-none"
									onClick={() => setDebugClickCount(prev => prev + 1)}
								>
									Debug Controls
								</div>
								{debugClickCount >= 5 && (
									<div className="flex gap-1.5">
										<button
											onClick={() => void setPreferences({ rightNowRemaining: Math.max(0, rightNowRemaining - 1) })}
											className="flex h-5 items-center justify-center rounded bg-blue-500/20 px-2 font-bold hover:bg-blue-500/30 active:scale-90"
										>
											-1
										</button>
										<button
											onClick={() => void setPreferences({ rightNowRemaining: rightNowRemaining + 1 })}
											className="flex h-5 items-center justify-center rounded bg-blue-500/20 px-2 font-bold hover:bg-blue-500/30 active:scale-90"
										>
											+1
										</button>
									</div>
								)}
							</div>

							{debugClickCount >= 5 && (
								<div className="mb-3 space-y-2 border-b border-blue-500/20 pb-3">
									<div className="flex gap-2">
										<input
											type="text"
											placeholder="Active ID"
											value={debugId}
											onChange={(e) => setDebugId(e.target.value)}
											className="w-1/2 rounded border border-blue-500/30 bg-blue-500/10 px-2 py-1 outline-none placeholder:text-blue-500/40"
										/>
										<input
											type="text"
											placeholder="Expires At"
											value={debugExpires}
											onChange={(e) => setDebugExpires(e.target.value)}
											className="w-1/2 rounded border border-blue-500/30 bg-blue-500/10 px-2 py-1 outline-none placeholder:text-blue-500/40"
										/>
									</div>
									<button
										onClick={() => {
											const id = parseInt(debugId);
											const expires = parseInt(debugExpires);
											if (!isNaN(id) && !isNaN(expires)) {
												void setPreferences({
													activeRightNowId: id,
													activeRightNowExpiresAt: expires
												});
												toast.success("Debug state forced");
											} else {
												toast.error("Invalid ID or Expiration");
											}
										}}
										className="w-full rounded bg-blue-500/20 py-1 font-bold hover:bg-blue-500/30 active:scale-[0.98]"
									>
										Apply Debug State
									</button>
								</div>
							)}

							<div className="grid grid-cols-2 gap-2">
								<div>Remaining: {rightNowRemaining}</div>
								<div>isEditMode: {isEditMode ? "YES" : "NO"}</div>
								<div>Active ID: {activeRightNowId || "None"}</div>
							</div>
							{isEditMode && debugInfo && (
								<div className="mt-2 border-t border-blue-500/20 pt-2">
									<div className="mb-1 opacity-70">Fetched at: {debugInfo.time}</div>
									<pre className="overflow-x-auto whitespace-pre-wrap max-h-40">
										{JSON.stringify(debugInfo.data, null, 2)}
									</pre>
								</div>
							)}
						</div>
					)}
				</div>
			</div>

			{/* Bottom actions */}
			{canPost && (
				<div className={`${SHEET_FOOTER_CLASS} flex-col`}>
					<button
						type="button"
						onClick={handlePost}
						disabled={isPosting}
						style={{ backgroundColor: "var(--right-now)", color: "white" }}
						className={cn(sheetButtonClass(), "w-full flex-none shadow-[0_4px_16px_color-mix(in_srgb,var(--right-now)_35%,transparent)]")}
					>
						{isPosting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RightNowIcon className="h-4 w-4" />}
						{isPosting
							? isEditMode
								? t("right_now.updating")
								: t("right_now.starting_session")
							: isEditMode
							? t("right_now.update_now")
							: t("right_now.start_now")}
					</button>

					{isEditMode && rightNowTestMode && (
						<button
							type="button"
							onClick={handleEndSession}
							disabled={isEnding || isPosting}
							className={cn(sheetButtonClass("destructive"), "w-full flex-none")}
						>
							{isEnding && <Loader2 className="h-4 w-4 animate-spin" />}
							{isEnding ? t("right_now.ending_session") : t("right_now.end_session")}
						</button>
					)}
				</div>
			)}
		</>
	);
}

/** Icon tile of every option row, as ToggleRow draws it. */
const ROW_ICON_CLASS = "bg-[color-mix(in_srgb,var(--right-now)_15%,transparent)] text-[var(--right-now)]";
/** The post's photo as a row: pick or drop one, or the uploaded one with a remove button. */
function PostPhotoRow({
	thumbnailUrl,
	isUploading,
	isDragging,
	onPick,
	onRemove,
	onDragOver,
	onDragLeave,
	onDrop,
}: {
	thumbnailUrl: string | null;
	isUploading: boolean;
	isDragging: boolean;
	onPick: () => void;
	onRemove: () => void;
	onDragOver: (e: React.DragEvent) => void;
	onDragLeave: () => void;
	onDrop: (e: React.DragEvent) => void;
}) {
	const { t } = useTranslation();
	return (
		<div
			onDragOver={onDragOver}
			onDragLeave={onDragLeave}
			onDrop={onDrop}
			className={cn("flex items-center gap-3 px-4 py-3 transition", isDragging && "ring-2 ring-inset ring-[var(--right-now)]")}
		>
			<button
				type="button"
				onClick={onPick}
				disabled={isUploading}
				className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-wait"
			>
				{thumbnailUrl ? (
					<img
						src={proxyMediaUrl(thumbnailUrl)}
						alt={t("right_now.upload_preview_alt")}
						className="h-14 w-14 shrink-0 rounded-xl object-cover"
					/>
				) : (
					<span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${ROW_ICON_CLASS}`}>
						{isUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
					</span>
				)}
				<span className="min-w-0 flex-1">
					<span className="block text-sm font-semibold leading-snug text-[var(--text)]">
						{isUploading
							? t("right_now.uploading")
							: thumbnailUrl
								? t("right_now.section_photo", { defaultValue: "Photo" })
								: t("right_now.add_photo")}
					</span>
					<span className="mt-0.5 block text-xs leading-relaxed text-[var(--text-muted)]">
						{thumbnailUrl
							? t("right_now.photo_change_hint", { defaultValue: "Tap to change" })
							: t("right_now.photo_hint", { defaultValue: "Tap to choose or drop an image here" })}
					</span>
				</span>
			</button>
			{thumbnailUrl && !isUploading ? (
				<button
					type="button"
					onClick={onRemove}
					aria-label={t("right_now.photo_remove", { defaultValue: "Remove photo" })}
					title={t("right_now.photo_remove", { defaultValue: "Remove photo" })}
					className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full ink-tint-8 text-[var(--text-muted)] transition hover:text-[var(--text)] active:scale-90"
				>
					<X className="h-4 w-4" />
				</button>
			) : null}
		</div>
	);
}

/** Where others see the post: on the map (with a precision), as a distance, or neither. */
function PostLocationRow({
	shareLocation,
	onShareLocationChange,
	locationRadius,
	onLocationRadiusChange,
	allowMap,
}: {
	shareLocation: RightNowShareLocation;
	onShareLocationChange: (value: RightNowShareLocation) => void;
	locationRadius: number;
	onLocationRadiusChange: (value: number) => void;
	allowMap: boolean;
}) {
	const { t } = useTranslation();
	const { unitsPreset } = usePreferences();
	const options: SelectSheetOption<RightNowShareLocation>[] = [
		...(allowMap
			? [
					{
						value: "DISTANCE_AND_MAP" as const,
						label: t("right_now.location_map", { defaultValue: "On the map" }),
						description: t("right_now.location_map_desc", { defaultValue: "Your post shows on the map, slightly offset." }),
						icon: MapPin,
						iconClassName: ROW_ICON_CLASS,
					},
				]
			: []),
		{
			value: "DISTANCE_ONLY",
			label: t("right_now.location_distance", { defaultValue: "Distance only" }),
			description: t("right_now.location_distance_desc", { defaultValue: "Others see how far away you are, but not where." }),
			icon: Navigation,
			iconClassName: ROW_ICON_CLASS,
		},
		{
			value: "NONE",
			label: t("right_now.location_none", { defaultValue: "Hidden" }),
			description: t("right_now.location_none_desc", { defaultValue: "Nobody sees how far away you are." }),
			icon: EyeOff,
			iconClassName: ROW_ICON_CLASS,
		},
	];
	const radiusLabel = t("right_now.location_within", {
		defaultValue: "Within about {{distance}}",
		distance: formatDistance(approximateRightNowRadiusMeters(locationRadius), t, unitsPreset),
	});

	return (
		<>
			<SelectRow<RightNowShareLocation>
				icon={<MapPin className="h-5 w-5" />}
				iconClass={ROW_ICON_CLASS}
				label={t("right_now.section_location", { defaultValue: "Location" })}
				value={shareLocation}
				options={options}
				onChange={(next) => {
					onShareLocationChange(next);
					if (next === "DISTANCE_AND_MAP") onLocationRadiusChange(RIGHT_NOW_LOCATION_RADIUS_MAX);
				}}
				accentColor="var(--right-now)"
				accentContrast="#fff"
			/>
			{/* Its own tile, so it doesn't run into the row's hover fill. */}
			{shareLocation === "DISTANCE_AND_MAP" ? (
				<div className="flex items-start gap-3 px-4 py-3.5">
					<div className={`shrink-0 rounded-2xl p-2.5 ${ROW_ICON_CLASS}`}>
						<Crosshair className="h-5 w-5" />
					</div>
					<div className="min-w-0 flex-1">
						<div className="flex items-baseline justify-between gap-2">
							<p className="text-sm font-semibold leading-snug text-[var(--text)]">
								{t("right_now.location_accuracy", { defaultValue: "Location accuracy" })}
							</p>
							<span className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]">{radiusLabel}</span>
						</div>
						{/* The app's own slider (the native one is light on desktop dark mode).
						    It shows accuracy, so it runs opposite to locationRadius. */}
						<div className="-my-1">
							<Slider
								min={0}
								max={RIGHT_NOW_LOCATION_RADIUS_MAX}
								step={1}
								defaultValue={RIGHT_NOW_LOCATION_RADIUS_MAX - locationRadius}
								label={t("right_now.location_accuracy", { defaultValue: "Location accuracy" })}
								displayValue={radiusLabel}
								hideHeader
								activeColor="var(--right-now)"
								onChange={(value) => onLocationRadiusChange(RIGHT_NOW_LOCATION_RADIUS_MAX - value)}
							/>
						</div>
						<div aria-hidden="true" className="flex justify-between text-[10px] text-[var(--text-muted)]">
							<span>{t("right_now.location_less", { defaultValue: "Less" })}</span>
							<span>{t("right_now.location_more", { defaultValue: "More" })}</span>
						</div>
					</div>
				</div>
			) : null}
		</>
	);
}

const SHARED_FIELD_LABELS: Record<RightNowSharedField, { key: string; defaultValue: string }> = {
	AGE: { key: "right_now.shared_field_age", defaultValue: "Age" },
	HEIGHT: { key: "right_now.shared_field_height", defaultValue: "Height" },
	WEIGHT: { key: "right_now.shared_field_weight", defaultValue: "Weight" },
	POSITION: { key: "right_now.shared_field_position", defaultValue: "Position" },
};

/**
 * Discreet: the feed shows the post without the profile, only the chosen
 * fields; people send a request instead of messaging. Can't be undone on a
 * running post. Two tiles: the switch, and once on, the shared fields.
 */
function PostDiscreetRow({
	isDiscreet,
	onDiscreetChange,
	isLocked,
	sharedFields,
	onSharedFieldsChange,
}: {
	isDiscreet: boolean;
	onDiscreetChange: (value: boolean) => void;
	isLocked: boolean;
	sharedFields: RightNowSharedField[];
	onSharedFieldsChange: (value: RightNowSharedField[]) => void;
}) {
	const { t } = useTranslation();
	const [isPickerOpen, setIsPickerOpen] = useState(false);
	// The picker works on numbers: a field's index in RIGHT_NOW_SHARED_FIELDS.
	const fieldOptions = RIGHT_NOW_SHARED_FIELDS.map((field, index) => ({
		value: index,
		label: t(SHARED_FIELD_LABELS[field].key, { defaultValue: SHARED_FIELD_LABELS[field].defaultValue }),
	}));
	const summary =
		sharedFields.length > 0
			? fieldOptions.filter((option) => sharedFields.includes(RIGHT_NOW_SHARED_FIELDS[option.value])).map((o) => o.label).join(", ")
			: t("right_now.shared_fields_none", { defaultValue: "Nothing" });
	const toggleField = (index: number) => {
		const field = RIGHT_NOW_SHARED_FIELDS[index];
		const next = sharedFields.includes(field) ? sharedFields.filter((f) => f !== field) : [...sharedFields, field];
		// Keep the API's order.
		onSharedFieldsChange(RIGHT_NOW_SHARED_FIELDS.filter((f) => next.includes(f)));
	};

	return (
		<>
			<ToggleRow
				icon={<VenetianMask className="h-5 w-5" />}
				iconClass={ROW_ICON_CLASS}
				label={t("right_now.discreet_toggle", { defaultValue: "Post discreetly" })}
				description={
					isLocked
						? t("right_now.discreet_locked_desc", { defaultValue: "This post is discreet and stays that way until it ends." })
						: t("right_now.discreet_desc", {
								defaultValue: "Your profile stays hidden. People send a request, and a chat opens once you accept.",
							})
				}
				checked={isDiscreet}
				onChange={onDiscreetChange}
				activeColor="var(--right-now)"
				activeThumbColor="#fff"
			/>
			{isDiscreet ? (
				<button
					type="button"
					onClick={() => setIsPickerOpen(true)}
					className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover-fill"
				>
					<div className={`shrink-0 rounded-2xl p-2.5 ${ROW_ICON_CLASS}`}>
						<ListChecks className="h-5 w-5" />
					</div>
					<div className="min-w-0 flex-1">
						<p className="text-sm font-semibold leading-snug">
							{t("right_now.shared_fields_title", { defaultValue: "Shown on your post" })}
						</p>
					</div>
					<span className="max-w-[50%] shrink-0 truncate text-sm font-medium text-[var(--text-muted)]">{summary}</span>
					<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
				</button>
			) : null}
			{isPickerOpen &&
				createPortal(
					<ManagedOptionsPickerDialog
						title={t("right_now.shared_fields_title", { defaultValue: "Shown on your post" })}
						options={fieldOptions}
						selected={sharedFields.map((field) => RIGHT_NOW_SHARED_FIELDS.indexOf(field))}
						confirmLabel={t("common.done", { defaultValue: "Done" })}
						accentColor="var(--right-now)"
						onToggle={toggleField}
						onClose={() => setIsPickerOpen(false)}
					/>,
					document.body,
				)}
		</>
	);
}
