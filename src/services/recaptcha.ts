/**
 * reCAPTCHA Enterprise tokens for Grindr's captcha-gated endpoints, minted by
 * the Free Grind reCAPTCHA helper add-on (Android only, see
 * RecaptchaHelper.kt). Ported from open-grind's mint_recaptcha_token: the
 * helper bundles Google's reCAPTCHA SDK and needs the Grindr app installed,
 * so nothing here works on desktop.
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
 * Why no token could be minted. The first four come from Free Grind itself,
 * the rest from the helper's refusal markers.
 */
export type RecaptchaFailure =
	| "unsupportedPlatform"
	| "addonUnavailable"
	| "addonUntrusted"
	| "busy"
	| "cancelled"
	| "untrustedCaller"
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
	recaptchaHelperAvailability?: () => string;
	mintRecaptchaToken?: (action: string, requestId: string) => string;
};

type RecaptchaResult = {
	requestId?: string;
	token?: string;
	error?: string;
	detail?: string;
};

const HELPER_REFUSALS: Record<string, RecaptchaFailure> = {
	"untrusted-caller": "untrustedCaller",
	"unsupported-action": "unsupportedAction",
	"grindr-missing": "grindrMissing",
	"mint-failed": "mintFailed",
	cancelled: "cancelled",
	addonUnavailable: "addonUnavailable",
};

// The helper gives up after 20s itself; this only guards against an Activity
// result that never arrives at all.
const RESULT_TIMEOUT_MS = 60_000;

function bridge(): RecaptchaBridge | undefined {
	return (window as Window & { FreeGrindBridge?: RecaptchaBridge }).FreeGrindBridge;
}

/** Whether a trusted helper is installed, so a token can be asked for. */
export function isRecaptchaHelperAvailable(): boolean {
	try {
		return bridge()?.recaptchaHelperAvailability?.() === "available";
	} catch {
		return false;
	}
}

/**
 * Mints a token for `action`. Opens the helper (a translucent activity) and
 * rejects with a {@link RecaptchaError} when it is missing, untrusted or
 * refuses.
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
				const reason = HELPER_REFUSALS[result.error ?? ""] ?? "mintFailed";
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
		} catch {
			started = "addonUnavailable";
		}
		if (started !== "ok") {
			cleanup();
			const reason: RecaptchaFailure =
				started === "busy" || started === "addonUntrusted" ? started : "addonUnavailable";
			reject(new RecaptchaError(reason));
		}
	});
}
