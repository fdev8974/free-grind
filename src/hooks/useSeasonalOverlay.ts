import { useEffect, useState } from "react";

/** A seasonal theme (overlay, nav icons, …) shown only within its time window. */
export interface SeasonalOverlay {
	label: string;
	/** Active window (UTC ms), end exclusive. */
	start: number;
	end: number;
}

export const SEASONAL_OVERLAYS = {
	halloween: {
		label: "Halloween",
		start: Date.UTC(2026, 9, 31, 12),
		end: Date.UTC(2026, 10, 1, 6),
	},
	christmas: {
		label: "Christmas",
		start: Date.UTC(2026, 11, 24, 12),
		end: Date.UTC(2026, 11, 27),
	},
	valentines: {
		label: "Valentine's Day",
		start: Date.UTC(2027, 1, 13, 12),
		end: Date.UTC(2027, 1, 15, 6),
	},
} satisfies Record<string, SeasonalOverlay>;

export type SeasonalOverlayId = keyof typeof SEASONAL_OVERLAYS;

const SEASON_IDS = Object.keys(SEASONAL_OVERLAYS) as SeasonalOverlayId[];

/** Dev option per season: follow the window, force it on, or suppress it. */
export type SeasonalOverlayMode = "auto" | "on" | "off";

const MODE_KEY_PREFIX = "fg-seasonal-overlay-";
const MODE_EVENT = "fg-seasonal-overlay-changed";

export function getSeasonalOverlayMode(id: SeasonalOverlayId): SeasonalOverlayMode {
	try {
		const value = window.localStorage.getItem(MODE_KEY_PREFIX + id);
		return value === "on" || value === "off" ? value : "auto";
	} catch {
		return "auto";
	}
}

/** Only one season can be forced on: forcing one puts any other forced one back on "auto". */
export function setSeasonalOverlayMode(id: SeasonalOverlayId, mode: SeasonalOverlayMode): void {
	try {
		if (mode === "on") {
			for (const other of SEASON_IDS) {
				if (other !== id && getSeasonalOverlayMode(other) === "on") window.localStorage.removeItem(MODE_KEY_PREFIX + other);
			}
		}
		if (mode === "auto") window.localStorage.removeItem(MODE_KEY_PREFIX + id);
		else window.localStorage.setItem(MODE_KEY_PREFIX + id, mode);
	} catch {
		// Storage unavailable: the choice just doesn't stick.
	}
	window.dispatchEvent(new Event(MODE_EVENT));
}

/** The dev option's mode for a season; follows changes live. */
export function useSeasonalOverlayMode(id: SeasonalOverlayId): SeasonalOverlayMode {
	const [mode, setMode] = useState(() => getSeasonalOverlayMode(id));
	useEffect(() => {
		const onChange = () => setMode(getSeasonalOverlayMode(id));
		onChange();
		window.addEventListener(MODE_EVENT, onChange);
		return () => window.removeEventListener(MODE_EVENT, onChange);
	}, [id]);
	return mode;
}

export function isInSeasonalWindow(id: SeasonalOverlayId, now = Date.now()): boolean {
	const { start, end } = SEASONAL_OVERLAYS[id];
	return now >= start && now < end;
}

/**
 * The one season whose theme shows right now, if any: a season forced "on"
 * wins, otherwise the first (in SEASONAL_OVERLAYS order) on "auto" within its window.
 */
export function getActiveSeason(now = Date.now()): SeasonalOverlayId | null {
	const modes = SEASON_IDS.map((id) => [id, getSeasonalOverlayMode(id)] as const);
	const forced = modes.find(([, mode]) => mode === "on");
	if (forced) return forced[0];
	return modes.find(([id, mode]) => mode === "auto" && isInSeasonalWindow(id, now))?.[0] ?? null;
}

/** The active season (see getActiveSeason). Re-renders when a window opens or closes, or a dev option changes. */
export function useActiveSeason(): SeasonalOverlayId | null {
	const [now, setNow] = useState(() => Date.now());

	// A dev option changed: recheck the windows against the current time.
	useEffect(() => {
		const onChange = () => setNow(Date.now());
		window.addEventListener(MODE_EVENT, onChange);
		return () => window.removeEventListener(MODE_EVENT, onChange);
	}, []);

	useEffect(() => {
		const boundaries = SEASON_IDS.flatMap((id) => [SEASONAL_OVERLAYS[id].start, SEASONAL_OVERLAYS[id].end]);
		const next = Math.min(...boundaries.filter((time) => time > now));
		if (!Number.isFinite(next)) return;
		// setTimeout caps at ~24.8 days; an early wake-up just re-arms.
		const timer = setTimeout(() => setNow(Date.now()), Math.min(next - now + 50, 2_147_483_647));
		return () => clearTimeout(timer);
	}, [now]);

	return getActiveSeason(now);
}

/** Whether this season is the active one. */
export function useIsSeasonalOverlayActive(id: SeasonalOverlayId): boolean {
	return useActiveSeason() === id;
}
