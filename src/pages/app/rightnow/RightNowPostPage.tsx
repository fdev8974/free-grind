import { X, ImagePlus, Loader2, CheckCircle2, Lock, Hourglass } from "lucide-react";
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
import { prepare1024SquareImage } from "../../../utils/media";
import { sanitizeUploadFile } from "../../../services/uploadSanitize";
import { useApiFunctions } from "../../../hooks/useApiFunctions";
import type { RightNowCreatePostRequest, RightNowUpdatePostRequest } from "../../../services/apiFunctions";
import { getRightNowSessionDuration } from "./rightnow-constants";
import { DrawerEmptyState } from "../chat/drawerUi";
import { triggerRightNowStarted } from "../../../components/RightNowStartedOverlay";
import { SheetSection } from "../../../components/ui/sheet-section";
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
		>
			<RightNowPostSheetContent onPost={onPost} />
		</BottomSheet>
	);
}

// Translucent "glass" fields (same recipe as the profile's quick-message bar),
// so the breathing glow behind them stays visible.
const GLASS_FIELD =
	"border border-[color-mix(in_srgb,var(--border)_60%,transparent)] bg-[color-mix(in_srgb,var(--surface-2)_50%,transparent)] backdrop-blur-md";

function RightNowPostSheetContent({ onPost }: Pick<RightNowPostPageProps, "onPost">) {
	const { t } = useTranslation();
	const apiFunctions = useApiFunctions();
	const { setPreferences, activeRightNowId, activeRightNowExpiresAt, developerMode, showDebugInfo, rightNowRemaining, rightNowTestMode, autoFocusRightNowText } = usePreferences();
	// Closes through the sheet so it animates out and pops its history entry.
	const handleClose = useBottomSheetClose();

	const [text, setText] = useState("");
	const [isHosting, setIsHosting] = useState(false);
	const [isHidden, setIsHidden] = useState(false);
	const [showOnMap, setShowOnMap] = useState(false);
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
				void setPreferences({ activeRightNowHidden: post.postStatus === "HIDDEN" });
				setShowOnMap(post.shareLocation === "DISTANCE_AND_MAP");

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

	const uploadFile = async (file: File) => {
		if (isUploading) return;
		setIsUploading(true);

		try {
			if (rightNowTestMode) {
				const result = await simulateUploadMedia(file);
				setMediaId(result.mediaId);
				setThumbnailUrl(result.thumbnailUrl);
			} else {
				// 1. Resize locally to 1024px to prevent 500 error and corner-crop
				const resizedBlob = await prepare1024SquareImage(file);
				const sanitized = await sanitizeUploadFile(new File([resizedBlob], "right-now.png", { type: "image/png" }));
				const body = new Uint8Array(await sanitized.arrayBuffer());
				const contentType = sanitized.type;
				const coords = { top: 0, left: 0, right: 1024, bottom: 1024 };

				const result = await apiFunctions.uploadRightNowMedia({
					body,
					contentType,
					coords,
				});
				setMediaId(result.mediaId);
				// 2. Only show image AFTER successful upload from server response
				setThumbnailUrl(result.thumbnailUrl);
			}
		} catch (error) {
			appLog.error("Upload failed", error);
			toast.error(t("right_now.error_upload"));
		} finally {
			setIsUploading(false);
			if (fileInputRef.current) fileInputRef.current.value = "";
		}
	};

	const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) void uploadFile(file);
	};

	const handleFileDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDraggingPhoto(false);
		const file = e.dataTransfer.files?.[0];
		if (file && file.type.startsWith("image/")) void uploadFile(file);
	};

	const handlePost = async () => {
		if (isPosting || !canPost) return;

		setIsPosting(true);

		try {
			if (isEditMode && activeRightNowId) {
				const updatePayload: RightNowUpdatePostRequest = {
					text: text.trim(),
					hosting: isHosting,
					hidden: isHidden,
					media: mediaId
						? [
								{
									type: "image_v1",
									data: { id: mediaId },
								},
						  ]
						: [],
					shareLocation: showOnMap ? "DISTANCE_AND_MAP" : "DISTANCE_ONLY",
					sharedFields: [], // Mandatory empty list by default
				};

				if (rightNowTestMode) {
					await simulateUpdatePost(activeRightNowId, updatePayload);
				} else {
					await apiFunctions.updateRightNowPost(activeRightNowId, updatePayload);
				}
				await setPreferences({ activeRightNowHidden: isHidden });
			} else {
				const createPayload: RightNowCreatePostRequest = {
					text: text.trim(),
					shareLocation: showOnMap ? "DISTANCE_AND_MAP" : "DISTANCE_ONLY",
					lat: null,
					lon: null,
					locationRadius: null,
					media: mediaId
						? [
								{
									type: "image_v1",
									data: { id: mediaId },
								},
						  ]
						: [],
					hosting: isHosting,
					sharedFields: [], // Mandatory empty list
				};

				if (rightNowTestMode) {
					const { id, expiresAt } = await simulateCreatePost(createPayload);
					await setPreferences({
						activeRightNowId: id,
						activeRightNowExpiresAt: expiresAt,
						activeRightNowHidden: false,
						rightNowRemaining: Math.max(0, rightNowRemaining - 1),
					});
				} else {
					const response = await apiFunctions.createRightNowPost(createPayload);
					// Fallback to local duration if server doesn't provide expiration
					const expiresAt = response.post.expiration || (Date.now() + sessionDuration);
					await setPreferences({
						activeRightNowId: response.post.id,
						activeRightNowExpiresAt: expiresAt,
						activeRightNowHidden: false,
						rightNowRemaining: Math.max(0, rightNowRemaining - 1),
					});
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
			toast.error(isEditMode ? t("right_now.error_session_update_failed") : t("right_now.error_session_failed"));
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

	return (
		<>
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
						aria-label={`${t("right_now.weekly_limit")}: ${rightNowRemaining}/${weeklyMax}`}
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
							{rightNowRemaining}/{weeklyMax}
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
							<SheetSection title={t("right_now.section_message", { defaultValue: "Message" })}>
								<div className="relative">
									<textarea
										autoFocus={autoFocusRightNowText}
										value={text}
										onChange={(e) => setText(e.target.value.slice(0, maxChars))}
										placeholder={t("right_now.session_placeholder")}
										className={`min-h-[88px] w-full resize-none rounded-xl ${GLASS_FIELD} p-3 pb-6 text-sm text-[var(--text)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--right-now)]`}
									/>
									<div className="pointer-events-none absolute bottom-2.5 right-3 text-[10px] font-medium text-[var(--text-muted)]">
										{t("right_now.char_limit", { count: text.length })}
									</div>
								</div>
							</SheetSection>

							<SheetSection title={t("right_now.section_photo", { defaultValue: "Photo" })}>
								<input
									type="file"
									ref={fileInputRef}
									onChange={handleFileSelect}
									accept="image/*"
									className="hidden"
								/>
								{thumbnailUrl ? (
									<div className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl bg-[var(--surface-2)]">
										<img
											src={proxyMediaUrl(thumbnailUrl)}
											className="h-full w-full object-cover"
											alt={t("right_now.upload_preview_alt")}
										/>
										<button
											type="button"
											onClick={() => {
												setMediaId(null);
												setThumbnailUrl(null);
											}}
											className="absolute right-2 top-2 rounded-full bg-black/60 p-2 text-white backdrop-blur-md transition hover:bg-black/80"
										>
											<X className="h-4 w-4" />
										</button>
									</div>
								) : (
									/* Drop zone, same look as the backup restore offer. */
									<button
										type="button"
										onClick={() => fileInputRef.current?.click()}
										onDragOver={(e) => {
											e.preventDefault();
											if (!isUploading) setIsDraggingPhoto(true);
										}}
										onDragLeave={() => setIsDraggingPhoto(false)}
										onDrop={handleFileDrop}
										disabled={isUploading}
										className={cn(
											"group flex w-full flex-col items-center gap-3 rounded-3xl border-2 border-dashed px-6 py-6 text-center transition disabled:cursor-wait",
											isDraggingPhoto
												? "border-[var(--right-now)] bg-[color-mix(in_srgb,var(--right-now)_10%,var(--surface))]"
												: "border-[color-mix(in_srgb,var(--border)_60%,transparent)] bg-[color-mix(in_srgb,var(--surface-2)_50%,transparent)] backdrop-blur-md hover:border-[var(--right-now)] hover:bg-[color-mix(in_srgb,var(--right-now)_8%,transparent)]",
										)}
									>
										<span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--right-now)] text-white shadow-lg shadow-[var(--right-now)]/20 transition group-hover:scale-105">
											{isUploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
										</span>
										<span className="space-y-1">
											<span className="block text-sm font-semibold text-[var(--text)]">
												{isUploading ? t("right_now.uploading") : t("right_now.add_photo")}
											</span>
											<span className="block text-xs text-[var(--text-muted)]">
												{t("right_now.photo_hint", { defaultValue: "Tap to choose or drop an image here" })}
											</span>
										</span>
									</button>
								)}
							</SheetSection>

							<SheetSection title={t("right_now.section_options", { defaultValue: "Options" })}>
								<div className={`divide-y divide-[color-mix(in_srgb,var(--border)_60%,transparent)] overflow-hidden rounded-2xl ${GLASS_FIELD}`}>
									{isEditMode && (
										<ToggleRow
											icon={<RightNowIcon className="h-5 w-5" />}
											iconClass={cn(
												"flex h-10 w-10 items-center justify-center transition-colors",
												isHidden ? "bg-[var(--surface)] text-[var(--text-muted)]" : "bg-[var(--right-now)] text-white"
											)}
											label={t("right_now.visibility")}
											description={
												isHidden
													? t("right_now.visibility_hidden_desc", { defaultValue: "Paused, nobody nearby can see your session" })
													: t("right_now.visibility_visible_desc", { defaultValue: "Your session shows up in the Right Now feed" })
											}
											checked={!isHidden}
											onChange={(checked) => setIsHidden(!checked)}
											dense
											activeColor="var(--right-now)"
											activeThumbColor="#fff"
										/>
									)}
									<ToggleRow
										icon={<HomeFilled className="h-5 w-5" />}
										iconClass={cn(
											"flex h-10 w-10 items-center justify-center transition-colors",
											isHosting ? "bg-[var(--right-now)] text-white" : "bg-[var(--surface)] text-[var(--text-muted)]"
										)}
										label={t("right_now.i_am_hosting")}
										description={t("right_now.i_am_hosting_desc")}
										checked={isHosting}
										onChange={setIsHosting}
										dense
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
