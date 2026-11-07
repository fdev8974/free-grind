import { hourCycleOptions } from "./timeFormat";

/**
 * OTA bundle versions look like `1.2.0-ota.development.1729500000` (see
 * scripts/publish-ota.mjs) — only the release part is meaningful to users.
 */
export function displayVersion(version: string | null): string | null {
	return version?.replace(/-ota\..*$/, "") || null;
}

/** The trailing Unix-seconds sequence of an OTA version is its publish time. */
export function buildDate(version: string | null): Date | null {
	const seconds = Number(version?.match(/-ota\..*\.(\d{9,})$/)?.[1]);
	return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
}

/** Release part of a bundle version; the embedded frontend has the app's own. */
export function releaseOf(version: string | null): string | null {
	return displayVersion(version) ?? import.meta.env.VITE_APP_VERSION ?? null;
}

/**
 * "Today, 09:12" / "Yesterday, 14:03" / "Monday, 14:03" within the last week,
 * else a medium date — the build time is the only thing telling OTA bundles apart.
 */
export function formatBuildTime(date: Date, lang: string): string {
	const time = date.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", ...hourCycleOptions() });
	const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const daysAgo = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
	if (daysAgo === 0 || daysAgo === 1) {
		const day = new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(-daysAgo, "day");
		return `${day.charAt(0).toLocaleUpperCase(lang)}${day.slice(1)}, ${time}`;
	}
	if (daysAgo > 1 && daysAgo < 7) {
		return `${date.toLocaleDateString(lang, { weekday: "long" })}, ${time}`;
	}
	return date.toLocaleString(lang, { dateStyle: "medium", timeStyle: "short", ...hourCycleOptions() });
}
