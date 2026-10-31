import { useEffect, useState } from "react";

// Halloween theme window (UTC): blood drips and spooky nav icons.
const HALLOWEEN_START = Date.UTC(2026, 9, 31, 12);
const HALLOWEEN_END = Date.UTC(2026, 10, 1, 6);

// Set to "true" in localStorage to preview the theme outside the window.
export const FORCE_HALLOWEEN_KEY = "fg-force-halloween";

function isForced(): boolean {
	try {
		return window.localStorage.getItem(FORCE_HALLOWEEN_KEY) === "true";
	} catch {
		return false;
	}
}

export function isHalloween(now = Date.now()): boolean {
	return isForced() || (now >= HALLOWEEN_START && now < HALLOWEEN_END);
}

/** Whether the Halloween theme is active. Re-renders when the window opens or closes. */
export function useIsHalloween(): boolean {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const next = now < HALLOWEEN_START ? HALLOWEEN_START : now < HALLOWEEN_END ? HALLOWEEN_END : null;
		if (next === null) return;
		// setTimeout caps at ~24.8 days; an early wake-up just re-arms.
		const timer = setTimeout(() => setNow(Date.now()), Math.min(next - now + 50, 2_147_483_647));
		return () => clearTimeout(timer);
	}, [now]);

	return isHalloween(now);
}
