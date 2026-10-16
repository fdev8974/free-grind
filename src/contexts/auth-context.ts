import { createContext } from "react";
import type { BanInfo, Restriction } from "../types/api";

/**
 * Blocks the account from being used right now. `banned` is a hard
 * login/refresh rejection (asBanned/auth:banned); `restriction` is a session
 * that's still valid but the account needs the user to resolve something
 * (age verification, a timed ban, ...) — see AccountStatusPrompt.tsx, gated
 * the same way as TokenExpiredGate.
 */
export type AccountStatus =
	| { kind: "banned"; info: BanInfo }
	| { kind: "restriction"; restriction: Restriction }
	| null;

/** A failed sign-in/sign-up, as shown on the auth pages. */
export interface AuthError {
	message: string;
	/** The raw technical text behind a generic `message`, folded away under "Details". */
	detail?: string;
}

export interface AuthState {
	userId: number | null;
	isLoading: boolean;
	error: AuthError | null;
	/**
	 * True once the per-profile db (chatDb) is pointed at the active user's
	 * own file and the one-time legacy-settings migration has been checked.
	 * Anything reading profile-scoped settings (preferences, automation,
	 * saved phrases/locations) must wait for this before loading — otherwise
	 * it risks reading the previous profile's connection during the switch.
	 */
	settingsReady: boolean;
	/**
	 * Set once the session can no longer be refreshed — a JWT login's token
	 * ran out, or the server rejected a refresh (401). Drives a full-screen
	 * re-login prompt; see TokenExpiredGate.
	 */
	tokenExpired: boolean;
	/** See AccountStatus. Drives AccountStatusPrompt, checked before TokenExpiredGate. */
	accountStatus: AccountStatus;
}

export interface SavedAccountMeta {
	profileId: string;
	email: string;
	lastUsedAt: number;
}

export interface SignUpData {
	email: string;
	password: string;
	/** Unix milliseconds. */
	birthday: number;
}

/**
 * Sign-in refused with Grindr code 30: the account has to verify a phone
 * number by SMS first. `profileId` comes from the error body.
 */
export class SmsVerificationRequiredError extends Error {
	constructor(readonly profileId: string) {
		super("SMS verification required");
		this.name = "SmsVerificationRequiredError";
	}
}

export interface LoginOptions {
	/** Sign in on the current device identity instead of a fresh one. */
	keepDevice?: boolean;
}

export interface AuthContextType extends AuthState {
	login: (email: string, password: string, options?: LoginOptions) => Promise<void>;
	loginWithGoogle: (token: string) => Promise<void>;
	/** Desktop only: opens the Google sign-in window; resolves without signing in when the user closes it. */
	loginWithGoogleWindow: () => Promise<void>;
	/** Opens Facebook's sign-in window; resolves without signing in when the user closes it. */
	loginWithFacebook: () => Promise<void>;
	signUp: (account: SignUpData) => Promise<void>;
	logout: () => Promise<void>;
	checkAuth: () => Promise<void>;
	/** Accepts the ban agreement of an expired timed ban; see AccountStatusPrompt. */
	acceptBanAgreement: () => Promise<void>;
	savedAccounts: SavedAccountMeta[];
	switchAccount: (profileId: string) => Promise<void>;
	removeSavedAccount: (profileId: string) => Promise<void>;
	/** Drops a stale `error`, e.g. when the sign-in page switches method. */
	clearError: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);