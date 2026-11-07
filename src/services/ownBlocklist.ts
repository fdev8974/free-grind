/**
 * Keeps the profile's block list restorable from a backup. It lives only on
 * the server, which a banned account can't read anymore, so every profile load
 * records it in the own_blocked_profiles table — the "blocked_profiles"
 * backup category.
 *
 * Import (src-tauri/src/commands/backup.rs), also into the same profile,
 * writes it to restored_blocked_profiles instead, and runRestoredBlocklist
 * blocks those profiles again in the background. Deliberately slow and
 * sequential, like inboxSync.ts: one block at a time with a pause in between,
 * each done one removed from the table so an interrupted run resumes.
 */

import type { createApiFunctions } from "./apiFunctions";
import { isGoneProfileError } from "./apiHelpers";
import * as chatDb from "./chatDb";
import { advanceRestoreTask, reportRestoreTask, stoppableRestoreTask } from "./restoreStatus";
import { appLog } from "../utils/logger";

type ApiFunctions = ReturnType<typeof createApiFunctions>;

const BLOCK_DELAY_MS = 3_000;
const BLOCK_DELAY_JITTER_MS = 2_000;
/** Likely rate limiting or no connection: stop and pick up again on the next app start. */
const MAX_CONSECUTIVE_FAILURES = 3;

let running = false;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Records the profile's current block list. Never throws. */
export async function syncOwnBlocklist(api: ApiFunctions, isCurrent: () => boolean): Promise<void> {
	try {
		const blocked = await api.getBlockedProfileIds();
		if (!isCurrent()) return;
		await chatDb.replaceOwnBlockedProfiles(blocked);
	} catch (error) {
		appLog.warn("[ownBlocklist] recording block list failed", error);
	}
}

/** Blocks the profiles a backup of another profile had blocked, skipping ones already blocked here. */
export async function runRestoredBlocklist(api: ApiFunctions, ownProfileId: number, isCurrentProfile: () => boolean): Promise<void> {
	if (running) return;
	running = true;
	const isCurrent = stoppableRestoreTask("blocked_profiles", isCurrentProfile);
	try {
		const restored = await chatDb.listRestoredBlockedProfiles();
		if (restored.length === 0) return;

		const alreadyBlocked = new Set(await api.getBlockedProfileIds());
		const remaining: string[] = [];
		for (const profileId of restored) {
			// Import rewrote the old profile's id to this one; this profile can't block itself.
			if (profileId === String(ownProfileId) || alreadyBlocked.has(profileId)) {
				await chatDb.deleteRestoredBlockedProfile(profileId);
			} else {
				remaining.push(profileId);
			}
		}
		appLog.info("[ownBlocklist] restoring blocked profiles", { count: remaining.length });
		const total = remaining.length;
		let done = 0;
		reportRestoreTask("blocked_profiles", { state: total > 0 ? "running" : "done", done, total });

		let consecutiveFailures = 0;
		while (remaining.length > 0) {
			await sleep(BLOCK_DELAY_MS + Math.random() * BLOCK_DELAY_JITTER_MS);
			// The api always talks to the active profile: never block from another one.
			if (!isCurrent()) return reportRestoreTask("blocked_profiles", null);
			const profileId = remaining.shift() as string;
			try {
				await api.blockProfile(profileId);
				consecutiveFailures = 0;
			} catch (error) {
				if (!isCurrent()) return reportRestoreTask("blocked_profiles", null);
				// A deleted profile can't be blocked ever again: drop it instead of
				// retrying until the whole restore pauses over it.
				if (isGoneProfileError(error)) {
					appLog.info("[ownBlocklist] profile gone, skipping", { profileId });
					await chatDb.deleteRestoredBlockedProfile(profileId);
					done++;
					advanceRestoreTask("blocked_profiles");
					continue;
				}
				appLog.warn("[ownBlocklist] blocking failed", { profileId, error });
				if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
					appLog.warn("[ownBlocklist] stopping after repeated failures, resuming on next start");
					reportRestoreTask("blocked_profiles", { state: "paused", done, total });
					return;
				}
				// Possibly just a hiccup: to the back, not in the way.
				remaining.push(profileId);
				continue;
			}
			await chatDb.deleteRestoredBlockedProfile(profileId);
			done++;
			advanceRestoreTask("blocked_profiles");
		}
		reportRestoreTask("blocked_profiles", { state: "done", done, total });
	} catch (error) {
		appLog.warn("[ownBlocklist] restoring block list failed", error);
	} finally {
		running = false;
	}
}
