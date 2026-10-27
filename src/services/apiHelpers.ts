import type { RestResponse } from "../types/chat-service";

export class ApiFunctionError extends Error {
	status: number;
	payload: unknown;

	constructor(message: string, status: number, payload: unknown) {
		super(message);
		this.name = "ApiFunctionError";
		this.status = status;
		this.payload = payload;
	}
}

/** Banned terms per moderated field, as reported by a rejected profile update. */
export interface BannedTermsByField {
	displayName?: string[];
	aboutMe?: string[];
	genderDisplay?: string[];
	pronounsDisplay?: string[];
}

/**
 * PUT /v3.1/me/profile answers 400 `urn:gr:err:hit_banned_terms` when a
 * moderated text field contains a banned term. The whole update is rejected —
 * nothing is saved, clean fields included.
 */
export class BannedTermsError extends ApiFunctionError {
	fields: BannedTermsByField;

	constructor(message: string, payload: unknown, fields: BannedTermsByField) {
		super(message, 400, payload);
		this.name = "BannedTermsError";
		this.fields = fields;
	}
}

/** Reads a BannedTermsResponse body; null when it isn't one. */
export function parseBannedTerms(payload: unknown): BannedTermsByField | null {
	if (!payload || typeof payload !== "object") return null;
	const p = payload as Record<string, unknown>;
	const termsOf = (value: unknown): string[] | undefined => {
		const terms = (value as { terms?: unknown } | null)?.terms;
		return Array.isArray(terms) ? terms.filter((term): term is string => typeof term === "string") : undefined;
	};
	const fields: BannedTermsByField = {
		displayName: termsOf(p.display_name),
		aboutMe: termsOf(p.about_me),
		genderDisplay: termsOf(p.gender_display),
		pronounsDisplay: termsOf(p.pronouns_display),
	};
	const hasField = Object.values(fields).some((terms) => terms !== undefined);
	if (p.type !== "urn:gr:err:hit_banned_terms" && !hasField) return null;
	return fields;
}

/**
 * Turns a rejected Tauri command's `AppError`-shaped payload (a plain object
 * like `{kind: "Api", message: {code, message}}`, not an `Error` instance —
 * unlike `fetchRest`, which already normalizes this) into an `ApiFunctionError`
 * so command-based call sites (e.g. the signed media-upload commands) surface
 * the same error shape REST-based ones do.
 */
export function commandErrorToApiFunctionError(error: unknown, fallback: string): ApiFunctionError {
	if (error && typeof error === "object" && "kind" in error) {
		const err = error as { kind?: unknown; message?: unknown };
		if (typeof err.message === "string") {
			return new ApiFunctionError(err.message, 0, error);
		}
		if (err.message && typeof err.message === "object") {
			const m = err.message as { code?: unknown; message?: unknown };
			if (typeof m.message === "string") {
				const status = typeof m.code === "number" ? m.code : 0;
				return new ApiFunctionError(m.message, status, error);
			}
		}
		if (typeof err.kind === "string") {
			return new ApiFunctionError(err.kind, 0, error);
		}
	}
	if (error instanceof Error) {
		return new ApiFunctionError(error.message, 0, error);
	}
	return new ApiFunctionError(fallback, 0, error);
}

const MEDIA_REJECTION_MESSAGES: Record<string, { key: string; defaultValue: string }> = {
	banned_image: {
		key: "api.errors.media_banned_image",
		defaultValue: "This image was rejected by Grindr's moderation and can't be sent.",
	},
	banned_video: {
		key: "api.errors.media_banned_video",
		defaultValue: "This video was rejected by Grindr's moderation and can't be sent.",
	},
	timestamp_drift: {
		key: "api.errors.media_timestamp_drift",
		defaultValue: "Upload rejected: your device clock is out of sync. Check your date and time settings.",
	},
	nonce_replayed: {
		key: "api.errors.media_nonce_replayed",
		defaultValue: "Upload rejected as a duplicate request. Please try again.",
	},
};

/**
 * Like `commandErrorToApiFunctionError`, for the media-upload commands: a
 * `MediaRejected` error (moderation or signature refusal) becomes a readable
 * explanation, anything else keeps its detail behind the fallback so the
 * toast says both what failed and why.
 */
export function mediaUploadErrorToApiFunctionError(
	error: unknown,
	fallback: string,
	t: (key: string, options?: { defaultValue?: string }) => string,
): ApiFunctionError {
	if (error && typeof error === "object" && (error as { kind?: unknown }).kind === "MediaRejected") {
		const { status, reason } = ((error as { message?: unknown }).message ?? {}) as {
			status?: unknown;
			reason?: unknown;
		};
		const known = typeof reason === "string" ? MEDIA_REJECTION_MESSAGES[reason] : undefined;
		const message = known
			? t(known.key, { defaultValue: known.defaultValue })
			: `${t("api.errors.media_rejected", { defaultValue: "The server rejected the upload" })} (${String(reason)})`;
		return new ApiFunctionError(message, typeof status === "number" ? status : 0, error);
	}
	const base = commandErrorToApiFunctionError(error, fallback);
	if (base.message === fallback) {
		return base;
	}
	return new ApiFunctionError(`${fallback}: ${base.message}`, base.status, base.payload);
}

export async function parseJsonSafe(response: RestResponse | Response): Promise<unknown> {
	try {
		return response.json();
	} catch {
		return null;
	}
}

export async function assertSuccess(response: RestResponse | Response, fallbackMessage: string) {
	const status = "status" in response ? response.status : (response as Response).status;
	if (status >= 200 && status < 300) {
		return;
	}

	const payload = await parseJsonSafe(response);
	let message = fallbackMessage;

	if (payload && typeof payload === "object") {
		const p = payload as Record<string, unknown>;
		if (typeof p.message === "string" && p.message) {
			message = p.message;
		} else if (typeof p.error === "string" && p.error) {
			message = p.error;
		}
	}

	throw new ApiFunctionError(message, status, payload);
}

