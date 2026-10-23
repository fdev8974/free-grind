import { useSyncExternalStore } from "react";

/**
 * Grindr's answer (HTTP 412, code 8) once it stops accepting the app version
 * grindr.rs emulates. Any request can get it; only an app update helps, since
 * the emulated version lives in the native build, not the OTA bundle.
 */
export const DEPRECATED_CLIENT_VERSION_CODE = 8;

export type UnsupportedVersionError = { code: number; message: string };

let current: UnsupportedVersionError | null = null;
// Asked once per app run: a burst of refused requests opens one prompt, and
// after "Not now" nothing reopens it until the next start.
let dismissed = false;
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) listener();
}

export function reportUnsupportedVersion(error: UnsupportedVersionError): void {
	if (dismissed || current) return;
	current = error;
	emit();
}

export function dismissUnsupportedVersion(): void {
	dismissed = true;
	current = null;
	emit();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useUnsupportedVersion(): UnsupportedVersionError | null {
	return useSyncExternalStore(subscribe, () => current);
}

function asUnsupportedVersionError(value: unknown): UnsupportedVersionError | null {
	if (typeof value !== "object" || value === null) return null;
	const { code, message } = value as { code?: unknown; message?: unknown };
	if (code !== DEPRECATED_CLIENT_VERSION_CODE) return null;
	return { code, message: typeof message === "string" ? message : "" };
}

/** An invoke rejection (`AppError`) of kind `Api` with code 8. */
export function noticeUnsupportedVersionInError(error: unknown): void {
	if (typeof error !== "object" || error === null) return;
	const { kind, message } = error as { kind?: unknown; message?: unknown };
	if (kind !== "Api") return;
	const refused = asUnsupportedVersionError(message);
	if (refused) reportUnsupportedVersion(refused);
}

/** A raw REST response proxied through `request`. */
export function noticeUnsupportedVersionInResponse(status: number, body: Uint8Array): void {
	if (status !== 412) return;
	try {
		const refused = asUnsupportedVersionError(JSON.parse(new TextDecoder().decode(body)));
		if (refused) reportUnsupportedVersion(refused);
	} catch {
		// Not a JSON body; not Grindr's version refusal.
	}
}
