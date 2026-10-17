export type RightNowSortOption = "DISTANCE" | "RECENCY";

export type RightNowViewMode = "list" | "map";

export type RightNowFiltersDraft = {
	ageMin: number;
	ageMax: number;
	positionFilter: string;
	hostingOnly: boolean;
	/** Client-side only: the feed API has no favorites filter, but each post carries isFavorite. */
	favoritesOnly: boolean;
};

export type RightNowFiltersPersisted = RightNowFiltersDraft & {
	sort: RightNowSortOption;
	viewMode: RightNowViewMode;
};

const STORAGE_KEY = "open-grind:right-now-filters";

function clampAge(value: number): number {
	return Math.max(18, Math.min(99, value));
}

export function getDefaultRightNowFilters(): RightNowFiltersPersisted {
	return {
		sort: "DISTANCE",
		hostingOnly: false,
		favoritesOnly: false,
		viewMode: "list",
		ageMin: 18,
		ageMax: 99,
		positionFilter: "",
	};
}

export function loadRightNowFiltersDraft(): RightNowFiltersPersisted {
	const defaults = getDefaultRightNowFilters();

	if (typeof window === "undefined") {
		return defaults;
	}

	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			return defaults;
		}

		const parsed = JSON.parse(raw) as Partial<RightNowFiltersPersisted>;
		const nextAgeMin =
			typeof parsed.ageMin === "number" && Number.isFinite(parsed.ageMin)
				? clampAge(parsed.ageMin)
				: defaults.ageMin;
		const nextAgeMaxRaw =
			typeof parsed.ageMax === "number" && Number.isFinite(parsed.ageMax)
				? clampAge(parsed.ageMax)
				: defaults.ageMax;

		return {
			sort:
				parsed.sort === "DISTANCE" || parsed.sort === "RECENCY"
					? parsed.sort
					: defaults.sort,
			hostingOnly:
				typeof parsed.hostingOnly === "boolean"
					? parsed.hostingOnly
					: defaults.hostingOnly,
			favoritesOnly:
				typeof parsed.favoritesOnly === "boolean"
					? parsed.favoritesOnly
					: defaults.favoritesOnly,
			viewMode:
				parsed.viewMode === "list" || parsed.viewMode === "map"
					? parsed.viewMode
					: defaults.viewMode,
			ageMin: nextAgeMin,
			ageMax: Math.max(nextAgeMin, nextAgeMaxRaw),
			positionFilter:
				typeof parsed.positionFilter === "string"
					? parsed.positionFilter
					: defaults.positionFilter,
		};
	} catch {
		return defaults;
	}
}

export function saveRightNowFiltersDraft(
	draft: RightNowFiltersPersisted,
): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
	} catch {
		// Ignore storage failures (quota/private mode) to avoid breaking core UX.
	}
}
