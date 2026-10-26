import {
	useCallback,
	useReducer,
	useEffect,
	useRef,
	useState,
	ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useApi } from "../hooks/useApi";
import { useApiFunctions } from "../hooks/useApiFunctions";
import type { AppError, Restriction } from "../types/api";
import { banInfoSchema, restrictionSchema } from "../types/api";
import toast from "react-hot-toast";
import {
	AuthContext,
	type AccountStatus,
	type AuthContextType,
	type AuthError,
	type AuthState,
	type SavedAccountMeta,
	type LoginOptions,
	type SignUpData,
	SmsVerificationRequiredError,
} from "./auth-context";
import { appLog } from "../utils/logger";
import { setActiveChatDbUser, migrateLegacySettingsIfNeeded } from "../services/chatDb";
import { setActiveChatContactIndexAccount } from "../services/chatContactIndex";
import { setActiveInterestStoreUser } from "../services/interestViewsStore";
import { clearAllCaches } from "../pages/app/gridpage/cache";
import { loadAutomationCache } from "../utils/autoblock";
import { loadAutomationRulesCache } from "../utils/automationRules";
import { loadPrivacyCache } from "../utils/privacy";
import { loadAutoTranslateCache } from "../utils/autoTranslate";
import { loadSeenCache } from "../services/seenStore";
import { runInboxSync } from "../services/inboxSync";
import { runTapsAutomationSync } from "../services/tapsSync";
import { syncSavedPhrasesFromServer } from "../services/savedPhrases";
import { mintRecaptchaToken, RecaptchaError, type RecaptchaFailure } from "../services/recaptcha";
import { restoreStrandedLocation } from "../services/entitlementBypass";
import { syncPushAccountsToNative } from "../services/pushAccounts";

const AUTH_USER_ID_STORAGE_KEY = "fg-user-id";
const PUSH_TOKEN_STORAGE_KEY = "fg-fcm-token";
const PUSH_TOKEN_SYNCED_STORAGE_KEY = "fg-fcm-token-synced";
// { key: "<token>::<sorted non-active profile ids>", at, ok } of the last
// registration for the saved accounts that aren't active.
const PUSH_TOKEN_SAVED_SYNCED_STORAGE_KEY = "fg-fcm-token-synced-saved";
// Re-registered now and then even when nothing changed, in case Grindr
// dropped one; a failed run is retried sooner.
const SAVED_PUSH_SYNC_INTERVAL_MS = 24 * 60 * 60_000;
const SAVED_PUSH_SYNC_RETRY_MS = 10 * 60_000;

type SavedPushSyncMarker = { key: string; at: number; ok: boolean };

function readSavedPushSyncMarker(): SavedPushSyncMarker | null {
	try {
		const parsed: unknown = JSON.parse(window.localStorage.getItem(PUSH_TOKEN_SAVED_SYNCED_STORAGE_KEY) ?? "null");
		if (!parsed || typeof parsed !== "object") return null;
		const { key, at, ok } = parsed as Partial<SavedPushSyncMarker>;
		return typeof key === "string" && typeof at === "number" ? { key, at, ok: ok === true } : null;
	} catch {
		return null;
	}
}

/** The FCM token Android handed over, cached or still waiting on window. */
function cachedPushToken(): string | null {
	const fallback = (window as Window & { __FG_FCM_TOKEN?: unknown }).__FG_FCM_TOKEN;
	return window.localStorage.getItem(PUSH_TOKEN_STORAGE_KEY) || (typeof fallback === "string" ? fallback : null) || null;
}

// Grindr's API returns this generic validation error for several rejected-login
// cases (wrong credentials, malformed/expired token) rather than a specific one,
// so its raw "Error 4: invalid input parameters" text is meaningless to users.
const INVALID_INPUT_PARAMETERS_CODE = 4;
// Sign-in refused until the account verifies a phone number by SMS (Grindr
// code 30): the profile id and whole body the error carries, null for
// anything else.
function verificationRequired(appError: AppError | null): { profileId: string; body: string } | null {
	if (appError?.kind !== "VerificationRequired") return null;
	const message = appError.message;
	if (typeof message !== "object") return null;
	const profileId = "profileId" in message && typeof message.profileId === "string" ? message.profileId : null;
	if (!profileId) return null;
	return { profileId, body: ("body" in message && message.body) || "" };
}

// Error markers from api/facebook_oauth and api/google_oauth (Rust), matched verbatim.
const GOOGLE_CANCELED = "google-canceled";
const FACEBOOK_CANCELED = "facebook-canceled";
const FACEBOOK_DIALOG_ERROR = "facebook-dialog-error";
const FACEBOOK_HANDOFF_REFUSED = "facebook-handoff-refused";
// Error markers from sign_in_with_transfer_code (api/auth.rs), matched verbatim.
const TRANSFER_CODE_MESSAGES: Record<string, string> = {
	"transfer-code-invalid": "This isn't a Free Grind sign-in code.",
	"transfer-code-expired": "This sign-in code has expired. Show a new one on the other device.",
	"transfer-code-revoked": "The other device's session is no longer valid. Sign in there again, then show a new code.",
};

