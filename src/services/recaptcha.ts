/**
 * reCAPTCHA Enterprise tokens for Grindr's captcha-gated endpoints, minted
 * in-app by RecaptchaMintActivity (Android only). Ported from open-grind's
 * mint_recaptcha_token: it needs Google's reCAPTCHA SDK and the Grindr app
 * installed, so nothing here works on desktop.
 */

/** The action strings Grindr scores a token against. */
export type RecaptchaAction =
	| "sign_up"
	| "login"
	| "forgot_password"
	| "report"
	| "decision_appeal"
	| "device_key_registration";

/**
 * Why no token could be minted. The first three come from the bridge, the
 * rest from RecaptchaMintActivity's refusal markers.
 */
export type RecaptchaFailure =
	| "unsupportedPlatform"
	| "busy"
	| "cancelled"
	| "unsupportedAction"
	| "grindrMissing"
	| "mintFailed";

export class RecaptchaError extends Error {
	constructor(
		readonly reason: RecaptchaFailure,
		readonly detail?: string,
	) {
		super(detail ? `reCAPTCHA ${reason}: ${detail}` : `reCAPTCHA ${reason}`);
		this.name = "RecaptchaError";
	}
}

type RecaptchaBridge = {
	mintRecaptchaToken?: (action: string, requestId: string) => string;
};

type RecaptchaResult = {
	requestId?: string;
	token?: string;
	error?: string;
	detail?: string;
};

const REFUSALS: Record<string, RecaptchaFailure> = {
	"unsupported-action": "unsupportedAction",
	"grindr-missing": "grindrMissing",
	"mint-failed": "mintFailed",
	cancelled: "cancelled",
};

// The SDK gives up after 20s itself; this only guards against an Activity
// result that never arrives at all.
const RESULT_TIMEOUT_MS = 60_000;

function bridge(): RecaptchaBridge | undefined {
	return (window as Window & { FreeGrindBridge?: RecaptchaBridge }).FreeGrindBridge;
}

/** Whether this platform can mint a token at all (Android). */
export function isRecaptchaAvailable(): boolean {
	return typeof bridge()?.mintRecaptchaToken === "function";
}

/**
 * Mints a token for `action`. Opens RecaptchaMintActivity (translucent) and
 * rejects with a {@link RecaptchaError} when it refuses or fails.
 */
export function mintRecaptchaToken(action: RecaptchaAction): Promise<string> {
	const native = bridge();
	if (!native?.mintRecaptchaToken) {
		return Promise.reject(new RecaptchaError("unsupportedPlatform"));
	}
	const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

	return new Promise<string>((resolve, reject) => {
		let timer = 0;
		const onResult = (event: Event) => {
			const result = (event as CustomEvent<RecaptchaResult>).detail;
			if (result?.requestId !== requestId) return;
			cleanup();
			if (result.token) {
				resolve(result.token);
			} else {
				const reason = REFUSALS[result.error ?? ""] ?? "mintFailed";
				reject(new RecaptchaError(reason, result.detail));
			}
		};
		const cleanup = () => {
			window.clearTimeout(timer);
			window.removeEventListener("fg:recaptcha-result", onResult);
		};

		window.addEventListener("fg:recaptcha-result", onResult);
		timer = window.setTimeout(() => {
			cleanup();
			reject(new RecaptchaError("mintFailed", "timeout"));
		}, RESULT_TIMEOUT_MS);

		let started: string;
		try {
			started = native.mintRecaptchaToken!(action, requestId);
		} catch (error) {
			started = String(error);
		}
		if (started !== "ok") {
			cleanup();
			reject(started === "busy" ? new RecaptchaError("busy") : new RecaptchaError("mintFailed", started));
		}
	});
}
