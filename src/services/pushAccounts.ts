/**
 * pushAccounts.ts — mirrors the active and saved accounts down to the native
 * push pipeline (PushAccounts.kt) via `FreeGrindBridge.setPushAccounts`.
 *
 * The device's FCM token is registered for every saved account, so pushes
 * arrive for all of them; native uses this to tell which ones belong to an
 * account other than the active one (shown even in the foreground, opened by
 * switching first — see PushNotificationBridge), to drop pushes for removed
 * accounts, and to label notifications with the receiving account's name.
 * No-op outside the Android WebView.
 */

import type { SavedAccountMeta } from "../contexts/auth-context";
import { getSavedAccountProfile } from "./savedAccountProfiles";

type PushAccountsBridge = {
	setPushAccounts?: (json: string) => void;
};

let lastSynced: { activeProfileId: string | null; accounts: SavedAccountMeta[] } | null = null;

export function syncPushAccountsToNative(
	activeProfileId: string | null,
	accounts: SavedAccountMeta[],
): void {
	lastSynced = { activeProfileId, accounts };
	try {
		const payload = JSON.stringify({
			activeProfileId,
			accounts: accounts.map((account) => ({
				profileId: account.profileId,
				label: getSavedAccountProfile(account.profileId).displayName || account.email,
			})),
		});
		(window as unknown as { FreeGrindBridge?: PushAccountsBridge }).FreeGrindBridge?.setPushAccounts?.(payload);
	} catch {
		// no-op outside the Android WebView
	}
}

/** Re-sends the last accounts, e.g. once an account's display name is known. */
export function refreshPushAccountLabels(): void {
	if (lastSynced) syncPushAccountsToNative(lastSynced.activeProfileId, lastSynced.accounts);
}
