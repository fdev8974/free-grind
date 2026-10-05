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

