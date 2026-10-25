import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/useAuth";
import { AuthShell } from "../../components/ui/auth-shell";
import { AuthAltAction, AuthErrorBox, AuthSubmitSection, IconInput } from "./auth-form";
import { Button } from "../../components/ui/button";
import { BugReportButton } from "../../components/ui/BugReportButton";
import type { SignInMethod } from "../../types/auth";
import { useTranslation } from "react-i18next";
import { Mail, Lock, KeyRound, Eye, EyeOff, UserPlus, ChevronDown, QrCode, ScanLine } from "lucide-react";
import { SmsVerificationRequiredError, type SignInRefusal } from "../../contexts/auth-context";
import { SmsVerificationPanel } from "./SmsVerificationPanel";
import { isAndroid } from "../../services/saveMedia";
import { isTauriRuntime } from "../../services/tauriWebSocket";
import { cancelQrScan, isQrScanSupported, QrScanError, scanQrCode } from "../../services/qrScanner";
import { QrScanOverlay } from "../../components/QrScanOverlay";
import { cn } from "../../utils/cn";
import { SlidingTabs } from "../../components/ui/sliding-tabs";

/**
 * Android-only native Google sign-in (GoogleOAuthActivity.kt).
 * requestGoogleToken() answers through the `fg:google-token` /
 * `fg:google-token-error` window events; a token that arrived before this
 * page mounted waits in __FG_GOOGLE_TOKEN.
 */
type GoogleOAuthWindow = Window & {
	FreeGrindBridge?: {
		requestGoogleToken?: () => string;
	};
	__FG_GOOGLE_TOKEN?: string;
};

