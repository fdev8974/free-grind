import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/useAuth";
import { AuthShell } from "../../components/ui/auth-shell";
import { AuthAltAction, AuthErrorBox, AuthSubmitSection, IconInput } from "./auth-form";
import { Button } from "../../components/ui/button";
import { BugReportButton } from "../../components/ui/BugReportButton";
import type { SignInMethod } from "../../types/auth";
import { useTranslation } from "react-i18next";
import { Mail, Lock, KeyRound, ExternalLink, Eye, EyeOff, Smartphone, Puzzle, Download, Loader2, Check, ShieldAlert, ShieldCheck, UserPlus, ChevronDown } from "lucide-react";
import { describeApkUpdateError, useGoogleOAuthAppInstall, useRecaptchaHelperInstall } from "../../services/apkUpdate";
import { RecaptchaError } from "../../services/recaptcha";
import { SmsVerificationRequiredError } from "../../contexts/auth-context";
import { SmsVerificationPanel } from "./SmsVerificationPanel";
import { isAndroid } from "../../services/saveMedia";
import { cn } from "../../utils/cn";

const GOOGLE_OAUTH_APP_RELEASES = "https://github.com/fdev8974/free-grind-oauth-app/releases";

/**
 * Android-only native side of the Free Grind Google OAuth companion app (see
 * GoogleOAuthApp.kt). requestGoogleToken() answers through the
 * `fg:google-token` / `fg:google-token-error` window events; a token the app
 * handed over on its own before this page mounted waits in __FG_GOOGLE_TOKEN.
 */
type GoogleOAuthWindow = Window & {
	FreeGrindBridge?: {
		isGoogleOAuthAppInstalled?: () => boolean;
		requestGoogleToken?: () => string;
	};
	__FG_GOOGLE_TOKEN?: string;
};

function isGoogleOAuthAppInstalled(): boolean {
	try {
		return (window as GoogleOAuthWindow).FreeGrindBridge?.isGoogleOAuthAppInstalled?.() === true;
	} catch {
		return false;
	}
}

function takePendingGoogleToken(): string | null {
	const w = window as GoogleOAuthWindow;
	const token = w.__FG_GOOGLE_TOKEN?.trim();
	delete w.__FG_GOOGLE_TOKEN;
	return token || null;
}

// Lucide ships no brand logos; path from Simple Icons (CC0).
function GoogleIcon({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
			<path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
		</svg>
	);
}

function AuthMethodTab({
	active,
	icon,
	label,
	onClick,
}: {
	active: boolean;
	icon: ReactNode;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-[10px] py-2 text-sm font-medium transition-colors duration-300 active:scale-[0.97]",
				active ? "text-[var(--accent-contrast)]" : "text-[var(--text-muted)] hover:text-[var(--text)]",
			)}
		>
			{icon}
			{label}
		</button>
	);
}

function Step({
	step,
	title,
	hint,
	last = false,
	children,
}: {
	step: number;
	title: string;
	hint?: string;
	last?: boolean;
	children: ReactNode;
}) {
	return (
		<div className="flex gap-3">
			<div className="flex flex-col items-center">
				<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-bold text-[var(--accent-contrast)]">
					{step}
				</span>
				{last ? null : <span className="mt-1.5 w-px flex-1 bg-[var(--border)]" />}
			</div>
			<div className={cn("min-w-0 flex-1 space-y-2.5", !last && "pb-5")}>
				<div>
					<p className="text-sm font-semibold leading-6 text-[var(--text)]">{title}</p>
					{hint ? <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">{hint}</p> : null}
				</div>
				{children}
			</div>
		</div>
	);
}

function TokenSourceLink({
	href,
	icon,
	title,
	description,
}: {
	href: string;
	icon: ReactNode;
	title: string;
	description: string;
}) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			className="group flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 transition-all duration-150 hover:border-[var(--accent)] active:scale-[0.99]"
		>
			<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-contrast)]">
				{icon}
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm font-medium text-[var(--text)]">{title}</span>
				<span className="block truncate text-xs text-[var(--text-muted)]">{description}</span>
			</span>
			<ExternalLink className="h-4 w-4 shrink-0 text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]" />
		</a>
	);
}

