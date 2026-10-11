export const REPORT_REASONS = [
	"SPAM",
	"HARASSMENT_BULLYING",
	"HATE_DISCRIMINATION",
	"NUDITY_PORNOGRAPHY",
	"UNDERAGE",
	"IMPERSONATION",
	"ILLEGAL_ACTIVITY",
	"SEXUAL_SOLICITATION",
	"SERIOUS_IN_PERSON_INCIDENT",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_LOCATIONS = [
	"PROFILE_PHOTO",
	"PROFILE_INFORMATION",
	"CHAT_MESSAGE",
	"ALBUM",
	"RIGHT_NOW_PHOTO",
	"RIGHT_NOW_TEXT",
] as const;
export type ReportLocation = (typeof REPORT_LOCATIONS)[number];

export interface ProfileReportRequest {
	reason: ReportReason;
	comment: string;
	locations: ReportLocation[];
}

/** Spam reports carry no details — the official client always files them against chat. */
export function buildProfileReport(
	reason: ReportReason,
	comment: string,
	locations: ReportLocation[],
): ProfileReportRequest {
	if (reason === "SPAM") return { reason, comment: "", locations: ["CHAT_MESSAGE"] };
	return { reason, comment: comment.trim(), locations };
}