function isNativeGoogleSignInSupported(): boolean {
	return typeof (window as GoogleOAuthWindow).FreeGrindBridge?.requestGoogleToken === "function";
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

// Path from Simple Icons (CC0).
function FacebookIcon({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
			<path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z" />
		</svg>
	);
}

// The sign-in window (api/facebook_oauth) is a second webview, on every
// platform of the app.
function isFacebookSignInSupported(): boolean {
	return isTauriRuntime();
}

// Desktop and iOS open their own Google sign-in window (api/google_oauth);
// Android has GoogleOAuthActivity instead.
function isGoogleWindowSupported(): boolean {
	return isTauriRuntime() && !isAndroid();
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
	children?: ReactNode;
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

	const [isGoogleLoading, setIsGoogleLoading] = useState(false);
	// Android signs in through GoogleOAuthActivity, desktop and iOS through
	// their own window; a plain browser has neither, so no Google tab.
	const [hasNativeGoogle] = useState(isNativeGoogleSignInSupported);
	const [hasGoogleSignIn] = useState(() => isNativeGoogleSignInSupported() || isGoogleWindowSupported());
	const [googleAppError, setGoogleAppError] = useState<string | null>(null);
	const [hasFacebookSignIn] = useState(isFacebookSignInSupported);
	const [isFacebookLoading, setIsFacebookLoading] = useState(false);

	// Signing in with a code from another device: a secondary flow, so it
	// replaces the method tabs instead of being one of them.
	const [showTransfer, setShowTransfer] = useState(false);
	const [transferCode, setTransferCode] = useState("");
	const [isTransferLoading, setIsTransferLoading] = useState(false);
	const [canScanQr] = useState(isQrScanSupported);
	const [scanError, setScanError] = useState<string | null>(null);
	const [isScanning, setIsScanning] = useState(false);
	// With a camera to scan with, pasting the code stays folded away.
	const [showManualTransferCode, setShowManualTransferCode] = useState(false);

	// Set when an email sign-in is refused until the account verifies by SMS.
	const [verification, setVerification] = useState<{ profileId: string; signIn: SignInRefusal } | null>(null);

	const { login, loginWithGoogle, loginWithGoogleWindow, loginWithFacebook, loginWithTransferCode, error, clearError } = useAuth();
	const navigate = useNavigate();

	// A failure belongs to the method that produced it; also don't carry it to the next page.
	const changeMethod = (next: SignInMethod) => {
		setMethod(next);
		clearError();
		setGoogleAppError(null);
		setScanError(null);
	};
	const toggleTransfer = (next: boolean) => {
		setShowTransfer(next);
		clearError();
		setScanError(null);
	};
	useEffect(() => clearError, [clearError]);

	const isPasswordFormValid = email.trim().length > 0 && password.trim().length > 0;

	const submitPassword = async () => {
		setIsPasswordLoading(true);
		try {
			await login(email, password);
			navigate("/");
		} catch (error) {
			// AuthContext updates `error`, which is rendered in the form.
			if (error instanceof SmsVerificationRequiredError) {
				setVerification({ profileId: error.profileId, signIn: error.signIn });
			}
		} finally {
			setIsPasswordLoading(false);
		}
	};

	const handlePasswordSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		await submitPassword();
	};

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

	const handleGoogleWindowSignIn = async () => {
		setIsGoogleLoading(true);
		try {
			await loginWithGoogleWindow();
			navigate("/");
		} catch {
			// AuthContext updates `error`; a closed window stays silent.
		} finally {
			setIsGoogleLoading(false);
		}
	};

	const handleFacebookSignIn = async () => {
		setIsFacebookLoading(true);
		try {
			await loginWithFacebook();
			navigate("/");
		} catch {
			// AuthContext updates `error`; a closed window stays silent.
		} finally {
			setIsFacebookLoading(false);
		}
	};

	const submitTransferCode = async (code: string) => {
		setIsTransferLoading(true);
		try {
			await loginWithTransferCode(code);
			navigate("/");
		} catch {
			// AuthContext updates `error`, which is rendered in the form.
		} finally {
			setIsTransferLoading(false);
		}
	};

	const handleScanQr = async () => {
		setScanError(null);
		clearError();
		let code: string;
		setIsScanning(true);
		try {
			code = await scanQrCode();
		} catch (error) {
			if (error instanceof QrScanError && error.reason === "cancelled") return;
			setScanError(
				error instanceof QrScanError && error.reason === "permissionDenied"
					? t("auth.sign_in.qr_camera_denied", { defaultValue: "Free Grind needs camera access to scan the code." })
					: t("auth.sign_in.qr_scan_failed", { defaultValue: "Couldn't scan the code. Please try again." }),
			);
			return;
		} finally {
			setIsScanning(false);
		}
		await submitTransferCode(code);
	};

	// Leaving the page mid-scan must not leave the camera running behind it.
	const isScanningRef = useRef(false);
	isScanningRef.current = isScanning;
	useEffect(
		() => () => {
			if (isScanningRef.current) void cancelQrScan();
		},
		[],
	);

	const handleTransferSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		await submitTransferCode(transferCode.trim());
	};

	// The listeners below outlive renders; always submit through the latest closure.
	const submitGoogleTokenRef = useRef(submitGoogleToken);
	submitGoogleTokenRef.current = submitGoogleToken;

	useEffect(() => {
		const receiveToken = (token: string) => {
			setMethod("google");
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
					t("auth.sign_in.google_native_error", {
						defaultValue: "Google sign-in couldn't be opened. Please try again.",
					}),
				);
			}
		};
		window.addEventListener("fg:google-token", onToken);
		window.addEventListener("fg:google-token-error", onError);
		return () => {
			window.removeEventListener("fg:google-token", onToken);
			window.removeEventListener("fg:google-token-error", onError);
		};
	}, [t]);

	const handleGoogleAppSignIn = () => {
		setGoogleAppError(null);
		const result = (window as GoogleOAuthWindow).FreeGrindBridge?.requestGoogleToken?.();
		if (result === "ok") setIsGoogleLoading(true);
	};

	if (verification) {
		return (
			<SmsVerificationPanel
				profileId={verification.profileId}
				signIn={verification.signIn}
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
			footer={addProfileMode ? undefined : <BugReportButton />}
			toolbar={
				showTransfer ? undefined : (
					<SlidingTabs<SignInMethod>
						value={method}
						onChange={changeMethod}
						tabs={[
							{ value: "password", icon: <Mail className="h-3.5 w-3.5" />, label: t("auth.sign_in.method_password") },
							...(hasGoogleSignIn
								? [{ value: "google" as const, icon: <GoogleIcon className="h-3.5 w-3.5" />, label: t("auth.sign_in.method_google", { defaultValue: "Google" }) }]
								: []),
							...(hasFacebookSignIn
								? [{ value: "facebook" as const, icon: <FacebookIcon className="h-3.5 w-3.5" />, label: t("auth.sign_in.method_facebook", { defaultValue: "Facebook" }) }]
								: []),
						]}
					/>
				)
			}
		>
			{showTransfer ? (
				<form key="qr" onSubmit={handleTransferSubmit} className="animate-fade-in space-y-5">
					{isScanning ? (
						<QrScanOverlay
							hint={t("auth.sign_in.qr_scan_hint", { defaultValue: "Point the camera at the QR code on your other device" })}
							cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
							onCancel={() => void cancelQrScan()}
						/>
					) : null}
					<div>
						<Step
							step={1}
							title={t("auth.sign_in.qr_step_show", { defaultValue: "Show the code on your signed-in device" })}
							hint={t("auth.sign_in.qr_step_show_hint", {
								defaultValue: "In Free Grind on that device, open Settings and tap \"Sign in on another device\".",
							})}
						/>
						<Step
							step={2}
							title={
								canScanQr
									? t("auth.sign_in.qr_step_scan", { defaultValue: "Scan it here" })
									: t("auth.sign_in.qr_step_paste", { defaultValue: "Paste the code here" })
							}
							hint={
								canScanQr
									? undefined
									: t("auth.sign_in.qr_step_paste_hint", {
											defaultValue: "Tap \"Copy code\" under the QR code there and send it to this device.",
										})
							}
							last
						>
							{canScanQr ? (
								<section className="space-y-2.5">
									<Button
										type="button"
										variant="primary"
										loading={isTransferLoading && !showManualTransferCode}
										onClick={() => void handleScanQr()}
										leftIcon={<ScanLine className="h-4 w-4" />}
										className="w-full"
									>
										{t("auth.sign_in.qr_scan", { defaultValue: "Scan QR code" })}
									</Button>
									{scanError ? <AuthErrorBox message={scanError} /> : null}
									{!showManualTransferCode && error ? <AuthErrorBox message={error.message} detail={error.detail} /> : null}
									<button
										type="button"
										onClick={() => setShowManualTransferCode((prev) => !prev)}
										aria-expanded={showManualTransferCode}
										className="mx-auto flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
									>
										{t("auth.sign_in.qr_or_paste", { defaultValue: "or paste the code" })}
										<ChevronDown
											className={cn("h-3.5 w-3.5 transition-transform duration-200", showManualTransferCode && "rotate-180")}
										/>
									</button>
								</section>
							) : null}
							{canScanQr && !showManualTransferCode ? null : (
								<IconInput
									icon={<KeyRound className="h-4 w-4" />}
									type="password"
									value={transferCode}
									onChange={(e) => setTransferCode(e.target.value)}
									required
									placeholder={t("auth.sign_in.qr_code_placeholder", { defaultValue: "Sign-in code" })}
									autoComplete="off"
								/>
							)}
						</Step>
					</div>
					{canScanQr && !showManualTransferCode ? null : (
						<AuthSubmitSection
							error={error}
							loading={isTransferLoading}
							disabled={transferCode.trim().length === 0}
							loadingLabel={t("auth.sign_in.signing_in")}
							label={t("auth.sign_in.submit")}
						/>
					)}
				</form>
			) : method === "password" ? (
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
				</form>
			) : method === "facebook" ? (
				<form
					key="facebook"
					onSubmit={(e) => {
						e.preventDefault();
						void handleFacebookSignIn();
					}}
					className="animate-fade-in space-y-5"
				>
					<div>
						<Step
							step={1}
							title={t("auth.sign_in.facebook_step_open", { defaultValue: "Sign in on Facebook" })}
							hint={t("auth.sign_in.facebook_step_open_hint", {
								defaultValue: "A Facebook window opens. Your password goes to Facebook only, never to Free Grind.",
							})}
						/>
						<Step
							step={2}
							title={t("auth.sign_in.facebook_step_done", { defaultValue: "Confirm access" })}
							hint={t("auth.sign_in.facebook_step_done_hint", {
								defaultValue: "Allow Grindr to use your Facebook account. The window closes by itself and you're signed in.",
							})}
							last
						/>
					</div>
					<AuthSubmitSection
						error={error}
						loading={isFacebookLoading}
						disabled={false}
						loadingLabel={t("auth.sign_in.facebook_waiting", { defaultValue: "Waiting for Facebook…" })}
						label={t("auth.sign_in.facebook_sign_in", { defaultValue: "Sign in with Facebook" })}
					/>
				</form>
			) : (
				<form
					key="google"
					onSubmit={(e) => {
						e.preventDefault();
						if (hasNativeGoogle) handleGoogleAppSignIn();
						else void handleGoogleWindowSignIn();
					}}
					className="animate-fade-in space-y-5"
				>
					<div>
						<Step
							step={1}
							title={t("auth.sign_in.google_step_open", { defaultValue: "Sign in on Google" })}
							hint={t("auth.sign_in.google_step_open_hint", {
								defaultValue: "A Google window opens. Your password goes to Google only, never to Free Grind.",
							})}
						/>
						<Step
							step={2}
							title={t("auth.sign_in.google_step_done", { defaultValue: "Choose your account" })}
							hint={t("auth.sign_in.google_step_done_hint", {
								defaultValue: "Pick the Google account of your Grindr profile. The window closes by itself and you're signed in.",
							})}
							last
						/>
					</div>
					<AuthSubmitSection
						error={googleAppError ?? error}
						loading={isGoogleLoading}
						disabled={false}
						loadingLabel={t("auth.sign_in.google_window_waiting", { defaultValue: "Waiting for Google…" })}
						label={t("auth.sign_in.google_window_sign_in", { defaultValue: "Sign in with Google" })}
					/>
				</form>
			)}
			<button
				type="button"
				onClick={() => toggleTransfer(!showTransfer)}
				className="mx-auto mt-4 flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
			>
				{showTransfer ? (
					t("auth.sign_in.qr_back", { defaultValue: "Back to the other sign-in options" })
				) : (
					<>
						<QrCode className="h-3.5 w-3.5" />
						{t("auth.sign_in.qr_entry", { defaultValue: "Signed in on another device? Use a QR code" })}
					</>
				)}
			</button>
			{addProfileMode ? (
				<AuthAltAction
					onClick={() => navigate(-1)}
					label={t("common.cancel", { defaultValue: "Cancel" })}
				/>
			) : (
				<AuthAltAction
					to="/auth/sign-up"
					icon={<UserPlus className="h-4 w-4" />}
					label={t("auth.sign_in.no_account_action")}
				/>
			)}
		</AuthShell>
	);
}
