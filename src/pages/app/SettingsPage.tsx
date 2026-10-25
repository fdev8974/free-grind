import { useNavigate } from "react-router-dom";
import { useLogoutToNextAccount } from "../../hooks/useLogoutToNextAccount";
import { getVersion } from "@tauri-apps/api/app";
import { PageHeaderBackground } from "../../components/ui/PageHeaderBackground";
import { FeedScrollContainer } from "../../components/ui/FeedScrollContainer";
import {
	DatabaseBackup,
	AlertCircle,
	CheckCircle2,
	ChevronRight,
	Download,
	GitBranch,
	Globe,
	Languages,
	Loader2,
	LogOut,
	History,
	Radar,
	RotateCcw,
	RefreshCcw,
	Search,
	Terminal,
	X,
	ScrollText,
	Share2,
	QrCode,
	Ban,
	Clock,
} from "lucide-react";
import { SlidersHorizontal as PhosphorSlidersHorizontal } from "@phosphor-icons/react";
import { ArchiveRestoreFilled, BellFilled, BotFilled, BugFilled, ClipboardListFilled, EyeFilled, EyeOffFilled, FileUpFilled, FlaskConicalFilled, HeartPulseFilled, ImagesFilled, InfoFilled, MegaphoneFilled, PaletteFilled, PuzzleFilled, ShieldFilled, TriangleAlertFilled, UserPlusFilled, UserXFilled, ZapFilled } from "../../components/icons/FilledIcons";
import { useState, useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { appLog } from "../../utils/logger";
import { useAuth } from "../../contexts/useAuth";
import { useApi } from "../../hooks/useApi";
import { usePreferences } from "../../contexts/PreferencesContext";
import { useInboxSyncStatus } from "../../hooks/useInboxSyncStatus";
import type { InboxSyncStatus } from "../../services/inboxSync";
import {
	checkForHotswapUpdate,
	getCurrentHotswapChannel,
	getHotswapChannels,
	getHotswapProgress,
	subscribeHotswapProgress,
	getHotswapChannelLabel,
	installHotswapUpdate,
	isHotswapAvailable,
	isHotswapAutoUpdateEnabled,
	setHotswapAutoUpdateEnabled,
	subscribeHotswapAutoUpdate,
	showHotswapUpdatePrompt,
	setHotswapChannel,
	isContributorChannel,
	getContributorHandle,
	type HotswapChannel,
} from "../../services/hotswap";
import { RowActionPill } from "../../components/ui/row-action-pill";
import { ToggleRow } from "../../components/ui/toggle-row";
import { hasDemoProfileImages, isDemoProfileImagesEnabled, setDemoProfileImagesEnabled } from "../../utils/demoProfileImages";
import { UpdateChannelSheet } from "./UpdateChannelSheet";
import { FingerprintCheckSheet, PushTokenSheet } from "./settings-dev/DiagnosticsSheets";
import { SheetActionList, afterSheetClose } from "../../components/ui/action-sheet";
import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { useFingerprintCheck } from "../../components/FingerprintCheckButton";
import { VersionAnnouncement } from "../../components/VersionAnnouncement";
import { VERSION_ANNOUNCEMENTS } from "../../data/versionAnnouncements";
import { OutdatedVersionPromptView, fetchLatestRelease, isOlderVersion, type ReleaseInfo } from "../../components/OutdatedVersionPrompt";
import { AccountStatusPromptView } from "../../components/AccountStatusPrompt";
import type { AccountStatus } from "../../contexts/auth-context";
import { areUpdateChecksEnabled, setUpdateChecksEnabled, subscribeUpdateChecks } from "../../services/updateChecks";
import { Avatar } from "../../components/ui/avatar";
import { getThumbImageUrl } from "../../utils/media";
import { getSavedAccountProfile, removeSavedAccountProfile } from "../../services/savedAccountProfiles";
import { isAndroid } from "../../services/saveMedia";
import { useSettingsSearchIndex } from "../../data/settingsSearchIndex";
import { isSexualHealthEnabled } from "../../utils/optionalFeatures";
import { replayOnboarding } from "../../utils/onboardingStorage";
import { replayRestoreOffer } from "../../utils/restoreOfferStorage";
import { showLegalAgreementsPrompt } from "../../utils/legalAgreementsDebug";
import { showAccountWarningsPrompt } from "../../utils/accountWarningsDebug";
import { showSharePickerDebug } from "../../utils/sharePickerDebug";
import { GITHUB_ISSUES_URL, GITHUB_NEW_ISSUE_URL, openExternalUrl } from "../../utils/githubIssues";
import { sheetButtonClass } from "../../components/ui/bottom-sheet";

const PUSH_TOKEN_STORAGE_KEY = "fg-fcm-token";
const PUSH_TOKEN_SYNCED_STORAGE_KEY = "fg-fcm-token-synced";
// Always previews whichever entry was added/edited most recently, regardless
// of whether it matches the app's current running version yet.
const LATEST_ANNOUNCEMENT = VERSION_ANNOUNCEMENTS[VERSION_ANNOUNCEMENTS.length - 1] ?? null;
const PREVIEW_RELEASE_INFO = {
	latestVersion: "9.9.9",
	releasesUrl: "https://github.com/fdev8974/free-grind/releases",
	releases: [
		{ version: "9.9.9", publishedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
		{ version: "9.9.8", publishedAt: new Date(Date.now() - 12 * 86_400_000).toISOString() },
		{ version: import.meta.env.VITE_APP_VERSION, publishedAt: new Date(Date.now() - 30 * 86_400_000).toISOString() },
	],
};
const PREVIEW_BAN_STATUS: AccountStatus = {
	kind: "banned",
	info: { kind: "profile", code: 27, message: "Profile is banned", subReason: "DRUG_SALES", automated: true },
};
const PREVIEW_DEVICE_BAN_STATUS: AccountStatus = {
	kind: "banned",
	info: { kind: "device", code: 28, message: "Account banned" },
};
const PREVIEW_NETWORK_BAN_STATUS: AccountStatus = {
	kind: "banned",
	info: { kind: "network", code: 31, message: "Suspicious network" },
};
const PREVIEW_UNDERAGE_BAN_STATUS: AccountStatus = {
	kind: "banned",
	info: { kind: "underage", code: 35, message: "Underage", subReason: "UNDERAGE_ACCESS", automated: false },
};
// Built on selection so the expiry is relative to now: still running, or
// already over with the ban agreement waiting to be accepted.
function previewTimedBanStatus(expired: boolean): AccountStatus {
	return {
		kind: "restriction",
		restriction: {
			kind: "timedBan",
			// BOT_ACTIVITY is one of the timed bans that offer an appeal.
			reason: expired ? null : "HARASSMENT",
			subReason: expired ? "BOT_ACTIVITY" : "MILD_INSULTS",
			automated: true,
			expiresAt: Math.floor(Date.now() / 1000) + (expired ? -60 * 60 : 2 * 24 * 60 * 60),
			agreementCompleted: expired ? false : null,
		},
	};
}

function getErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}

	if (typeof error === "string") {
		return error;
	}

	try {
		return JSON.stringify(error);
	} catch {
		// ignore
	}

	return fallback;
}

