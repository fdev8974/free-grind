/**
 * Status of the restore work that keeps running in the background after a
 * backup import (server-side data the import can only queue locally): profile
 * details and photos (ownProfileDetails.ts / ownProfilePhotos.ts, applied once
 * the user agrees in RestoredProfilePrompt), the block list (ownBlocklist.ts),
 * favorites (restoredFavorites.ts) and drawer media (restoredDrawerMedia.ts).
 *
 * What's still left comes from the restored_* tables, so it survives a
 * restart; the runners add live progress on top through `reportRestoreTask`.
 */

import { useCallback, useEffect, useState } from "react";
import * as chatDb from "./chatDb";

export type RestoreTaskId = "profile_details" | "profile_photos" | "blocked_profiles" | "favorites" | "drawer_media";

export const RESTORE_TASK_IDS: RestoreTaskId[] = [
	"profile_details",
	"profile_photos",
	"blocked_profiles",
	"favorites",
	"drawer_media",
];

/**
 * - waiting_decision: profile details/photos the user hasn't agreed to apply yet
 * - queued: picked up automatically, e.g. on the next app start
 * - running / done: in progress / finished during this session
 * - paused: stopped after repeated failures, resumes on the next start
 * - failed: applying profile details/photos failed, asked again on the next start
 */
export type RestoreTaskState = "waiting_decision" | "queued" | "running" | "paused" | "failed" | "done";

export type RestoreTask = {
	id: RestoreTaskId;
	state: RestoreTaskState;
	/** Items handled so far in the current run (0 unless running/done). */
	done: number;
	/** Items in the current run, or what's still left when not running. */
	total: number;
};

type LiveEntry = { db: string; state: "running" | "paused" | "failed" | "done"; done: number; total: number };

/** Per profile db, so a run of a profile switched away from never shows up for another one. */
const live = new Map<RestoreTaskId, LiveEntry>();
const listeners = new Set<() => void>();

function notify(): void {
	for (const listener of listeners) listener();
}

export function subscribeToRestoreStatus(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Called by the runners; `null` forgets the task's live progress (e.g. discarded or profile switched). */
export function reportRestoreTask(id: RestoreTaskId, entry: Omit<LiveEntry, "db"> | null): void {
	if (entry) live.set(id, { ...entry, db: chatDb.getActiveChatDbFileName() });
	else live.delete(id);
	notify();
}

/** Bumps a running task's progress by one handled item. */
export function advanceRestoreTask(id: RestoreTaskId): void {
	const entry = live.get(id);
	if (!entry || entry.state !== "running") return;
	live.set(id, { ...entry, done: Math.min(entry.done + 1, entry.total) });
	notify();
}

async function remainingCounts(): Promise<Record<RestoreTaskId, number>> {
	const [details, photos, blocked, favorites, drawer] = await Promise.all([
		chatDb.getRestoredProfileDetails().then((d) => (d ? 1 : 0)),
		chatDb.countRestoredProfilePhotos(),
		chatDb.listRestoredBlockedProfiles().then((ids) => ids.length),
		chatDb.listRestoredFavoriteProfiles().then((ids) => ids.length),
		chatDb.listMediaFilesWithPrefix("restored-drawer:").then((files) => files.length),
	]);
	return {
		profile_details: details,
		profile_photos: photos,
		blocked_profiles: blocked,
		favorites,
		drawer_media: drawer,
	};
}

/** The tasks with anything left to do or finished this session, in a fixed order. */
export async function loadRestoreTasks(): Promise<RestoreTask[]> {
	const remaining = await remainingCounts();
	const db = chatDb.getActiveChatDbFileName();
	const tasks: RestoreTask[] = [];
	for (const id of RESTORE_TASK_IDS) {
		const entry = live.get(id);
		const current = entry?.db === db ? entry : undefined;
		const left = remaining[id];
		if (current?.state === "running") {
			tasks.push({ id, state: "running", done: current.done, total: current.total });
		} else if (left > 0) {
			const needsDecision = id === "profile_details" || id === "profile_photos";
			const state: RestoreTaskState =
				current?.state === "paused" || current?.state === "failed" ? current.state : needsDecision ? "waiting_decision" : "queued";
			tasks.push({ id, state, done: 0, total: left });
		} else if (current?.state === "done") {
			tasks.push({ id, state: "done", done: current.total, total: current.total });
		}
	}
	return tasks;
}

/** Live list of restore tasks; null while loading. `refresh` re-reads the db. */
export function useRestoreTasks(): { tasks: RestoreTask[] | null; refresh: () => void } {
	const [tasks, setTasks] = useState<RestoreTask[] | null>(null);
	const refresh = useCallback(() => {
		void loadRestoreTasks()
			.then(setTasks)
			.catch(() => setTasks([]));
	}, []);
	useEffect(() => {
		refresh();
		const unsubscribe = subscribeToRestoreStatus(refresh);
		// Runners don't report every db change (e.g. the prompt dropping unchanged
		// details), so poll lightly as a fallback while something is shown.
		const interval = window.setInterval(refresh, 5_000);
		return () => {
			unsubscribe();
			window.clearInterval(interval);
		};
	}, [refresh]);
	return { tasks, refresh };
}

/** Asks RestoredProfilePrompt to check again and open now (see its listener). */
export const SHOW_RESTORED_PROFILE_PROMPT_EVENT = "fg-show-restored-profile-prompt";
