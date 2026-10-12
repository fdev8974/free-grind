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

export interface AuthState {
	userId: number | null;
	isLoading: boolean;
	error: string | null;
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
	optIn: boolean;
}

/**
 * Sign-in refused with Grindr code 30: the account has to verify a phone
 * number by SMS first. `profileId` is null when this device never saw the
 * account's id (it is remembered from sign-up).
 */
export class SmsVerificationRequiredError extends Error {
	constructor(readonly profileId: string | null) {
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
	/** `onCreated` gets the new profile id before the follow-up sign-in, which may still fail. */
	signUp: (account: SignUpData, onCreated?: (profileId: string) => void) => Promise<void>;
	logout: () => Promise<void>;
	checkAuth: () => Promise<void>;
	savedAccounts: SavedAccountMeta[];
	switchAccount: (profileId: string) => Promise<void>;
	removeSavedAccount: (profileId: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);