/**
 * Android: installs a companion app (Google OAuth app, reCAPTCHA helper) in
 * place, like the in-app update (see useGoogleOAuthAppInstall), instead of
 * linking to its releases page.
 */
export function AppInstallCard({
	install,
	icon,
	title,
	installHint,
}: {
	install: ReturnType<typeof useGoogleOAuthAppInstall>;
	icon: ReactNode;
	title: string;
	installHint: string;
}) {
	const { t } = useTranslation();
	const { state } = install;
	const busy = state.phase === "downloading" || state.phase === "verifying" || state.phase === "installing";

	const status =
		state.phase === "downloading"
			? state.progress === null
				? t("auth.sign_in.google_app_downloading", { defaultValue: "Downloading…" })
				: `${t("auth.sign_in.google_app_downloading", { defaultValue: "Downloading…" })} ${Math.round(state.progress * 100)}%`
			: state.phase === "verifying"
				? t("auth.sign_in.google_app_verifying", { defaultValue: "Verifying…" })
				: state.phase === "installing"
					? t("auth.sign_in.google_app_installing", { defaultValue: "Installing…" })
					: state.phase === "installed"
						? t("auth.sign_in.google_app_installed", { defaultValue: "Installed" })
						: state.phase === "needs-permission"
							? t("auth.sign_in.google_app_needs_permission", {
									defaultValue: "Allow Free Grind to install apps, then come back here",
								})
							: state.phase === "error"
								? describeApkUpdateError(state.code)
								: installHint;

	const onClick = () => {
		if (state.phase === "needs-permission") install.openPermissionSettings();
		else if (state.phase === "error" && state.code === "canceled") install.installDownloaded();
		else install.start();
	};

	return (
		<button
			type="button"
			onClick={onClick}
			disabled={busy || state.phase === "installed"}
			className="group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-left transition-all duration-150 hover:border-[var(--accent)] active:scale-[0.99] disabled:active:scale-100"
		>
			<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-contrast)]">
				{icon}
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm font-medium text-[var(--text)]">{title}</span>
				<span
					className={cn(
						"block text-xs",
						state.phase === "error" ? "text-[#f87171]" : "text-[var(--text-muted)]",
						state.phase === "error" || state.phase === "needs-permission" ? "leading-relaxed" : "truncate",
					)}
				>
					{status}
				</span>
			</span>
			{busy ? (
				<Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--accent)]" />
			) : state.phase === "installed" ? (
				<Check className="h-4 w-4 shrink-0 text-[var(--accent)]" />
			) : state.phase === "needs-permission" ? (
				<ShieldAlert className="h-4 w-4 shrink-0 text-[var(--accent)]" />
			) : (
				<Download className="h-4 w-4 shrink-0 text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]" />
			)}
			{state.phase === "downloading" ? (
				<span className="absolute inset-x-0 bottom-0 h-0.5 bg-[color-mix(in_srgb,var(--accent)_18%,transparent)]">
					<span
						className={cn(
							"block h-full bg-[var(--accent)] transition-[width] duration-200",
							state.progress === null && "w-1/3 animate-pulse",
						)}
						style={state.progress === null ? undefined : { width: `${Math.round(state.progress * 100)}%` }}
					/>
				</span>
			) : null}
		</button>
	);
}

/** "— or —" divider plus a secondary button to the other auth page. */