function formatMegabytes(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describeInboxSyncStatus(status: InboxSyncStatus, t: TFunction) {
	switch (status.phase) {
		case "syncing_list":
			return {
				title: t("settings.chat_sync_syncing_list", { defaultValue: "Checking for new chats…" }),
				description:
					status.changedSoFar > 0
						? t("settings.chat_sync_syncing_list_desc_changed", {
								defaultValue: "{{checked}} checked, {{changed}} new or updated",
								checked: status.conversationsSoFar,
								changed: status.changedSoFar,
							})
						: t("settings.chat_sync_syncing_list_desc", {
								defaultValue: "{{count}} checked so far",
								count: status.conversationsSoFar,
							}),
				badgeIcon: <Loader2 className="h-3 w-3 animate-spin" />,
				badgeClass: "",
				badgeStyle: {
					backgroundColor: "var(--accent)",
					color: "var(--accent-contrast)",
				} as CSSProperties | undefined,
				progressPercent: null as number | null,
				active: true,
			};
		case "syncing_messages": {
			const progressPercent =
				status.total > 0 ? Math.round((status.completed / status.total) * 100) : null;
			return {
				title: t("settings.chat_sync_syncing_messages", {
					defaultValue: "Syncing latest messages…",
				}),
				description: t("settings.chat_sync_syncing_messages_desc", {
					defaultValue: "{{completed}} / {{total}} conversations",
					completed: status.completed,
					total: status.total,
				}),
				badgeIcon: <Loader2 className="h-3 w-3 animate-spin" />,
				badgeClass: "",
				badgeStyle: {
					backgroundColor: "var(--accent)",
					color: "var(--accent-contrast)",
				} as CSSProperties | undefined,
				progressPercent,
				active: true,
			};
		}
		case "done":
			return {
				title: t("settings.chat_sync_done", { defaultValue: "Chats up to date" }),
				description:
					status.changed > 0
						? t("settings.chat_sync_done_desc_changed", {
								defaultValue: "{{count}} conversations total, {{changed}} just updated",
								count: status.conversations,
								changed: status.changed,
							})
						: t("settings.chat_sync_done_desc", {
								defaultValue: "{{count}} conversations synced",
								count: status.conversations,
							}),
				badgeIcon: <CheckCircle2 className="h-3 w-3" />,
				badgeClass: "bg-emerald-500 text-white",
				badgeStyle: undefined as CSSProperties | undefined,
				progressPercent: null,
				active: false,
			};
		case "error":
			return {
				title: t("settings.chat_sync_error", { defaultValue: "Chat sync failed" }),
				description: status.message,
				badgeIcon: <AlertCircle className="h-3 w-3" />,
				badgeClass: "bg-red-500 text-white",
				badgeStyle: undefined as CSSProperties | undefined,
				progressPercent: null,
				active: false,
			};
		default:
			return {
				title: t("settings.chat_sync_preparing", { defaultValue: "Preparing chat sync…" }),
				description: t("settings.chat_sync_preparing_desc", {
					defaultValue: "Runs in the background and won't slow down the app.",
				}),
				badgeIcon: <Loader2 className="h-3 w-3 animate-spin" />,
				badgeClass: "",
				badgeStyle: {
					backgroundColor: "var(--accent)",
					color: "var(--accent-contrast)",
				} as CSSProperties | undefined,
				progressPercent: null,
				active: true,
			};
	}
}

function ContributorChannelDialog({
	isOpen,
	value,
	onValueChange,
	onSubmit,
	onCancel,
	isProcessing,
}: {
	isOpen: boolean;
	value: string;
	onValueChange: (value: string) => void;
	onSubmit: () => void;
	onCancel: () => void;
	isProcessing: boolean;
}) {
	const dialogRef = useRef<HTMLDialogElement | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (isOpen) {
			if (!dialog.open) {
				try {
					dialog.showModal();
				} catch {
					dialog.show();
				}
				requestAnimationFrame(() => inputRef.current?.focus());
			}
		} else if (dialog.open) {
			dialog.close();
		}
	}, [isOpen]);

	useEffect(() => {
		return () => {
			const dialog = dialogRef.current;
			if (dialog?.open) {
				dialog.close();
			}
		};
	}, []);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		const handleCancel = (event: Event) => {
			event.preventDefault();
			if (!isProcessing) onCancel();
		};
		dialog.addEventListener("cancel", handleCancel);
		return () => dialog.removeEventListener("cancel", handleCancel);
	}, [isProcessing, onCancel]);

	return (
		<dialog
			ref={dialogRef}
			className="fixed inset-0 m-auto h-fit w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)] p-0 text-[var(--text)] shadow-2xl backdrop:bg-black/45"
			onClick={(event) => {
				if (event.target === dialogRef.current && !isProcessing) onCancel();
			}}
		>
			<div className="p-4">
				<p className="text-sm font-semibold text-[var(--text)]">Contributor Channel</p>
				<p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
					Receive experimental builds from a community contributor's channel. Use at your own risk.
				</p>
				<input
					ref={inputRef}
					type="text"
					value={value}
					onChange={(event) => onValueChange(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
					onKeyDown={(event) => {
						if (event.key === "Enter") onSubmit();
					}}
					placeholder="contributor-handle"
					maxLength={32}
					disabled={isProcessing}
					className="input-field mt-4 w-full font-mono text-sm disabled:opacity-60"
				/>
				<div className="mt-6 flex gap-2">
					<button
						type="button"
						onClick={onCancel}
						disabled={isProcessing}
						className={sheetButtonClass("secondary")}
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={onSubmit}
						disabled={isProcessing || !value}
						className={sheetButtonClass()}
					>
						{isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
						<span>Activate</span>
					</button>
				</div>
			</div>
		</dialog>
	);
}

export function SettingsPage() {
	const { t } = useTranslation();
	const { userId, savedAccounts, switchAccount, removeSavedAccount } = useAuth();
	const inboxSyncStatus = useInboxSyncStatus(userId);
	const inboxSyncDisplay = describeInboxSyncStatus(inboxSyncStatus, t);
	const [searchQuery, setSearchQuery] = useState("");
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const settingsSearchIndex = useSettingsSearchIndex();
	const searchResults = useMemo(() => {
		const query = searchQuery.trim().toLowerCase();
		if (!query) return [];
		return settingsSearchIndex.filter((entry) =>
			entry.label.toLowerCase().includes(query) ||
			entry.description?.toLowerCase().includes(query) ||
			entry.section.toLowerCase().includes(query),
		);
	}, [searchQuery, settingsSearchIndex]);
	const [switchingProfileId, setSwitchingProfileId] = useState<string | null>(null);
	const [removingProfileId, setRemovingProfileId] = useState<string | null>(null);
	const [isLoggingOut, setIsLoggingOut] = useState(false);
	// "active" = end the current session; a profile id = forget that saved
	// (non-active) account — both are presented the same way (logout icon +
	// confirmation) even though only the active one is a "real" logout.
	const [logoutConfirmTarget, setLogoutConfirmTarget] = useState<"active" | string | null>(null);
	const navigate = useNavigate();
	const logoutToNextAccount = useLogoutToNextAccount();
	const { callMethod, asAppError } = useApi();
	const { developerMode, showDebugInfo, setPreferences } = usePreferences();
	const [previewAnnouncement, setPreviewAnnouncement] = useState(false);
	const [previewOutdatedPrompt, setPreviewOutdatedPrompt] = useState(false);
	const [previewAccountStatus, setPreviewAccountStatus] = useState<AccountStatus>(null);
	const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
	// App release found by a manual check — shown as the APK update prompt.
	const [appUpdateRelease, setAppUpdateRelease] = useState<ReleaseInfo | null>(null);
	const updateChecksEnabled = useSyncExternalStore(subscribeUpdateChecks, areUpdateChecksEnabled);
	const [isSwitchingChannel, setIsSwitchingChannel] = useState(false);
	const hotswapProgress = useSyncExternalStore(subscribeHotswapProgress, getHotswapProgress);
	const hotswapAutoUpdate = useSyncExternalStore(subscribeHotswapAutoUpdate, isHotswapAutoUpdateEnabled);
	const fingerprintCheck = useFingerprintCheck();
	const [isSyncingFcm, setIsSyncingFcm] = useState(false);
	const [fcmToken, setFcmToken] = useState<string | null>(() => {
		const stored = window.localStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
		if (stored) return stored;
		const win = window as Window & { __FG_FCM_TOKEN?: string };
		return typeof win.__FG_FCM_TOKEN === "string" ? win.__FG_FCM_TOKEN : null;
	});
	const [fcmSyncedToken, setFcmSyncedToken] = useState<string | null>(() => window.localStorage.getItem(PUSH_TOKEN_SYNCED_STORAGE_KEY));
	const [fcmEventLog, setFcmEventLog] = useState<{ time: string; token: string }[]>([]);
	const [manualToken, setManualToken] = useState("");
	const [isPushTokenSheetOpen, setIsPushTokenSheetOpen] = useState(false);
	const [isFingerprintSheetOpen, setIsFingerprintSheetOpen] = useState(false);
	const [isPreviewsSheetOpen, setIsPreviewsSheetOpen] = useState(false);
	const [isChannelSheetOpen, setIsChannelSheetOpen] = useState(false);
	const isDesktop = useDesktopBreakpoint();
	// Sync marker is `${token}::${userId}` (see AuthContext) since the device
	// token is shared across saved accounts but sync is per-account.
	const isFcmSynced = fcmToken != null && fcmSyncedToken === `${fcmToken}::${userId}`;
	const fcmLogRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const onFcmToken = (event: Event) => {
			const token = (event as CustomEvent<{ token: string }>).detail?.token;
			if (typeof token !== "string") return;
			setFcmToken(token);
			setFcmSyncedToken(window.localStorage.getItem(PUSH_TOKEN_SYNCED_STORAGE_KEY));
			const time = new Date().toLocaleTimeString();
			setFcmEventLog((prev) => [...prev, { time, token }]);
			setTimeout(() => {
				fcmLogRef.current?.scrollTo({ top: fcmLogRef.current.scrollHeight, behavior: "smooth" });
			}, 50);
		};
		window.addEventListener("fg:fcm-token", onFcmToken as EventListener);
		return () => window.removeEventListener("fg:fcm-token", onFcmToken as EventListener);
	}, []);
	const [updateChannel, setUpdateChannel] =
		useState<HotswapChannel>(getCurrentHotswapChannel());
	const visibleChannels = getHotswapChannels();
	const frontendVersion = import.meta.env.VITE_APP_VERSION;
	// The installed app (APK / desktop binary) can lag behind the frontend when an
	// OTA bundle was applied on top of it, so show both when they differ.
	const [nativeVersion, setNativeVersion] = useState<string | null>(null);
	useEffect(() => {
		if (!isHotswapAvailable()) return;
		void getVersion()
			.then(setNativeVersion)
			.catch(() => {});
	}, []);
	const [contributorCodeInput, setContributorCodeInput] = useState("");
	const [isActivatingContributor, setIsActivatingContributor] = useState(false);
	const [isContributorDialogOpen, setIsContributorDialogOpen] = useState(false);

	const handleForceSyncFcm = useCallback(async (overrideToken?: string) => {
		const tokenToSync = overrideToken ?? fcmToken;
		if (!tokenToSync) {
			toast.error("No FCM token to sync.");
			return;
		}
		setIsSyncingFcm(true);
		try {
			await callMethod("sync_push_token", { token: tokenToSync });
			// Marker must match AuthContext's `${token}::${userId}` format — the same
			// FCM token is shared across saved accounts, but sync is per-account.
			const syncMarker = `${tokenToSync}::${userId}`;
			window.localStorage.setItem(PUSH_TOKEN_SYNCED_STORAGE_KEY, syncMarker);
			setFcmSyncedToken(syncMarker);
			toast.success("FCM token synced to Grindr.");
		} catch (error) {
			const appError = asAppError(error);
			toast.error(appError?.prettyMessage ?? (error instanceof Error ? error.message : "Sync failed"));
		} finally {
			setIsSyncingFcm(false);
		}
	}, [fcmToken, userId, callMethod, asAppError]);

	const handleLogout = async () => {
		setIsLoggingOut(true);
		try {
			await logoutToNextAccount();
		} catch (error) {
			const message = getErrorMessage(error, "Failed to log out.");
			toast.error(message);
		} finally {
			setIsLoggingOut(false);
			setLogoutConfirmTarget(null);
		}
	};

	const handleSwitchAccount = async (profileId: string) => {
		setSwitchingProfileId(profileId);
		try {
			await switchAccount(profileId);
			navigate("/");
		} catch (error) {
			const message = getErrorMessage(error, "Failed to switch account.");
			toast.error(message);
		} finally {
			setSwitchingProfileId(null);
		}
	};

	const handleRemoveSavedAccount = async (profileId: string) => {
		setRemovingProfileId(profileId);
		try {
			await removeSavedAccount(profileId);
			removeSavedAccountProfile(profileId);
		} catch (error) {
			const message = getErrorMessage(error, "Failed to remove saved account.");
			toast.error(message);
		} finally {
			setRemovingProfileId(null);
			setLogoutConfirmTarget(null);
		}
	};

	// Checks the app release first, then the frontend OTA bundle (native app only).
	const handleCheckUpdates = async () => {
		setIsCheckingUpdates(true);
		try {
			// A failed release lookup doesn't block the frontend check; it's only
			// reported when nothing else turned up.
			let appCheckError: unknown = null;
			const appRelease = await fetchLatestRelease(
				new AbortController().signal,
				getCurrentHotswapChannel() !== "main",
			).catch((error: unknown) => {
				appCheckError = error;
				return null;
			});
			const frontend = isHotswapAvailable() ? await checkForHotswapUpdate() : null;

			const installedAppVersion = nativeVersion ?? frontendVersion;
			const appUpdate =
				appRelease && isOlderVersion(installedAppVersion, appRelease.latestVersion) ? appRelease : null;
			const frontendUpdate = frontend && frontend.available && !frontend.requiresBinaryUpdate ? frontend : null;

			if (frontend?.requiresBinaryUpdate && !appUpdate) {
				toast.error(
					frontend.notes ??
						"This build is no longer compatible. Please download and install the latest APK.",
				);
				return;
			}

			if (!appUpdate && !frontendUpdate) {
				if (appCheckError) throw appCheckError;
				toast.success(t("settings.latest_version"));
				return;
			}

			// Both found: the OTA prompt overlays everything first; the APK prompt
			// is still here once it's dismissed with "Later".
			if (appUpdate) setAppUpdateRelease(appUpdate);
			if (frontendUpdate) {
				if (hotswapAutoUpdate) {
					await installHotswapUpdate();
					toast.success(t("settings.update_installed"));
					window.location.reload();
					return;
				}
				showHotswapUpdatePrompt({ version: frontendUpdate.version, notes: frontendUpdate.notes });
			}
		} catch (error) {
			const msg = getErrorMessage(error, t("settings.failed_update_check"));
			if (import.meta.env.DEV) {
				appLog.error("Update check failed:", error, "| message:", msg);
			}
			toast.error(msg, { duration: 10000 });
		} finally {
			setIsCheckingUpdates(false);
		}
	};

	const handleSwitchUpdateChannel = async (channel: HotswapChannel) => {
		if (!isHotswapAvailable()) {
			toast.error(t("settings.ota_available_only_tauri"));
			return;
		}

		if (channel === updateChannel) {
			return;
		}

		setIsSwitchingChannel(true);
		try {
			await setHotswapChannel(channel);
			setUpdateChannel(channel);

			const result = await checkForHotswapUpdate();
			if (!result.requiresBinaryUpdate && result.available) {
				await installHotswapUpdate();
				toast.success(t("settings.switched_and_updated", { channel: getHotswapChannelLabel(channel) }));
				window.location.reload();
				return;
			}

			toast.success(t("settings.switched_channel", { channel: getHotswapChannelLabel(channel) }));
			window.location.reload();
		} catch (error) {
			if (import.meta.env.DEV) {
				appLog.error("Switch update environment failed:", error);
			}
			toast.error(t("settings.failed_switch_env"));
		} finally {
			setIsSwitchingChannel(false);
		}
	};

	const handleActivateContributorChannel = async () => {
		const handle = contributorCodeInput.trim().toLowerCase();
		if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) {
			toast.error("Enter a valid contributor code (letters, numbers, _ or -).");
			return;
		}

		if (!isHotswapAvailable()) {
			toast.error(t("settings.ota_available_only_tauri"));
			return;
		}

		const channel: HotswapChannel = `contrib-${handle}`;
		setIsActivatingContributor(true);
		try {
			await setHotswapChannel(channel);
			setUpdateChannel(channel);
			setContributorCodeInput("");

			const result = await checkForHotswapUpdate();
			if (!result.available) {
				toast.success(`Switched to ${handle}'s channel. No update available yet.`);
				window.location.reload();
				return;
			}
			if (result.requiresBinaryUpdate) {
				toast.error(result.notes ?? "Binary update required.");
				return;
			}
			await installHotswapUpdate();
			toast.success(`Switched to ${handle}'s channel and updated!`);
			window.location.reload();
		} catch (error) {
			if (import.meta.env.DEV) {
				appLog.error("Contributor channel switch failed:", error);
			}
			toast.error("Failed to switch to contributor channel.");
		} finally {
			setIsActivatingContributor(false);
		}
	};

	const navRow = (
		onClick: (() => void) | null,
		icon: React.ReactNode,
		iconClass: string,
		label: string,
		desc: string,
		right?: React.ReactNode,
		disabled?: boolean,
	) => {
		const inner = (
			<>
				<div className={`rounded-2xl p-2.5 shrink-0 ${iconClass}`}>
					{icon}
				</div>
				<div className="min-w-0 flex-1">
					<p className="text-sm font-semibold leading-snug">{label}</p>
					<p className="text-xs text-[var(--text-muted)] leading-snug mt-0.5">{desc}</p>
				</div>
				{right ?? <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)] opacity-50" />}
			</>
		);
		const cls = `flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ${disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)]"}`;
		return onClick ? (
			<button type="button" onClick={onClick} disabled={disabled} className={cls}>
				{inner}
			</button>
		) : (
			<div className={cls}>{inner}</div>
		);
	};

	if (previewAnnouncement && LATEST_ANNOUNCEMENT) {
		return (
			<div className="app-shell z-[300]">
				<VersionAnnouncement
					announcement={LATEST_ANNOUNCEMENT}
					buttonLabel="Close"
					onClose={() => setPreviewAnnouncement(false)}
				/>
			</div>
		);
	}

	if (appUpdateRelease) {
		return (
			<div className="app-shell z-[110]">
				<OutdatedVersionPromptView
					appVersion={nativeVersion ?? frontendVersion}
					releaseInfo={appUpdateRelease}
					onDismiss={() => setAppUpdateRelease(null)}
					manual
				/>
			</div>
		);
	}

	if (previewAccountStatus) {
		return (
			<div className="app-shell z-[110]">
				<AccountStatusPromptView
					status={previewAccountStatus}
					onSignOut={() => setPreviewAccountStatus(null)}
					onAcceptBanAgreement={async () => setPreviewAccountStatus(null)}
				/>
			</div>
		);
	}

	if (previewOutdatedPrompt) {
		return (
			<div className="app-shell z-[110]">
				<OutdatedVersionPromptView
					appVersion={import.meta.env.VITE_APP_VERSION}
					releaseInfo={PREVIEW_RELEASE_INFO}
					onDismiss={() => setPreviewOutdatedPrompt(false)}
				/>
			</div>
		);
	}

	return (
		<section className="app-screen flex h-dvh w-full flex-col overflow-x-hidden !px-0 !pb-0">
			{/* Main-page header, same structure as Inbox / Interest: a fixed header with the
			    accent glow over its own scroll container. Reached from the bottom nav, so no back button. */}
			<header className="relative z-20 flex shrink-0 flex-col pb-3 pointer-events-none">
				<PageHeaderBackground color="var(--accent)" />
				<div className="pointer-events-auto mx-auto flex w-full max-w-[var(--content-max)] flex-col gap-3 px-[var(--app-px)]">
					<div className="flex items-center justify-between gap-2">
						<div className="min-w-0">
							<h1 className="app-title">{t("settings.title")}</h1>
							{/* Caption under the title, styled like the inbox's sync caption. */}
							{developerMode ? (
								<p className="mt-0.5 text-[11px] font-medium text-[var(--accent-readable)]">Developer Mode</p>
							) : null}
						</div>
						<div className="-my-2 flex shrink-0 items-center gap-0.5">
							<button
								type="button"
								onClick={() => {
									if (isSearchOpen) setSearchQuery("");
									setIsSearchOpen(!isSearchOpen);
								}}
								className="header-icon-btn rounded-xl p-2 text-[var(--text-muted)] transition hover:text-[var(--text)]"
								aria-label={isSearchOpen ? t("common.close", { defaultValue: "Close" }) : t("settings.search_placeholder")}
							>
								{isSearchOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
							</button>
						</div>
					</div>
					{isSearchOpen && (
						<div className="settings-search-bar flex items-center gap-2.5 px-4 py-0.5">
							<Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
							<input
								type="search"
								autoFocus
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Escape") {
										setSearchQuery("");
										setIsSearchOpen(false);
									}
								}}
								placeholder={t("settings.search_placeholder")}
								className="h-11 flex-1 bg-transparent text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none"
							/>
							{searchQuery ? (
								<button
									type="button"
									onClick={() => setSearchQuery("")}
									className="shrink-0 rounded-full p-1 text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
									aria-label={t("common.clear", { defaultValue: "Clear" })}
								>
									<X className="h-4 w-4" />
								</button>
							) : null}
						</div>
					)}
				</div>
			</header>

			{/* Same scroll container as Interest / Right Now: fades content out under the header. */}
			<FeedScrollContainer>
				<div className="mx-auto w-full max-w-[var(--content-max)] px-[var(--app-px)] pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+clamp(92px,10vw,114px))]">
					{searchQuery.trim() ? (
						<div className="grid gap-6">
							{searchResults.length === 0 ? (
								<p className="px-1 text-sm text-[var(--text-muted)]">
									{t("settings.search_no_results", { query: searchQuery.trim() })}
								</p>
							) : (
								<div className="native-card overflow-hidden divide-y divide-[var(--border)]">
									{searchResults.map((entry) => (
										<button
											key={entry.id}
											type="button"
											onClick={() => {
												if (entry.externalUrl) {
													void openExternalUrl(entry.externalUrl);
													return;
												}
												navigate(entry.anchor ? `${entry.route}#${entry.anchor}` : entry.route);
											}}
											className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)]"
										>
											<div className={`rounded-2xl p-2.5 shrink-0 ${entry.iconClass}`}>
												<entry.icon className="h-5 w-5" />
											</div>
											<div className="min-w-0 flex-1">
												<p className="text-sm font-semibold leading-snug">{entry.label}</p>
												<p className="text-xs text-[var(--text-muted)] leading-snug mt-0.5 truncate">
													{entry.section}{entry.description ? ` — ${entry.description}` : ""}
												</p>
											</div>
											<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)] opacity-50" />
										</button>
									))}
								</div>
							)}
						</div>
					) : (
					<div className="grid gap-6">

						{/* Profile — the active profile is the primary focus (tap it to edit
						    your profile), with the account switcher folded in below it for
						    the other saved accounts you can tap between without
						    re-entering a password. Each saved account keeps its own chat
						    history and caches fully separate (see chatDb.ts/cache.ts), so
						    switching never shows a leftover account's data. */}
						<div className="min-w-0">
							<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Profile</p>
							<div className="native-card overflow-hidden divide-y divide-[var(--border)]">
								{(() => {
									const activeAccount = userId != null
										? savedAccounts.find((account) => String(userId) === account.profileId)
										: undefined;
									const activeProfile = userId != null ? getSavedAccountProfile(String(userId)) : null;
									return (
										<div className="flex items-center gap-1">
											<button
												type="button"
												onClick={() => navigate("/settings/profile-editor")}
												className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)]"
											>
												<Avatar
													src={activeProfile?.photoHash ? getThumbImageUrl(activeProfile.photoHash, "75x75") : null}
													alt=""
													className="h-10 w-10 shrink-0 rounded-2xl border-0"
												/>
												<div className="min-w-0 flex-1">
													<p className="truncate text-sm font-semibold leading-snug">
														{activeProfile?.displayName || activeAccount?.email || t("settings.profile_editor")}
													</p>
													<p className="text-xs text-[var(--text-muted)] leading-snug mt-0.5">
														{t("settings.profile_editor_desc")}
													</p>
												</div>
											</button>
											<button
												type="button"
												onClick={() => navigate("/settings/transfer-account")}
												aria-label={t("account_transfer.title", { defaultValue: "Sign in on another device" })}
												title={t("account_transfer.title", { defaultValue: "Sign in on another device" })}
												className="shrink-0 rounded-full p-2.5 text-[var(--text-muted)] transition hover:ink-tint-10 hover:text-[var(--text)]"
											>
												<QrCode className="h-4 w-4" />
											</button>
											<button
												type="button"
												onClick={() => setLogoutConfirmTarget("active")}
												aria-label={t("settings.logout")}
												className="mr-2 shrink-0 rounded-full p-2.5 text-[var(--text-muted)] transition hover:bg-red-500/12 hover:text-red-500"
											>
												<LogOut className="h-4 w-4" />
											</button>
										</div>
									);
								})()}

								{savedAccounts
									.filter((account) => !(userId != null && String(userId) === account.profileId))
									.map((account) => {
										const isSwitching = switchingProfileId === account.profileId;
										const isRemoving = removingProfileId === account.profileId;
										const savedProfile = getSavedAccountProfile(account.profileId);
										return (
											<div key={account.profileId} className="flex items-center gap-1">
												<button
													type="button"
													onClick={() => void handleSwitchAccount(account.profileId)}
													disabled={isSwitching || isRemoving}
													className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)] disabled:cursor-not-allowed"
												>
													<div className="relative h-10 w-10 shrink-0">
														<Avatar
															src={savedProfile.photoHash ? getThumbImageUrl(savedProfile.photoHash, "75x75") : null}
															alt=""
															className="h-full w-full rounded-2xl border-0"
														/>
														{isSwitching && (
															<div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-[var(--surface)]/80">
																<Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" />
															</div>
														)}
													</div>
													<div className="min-w-0 flex-1">
														<p className="truncate text-sm font-semibold leading-snug">
															{savedProfile.displayName || account.email || account.profileId}
														</p>
														<p className="text-xs text-[var(--text-muted)] leading-snug mt-0.5">
															{t("settings.account_tap_to_switch", { defaultValue: "Tap to switch" })}
														</p>
													</div>
												</button>
												<button
													type="button"
													onClick={() => setLogoutConfirmTarget(account.profileId)}
													disabled={isSwitching || isRemoving}
													aria-label={t("settings.logout")}
													className="mr-2 shrink-0 rounded-full p-2.5 text-[var(--text-muted)] transition hover:bg-red-500/12 hover:text-red-500 disabled:opacity-60"
												>
													{isRemoving ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
												</button>
											</div>
										);
									})}
								<button
									type="button"
									onClick={() => navigate("/auth/sign-in?mode=add-profile")}
									className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)]"
								>
									<div className="rounded-2xl bg-[var(--surface-2)] p-2.5 shrink-0 text-[var(--text-muted)]">
										<UserPlusFilled className="h-5 w-5" />
									</div>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-semibold leading-snug">
											{t("settings.add_account", { defaultValue: "Add account" })}
										</p>
										<p className="text-xs text-[var(--text-muted)] leading-snug mt-0.5">
											{t("settings.add_account_desc", { defaultValue: "Sign in with another account" })}
										</p>
									</div>
									<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)] opacity-50" />
								</button>
							</div>
						</div>

						{/* Chat */}
						<div>
							<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Chat</p>
							<div className="native-card overflow-hidden divide-y divide-[var(--border)]">
								<div className="flex items-center gap-3 px-4 py-3.5">
									<div className="relative shrink-0">
										<div className="rounded-2xl bg-[var(--surface-2)] p-2.5 text-[var(--text-muted)]">
											<DatabaseBackup className="h-5 w-5" />
										</div>
										<div
											className={`absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-[var(--surface)] ${inboxSyncDisplay.badgeClass}`}
											style={inboxSyncDisplay.badgeStyle}
										>
											{inboxSyncDisplay.badgeIcon}
										</div>
									</div>
									<div className="min-w-0 flex-1">
										<div className="flex items-center justify-between gap-2">
											<p className="text-sm font-semibold leading-snug">{inboxSyncDisplay.title}</p>
											{inboxSyncDisplay.progressPercent != null && (
												<p className="shrink-0 text-xs font-semibold tabular-nums text-[var(--accent)]">
													{inboxSyncDisplay.progressPercent}%
												</p>
											)}
										</div>
										<p className="mt-0.5 text-xs leading-snug tabular-nums text-[var(--text-muted)]">
											{inboxSyncDisplay.description}
										</p>
										{inboxSyncDisplay.active && (
											<div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
												<div
													className={
														inboxSyncDisplay.progressPercent == null
															? "h-full w-2/5 animate-progress-indeterminate rounded-full bg-[var(--accent)]"
															: "h-full rounded-full bg-[var(--accent)] transition-all duration-300"
													}
													style={
														inboxSyncDisplay.progressPercent != null
															? { width: `${inboxSyncDisplay.progressPercent}%` }
															: undefined
													}
												/>
											</div>
										)}
									</div>
								</div>
								{navRow(
									() => navigate("/settings/albums"),
									<ImagesFilled className="h-5 w-5" />,
									"bg-pink-500/15 text-pink-400",
									t("settings.my_albums"),
									t("settings.my_albums_desc"),
								)}
								{navRow(
									() => navigate("/settings/translation"),
									<Languages className="h-5 w-5" />,
									"bg-cyan-500/15 text-cyan-400",
									t("settings.translation", { defaultValue: "Translation" }),
									t("settings.translation_desc", { defaultValue: "Translate chat messages into your app language, one at a time or automatically per chat." }),
								)}
							</div>
						</div>

						{/* Safety */}
						<div>
							<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Safety</p>
							<div className="native-card overflow-hidden divide-y divide-[var(--border)]">
								{navRow(
									() => navigate("/settings/blocked"),
									<UserXFilled className="h-5 w-5" />,
									"bg-red-500/15 text-red-400",
									t("settings.blocked_accounts"),
									t("settings.blocked_accounts_desc"),
								)}
								{navRow(
									() => navigate("/settings/hidden"),
									<EyeOffFilled className="h-5 w-5" />,
									"bg-slate-500/15 text-slate-400",
									t("settings.hidden_profiles", { defaultValue: "Hidden Profiles" }),
									t("settings.hidden_profiles_desc", {
										defaultValue: "See who you hid from the grid and unhide them anytime.",
									}),
								)}
								{navRow(
									() => navigate("/settings/block-history"),
									<History className="h-5 w-5" />,
									"bg-orange-500/15 text-orange-400",
									t("settings.block_history", { defaultValue: "Block Activity" }),
									t("settings.block_history_desc", {
										defaultValue: "See who has blocked or unblocked you, and when.",
									}),
								)}
								{navRow(
									() => navigate("/settings/privacy"),
									<ShieldFilled className="h-5 w-5" />,
									"bg-sky-500/15 text-sky-400",
									t("settings.privacy"),
									t("settings.privacy_desc"),
								)}
								{isSexualHealthEnabled() &&
									navRow(
										() => navigate("/settings/sexual-health"),
										<HeartPulseFilled className="h-5 w-5" />,
										"bg-rose-500/15 text-rose-400",
										t("settings.sexual_health", { defaultValue: "Sexual Health" }),
										t("settings.sexual_health_desc", {
											defaultValue: "Track PrEP doses, encounters, tests and appointments.",
										}),
									)}
							</div>
						</div>

						{/* Customizability */}
						<div>
							<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Customizability</p>
							<div className="native-card overflow-hidden divide-y divide-[var(--border)]">
								{navRow(
									() => navigate("/settings/customizability"),
									<PaletteFilled className="h-5 w-5" />,
									"bg-violet-500/15 text-violet-400",
									t("settings.customizability"),
									t("settings.customizability_desc"),
								)}
								{navRow(
									() => navigate("/settings/behavior"),
									<PhosphorSlidersHorizontal weight="fill" className="h-5 w-5" />,
									"bg-slate-500/15 text-slate-400",
									t("settings.behavior"),
									t("settings.behavior_desc"),
								)}
								{navRow(
									() => navigate("/settings/optional-features"),
									<PuzzleFilled className="h-5 w-5" />,
									"bg-emerald-500/15 text-emerald-400",
									t("customizability.optional_features", { defaultValue: "Optional Features" }),
									t("customizability.optional_features_desc", {
										defaultValue: "Turn extra features on or off to keep the app as simple as you like.",
									}),
								)}
								{navRow(
									() => navigate("/settings/notifications"),
									<BellFilled className="h-5 w-5" />,
									"bg-blue-500/15 text-blue-400",
									t("settings.notifications"),
									t("settings.notifications_desc"),
								)}
								{navRow(
									() => navigate("/settings/automation"),
									<BotFilled className="h-5 w-5" />,
									"bg-amber-500/15 text-amber-400",
									t("settings.automation"),
									t("settings.automation_desc"),
								)}
							</div>
						</div>

						{/* Backup & Restore */}
						<div>
							<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
								{t("settings.data_section", { defaultValue: "Backup & Restore" })}
							</p>
							<div className="native-card overflow-hidden divide-y divide-[var(--border)]">
								{navRow(
									() => navigate("/settings/data"),
									<ArchiveRestoreFilled className="h-5 w-5" />,
									"bg-teal-500/15 text-teal-400",
									t("settings.data", { defaultValue: "Backup & Restore" }),
									t("settings.data_desc", { defaultValue: "Downloaded media storage, and back up/restore your entire account" }),
								)}
							</div>
						</div>

						{/* Updates — same row pattern as the rest of the settings list. */}
						<div className="min-w-0">
							<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Updates</p>
							<div className="native-card overflow-hidden divide-y divide-[var(--border)]">
								{/* The whole row checks; the pill on the right is the visible affordance. */}
								<button
									type="button"
									onClick={() => void handleCheckUpdates()}
									disabled={isCheckingUpdates || isSwitchingChannel}
									className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)] disabled:cursor-default disabled:hover:bg-transparent"
								>
									<div className="relative shrink-0">
										<div className="rounded-2xl bg-green-500/15 p-2.5 text-green-400">
											<RefreshCcw className="h-5 w-5" />
										</div>
										{isContributorChannel(updateChannel) && (
											<div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)] ring-2 ring-[var(--surface)]">
												<GitBranch className="h-3 w-3" />
											</div>
										)}
									</div>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-semibold leading-snug">
											{t("settings.check_updates")}
										</p>
										<p className="mt-0.5 truncate text-xs leading-snug tabular-nums text-[var(--text-muted)]">
											{nativeVersion && nativeVersion !== frontendVersion
												? t("settings.installed_versions", {
														defaultValue: "Frontend {{frontend}} · App {{app}}",
														frontend: frontendVersion,
														app: nativeVersion,
													})
												: t("settings.installed_version", {
														defaultValue: "Version {{version}}",
														version: frontendVersion,
													})}
										</p>
									</div>
									<RowActionPill loading={isCheckingUpdates} loadingLabel={false}>
										{t("settings.check_now")}
									</RowActionPill>
								</button>

								{hotswapProgress.phase !== "idle" && hotswapProgress.phase !== "checking" && (() => {
											const percent =
												hotswapProgress.phase === "downloading" && hotswapProgress.total
													? Math.min(100, Math.round((hotswapProgress.downloaded / hotswapProgress.total) * 100))
													: hotswapProgress.phase === "done"
														? 100
														: null;
											const label =
												hotswapProgress.phase === "downloading"
													? t("settings.ota_progress_downloading", {
															defaultValue: "Downloading update… {{size}}",
															size: hotswapProgress.total
																? `${formatMegabytes(hotswapProgress.downloaded)} / ${formatMegabytes(hotswapProgress.total)}`
																: formatMegabytes(hotswapProgress.downloaded),
														})
													: hotswapProgress.phase === "installing"
														? t("settings.ota_progress_installing", { defaultValue: "Installing update…" })
														: t("settings.ota_progress_done", { defaultValue: "Update installed. Reloading…" });
											return (
												<div className="px-4 py-3">
													<div className="flex items-center justify-between gap-2">
														<p className="text-xs leading-snug tabular-nums text-[var(--text-muted)]">{label}</p>
														{percent != null && (
															<p className="shrink-0 text-xs font-semibold tabular-nums text-[var(--accent)]">
																{percent}%
															</p>
														)}
													</div>
													{hotswapProgress.phase === "downloading" && (
														<div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
															<div
																className={
																	percent == null
																		? "h-full w-2/5 animate-progress-indeterminate rounded-full bg-[var(--accent)]"
																		: "h-full rounded-full bg-[var(--accent)] transition-[width] duration-200"
																}
																style={percent != null ? { width: `${percent}%` } : undefined}
															/>
														</div>
													)}
												</div>
											);
										})()}

								<ToggleRow
									checked={updateChecksEnabled}
									onChange={setUpdateChecksEnabled}
									icon={<Globe className="h-5 w-5" />}
									iconClass="bg-amber-500/15 text-amber-400"
									label={t("settings.update_checks", { defaultValue: "Check Automatically" })}
									description={t("settings.update_checks_desc", {
										defaultValue: "Looks for new app and frontend versions on GitHub at every app start. When off, no request is sent to GitHub unless you check manually above.",
									})}
								/>
								{updateChecksEnabled && (
									<ToggleRow
										checked={hotswapAutoUpdate}
										onChange={setHotswapAutoUpdateEnabled}
										icon={<ZapFilled className="h-5 w-5" />}
										iconClass="bg-sky-500/15 text-sky-400"
										label={t("settings.auto_update", { defaultValue: "Install Automatically" })}
										description={t("settings.auto_update_desc", {
											defaultValue: "Installs new frontend versions (OTA) from GitHub Actions right away and reloads the app. When off, you'll be asked first.",
										})}
									/>
								)}

								{visibleChannels.length > 0 &&
									navRow(
										() => setIsChannelSheetOpen(true),
										<GitBranch className="h-5 w-5" />,
										"bg-violet-500/15 text-violet-400",
										t("settings.update_channel", { defaultValue: "Update Channel" }),
										t("settings.update_channel_desc", { defaultValue: "Which release track this app gets updates from." }),
										<span className="flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--text-muted)]">
											{isContributorChannel(updateChannel)
												? getContributorHandle(updateChannel)
												: getHotswapChannelLabel(updateChannel)}
											<ChevronRight className="h-4 w-4 opacity-50" />
										</span>,
										// Only while switching: a running check shows as the spinner in the Check Now pill alone.
										isSwitchingChannel,
									)}
							</div>
						</div>

						{/* Dev tools */}
						{developerMode ? (
							<div>
								<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Developer</p>
								<div className="native-card overflow-hidden divide-y divide-[var(--border)]">
									<ToggleRow
										checked={showDebugInfo}
										onChange={(checked) => void setPreferences({ showDebugInfo: checked })}
										icon={<BugFilled className="h-5 w-5" />}
										iconClass="bg-[var(--surface-2)] text-[var(--text-muted)]"
										label="Show Debug Overlays"
										description="Displays source (cache/network) info in the grid."
									/>
									{hasDemoProfileImages() && (
										<ToggleRow
											checked={isDemoProfileImagesEnabled()}
											onChange={setDemoProfileImagesEnabled}
											icon={<ImagesFilled className="h-5 w-5" />}
											iconClass="bg-[var(--surface-2)] text-[var(--text-muted)]"
											label="Demo Profile Pictures"
											description="Replaces every profile photo with a bundled demo picture, for screenshots. Reloads the app."
										/>
									)}
									{navRow(
										() => navigate("/settings/api-inspector"),
										<Terminal className="h-5 w-5" />,
										"bg-[var(--surface-2)] text-[var(--text-muted)]",
										t("settings.api_inspector"),
										t("settings.api_inspector_desc"),
									)}
									{navRow(
										() => navigate("/settings/assignments"),
										<FlaskConicalFilled className="h-5 w-5" />,
										"bg-[var(--surface-2)] text-[var(--text-muted)]",
										"Assignments & Feature Flags",
										"Server-side flags and A/B experiments assigned to this account.",
									)}
									{isAndroid() && navRow(
										() => setIsPushTokenSheetOpen(true),
										<BellFilled className="h-5 w-5" />,
										"bg-[var(--surface-2)] text-[var(--text-muted)]",
										"Push Token (FCM)",
										"Inspect the device push token and re-sync it to Grindr.",
									)}
									{navRow(
										() => setIsFingerprintSheetOpen(true),
										<Radar className="h-5 w-5" />,
										"bg-[var(--surface-2)] text-[var(--text-muted)]",
										"Fingerprint Check",
										"Verify your HTTP/TLS fingerprint matches OkHttp.",
									)}
									{navRow(
										() => setIsPreviewsSheetOpen(true),
										<EyeFilled className="h-5 w-5" />,
										"bg-[var(--surface-2)] text-[var(--text-muted)]",
										"UI Previews",
										"Open onboarding, prompts and other one-off screens on demand.",
									)}
								</div>
							</div>
						) : null}

						{/* About */}
						<div>
							<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">About</p>
							<div className="native-card overflow-hidden divide-y divide-[var(--border)]">
								{navRow(
									() => navigate("/settings/about"),
									<InfoFilled className="h-5 w-5" />,
									"bg-slate-500/15 text-slate-400",
									t("settings.about"),
									t("settings.about_desc"),
								)}
								{navRow(
									() => void openExternalUrl(GITHUB_ISSUES_URL),
									<ClipboardListFilled className="h-5 w-5" />,
									"bg-orange-500/15 text-orange-400",
									t("settings.issue_board"),
									t("settings.issue_board_desc"),
								)}
								{navRow(
									() => void openExternalUrl(GITHUB_NEW_ISSUE_URL),
									<BugFilled className="h-5 w-5" />,
									"bg-rose-500/15 text-rose-400",
									t("settings.report_issue"),
									t("settings.report_issue_desc"),
								)}
							</div>
						</div>

					</div>
					)}
				</div>
			</FeedScrollContainer>

			<ConfirmDialog
				isOpen={logoutConfirmTarget != null}
				title={t("settings.logout_confirm_title", { defaultValue: "Log out?" })}
				message={
					logoutConfirmTarget === "active"
						? t("profile_editor.logout_description", { defaultValue: "You will be signed out of your account on this device." })
						: t("settings.logout_other_description", { defaultValue: "You'll need to sign in again to use this account on this device." })
				}
				confirmLabel={t("settings.logout")}
				cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
				confirmTone="danger"
				isProcessing={
					logoutConfirmTarget === "active" ? isLoggingOut : removingProfileId === logoutConfirmTarget
				}
				onConfirm={() => {
					if (logoutConfirmTarget === "active") {
						void handleLogout();
					} else if (logoutConfirmTarget != null) {
						void handleRemoveSavedAccount(logoutConfirmTarget);
					}
				}}
				onCancel={() => setLogoutConfirmTarget(null)}
			/>

			{isPushTokenSheetOpen && (
				<PushTokenSheet
					token={fcmToken}
					isSynced={isFcmSynced}
					isSyncing={isSyncingFcm}
					eventLog={fcmEventLog}
					logRef={fcmLogRef}
					manualToken={manualToken}
					onManualTokenChange={setManualToken}
					onSync={(override) => void handleForceSyncFcm(override)}
					onClose={() => setIsPushTokenSheetOpen(false)}
				/>
			)}

			{isChannelSheetOpen && (
				<UpdateChannelSheet
					channels={visibleChannels}
					current={updateChannel}
					canAddContributor={developerMode}
					disabled={isSwitchingChannel || isCheckingUpdates}
					isDesktop={isDesktop}
					onSelect={(channel) => void handleSwitchUpdateChannel(channel)}
					onAddContributor={() => setIsContributorDialogOpen(true)}
					onClose={() => setIsChannelSheetOpen(false)}
				/>
			)}

			{isPreviewsSheetOpen && (
				<SheetActionList
					title="UI Previews"
					onClose={() => setIsPreviewsSheetOpen(false)}
					isDesktop={isDesktop}
					expandable
					// Each preview opens after this sheet has closed (and popped its history entry).
					actions={[
						{ key: "onboarding", icon: RotateCcw, label: "Replay Onboarding", description: "The first-launch setup flow.", onSelect: () => afterSheetClose(replayOnboarding) },
						{ key: "restore", icon: FileUpFilled, label: "Restore Offer", description: "The first-login backup restore dialog.", onSelect: () => afterSheetClose(replayRestoreOffer) },
						{ key: "legal", icon: ScrollText, label: "Legal Agreements", description: "Terms of Service / Privacy Policy, even if already accepted.", onSelect: () => afterSheetClose(showLegalAgreementsPrompt) },
						{ key: "ban", icon: Ban, label: "Ban Screen", description: "A permanent profile ban (DRUG_SALES) with its explanation.", onSelect: () => afterSheetClose(() => setPreviewAccountStatus(PREVIEW_BAN_STATUS)) },
						{ key: "device-ban", icon: Ban, label: "Device Ban Screen", description: "Code 28, often a refused fingerprint rather than a real ban.", onSelect: () => afterSheetClose(() => setPreviewAccountStatus(PREVIEW_DEVICE_BAN_STATUS)) },
						{ key: "network-ban", icon: Globe, label: "Network Ban Screen", description: "Code 31 (SUSPICIOUS_NETWORK), e.g. a VPN.", onSelect: () => afterSheetClose(() => setPreviewAccountStatus(PREVIEW_NETWORK_BAN_STATUS)) },
						{ key: "underage-ban", icon: Ban, label: "Underage Ban Screen", description: "Code 35, banned as under 18 by a moderator.", onSelect: () => afterSheetClose(() => setPreviewAccountStatus(PREVIEW_UNDERAGE_BAN_STATUS)) },
						{ key: "timed-ban", icon: Clock, label: "Timed Ban Screen", description: "A temporary ban (MILD_INSULTS) that ends in two days.", onSelect: () => afterSheetClose(() => setPreviewAccountStatus(previewTimedBanStatus(false))) },
						{ key: "timed-ban-expired", icon: ScrollText, label: "Ban Agreement Screen", description: "An expired temporary ban (BOT_ACTIVITY, appealable) waiting for its ban agreement.", onSelect: () => afterSheetClose(() => setPreviewAccountStatus(previewTimedBanStatus(true))) },
						{ key: "warnings", icon: TriangleAlertFilled, label: "Account Warnings", description: "The community-guidelines warnings prompt with sample warnings.", onSelect: () => afterSheetClose(showAccountWarningsPrompt) },
						{ key: "share", icon: Share2, label: "Share Picker", description: "The \"Send to…\" chat picker with sample images.", onSelect: () => afterSheetClose(() => void showSharePickerDebug()) },
						{
							key: "announcement",
							icon: MegaphoneFilled,
							label: "Version Announcement",
							description: LATEST_ANNOUNCEMENT
								? `"${LATEST_ANNOUNCEMENT.headline}" (v${LATEST_ANNOUNCEMENT.version}).`
								: "No version announcement configured yet.",
							disabled: !LATEST_ANNOUNCEMENT,
							onSelect: () => afterSheetClose(() => setPreviewAnnouncement(true)),
						},
						{ key: "outdated", icon: Download, label: "Outdated Update Prompt", description: "The \"Update Available\" screen for outdated apps.", onSelect: () => afterSheetClose(() => setPreviewOutdatedPrompt(true)) },
						{
							key: "ota",
							icon: RefreshCcw,
							label: "OTA Update Prompt",
							description: "The frontend \"Update Available\" screen, with a simulated download.",
							onSelect: () =>
								afterSheetClose(() =>
									showHotswapUpdatePrompt({
										version: `${frontendVersion}-ota.${getCurrentHotswapChannel()}.${Math.floor(Date.now() / 1000)}`,
										notes: null,
										preview: true,
									}),
								),
						},
					]}
				/>
			)}

			{isFingerprintSheetOpen && (
				<FingerprintCheckSheet check={fingerprintCheck} onClose={() => setIsFingerprintSheetOpen(false)} />
			)}

			<ContributorChannelDialog
				isOpen={isContributorDialogOpen}
				value={contributorCodeInput}
				onValueChange={setContributorCodeInput}
				onSubmit={() => void handleActivateContributorChannel()}
				onCancel={() => {
					setIsContributorDialogOpen(false);
					setContributorCodeInput("");
				}}
				isProcessing={isActivatingContributor}
			/>
		</section>
	);
}
