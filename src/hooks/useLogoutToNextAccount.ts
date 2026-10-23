import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/useAuth";
import { removeSavedAccountProfile } from "../services/savedAccountProfiles";

/**
 * Explicit logout of the active account: forgets it in the switcher and,
 * if another saved account exists, switches straight to it instead of
 * dropping the user on the sign-in page. Errors from logout itself are
 * rethrown; a failed switch to the next account falls back to sign-in.
 */
export function useLogoutToNextAccount() {
	const { userId, logout, savedAccounts, switchAccount, removeSavedAccount } = useAuth();
	const navigate = useNavigate();

	return async () => {
		const loggedOutProfileId = userId != null ? String(userId) : null;
		await logout();
		// An explicit logout also forgets the account in the switcher;
		// plain account switches and expired-token prompts keep it.
		if (loggedOutProfileId) {
			await removeSavedAccount(loggedOutProfileId);
			removeSavedAccountProfile(loggedOutProfileId);
		}
		const nextAccount = savedAccounts.find((account) => account.profileId !== loggedOutProfileId);
		if (nextAccount) {
			try {
				await switchAccount(nextAccount.profileId);
				navigate("/");
				return;
			} catch {
				// switchAccount already surfaced the error (toast / ban gate).
			}
		}
		navigate("/auth/sign-in");
	};
}