export function SignInPage() {
	const { t } = useTranslation();
	const [searchParams] = useSearchParams();
	const addProfileMode = searchParams.get("mode") === "add-profile";
	const [method, setMethod] = useState<SignInMethod>("password");

	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [isPasswordLoading, setIsPasswordLoading] = useState(false);

	const [googleToken, setGoogleToken] = useState("");
	const [isGoogleLoading, setIsGoogleLoading] = useState(false);
	const [hasGoogleOAuthApp, setHasGoogleOAuthApp] = useState(isGoogleOAuthAppInstalled);
	const [googleAppError, setGoogleAppError] = useState<string | null>(null);
	// With the companion app installed, the manual token flow stays folded away.
	const [showManualToken, setShowManualToken] = useState(false);
	const googleAppInstall = useGoogleOAuthAppInstall();
	const [isAndroidDevice] = useState(isAndroid);
	// Set once a sign-in needed a reCAPTCHA token but the helper isn't installed.
	const [needsRecaptchaHelper, setNeedsRecaptchaHelper] = useState(false);
	const recaptchaHelperInstall = useRecaptchaHelperInstall();

	// Set when an email sign-in is refused until the account verifies by SMS.
	const [verification, setVerification] = useState<{ profileId: string } | null>(null);

	const { login, loginWithGoogle, error } = useAuth();
	const navigate = useNavigate();

	const isPasswordFormValid = email.trim().length > 0 && password.trim().length > 0;
	const isGoogleFormValid = googleToken.trim().length > 0;

	const submitPassword = async () => {
		setIsPasswordLoading(true);
		try {
			await login(email, password);
			navigate("/");
		} catch (error) {
			// AuthContext updates `error`, which is rendered in the form.
			if (error instanceof SmsVerificationRequiredError) {
				setVerification({ profileId: error.profileId });
			} else if (error instanceof RecaptchaError && error.reason === "addonUnavailable") {
				setNeedsRecaptchaHelper(true);
			}
		} finally {
			setIsPasswordLoading(false);
		}
	};

	const handlePasswordSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		await submitPassword();
	};

	// The helper was just installed for this sign-in: retry it right away.
	const submitPasswordRef = useRef(submitPassword);
	submitPasswordRef.current = submitPassword;
	useEffect(() => {
		if (needsRecaptchaHelper && recaptchaHelperInstall.state.phase === "installed") {
			setNeedsRecaptchaHelper(false);
			void submitPasswordRef.current();
		}
	}, [needsRecaptchaHelper, recaptchaHelperInstall.state.phase]);

	const submitGoogleToken = async (token: string) => {
		setGoogleAppError(null);
		setIsGoogleLoading(true);
		try {
			await loginWithGoogle(token);
			navigate("/");
		} catch {
			// AuthContext updates `error`, which is rendered in the form.
		} finally {
			setIsGoogleLoading(false);
		}
	};

	const handleGoogleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		await submitGoogleToken(googleToken.trim());
	};

	// The listeners below outlive renders; always submit through the latest closure.
	const submitGoogleTokenRef = useRef(submitGoogleToken);
	submitGoogleTokenRef.current = submitGoogleToken;

	useEffect(() => {
		const receiveToken = (token: string) => {
			setMethod("google");
			setGoogleToken(token);
			void submitGoogleTokenRef.current(token);
		};
		const pending = takePendingGoogleToken();
		if (pending) receiveToken(pending);

		const onToken = () => {
			const token = takePendingGoogleToken();
			if (token) receiveToken(token);
		};
		const onError = (event: Event) => {
			setIsGoogleLoading(false);
			const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
			if (reason && reason !== "cancelled") {
				setGoogleAppError(
					t("auth.sign_in.google_app_error", {
						defaultValue: "The Google OAuth app could not sign you in. Make sure it is the Free Grind version.",
					}),
				);
			}
		};
		// The app may get installed while this page sits in the background.
		const onVisible = () => {
			if (document.visibilityState === "visible") setHasGoogleOAuthApp(isGoogleOAuthAppInstalled());
		};
		window.addEventListener("fg:google-token", onToken);
		window.addEventListener("fg:google-token-error", onError);
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			window.removeEventListener("fg:google-token", onToken);
			window.removeEventListener("fg:google-token-error", onError);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, [t]);

	// Freshly installed in place: switch to the one-tap sign-in right away.
	useEffect(() => {
		if (googleAppInstall.state.phase === "installed") setHasGoogleOAuthApp(isGoogleOAuthAppInstalled());
	}, [googleAppInstall.state.phase]);

	const handleGoogleAppSignIn = () => {
		setGoogleAppError(null);
		const result = (window as GoogleOAuthWindow).FreeGrindBridge?.requestGoogleToken?.();
		if (result === "ok") {
			setIsGoogleLoading(true);
		} else {
			setHasGoogleOAuthApp(false);
		}
	};

	if (verification) {
		return (
			<SmsVerificationPanel
				profileId={verification.profileId}
				onVerified={async () => {
					// Same device as the refused attempt the verification belongs to.
					await login(email, password, { keepDevice: true });
					navigate("/");
				}}
				onCancel={() => setVerification(null)}
			/>
		);
	}

	return (
		<AuthShell
			title={addProfileMode ? t("auth.sign_in.add_profile_title", { defaultValue: "Add Profile" }) : t("auth.sign_in.title")}
			subtitle={addProfileMode ? t("auth.sign_in.add_profile_subtitle", { defaultValue: "Sign in with the account you want to add." }) : t("auth.sign_in.subtitle", { defaultValue: "Use your Grindr email and password, or sign in with Google." })}
			footer={
				addProfileMode ? (
					<div className="flex flex-col items-center gap-3">
						<button
							type="button"
							onClick={() => navigate(-1)}
							className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
						>
							{t("common.cancel", { defaultValue: "Cancel" })}
						</button>
					</div>
				) : (
					<BugReportButton />
				)
			}
			toolbar={
				<div className="relative flex gap-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-1 shadow-sm">
					{/* Sliding active indicator: half the track minus the gap-1 between the tabs. */}
					<span
						aria-hidden="true"
						className={cn(
							"absolute inset-y-1 left-1 w-[calc(50%-6px)] rounded-[10px] bg-[var(--accent)] shadow-md shadow-[var(--accent)]/25 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
							method === "google" && "translate-x-[calc(100%+4px)]",
						)}
					/>
					<AuthMethodTab
						active={method === "password"}
						icon={<Lock className="h-3.5 w-3.5" />}
						label={t("auth.sign_in.method_password")}
						onClick={() => setMethod("password")}
					/>
					<AuthMethodTab
						active={method === "google"}
						icon={<GoogleIcon className="h-3.5 w-3.5" />}
						label={t("auth.sign_in.method_google", { defaultValue: "Google" })}
						onClick={() => setMethod("google")}
					/>
				</div>
			}
		>
			{method === "password" ? (
				<form key="password" onSubmit={handlePasswordSubmit} className="animate-fade-in space-y-3">
					<IconInput
						icon={<Mail className="h-4 w-4" />}
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						required
						autoFocus
						placeholder={t("auth.common.email")}
					/>
					<IconInput
						icon={<Lock className="h-4 w-4" />}
						type={showPassword ? "text" : "password"}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						required
						placeholder={t("auth.common.password")}
						rightSlot={
							<button
								type="button"
								onClick={() => setShowPassword((prev) => !prev)}
								className="flex items-center p-0 text-[var(--text-muted)] hover:text-[var(--text)]"
								tabIndex={-1}
								aria-label={
									showPassword
										? t("auth.common.hide_password")
										: t("auth.common.show_password")
								}
							>
								{showPassword ? (
									<EyeOff className="h-4 w-4" />
								) : (
									<Eye className="h-4 w-4" />
								)}
							</button>
						}
					/>
					<div className="flex justify-end">
						<Link
							to={`/auth/password-reset${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ""}`}
							className="text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
						>
							{t("auth.sign_in.forgot_password", { defaultValue: "Forgot password?" })}
						</Link>
					</div>
					<AuthSubmitSection
						error={error}
						loading={isPasswordLoading}
						disabled={!isPasswordFormValid}
						loadingLabel={t("auth.sign_in.signing_in")}
						label={t("auth.sign_in.submit")}
					/>
					{recaptchaHelperInstall.supported && needsRecaptchaHelper ? (
						<AppInstallCard
							install={recaptchaHelperInstall}
							icon={<ShieldCheck className="h-4 w-4" />}
							title={t("auth.sign_in.recaptcha_helper_link", { defaultValue: "reCAPTCHA helper" })}
							installHint={t("auth.sign_in.recaptcha_helper_install_hint", {
								defaultValue: "Needed to sign in to this account · Tap to install",
							})}
						/>
					) : null}
				</form>
			) : (
				<form key="google" onSubmit={handleGoogleSubmit} className="animate-fade-in space-y-5">
					{hasGoogleOAuthApp ? (
						<section className="space-y-2.5">
							<Button
								type="button"
								variant="primary"
								loading={isGoogleLoading}
								onClick={handleGoogleAppSignIn}
								leftIcon={<GoogleIcon className="h-4 w-4" />}
								className="w-full"
							>
								{t("auth.sign_in.google_app_sign_in", { defaultValue: "Sign in with the Google app" })}
							</Button>
							{googleAppError ? <AuthErrorBox message={googleAppError} /> : null}
							{!showManualToken && error ? <AuthErrorBox message={error} /> : null}
							<button
								type="button"
								onClick={() => setShowManualToken((prev) => !prev)}
								aria-expanded={showManualToken}
								className="mx-auto flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
							>
								{t("auth.sign_in.google_app_or_manual", { defaultValue: "or paste a token manually" })}
								<ChevronDown
									className={cn("h-3.5 w-3.5 transition-transform duration-200", showManualToken && "rotate-180")}
								/>
							</button>
						</section>
					) : null}
					{hasGoogleOAuthApp && !showManualToken ? null : (
						<div className="animate-fade-in space-y-5">
							<div>
								<Step
									step={1}
									title={t("auth.sign_in.google_step_get", { defaultValue: "Get a sign-in token" })}
									hint={t("auth.sign_in.google_step_get_hint", {
										defaultValue: "Sign in with Google there, then tap \"Copy token\".",
									})}
								>
									<div className="space-y-2">
										{/* The browser extension is desktop-only; the companion app is shown everywhere. */}
										{isAndroidDevice ? null : (
											<TokenSourceLink
												href="https://github.com/fdev8974/freegrind-google-oauth-webextension#install"
												icon={<Puzzle className="h-4 w-4" />}
												title={t("auth.sign_in.google_extension_link", { defaultValue: "Browser extension" })}
												description={t("auth.sign_in.google_extension_desc", { defaultValue: "Firefox, Chrome and other desktop browsers" })}
											/>
										)}
										{isAndroidDevice && googleAppInstall.supported && !hasGoogleOAuthApp ? (
											<AppInstallCard
												install={googleAppInstall}
												icon={<Smartphone className="h-4 w-4" />}
												title={t("auth.sign_in.google_app_link", { defaultValue: "Google OAuth app" })}
												installHint={t("auth.sign_in.google_app_install_hint", { defaultValue: "Android · Tap to install" })}
											/>
										) : (
											<TokenSourceLink
												href={GOOGLE_OAUTH_APP_RELEASES}
												icon={<Smartphone className="h-4 w-4" />}
												title={t("auth.sign_in.google_app_link", { defaultValue: "Google OAuth app" })}
												description={t("auth.sign_in.google_app_desc", { defaultValue: "Android" })}
											/>
										)}
									</div>
								</Step>
								<Step
									step={2}
									title={t("auth.sign_in.google_step_paste", { defaultValue: "Paste the token" })}
									last
								>
									<IconInput
										icon={<KeyRound className="h-4 w-4" />}
										type="password"
										value={googleToken}
										onChange={(e) => setGoogleToken(e.target.value)}
										required
										placeholder={t("auth.sign_in.google_token_placeholder", { defaultValue: "Google OAuth token" })}
										autoComplete="off"
									/>
								</Step>
							</div>
							<AuthSubmitSection
								error={error}
								loading={isGoogleLoading}
								disabled={!isGoogleFormValid}
								loadingLabel={t("auth.sign_in.signing_in")}
								label={t("auth.sign_in.submit")}
							/>
						</div>
					)}
				</form>
			)}
			{addProfileMode ? null : (
				<AuthAltAction
					to="/auth/sign-up"
					icon={<UserPlus className="h-4 w-4" />}
					label={t("auth.sign_in.no_account_action")}
				/>
			)}
		</AuthShell>
	);
}
