import i18n from "../i18n";

// Optimization: Cache the formatter to avoid expensive re-instantiation in long lists
const formatterCache = new Map<string, Intl.RelativeTimeFormat>();

type RelativeTimeStyle = "long" | "short";

function getRelativeFormatter(lang: string, style: RelativeTimeStyle) {
	const key = `${lang}:${style}`;
	if (!formatterCache.has(key)) {
		formatterCache.set(
			key,
			new Intl.RelativeTimeFormat(lang, {
				numeric: "auto",
				style,
			}),
		);
	}
	return formatterCache.get(key)!;
}

// Intl's short English form reads "2 min. ago" / "3 hr. ago" — turn that into
// the more natural "2 mins ago" / "3 hrs ago". Other locales keep Intl's output.
function polishShortEnglish(text: string, value: number): string {
	const suffix = value === 1 ? "" : "s";
	return text.replace(/\bmin\./, `min${suffix}`).replace(/\bhr\./, `hr${suffix}`);
}

/**
 * Format a timestamp as a short relative string falling back to a locale date for older values.
 * Uses Intl.RelativeTimeFormat and synchronizes with the app's current i18n language.
 */
export function formatRelativeTime(
	timestamp: number | null | undefined,
	now: number = Date.now(),
	style: RelativeTimeStyle = "long",
): string {
	if (!timestamp || !Number.isFinite(timestamp)) {
		return "";
	}

	const diffMs = now - timestamp;
	const lang = i18n.language;

	// For very recent items, show a localized "Just now" or similar.
	// We use Math.abs just in case of minor clock drift.
	if (Math.abs(diffMs) < 60000) {
		return i18n.t("browse_page.status_just_now");
	}

	const formatter = getRelativeFormatter(lang, style);
	const format = (value: number, unit: Intl.RelativeTimeFormatUnit) => {
		const text = formatter.format(-value, unit);
		return style === "short" && lang.startsWith("en") ? polishShortEnglish(text, value) : text;
	};

	const seconds = Math.floor(diffMs / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (minutes < 60) {
		return format(minutes, "minute");
	}
	if (hours < 24) {
		return format(hours, "hour");
	}
	if (days < 7) {
		return format(days, "day");
	}

	// For older dates, use the browser's default locale date format
	return new Date(timestamp).toLocaleDateString(lang);
}
