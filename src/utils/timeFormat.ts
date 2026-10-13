/** User-selectable clock format (12h / 24h / follow the system locale). */

export const TIME_FORMAT_KEY = "fg-time-format";

export type TimeFormat = "system" | "12h" | "24h";

export function getTimeFormat(): TimeFormat {
	try {
		const value = window.localStorage.getItem(TIME_FORMAT_KEY);
		return value === "12h" || value === "24h" ? value : "system";
	} catch {
		return "system";
	}
}

/** Spread into Intl/toLocale*String options for any format that shows a time of day. */
export function hourCycleOptions(): Pick<Intl.DateTimeFormatOptions, "hour12"> {
	const format = getTimeFormat();
	return format === "system" ? {} : { hour12: format === "12h" };
}
