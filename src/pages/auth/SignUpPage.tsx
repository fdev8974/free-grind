import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Mail, Lock, Cake, Eye, EyeOff, ShieldCheck, LogIn } from "lucide-react";
import { AuthShell } from "../../components/ui/auth-shell";
import { BugReportButton } from "../../components/ui/BugReportButton";
import { useAuth } from "../../contexts/useAuth";
import { useRecaptchaHelperInstall } from "../../services/apkUpdate";
import { isRecaptchaHelperAvailable, RecaptchaError } from "../../services/recaptcha";
import { SmsVerificationRequiredError } from "../../contexts/auth-context";
import { AuthAltAction, AuthSubmitSection, IconInput } from "./auth-form";
import { AppInstallCard } from "./SignInPage";
import { SmsVerificationPanel } from "./SmsVerificationPanel";

const MIN_AGE = 18;

/** Latest birthday (YYYY-MM-DD) that is MIN_AGE today, for the date input's max. */
function latestAllowedBirthday(): string {
	const now = new Date();
	const d = new Date(Date.UTC(now.getFullYear() - MIN_AGE, now.getMonth(), now.getDate()));
	return d.toISOString().slice(0, 10);
}

/** A date input's YYYY-MM-DD as Unix milliseconds at UTC midnight. */
function birthdayToMillis(value: string): number | null {
	const [y, m, d] = value.split("-").map(Number);
	if (!y || !m || !d) return null;
	return Date.UTC(y, m - 1, d);
}

export function SignUpPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { signUp, login, error } = useAuth();

	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [birthday, setBirthday] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	// Set when the sign-in after creating the account asks for SMS verification.
	const [verification, setVerification] = useState<{ profileId: string } | null>(null);
	// Sign-up always sends a reCAPTCHA token, so it needs the helper.
	const [hasRecaptchaHelper, setHasRecaptchaHelper] = useState(isRecaptchaHelperAvailable);
	const recaptchaHelperInstall = useRecaptchaHelperInstall();

	// Freshly installed in place, or installed while the page sat in the background.
	useEffect(() => {
		if (recaptchaHelperInstall.state.phase === "installed") setHasRecaptchaHelper(isRecaptchaHelperAvailable());
	}, [recaptchaHelperInstall.state.phase]);
	useEffect(() => {
		const onVisible = () => {
			if (document.visibilityState === "visible") setHasRecaptchaHelper(isRecaptchaHelperAvailable());
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => document.removeEventListener("visibilitychange", onVisible);
	}, []);

	const maxBirthday = latestAllowedBirthday();
	const birthdayMillis = birthdayToMillis(birthday);
	const isTooYoung = birthday !== "" && birthday > maxBirthday;
	const isFormValid =
		hasRecaptchaHelper &&
		email.trim().length > 0 &&
		password.length > 0 &&
		birthdayMillis !== null &&
		!isTooYoung;

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!isFormValid || birthdayMillis === null) return;
		setIsLoading(true);
		try {
			await signUp({ email: email.trim(), password, birthday: birthdayMillis });
			navigate("/");
		} catch (error) {
			// AuthContext updates `error`, which is rendered in the form.
			if (error instanceof SmsVerificationRequiredError) {
				setVerification({ profileId: error.profileId });
			} else if (error instanceof RecaptchaError && error.reason === "addonUnavailable") {
				setHasRecaptchaHelper(false);
			}
		} finally {
			setIsLoading(false);
		}
	};

	if (verification) {
		return (
			<SmsVerificationPanel
				profileId={verification.profileId}
				onVerified={async () => {
					await login(email.trim(), password, { keepDevice: true });
					navigate("/");
				}}
				onCancel={() => setVerification(null)}
			/>
		);
	}

	return (
		<AuthShell
			title={t("auth.sign_up.title")}
			subtitle={t("auth.sign_up.subtitle", { defaultValue: "Create a new Grindr account with your email and password." })}
			footer={<BugReportButton />}
		>
			<form onSubmit={handleSubmit} className="animate-fade-in space-y-3">
				{hasRecaptchaHelper ? null : recaptchaHelperInstall.supported ? (
					<AppInstallCard
						install={recaptchaHelperInstall}
						icon={<ShieldCheck className="h-4 w-4" />}
						title={t("auth.sign_in.recaptcha_helper_link", { defaultValue: "reCAPTCHA helper" })}
						installHint={t("auth.sign_up.recaptcha_helper_install_hint", {
							defaultValue: "Needed to create an account · Tap to install",
						})}
					/>
				) : (
					<p className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-sm leading-relaxed text-[var(--text-muted)]">
						{t("auth.sign_up.recaptcha_helper_unsupported", {
							defaultValue: "Creating an account needs the Free Grind reCAPTCHA helper, which is only available on Android.",
						})}
					</p>
				)}
				<IconInput
					icon={<Mail className="h-4 w-4" />}
					type="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					required
					autoFocus
					autoComplete="email"
					placeholder={t("auth.common.email")}
				/>
				<IconInput
					icon={<Lock className="h-4 w-4" />}
					type={showPassword ? "text" : "password"}
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					required
					autoComplete="new-password"
					placeholder={t("auth.common.password")}
					rightSlot={
						<button
							type="button"
							onClick={() => setShowPassword((prev) => !prev)}
							className="flex items-center p-0 text-[var(--text-muted)] hover:text-[var(--text)]"
							tabIndex={-1}
							aria-label={showPassword ? t("auth.common.hide_password") : t("auth.common.show_password")}
						>
							{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
						</button>
					}
				/>
				<div className="space-y-1.5">
					<label htmlFor="sign-up-birthday" className="block text-xs font-medium text-[var(--text-muted)]">
						{t("auth.sign_up.birthday_label", { defaultValue: "Date of birth" })}
					</label>
					<IconInput
						id="sign-up-birthday"
						icon={<Cake className="h-4 w-4" />}
						type="date"
						value={birthday}
						onChange={(e) => setBirthday(e.target.value)}
						required
						max={maxBirthday}
						autoComplete="bday"
					/>
					{isTooYoung ? (
						<p className="text-xs text-[#f87171]">{t("auth.sign_up.too_young", { age: MIN_AGE, defaultValue: "You must be at least {{age}} years old." })}</p>
					) : null}
				</div>
				<AuthSubmitSection
					error={error}
					loading={isLoading}
					disabled={!isFormValid}
					loadingLabel={t("auth.sign_up.creating", { defaultValue: "Creating account..." })}
					label={t("auth.sign_up.submit", { defaultValue: "Create account" })}
				/>
			</form>
			<AuthAltAction
				to="/auth/sign-in"
				icon={<LogIn className="h-4 w-4" />}
				label={t("auth.sign_up.have_account_action")}
			/>
		</AuthShell>
	);
}
