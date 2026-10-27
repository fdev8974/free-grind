import { useCallback, useEffect, useState } from "react";
import {
	getSeenDisplayNamesForProfiles,
	setSeenDisplayNameForProfile,
	subscribeSeenDisplayNames,
	type SeenDisplayName,
} from "../services/chatContactIndex";

export type { SeenDisplayName };

// A nickname replaces the profile's display name everywhere, so a rename on
// their side would otherwise go unnoticed. The display name the user last saw
// is stored per nicknamed profile and compared with the live one.

export type NicknameRename = {
	/** The profile's own display name while it's hidden behind a nickname (null without one, or when empty). */
	realName: string | null;
	/** The name they had when the user last looked, if they've been renamed since. */
	previousName: string | null;
};

export function getNicknameRename(
	nickname: string | null | undefined,
	displayName: string | null | undefined,
	seen: SeenDisplayName | null | undefined,
): NicknameRename {
	const realName = nickname?.trim() ? displayName?.trim() || null : null;
	// Matching the name acknowledged before the current one means this view's
	// data is just older than wherever the rename was seen, not a new rename.
	const previousName =
		realName && seen && seen.name !== realName && seen.previousName !== realName ? seen.name : null;
	return { realName, previousName };
}

/** Marks the profile's current display name as seen, clearing its rename markers everywhere. */
export function acknowledgeNicknameRename(profileId: string | number, displayName: string): void {
	void setSeenDisplayNameForProfile(String(profileId), displayName).catch(() => {});
}

type SeenDisplayNameEntry = {
	profileId: string | number;
	nickname: string | null | undefined;
	displayName: string | null | undefined;
};

/**
 * Seen display names for the nicknamed profiles among `entries`, keyed by
 * profile id. Profiles without a recorded name get the current one as their
 * baseline instead of being flagged.
 */
export function useSeenDisplayNames(entries: SeenDisplayNameEntry[]): Record<string, SeenDisplayName> {
	const tracked = entries.flatMap((entry) => {
		const { realName } = getNicknameRename(entry.nickname, entry.displayName, null);
		return realName ? [{ id: String(entry.profileId), realName }] : [];
	});
	// Callers pass fresh arrays every render; key the effect on the content.
	const trackedKey = tracked.map(({ id, realName }) => `${id}\u0000${realName}`).join("\u0001");
	const [seenByProfileId, setSeenByProfileId] = useState<Record<string, SeenDisplayName>>({});

	useEffect(() => {
		if (!trackedKey) {
			setSeenByProfileId({});
			return;
		}
		const current = trackedKey.split("\u0001").map((part) => {
			const [id, realName] = part.split("\u0000");
			return { id, realName };
		});
		let cancelled = false;
		const load = () => {
			getSeenDisplayNamesForProfiles(current.map(({ id }) => id))
				.then((seen) => {
					if (cancelled) return;
					const next = { ...seen };
					for (const { id, realName } of current) {
						if (next[id] == null) {
							next[id] = { name: realName, previousName: null };
							void setSeenDisplayNameForProfile(id, realName, { onlyIfUnset: true }).catch(() => {});
						}
					}
					setSeenByProfileId(next);
				})
				.catch(() => {});
		};
		load();
		const unsubscribe = subscribeSeenDisplayNames(load);
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [trackedKey]);

	return seenByProfileId;
}

export type NicknameNameChange = NicknameRename & {
	/** The profile was renamed since the user last looked; drives the badge on the actions button. */
	hasUnseenChange: boolean;
	/** Marks the current display name as seen. `previousName` stays set for this view so the open menu can still show it. */
	acknowledge: () => void;
};

/** Single-profile variant for the profile and chat headers. */
export function useNicknameNameChange(
	profileId: string | number | null | undefined,
	nickname: string | null | undefined,
	displayName: string | null | undefined,
): NicknameNameChange {
	const id = profileId != null ? String(profileId) : "";
	const seenByProfileId = useSeenDisplayNames(id ? [{ profileId: id, nickname, displayName }] : []);
	const { realName, previousName: unseenPreviousName } = getNicknameRename(nickname, displayName, seenByProfileId[id]);
	const [acknowledged, setAcknowledged] = useState<{ id: string; from: string; to: string } | null>(null);

	const hasUnseenChange = unseenPreviousName != null;
	const previousName =
		unseenPreviousName ??
		(acknowledged?.id === id && acknowledged.to === realName ? acknowledged.from : null);

	const acknowledge = useCallback(() => {
		if (!unseenPreviousName || !realName) return;
		setAcknowledged({ id, from: unseenPreviousName, to: realName });
		acknowledgeNicknameRename(id, realName);
	}, [unseenPreviousName, realName, id]);

	return { realName, previousName, hasUnseenChange, acknowledge };
}
