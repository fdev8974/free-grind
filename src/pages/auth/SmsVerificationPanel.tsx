import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { platform } from "@tauri-apps/plugin-os";
import { ClipboardCopy, Hash, Phone, Plus } from "lucide-react";
import { AuthShell } from "../../components/ui/auth-shell";
import { BugReportButton } from "../../components/ui/BugReportButton";
import { useApi } from "../../hooks/useApi";
import { detectCallingCode } from "../../utils/callingCodes";
import { SmsVerificationRequiredError, type SignInRefusal } from "../../contexts/auth-context";
import { AuthAltAction, AuthSubmitSection, IconInput } from "./auth-form";

const digitsOnly = (value: string) => value.replace(/\D/g, "");

// Wait after a sendcode request before another one can be sent.
const RESEND_COOLDOWN_MS = 60_000;
const MAX_CODE_LENGTH = 6;

/**
 * SMS verification page for a sign-in refused with code 30: text a code to a
 * phone number, submit it, then `onVerified` signs in again. Rendered by the
 * sign-in/sign-up pages in place of their own page.
 */
export function SmsVerificationPanel({
	profileId,
	signIn,
	onVerified,
	onCancel,
}: {
	/** From the code-30 error body. */
	profileId: string;
	/** The refused sign-in, for the debug report. */
	signIn: SignInRefusal;
	/** Signs in again; rejects if that fails. */
	onVerified: () => Promise<void>;
	onCancel: () => void;
}) {
	const { t } = useTranslation();
	const { callMethod, asAppError } = useApi();

	const [step, setStep] = useState<"phone" | "code">("phone");
	const [countryCode, setCountryCode] = useState("");
	const [phoneNumber, setPhoneNumber] = useState("");
	const [code, setCode] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// A non-null `code` in the answer, e.g. "Profile is already verified".
	const [notice, setNotice] = useState<string | null>(null);
	const [resendAt, setResendAt] = useState<number | null>(null);
	const [now, setNow] = useState(Date.now);
	// The latest refused sign-in: signing in again after verifying can be refused too.
	const [lastSignIn, setLastSignIn] = useState(signIn);

	useEffect(() => {
		if (resendAt === null) return;
		const timer = window.setInterval(() => {
			const current = Date.now();
			setNow(current);
			if (current >= resendAt) setResendAt(null);
		}, 1000);
		return () => window.clearInterval(timer);
	}, [resendAt]);

	// Prefill the device region's calling code unless the user typed one already.
	useEffect(() => {
		let cancelled = false;
		void detectCallingCode().then((detected) => {
			if (!cancelled && detected) setCountryCode((current) => current || detected);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const cooldownSeconds = resendAt === null ? 0 : Math.max(0, Math.ceil((resendAt - now) / 1000));

	const target = {
		profileId,
		countryCode: digitsOnly(countryCode),
		phoneNumber: digitsOnly(phoneNumber),
	};
	const isPhoneValid = target.countryCode.length > 0 && target.phoneNumber.length > 0;

	const run = async (action: () => Promise<void>) => {
		setIsLoading(true);
		setError(null);
		setNotice(null);
		try {
			await action();
		} catch (err) {
			if (err instanceof SmsVerificationRequiredError) setLastSignIn(err.signIn);
			setError(
				err instanceof SmsVerificationRequiredError
					? t("auth.sms_verification.still_required", {
							defaultValue: "Grindr still asks for verification. Check the code or request a new one.",
						})
					: asAppError(err)?.prettyMessage ||
							t("auth.sms_verification.failed", { defaultValue: "Something went wrong. Please try again." }),
			);
		} finally {
			setIsLoading(false);
		}
	};

	const copyReport = async () => {
		try {
			const report = await callMethod("sms_debug_report");
			await navigator.clipboard.writeText(
				[
					"Free Grind SMS verification report",
					`App: ${import.meta.env.VITE_APP_VERSION} (${currentPlatform()})`,
					"",
					"== Refused sign-in ==",
					`Endpoint: POST ${lastSignIn.endpoint}`,
					"Response body:",
					lastSignIn.body.trim() || "(empty)",
					"",
					"== Last SMS request ==",
					report ?? "(none sent yet)",
				].join("\n"),
			);
			toast.success(t("auth.sms_verification.report_copied", { defaultValue: "Debug info copied to clipboard" }));
		} catch {
			toast.error(t("auth.sms_verification.report_copy_failed", { defaultValue: "Couldn't copy the debug info" }));
		}
	};

	const sendCode = () => {
		if (cooldownSeconds > 0) return;
		return run(async () => {
			const result = await callMethod("send_sms_verification_code", target);
			const answeredAt = Date.now();
			setNow(answeredAt);
			setResendAt(answeredAt + RESEND_COOLDOWN_MS);
			if (result.code != null) {
				setNotice(result.message);
				return;
			}
			setCode("");
			setStep("code");
		});
	};

	const verifyCode = () =>
		run(async () => {
			const result = await callMethod("verify_sms_verification_code", { ...target, code: code.trim() });
			if (result.code != null) {
				setNotice(result.message);
				return;
			}
			await onVerified();
		});

	const signInAgain = () => run(onVerified);

	return (
		<AuthShell
			title={t("auth.sms_verification.title", { defaultValue: "Verification" })}
			subtitle={
				step === "phone"
					? t("auth.sms_verification.phone_hint", {
							defaultValue: "Grindr requires this account to verify a phone number by SMS before it can sign in.",
						})
					: t("auth.sms_verification.code_hint", {
							defaultValue: "Enter the code sent to +{{country}} {{phone}}.",
							country: target.countryCode,
							phone: target.phoneNumber,
						})
			}
			footer={
				<>
					<button
						type="button"
						onClick={() => void copyReport()}
						className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:ink-tint-8 hover:text-[var(--text)]"
					>
						<ClipboardCopy className="h-3.5 w-3.5" />
						{t("auth.sms_verification.copy_report", { defaultValue: "Copy debug info" })}
					</button>
					<BugReportButton />
				</>
			}
		>
			{step === "phone" ? (
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (isPhoneValid) void sendCode();
					}}
					className="animate-fade-in space-y-3"
				>
					<div className="flex gap-2">
						<IconInput
							icon={<Plus className="h-4 w-4" />}
							inputMode="numeric"
							autoComplete="tel-country-code"
							value={countryCode}
							onChange={(e) => setCountryCode(digitsOnly(e.target.value).slice(0, 4))}
							required
							autoFocus
							placeholder="49"
							className="w-24"
						/>
						<div className="min-w-0 flex-1">
							<IconInput
								icon={<Phone className="h-4 w-4" />}
								type="tel"
								autoComplete="tel-national"
								value={phoneNumber}
								onChange={(e) => setPhoneNumber(e.target.value)}
								required
								placeholder={t("auth.sms_verification.phone_placeholder", { defaultValue: "Phone number" })}
							/>
						</div>
					</div>
					{notice ? <SmsNotice message={notice} onSignIn={signInAgain} /> : null}
					<AuthSubmitSection
						error={error}
						loading={isLoading}
						disabled={!isPhoneValid || cooldownSeconds > 0}
						loadingLabel={t("auth.sms_verification.sending", { defaultValue: "Sending code..." })}
						label={
							cooldownSeconds > 0
								? t("auth.sms_verification.send_in", {
										defaultValue: "Send code ({{seconds}}s)",
										seconds: cooldownSeconds,
									})
								: t("auth.sms_verification.send", { defaultValue: "Send code" })
						}
					/>
				</form>
			) : (
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (code.trim()) void verifyCode();
					}}
					className="animate-fade-in space-y-3"
				>
					<IconInput
						icon={<Hash className="h-4 w-4" />}
						inputMode="numeric"
						autoComplete="one-time-code"
						value={code}
						onChange={(e) => setCode(digitsOnly(e.target.value).slice(0, MAX_CODE_LENGTH))}
						maxLength={MAX_CODE_LENGTH}
						required
						autoFocus
						placeholder={t("auth.sms_verification.code_placeholder", { defaultValue: "Verification code" })}
						className="font-mono tracking-[0.3em]"
					/>
					{notice ? <SmsNotice message={notice} onSignIn={signInAgain} /> : null}
					<AuthSubmitSection
						error={error}
						loading={isLoading}
						disabled={!code.trim()}
						loadingLabel={t("auth.sms_verification.verifying", { defaultValue: "Verifying..." })}
						label={t("auth.sms_verification.verify", { defaultValue: "Verify and sign in" })}
					/>
					<div className="flex justify-between text-xs">
						<button
							type="button"
							onClick={() => {
								setStep("phone");
								setError(null);
								setNotice(null);
								// A different number may get its code right away.
								setResendAt(null);
							}}
							className="text-[var(--text-muted)] hover:text-[var(--text)]"
						>
							{t("auth.sms_verification.change_number", { defaultValue: "Change number" })}
						</button>
						<button
							type="button"
							onClick={() => void sendCode()}
							disabled={isLoading || cooldownSeconds > 0}
							className="font-semibold tabular-nums text-[var(--accent)] disabled:text-[var(--text-muted)] disabled:opacity-70"
						>
							{cooldownSeconds > 0
								? t("auth.sms_verification.resend_in", {
										defaultValue: "Resend code ({{seconds}}s)",
										seconds: cooldownSeconds,
									})
								: t("auth.sms_verification.resend", { defaultValue: "Resend code" })}
						</button>
					</div>
				</form>
			)}

			<AuthAltAction
				onClick={onCancel}
				label={t("auth.sms_verification.back", { defaultValue: "Back" })}
			/>
		</AuthShell>
	);
}

function currentPlatform(): string {
	try {
		return platform();
	} catch {
		return "web";
	}
}

/** The endpoints' status message, with a way out when it says there's nothing to verify. */
function SmsNotice({ message, onSignIn }: { message: string; onSignIn: () => void }) {
	const { t } = useTranslation();
	return (
		<div className="animate-fade-in flex items-center justify-between gap-3 native-card rounded-2xl px-3 py-2.5 text-sm text-[var(--text)]">
			<span className="min-w-0">{message}</span>
			<button type="button" onClick={onSignIn} className="shrink-0 text-xs font-semibold text-[var(--accent)]">
				{t("auth.sms_verification.sign_in", { defaultValue: "Sign in" })}
			</button>
		</div>
	);
}
