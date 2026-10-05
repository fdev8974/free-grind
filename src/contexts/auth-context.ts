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
	 * Set when an authenticated API call fails because a third-party (JWT)
	 * login's token has expired — that login method has no real refresh
	 * mechanism, unlike email/password sessions. Drives a full-screen
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

export interface AuthContextType extends AuthState {
	login: (email: string, password: string) => Promise<void>;
	loginWithJwt: (token: string) => Promise<void>;
	logout: () => Promise<void>;
	checkAuth: () => Promise<void>;
	savedAccounts: SavedAccountMeta[];
	switchAccount: (profileId: string) => Promise<void>;
	removeSavedAccount: (profileId: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);