import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Ban, ShieldAlert } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "../contexts/useAuth";
import type { AccountStatus } from "../contexts/auth-context";

function contentFor(
	status: AccountStatus,
	t: (key: string, options?: Record<string, unknown>) => string,
) {
	if (status?.kind === "banned") {
		const reason = status.info.reason ? ` (${status.info.reason})` : "";
		return {
			icon: <Ban className="h-9 w-9 text-[var(--accent)]" />,
			title: t("account_status.banned.title", { defaultValue: "Account Banned" }),
			description: t("account_status.banned.description", {
				reason,
				defaultValue: "Grindr has banned this account{{reason}}. You can't sign in until the ban is lifted.",
			}),
		};
	}
	if (status?.kind === "restriction") {
		if (status.restriction.kind === "ageVerification") {
			return {
				icon: <ShieldAlert className="h-9 w-9 text-[var(--accent)]" />,
				title: t("account_status.age_verification.title", { defaultValue: "Age Verification Required" }),
				description: t("account_status.age_verification.description", { defaultValue: "Grindr requires you to verify your age before continuing. Complete it in the official Grindr app, then sign in again. Free Grind does not bypass age verification." }),
			};
		}
		return {
			icon: <ShieldAlert className="h-9 w-9 text-[var(--accent)]" />,
			title: t("account_status.restricted.title", { defaultValue: "Account Restricted" }),
			description: t("account_status.restricted.description", { defaultValue: "Your account is currently restricted and can't be used. Check the official Grindr app for details." }),
		};
	}
	return null;
}

export function AccountStatusPromptView({
	status,
	onSignOut,
}: {
	status: AccountStatus;
	onSignOut: () => void;
}) {
	const { t } = useTranslation();
	const content = contentFor(status, t);
	if (!content) {
		return null;
	}

	const copyDetails =
		status?.kind === "banned"
			? () => {
					navigator.clipboard
						.writeText(JSON.stringify(status.info, null, 2))
						.then(() => toast.success(t("account_status.banned.copy_details_success", { defaultValue: "Details copied to clipboard" })))
						.catch(() => {});
				}
			: null;

	return (
		<div className="fs-card-outer fs-card-overlay z-[110] no-touch-callout">
			<div className="fs-card-inner fs-card-lg flex flex-col">
				<div
					className="flex flex-1 flex-col items-center justify-center px-8 text-center"
					style={{
						paddingTop: "max(48px, env(safe-area-inset-top))",
						paddingBottom: "max(24px, env(safe-area-inset-bottom))",
					}}
				>
					<div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-[var(--surface-2)] border border-[var(--border)]">
						{content.icon}
					</div>
					<h1 className="text-2xl font-bold text-[var(--text)]">{content.title}</h1>
					<p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--text-muted)]">
						{content.description}
					</p>
				</div>

				<div
					className="flex h-44 shrink-0 flex-col justify-end gap-2 px-6"
					style={{ paddingBottom: "max(28px, calc(env(safe-area-inset-bottom) + 12px))" }}
				>
					{copyDetails && (
						<button
							type="button"
							onClick={copyDetails}
							className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] py-3.5 text-sm font-semibold text-[var(--text)] transition hover:brightness-110"
						>
							{t("account_status.banned.copy_details", { defaultValue: "Copy Details" })}
						</button>
					)}
					<button
						type="button"
						onClick={onSignOut}
						className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] py-3.5 text-sm font-semibold text-[var(--accent-contrast)] transition hover:brightness-110"
					>
						{t("account_status.sign_out", { defaultValue: "Sign Out" })}
					</button>
				</div>
			</div>
		</div>
	);
}

/**
 * Gates the routed app behind a full-page "account banned / restricted"
 * prompt — same pattern and slot in the tree as TokenExpiredGate, checked
 * first (a banned/restricted account is a harder block than a merely
 * expired token). Driven by AuthContext's accountStatus, set from a login
 * result's restriction field, the account_restriction check at startup, or
 * an asynchronous auth:banned event pushed mid-session.
 */
export function AccountStatusGate({ children }: { children: ReactNode }) {
	const { accountStatus, logout } = useAuth();

	if (!accountStatus) {
		return <>{children}</>;
	}

	return (
		<div className="app-shell">
			<AccountStatusPromptView status={accountStatus} onSignOut={() => void logout()} />
		</div>
	);
}