function describeLoginError(
	appError: AppError | null,
	fallback: string,
	invalidCredentialsMessage: string,
): AuthError {
	if (
		appError?.kind === "Api" &&
		typeof appError.message === "object" &&
		appError.message.code === INVALID_INPUT_PARAMETERS_CODE
	) {
		return { message: invalidCredentialsMessage };
	}
	// Plumbing failures ("failed to open sign-in window: ..."): the raw text
	// means nothing to the user, so it only goes under "Details".
	if (appError?.kind === "Connect") {
		return {
			message: "Couldn't connect. Check your internet connection and try again.",
			detail: appError.prettyMessage,
		};
	}
	if (appError?.kind === "Http") {
		return { message: fallback, detail: appError.prettyMessage };
	}
	return { message: appError?.prettyMessage || fallback };
}

function isInvalidCredentials(appError: AppError | null): boolean {
	if (appError?.kind === "Unauthorized") return true;
	return (
		appError?.kind === "Api" &&
		typeof appError.message === "object" &&
		appError.message.code === INVALID_INPUT_PARAMETERS_CODE
	);
}

// Shown when a sign-in or sign-up needs a reCAPTCHA token (Grindr's
// first-party reCAPTCHA) but none could be minted.
const CAPTCHA_MESSAGES: Partial<Record<RecaptchaFailure, string>> = {
	unsupportedPlatform: "This account needs captcha verification, which is only available on Android.",
	grindrMissing: "Captcha verification needs the Grindr app installed on this device.",
};
const CAPTCHA_FAILED_MESSAGE = "Captcha verification failed. Please try again.";

type AuthAction =
	| { type: "SET_USER"; payload: number }
	| { type: "CLEAR_USER" }
	| { type: "SET_LOADING"; payload: boolean }
	| { type: "SET_ERROR"; payload: AuthError | null }
	| { type: "SET_SETTINGS_READY"; payload: boolean }
	| { type: "SET_TOKEN_EXPIRED"; payload: boolean }
	| { type: "SET_ACCOUNT_STATUS"; payload: AccountStatus };

function authReducer(state: AuthState, action: AuthAction): AuthState {
	switch (action.type) {
		case "SET_USER":
			return { ...state, userId: action.payload, error: null, tokenExpired: false, accountStatus: null };
		case "CLEAR_USER":
			return { ...state, userId: null, tokenExpired: false, accountStatus: null };
		case "SET_LOADING":
			return { ...state, isLoading: action.payload };
		case "SET_ERROR":
			return { ...state, error: action.payload };
		case "SET_SETTINGS_READY":
			return { ...state, settingsReady: action.payload };
		case "SET_TOKEN_EXPIRED":
			return { ...state, tokenExpired: action.payload };
		case "SET_ACCOUNT_STATUS":
			return { ...state, accountStatus: action.payload };
		default:
			return state;
	}
}

