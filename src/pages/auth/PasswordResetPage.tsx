import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Mail, MailCheck } from "lucide-react";
import toast from "react-hot-toast";
import { AuthShell } from "../../components/ui/auth-shell";
import { BugReportButton } from "../../components/ui/BugReportButton";
import { Button } from "../../components/ui/button";
import { useApi } from "../../hooks/useApi";
import { AuthAltAction, AuthSubmitSection, IconInput } from "./auth-form";

export function PasswordResetPage() {
	const { t } = useTranslation();
	const { callMethod, asAppError } = useApi();
	const [searchParams] = useSearchParams();

	const [email, setEmail] = useState(searchParams.get("email") ?? "");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Set once the request went through, so the form is swapped for a confirmation.
	const [sent, setSent] = useState(false);

	const isFormValid = email.trim().length > 0;

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!isFormValid) return;
		setIsLoading(true);
		setError(null);
		try {
			await callMethod("forgot_password", { email: email.trim() });
			setSent(true);
			toast.success(
				t("auth.reset.sent_toast", { defaultValue: "Password reset email sent" }),
			);
		} catch (err) {
			const appError = asAppError(err);
			const message =
				appError?.prettyMessage ||
				t("auth.reset.failed", {
					defaultValue: "Couldn't send the reset email. Please try again.",
				});
			setError(message);
			toast.error(message);
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<AuthShell
			title={t("auth.reset.title", { defaultValue: "Reset password" })}
			subtitle={
				sent
					? t("auth.reset.sent_subtitle", {
							defaultValue: "If an account exists for that email, a reset link is on its way.",
						})
					: t("auth.reset.subtitle", {
							defaultValue: "Enter your email and we'll send you a link to reset your password.",
						})
			}
			footer={<BugReportButton />}
		>
			{sent ? (
				<div className="animate-fade-in space-y-5">
					<div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3">
						<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-contrast)]">
							<MailCheck className="h-4 w-4" />
						</span>
						<div className="min-w-0 space-y-1 text-sm">
							<p className="font-semibold text-[var(--text)]">
								{t("auth.reset.sent_title", { defaultValue: "Check your inbox" })}
							</p>
							<p className="leading-relaxed text-[var(--text-muted)]">
								{t("auth.reset.sent_hint", {
									defaultValue:
										"Follow the link in the email to choose a new password. It may take a few minutes to arrive.",
								})}
							</p>
						</div>
					</div>
					<Button
						type="button"
						variant="secondary"
						onClick={() => setSent(false)}
						className="w-full"
					>
						{t("auth.reset.resend", { defaultValue: "Use a different email" })}
					</Button>
				</div>
			) : (
				<form onSubmit={handleSubmit} className="animate-fade-in space-y-3">
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
					<AuthSubmitSection
						error={error}
						loading={isLoading}
						disabled={!isFormValid}
						loadingLabel={t("auth.reset.sending", { defaultValue: "Sending…" })}
						label={t("auth.reset.submit", { defaultValue: "Send reset link" })}
					/>
				</form>
			)}
			<AuthAltAction
				to="/auth/sign-in"
				label={t("auth.reset.back_to_sign_in", { defaultValue: "Back" })}
			/>
		</AuthShell>
	);
}