export function AuthProvider({ children }: { children: ReactNode }) {
	const [state, dispatch] = useReducer(authReducer, {
		userId: null,
		isLoading: true,
		error: null,
		settingsReady: false,
		tokenExpired: false,
		accountStatus: null,
	});

	const { callMethod, asAppError, asBanned } = useApi();
	const apiFunctions = useApiFunctions();
	const queryClient = useQueryClient();
	const [savedAccounts, setSavedAccounts] = useState<SavedAccountMeta[]>([]);
	// Until the first list_saved_accounts answer, an empty savedAccounts
	// means "unknown", not "none" — native must not be told there are none.
	const [savedAccountsLoaded, setSavedAccountsLoaded] = useState(false);
	const savedAccountsRef = useRef(savedAccounts);
	savedAccountsRef.current = savedAccounts;
	const savedPushSyncInFlightRef = useRef(false);
	// undefined = not yet resolved once; distinguishes "app boot" (nothing to
	// clear, just point the chat db at whatever account is already logged
	// in) from an actual account change (switch/logout) afterwards.
	const previousUserIdRef = useRef<number | null | undefined>(undefined);
	// Live mirror of state.userId for the background inbox sync's staleness
	// check below — a plain closure over state.userId would only ever see
	// the value from the render that kicked the sync off.
	const currentUserIdRef = useRef<number | null>(state.userId);
	useEffect(() => {
		currentUserIdRef.current = state.userId;
	}, [state.userId]);

	const refreshSavedAccounts = async () => {
		try {
			const accounts = await callMethod("list_saved_accounts");
			setSavedAccounts(accounts);
			setSavedAccountsLoaded(true);
		} catch (error) {
			appLog.warn("[Auth] refreshSavedAccounts failed", asAppError(error) ?? error);
		}
	};

	// Session still valid, but the account needs the user to resolve
	// something (age verification, a timed ban, ...) before it can be used —
	// gates the app behind AccountStatusPrompt the same way tokenExpired
	// gates it behind TokenExpiredGate. Returns whether one was shown, so
	// callers can skip their normal "login succeeded" follow-up.
	const showRestriction = (restriction: Restriction | null | undefined): boolean => {
		if (!restriction) return false;
		dispatch({ type: "SET_ACCOUNT_STATUS", payload: { kind: "restriction", restriction } });
		return true;
	};

	// A hard login/refresh rejection — the account is banned outright (no
	// session was established) or Grindr is rate-limiting attempts. Returns
	// whether the error was one of these, so callers can skip their normal
	// generic-error toast.
	const handleAccountBlock = (error: unknown): boolean => {
		const ban = asBanned(error);
		if (ban) {
			dispatch({ type: "SET_ACCOUNT_STATUS", payload: { kind: "banned", info: ban } });
			return true;
		}
		if (asAppError(error)?.kind === "RateLimited") {
			toast.error("Too many attempts. Please try again later.");
			return true;
		}
		return false;
	};

	const checkAuth = async () => {
		try {
			appLog.debug("[Auth] checkAuth: starting");
			dispatch({ type: "SET_LOADING", payload: true });
			const result = await callMethod("auth_state");
			if (result !== null) {
				appLog.info("[Auth] checkAuth: active session found");
				dispatch({ type: "SET_USER", payload: result });
				void refreshSavedAccounts();
				// Resumed from a persisted session (not a fresh login result), so
				// the restriction has to be fetched separately.
				void callMethod("account_restriction")
					.then((restriction) => {
						showRestriction(restriction);
					})
					.catch((error) => {
						appLog.warn("[Auth] account_restriction check failed", asAppError(error) ?? error);
					});
			} else {
				appLog.info("[Auth] checkAuth: no active session");
				dispatch({ type: "CLEAR_USER" });
				// Saved accounts still get pushes while signed out, and opening
				// one switches to it — native needs the list either way.
				void refreshSavedAccounts();
			}
		} catch (error) {
			const appError = asAppError(error);
			if (appError?.kind === "NotInitialized") {
				appLog.warn("[Auth] checkAuth: client NotInitialized, clearing user");
				dispatch({ type: "CLEAR_USER" });
			} else {
				appLog.error("[Auth] checkAuth failed", appError ?? error);
				dispatch({
					type: "SET_ERROR",
					payload: { message: appError?.prettyMessage || "Failed to check auth status" },
				});
			}
		} finally {
			dispatch({ type: "SET_LOADING", payload: false });
		}
	};

	const login = async (email: string, password: string, { keepDevice }: LoginOptions = {}) => {
		// The sign-in endpoint the last attempt went to, for the SMS page's report.
		let endpoint = "/v8/sessions";
		try {
			appLog.info("[Auth] login: attempting email/password login");
			dispatch({ type: "SET_LOADING", payload: true });
			dispatch({ type: "SET_ERROR", payload: null });

			let result;
			try {
				result = await callMethod("login", { email, password, keepDevice });
			} catch (error) {
				// Accounts with Grindr's first-party reCAPTCHA fail the plain
				// /v8 sign-in as invalid credentials. Open Grind retries those
				// with a reCAPTCHA token via /v9 once the assignment says so.
				const firstError = asAppError(error);
				if (firstError?.kind === "VerificationRequired" || !isInvalidCredentials(firstError)) throw error;
				const required = await callMethod("recaptcha_first_party_enabled").catch((checkError) => {
					appLog.warn("[Auth] recaptcha_first_party check failed", asAppError(checkError) ?? checkError);
					return false;
				});
				if (!required) throw error;
				appLog.info("[Auth] login: retrying with a reCAPTCHA token");
				endpoint = "/v9/sessions (reCAPTCHA)";
				const captchaToken = await mintRecaptchaToken("login");
				result = await callMethod("login", { email, password, captchaToken, keepDevice });
			}
			appLog.info("[Auth] login: succeeded");
			dispatch({ type: "SET_USER", payload: result.profileId });
			void refreshSavedAccounts();
			if (!showRestriction(result.restriction)) {
				toast.success("Login successful");
			}
		} catch (error) {
			// Not a failure to report: the page switches to SMS verification.
			// Without a profile id there's nothing to verify against, so that
			// falls through to the generic error below.
			const verification = verificationRequired(asAppError(error));
			if (verification) {
				appLog.info("[Auth] login: SMS verification required");
				throw new SmsVerificationRequiredError(verification.profileId, { endpoint, body: verification.body });
			}
			if (handleAccountBlock(error)) {
				throw error;
			}
			if (error instanceof RecaptchaError) {
				appLog.warn("[Auth] login: reCAPTCHA token unavailable", { reason: error.reason, detail: error.detail });
				if (error.reason !== "cancelled") {
					const message = CAPTCHA_MESSAGES[error.reason] ?? CAPTCHA_FAILED_MESSAGE;
					dispatch({ type: "SET_ERROR", payload: { message } });
				}
				throw error;
			}
			const appError = asAppError(error);
			const message = describeLoginError(
				appError,
				"Sign-in failed. Please try again.",
				"Invalid email or password. Please check your credentials and try again.",
			);
			appLog.error("[Auth] login failed", { kind: appError?.kind, message });
			dispatch({ type: "SET_ERROR", payload: message });
			throw error;
		} finally {
			dispatch({ type: "SET_LOADING", payload: false });
		}
	};

	const loginWithGoogle = async (token: string) => {
		try {
			appLog.info("[Auth] loginWithGoogle: attempting Google third-party login");
			dispatch({ type: "SET_LOADING", payload: true });
			dispatch({ type: "SET_ERROR", payload: null });

			const result = await callMethod("login_with_google", { token });
			appLog.info("[Auth] loginWithGoogle: succeeded");
			dispatch({ type: "SET_USER", payload: result.profileId });
			void refreshSavedAccounts();
			if (!showRestriction(result.restriction)) {
				toast.success("Google login successful");
			}
		} catch (error) {
			if (handleAccountBlock(error)) {
				throw error;
			}
			const appError = asAppError(error);
			const message = describeLoginError(
				appError,
				"Google sign-in failed. Please try again.",
				"This Google token is invalid or has expired. Please get a new one and try again.",
			);
			appLog.error("[Auth] loginWithGoogle failed", { kind: appError?.kind, message });
			dispatch({ type: "SET_ERROR", payload: message });
			throw error;
		} finally {
			dispatch({ type: "SET_LOADING", payload: false });
		}
	};

	const loginWithGoogleWindow = async () => {
		try {
			appLog.info("[Auth] loginWithGoogleWindow: opening Google sign-in window");
			dispatch({ type: "SET_LOADING", payload: true });
			dispatch({ type: "SET_ERROR", payload: null });

			const result = await callMethod("login_with_google_window");
			appLog.info("[Auth] loginWithGoogleWindow: succeeded");
			dispatch({ type: "SET_USER", payload: result.profileId });
			void refreshSavedAccounts();
			if (!showRestriction(result.restriction)) {
				toast.success("Google login successful");
			}
		} catch (error) {
			if (handleAccountBlock(error)) {
				throw error;
			}
			const appError = asAppError(error);
			if (appError?.kind === "Auth" && appError.message === GOOGLE_CANCELED) {
				// The user closed the window.
				appLog.info("[Auth] loginWithGoogleWindow: canceled");
				throw error;
			}
			const message = describeLoginError(appError, "Google sign-in failed. Please try again.", "Google sign-in failed. Please try again.");
			appLog.error("[Auth] loginWithGoogleWindow failed", { kind: appError?.kind, message });
			dispatch({ type: "SET_ERROR", payload: message });
			throw error;
		} finally {
			dispatch({ type: "SET_LOADING", payload: false });
		}
	};

	// Signs in with a code shown on another device (create_transfer_code
	// there), scanned as a QR code or pasted as text.
	const loginWithTransferCode = async (code: string) => {
		try {
			appLog.info("[Auth] loginWithTransferCode: attempting");
			dispatch({ type: "SET_LOADING", payload: true });
			dispatch({ type: "SET_ERROR", payload: null });

			const result = await callMethod("sign_in_with_transfer_code", { code });
			appLog.info("[Auth] loginWithTransferCode: succeeded");
			dispatch({ type: "SET_USER", payload: result.profileId });
			void refreshSavedAccounts();
			if (!showRestriction(result.restriction)) {
				toast.success("Login successful");
			}
		} catch (error) {
			if (handleAccountBlock(error)) {
				throw error;
			}
			const appError = asAppError(error);
			const transferMessage =
				appError?.kind === "Auth" && typeof appError.message === "string"
					? TRANSFER_CODE_MESSAGES[appError.message]
					: undefined;
			const message: AuthError = transferMessage
				? { message: transferMessage }
				: describeLoginError(appError, "Sign-in failed. Please try again.", "Sign-in failed. Please try again.");
			appLog.error("[Auth] loginWithTransferCode failed", { kind: appError?.kind, message });
			dispatch({ type: "SET_ERROR", payload: message });
			throw error;
		} finally {
			dispatch({ type: "SET_LOADING", payload: false });
		}
	};

	const loginWithFacebook = async () => {
		try {
			appLog.info("[Auth] loginWithFacebook: opening Facebook sign-in window");
			dispatch({ type: "SET_LOADING", payload: true });
			dispatch({ type: "SET_ERROR", payload: null });

			const result = await callMethod("login_with_facebook");
			appLog.info("[Auth] loginWithFacebook: succeeded");
			dispatch({ type: "SET_USER", payload: result.profileId });
			void refreshSavedAccounts();
			if (!showRestriction(result.restriction)) {
				toast.success("Facebook login successful");
			}
		} catch (error) {
			if (handleAccountBlock(error)) {
				throw error;
			}
			const appError = asAppError(error);
			if (appError?.kind === "Auth" && appError.message === FACEBOOK_CANCELED) {
				// The user closed the window or declined the consent screen.
				appLog.info("[Auth] loginWithFacebook: canceled");
				throw error;
			}
			const message: AuthError =
				appError?.kind === "Auth" && appError.message === FACEBOOK_HANDOFF_REFUSED
					? { message: "Facebook tried to continue in another app. Please sign in on the Facebook page instead." }
					: appError?.kind === "Auth" && appError.message === FACEBOOK_DIALOG_ERROR
						? { message: "Facebook refused the sign-in. Please try again later." }
						: describeLoginError(appError, "Facebook sign-in failed. Please try again.", "Facebook sign-in failed. Please try again.");
			appLog.error("[Auth] loginWithFacebook failed", { kind: appError?.kind, message });
			dispatch({ type: "SET_ERROR", payload: message });
			throw error;
		} finally {
			dispatch({ type: "SET_LOADING", payload: false });
		}
	};

	const signUp = async ({ email, password, birthday }: SignUpData) => {
		try {
			appLog.info("[Auth] signUp: creating email account");
			dispatch({ type: "SET_LOADING", payload: true });
			dispatch({ type: "SET_ERROR", payload: null });

			// Sign-up is Android-only: rejects with a RecaptchaError elsewhere.
			const captchaToken = await mintRecaptchaToken("sign_up");
			const profileId = await callMethod("create_account", {
				email,
				password,
				birthday,
				captchaToken,
				pushToken: cachedPushToken(),
			});
			appLog.info("[Auth] signUp: account created", { profileId });
			toast.success("Account created");
		} catch (error) {
			if (error instanceof RecaptchaError) {
				appLog.warn("[Auth] signUp: reCAPTCHA token unavailable", { reason: error.reason, detail: error.detail });
				if (error.reason !== "cancelled") {
					const message = CAPTCHA_MESSAGES[error.reason] ?? CAPTCHA_FAILED_MESSAGE;
					dispatch({ type: "SET_ERROR", payload: { message } });
				}
				throw error;
			}
			const appError = asAppError(error);
			const message = describeLoginError(appError, "Sign-up failed. Please try again.", "Sign-up failed. Please try again.");
			appLog.error("[Auth] signUp failed", { kind: appError?.kind, message });
			dispatch({ type: "SET_ERROR", payload: message });
			throw error;
		} finally {
			dispatch({ type: "SET_LOADING", payload: false });
		}

		// The response carries no session: sign in on the device the account
		// was just created on.
		await login(email, password, { keepDevice: true });
	};

	// Once a timed ban has run out, Grindr wants its ban agreement accepted
	// before the account can be used again. The backend refreshes the session
	// right after, so the result's restriction is the account's new state.
	// Throws on failure so the prompt can show it.
	const acceptBanAgreement = async () => {
		try {
			const result = await callMethod("accept_ban_agreement");
			if (!showRestriction(result.restriction)) {
				appLog.info("[Auth] ban agreement accepted, restriction lifted");
				dispatch({ type: "SET_ACCOUNT_STATUS", payload: null });
			}
		} catch (error) {
			// The session is gone; let TokenExpiredGate (behind this gate) take over.
			if (asAppError(error)?.kind === "TokenExpired") {
				dispatch({ type: "SET_ACCOUNT_STATUS", payload: null });
			}
			throw error;
		}
	};

	const logout = async () => {
		try {
			dispatch({ type: "SET_LOADING", payload: true });
			// Repair a location left parked in Honduras before the session goes
			// away, so the account isn't stranded there after sign-out (#446).
			await restoreStrandedLocation();
			await callMethod("logout");
			dispatch({ type: "CLEAR_USER" });
			toast.success("Logged out");
		} catch (error) {
			const appError = asAppError(error);
			const message = appError?.prettyMessage || "Logout failed";
			toast.error(message);
			throw error;
		} finally {
			dispatch({ type: "SET_LOADING", payload: false });
		}
	};

	// Makes a previously saved account active without re-entering a
	// password — the account-change effect above (watching state.userId)
	// handles pointing the chat db and clearing caches once this resolves.
	const switchAccount = async (profileId: string) => {
		try {
			appLog.info("[Auth] switchAccount: attempting", { profileId });
			dispatch({ type: "SET_LOADING", payload: true });
			dispatch({ type: "SET_ERROR", payload: null });

			const result = await callMethod("switch_account", { profileId });
			appLog.info("[Auth] switchAccount: succeeded");
			dispatch({ type: "SET_USER", payload: result.profileId });
			void refreshSavedAccounts();
			if (!showRestriction(result.restriction)) {
				toast.success("Switched account");
			}
		} catch (error) {
			if (handleAccountBlock(error)) {
				throw error;
			}
			const appError = asAppError(error);
			const message = appError?.prettyMessage || "Failed to switch account";
			appLog.error("[Auth] switchAccount failed", { kind: appError?.kind, message });
			dispatch({ type: "SET_ERROR", payload: { message } });
			toast.error(message);
			throw error;
		} finally {
			dispatch({ type: "SET_LOADING", payload: false });
		}
	};

	const removeSavedAccount = async (profileId: string) => {
		try {
			await callMethod("remove_saved_account", { profileId, pushToken: cachedPushToken() });
			// Grindr may unregister the token device-wide rather than for that
			// account alone, so the remaining ones register it again: the
			// saved-account marker changes with the account list by itself,
			// the active one's is dropped here.
			window.localStorage.removeItem(PUSH_TOKEN_SYNCED_STORAGE_KEY);
			setSavedAccounts((accounts) => accounts.filter((account) => account.profileId !== profileId));
		} catch (error) {
			const appError = asAppError(error);
			const message = appError?.prettyMessage || "Failed to remove saved account";
			appLog.error("[Auth] removeSavedAccount failed", { kind: appError?.kind, message });
			toast.error(message);
			throw error;
		}
	};

	// Check auth on mount
	useEffect(() => {
		checkAuth();
	}, []);

	// Points the chat db at the active account's own file, and on an actual
	// account change (not the initial boot resolution) clears every other
	// account-scoped cache — otherwise the previous account's chats/profile
	// data/blocked list would still show through until something happened
	// to overwrite them.
	useEffect(() => {
		if (state.isLoading) {
			return;
		}

		const previousUserId = previousUserIdRef.current;
		previousUserIdRef.current = state.userId;

		if (previousUserId === state.userId) {
			return;
		}

		const isActualAccountChange = previousUserId !== undefined && previousUserId != null;
		if (isActualAccountChange) {
			clearAllCaches();
			queryClient.clear();
		}

		dispatch({ type: "SET_SETTINGS_READY", payload: false });
		setActiveInterestStoreUser(state.userId);
		setActiveChatContactIndexAccount(state.userId);

		void (async () => {
			await setActiveChatDbUser(state.userId);
			if (state.userId != null) {
				await migrateLegacySettingsIfNeeded(state.userId);
			}

			// Fire-and-forget: throttled background sync of the chat list and
			// each changed conversation's latest messages, run on every profile
			// load. Deliberately started only *after* setActiveChatDbUser has
			// fully resolved above — that call both migrates the legacy db file
			// (a rename) and opens the actual per-profile connection, so kicking
			// the sync off any earlier races it against that migration/open and
			// can leave it stuck waiting on a half-migrated db. Kicked off here
			// rather than after the cache loads below on purpose: it has no
			// dependency on automation/media/privacy/seen settings, and
			// chaining it behind them would mean any slowness (or a stuck
			// chatDb connection) in loading those silently delays the sync
			// starting too, even though the two are otherwise unrelated. Not
			// awaited itself, so it never gates the UI. Only the first-ever
			// run per profile walks the whole inbox — every run after that
			// stops as soon as it hits unchanged conversations (see
			// inboxSync.ts).
			if (state.userId != null) {
				const userId = state.userId;
				void runInboxSync(apiFunctions, userId, () => currentUserIdRef.current === userId);
				// Fire-and-forget: pulls this account's saved phrases from Grindr and
				// unions them into the local list, but only the very first time this
				// runs for this profile (see syncSavedPhrasesFromServer) — otherwise a
				// phrase deleted locally would just get re-added from the server on the
				// next load. Guarded by the same "still the active profile" check as the
				// inbox sync above, since chatDb (and so where the merged list gets
				// written) already points at whichever profile is active by the time
				// this resolves.
				void syncSavedPhrasesFromServer(
					apiFunctions.getSavedPhrases,
					() => currentUserIdRef.current === userId,
				);
				// Fire-and-forget: reconciles taps received while the app was closed
				// against the "tap_received" automation trigger — guarded the same
				// way, and safe to start before the automation cache below finishes
				// loading (runAutomationRulesForSender no-ops until it has).
				void runTapsAutomationSync(apiFunctions, () => currentUserIdRef.current === userId);
			}

			await Promise.all([
				loadAutomationCache(),
				loadAutomationRulesCache(),
				loadPrivacyCache(),
				loadAutoTranslateCache(),
				loadSeenCache(),
			]);
			dispatch({ type: "SET_SETTINGS_READY", payload: true });
		})();
	}, [state.userId, state.isLoading, queryClient, apiFunctions]);

	// A third-party (JWT) login's token has no real refresh mechanism, so once it
	// expires any authenticated API call anywhere in the app can be the one that
	// first surfaces it (see useApi.ts's asAppError). Listen globally rather than
	// only reacting to calls made from within this context.
	useEffect(() => {
		const onTokenExpired = () => {
			dispatch({ type: "SET_TOKEN_EXPIRED", payload: true });
		};

		window.addEventListener("fg:token-expired", onTokenExpired);
		return () => {
			window.removeEventListener("fg:token-expired", onTokenExpired);
		};
	}, []);

	// Account-status changes the Rust side detects on its own, outside any
	// call made from here (see api/websocket.rs and api/auth.rs):
	// - auth:banned — a background token refresh found the account banned.
	// - auth:restriction — a restriction arrived with a later session token
	//   (a resumed session only gets its token on the first refresh, so
	//   checkAuth's account_restriction check can come back empty).
	// - auth:session-error with unauthorized — a refresh was answered 401 and
	//   the session is gone; same "sign in again" prompt as an expired JWT.
	useEffect(() => {
		const unlisteners = [
			listen<unknown>("auth:banned", (event) => {
				const parsed = banInfoSchema.safeParse(event.payload);
				if (!parsed.success) {
					appLog.warn("[Auth] auth:banned event with unexpected payload", event.payload);
					return;
				}
				dispatch({ type: "SET_ACCOUNT_STATUS", payload: { kind: "banned", info: parsed.data } });
			}),
			listen<unknown>("auth:restriction", (event) => {
				const parsed = restrictionSchema.safeParse(event.payload);
				if (!parsed.success) {
					appLog.warn("[Auth] auth:restriction event with unexpected payload", event.payload);
					return;
				}
				dispatch({
					type: "SET_ACCOUNT_STATUS",
					payload: { kind: "restriction", restriction: parsed.data },
				});
			}),
			listen<{ unauthorized?: boolean }>("auth:session-error", (event) => {
				if (event.payload?.unauthorized) {
					dispatch({ type: "SET_TOKEN_EXPIRED", payload: true });
				}
			}),
		];

		return () => {
			for (const unlisten of unlisteners) {
				void unlisten.then((fn) => fn());
			}
		};
	}, []);

	// Receive Android native FCM token and sync it to Grindr once authenticated.
	useEffect(() => {
		const onFcmToken = (event: Event) => {
			const token =
				typeof (event as CustomEvent).detail?.token === "string"
					? (event as CustomEvent<{ token: string }>).detail.token
					: null;

			if (!token) {
				appLog.debug("[PUSH_SYNC] Received fg:fcm-token event without token payload");
				return;
			}

			appLog.debug(`[PUSH_SYNC] Received native FCM token event (len=${token.length})`);

			window.localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);

			if (!state.userId || state.isLoading) {
				appLog.debug("[PUSH_SYNC] Token cached; waiting for authenticated session before sync");
				return;
			}

			appLog.debug("[PUSH_SYNC] Syncing FCM token to Grindr");
			void callMethod("sync_push_token", { token })
				.then(() => {
					window.localStorage.setItem(
						PUSH_TOKEN_SYNCED_STORAGE_KEY,
						`${token}::${state.userId}`,
					);
					appLog.debug("[PUSH_SYNC] Push token sync succeeded");
				})
				.catch((error) => {
					const appError = asAppError(error);
					appLog.warn(
						"[PUSH_SYNC] Failed to sync push token",
						appError?.prettyMessage || error,
					);
				});
		};

		window.addEventListener("fg:fcm-token", onFcmToken as EventListener);
		return () => {
			window.removeEventListener("fg:fcm-token", onFcmToken as EventListener);
		};
	}, [callMethod, asAppError, state.userId, state.isLoading]);

	// Retry sync after login if we already captured a token from native code.
	useEffect(() => {
		if (state.isLoading || !state.userId) {
			return;
		}

		let cancelled = false;

		// The token is also registered for every other saved account, so
		// their pushes keep arriving while they aren't the active one (see
		// PushNotificationBridge for opening those).
		const syncSavedAccountsPushToken = (token: string) => {
			if (savedPushSyncInFlightRef.current) {
				return;
			}
			const activeId = String(state.userId);
			const otherIds = savedAccountsRef.current
				.map((account) => account.profileId)
				.filter((profileId) => profileId !== activeId)
				.sort();
			if (otherIds.length === 0) {
				return;
			}

			const key = `${token}::${otherIds.join(",")}`;
			const marker = readSavedPushSyncMarker();
			if (
				marker?.key === key &&
				Date.now() - marker.at < (marker.ok ? SAVED_PUSH_SYNC_INTERVAL_MS : SAVED_PUSH_SYNC_RETRY_MS)
			) {
				return;
			}

			savedPushSyncInFlightRef.current = true;
			appLog.debug(`[PUSH_SYNC] Syncing push token to ${otherIds.length} saved account(s)`);
			void callMethod("sync_push_token_for_saved_accounts", { token })
				.then((synced) => {
					const ok = otherIds.every((profileId) => synced.includes(profileId));
					if (!ok) {
						appLog.warn("[PUSH_SYNC] Push token sync failed for some saved accounts", {
							failed: otherIds.filter((profileId) => !synced.includes(profileId)),
						});
					}
					return ok;
				})
				.catch((error) => {
					appLog.warn(
						"[PUSH_SYNC] Failed to sync push token to saved accounts",
						asAppError(error)?.prettyMessage || error,
					);
					return false;
				})
				.then((ok) => {
					const next: SavedPushSyncMarker = { key, at: Date.now(), ok };
					window.localStorage.setItem(PUSH_TOKEN_SAVED_SYNCED_STORAGE_KEY, JSON.stringify(next));
					savedPushSyncInFlightRef.current = false;
				});
		};

		const trySync = () => {
			if (cancelled) {
				return;
			}

			const token = window.localStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
			const fallbackToken =
				typeof (window as Window & { __FG_FCM_TOKEN?: unknown }).__FG_FCM_TOKEN ===
				"string"
					? ((window as Window & { __FG_FCM_TOKEN?: string }).__FG_FCM_TOKEN ?? null)
					: null;
			const effectiveToken = token || fallbackToken;

			if (!effectiveToken) {
				appLog.debug("[PUSH_SYNC] No cached token found while logged in");
				return;
			}

			if (!token && fallbackToken) {
				window.localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, fallbackToken);
			}

			syncSavedAccountsPushToken(effectiveToken);

			// Keyed by token *and* account: the device's FCM token doesn't change
			// when switching between saved accounts, but the backend association
			// is per-account, so a stale "already synced" marker from the
			// previous account would otherwise skip re-syncing for the new one.
			const syncMarker = `${effectiveToken}::${state.userId}`;
			const lastSyncedMarker = window.localStorage.getItem(PUSH_TOKEN_SYNCED_STORAGE_KEY);
			if (lastSyncedMarker === syncMarker) {
				return;
			}

			appLog.debug("[PUSH_SYNC] Syncing cached push token (retry loop)");
			void callMethod("sync_push_token", { token: effectiveToken })
				.then(() => {
					window.localStorage.setItem(PUSH_TOKEN_SYNCED_STORAGE_KEY, syncMarker);
					appLog.debug("[PUSH_SYNC] Cached push token sync succeeded");
				})
				.catch((error) => {
					const appError = asAppError(error);
					appLog.warn(
						"[PUSH_SYNC] Failed to sync push token in retry loop",
						appError?.prettyMessage || error,
					);
				});
		};

		trySync();
		const interval = window.setInterval(trySync, 5000);
		return () => {
			cancelled = true;
			window.clearInterval(interval);
		};
	}, [callMethod, asAppError, state.userId, state.isLoading]);

	// Native routes pushes by account (PushAccounts.kt): which one is active,
	// and which are saved at all.
	useEffect(() => {
		if (state.isLoading || !savedAccountsLoaded) {
			return;
		}
		syncPushAccountsToNative(state.userId != null ? String(state.userId) : null, savedAccounts);
	}, [state.userId, state.isLoading, savedAccounts, savedAccountsLoaded]);

	// Persist current user id so non-React services (e.g. hotswap) can re-register after updates.
	useEffect(() => {
		if (state.isLoading) {
			return;
		}

		if (state.userId) {
			window.localStorage.setItem(AUTH_USER_ID_STORAGE_KEY, String(state.userId));
		} else {
			window.localStorage.removeItem(AUTH_USER_ID_STORAGE_KEY);
		}
	}, [state.userId, state.isLoading]);

	const clearError = useCallback(() => dispatch({ type: "SET_ERROR", payload: null }), []);

	const value: AuthContextType = {
		...state,
		login,
		loginWithGoogle,
		loginWithGoogleWindow,
		loginWithFacebook,
		loginWithTransferCode,
		signUp,
		logout,
		checkAuth,
		acceptBanAgreement,
		savedAccounts,
		switchAccount,
		removeSavedAccount,
		clearError,
	};

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
