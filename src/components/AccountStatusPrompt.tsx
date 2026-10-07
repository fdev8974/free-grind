import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Ban, Clock, ShieldAlert } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "../contexts/useAuth";
import type { AccountStatus } from "../contexts/auth-context";

type Translate = (key: string, options?: Record<string, unknown>) => string;

type Detail = { label: string; value: string };

/**
 * Grindr's codes ("DRUG_SALES") as readable text ("Drug sales"); anything
 * already written for people ("Drug Selling", free-form vendor text) is kept.
 */
function humanize(code: string): string {
	const trimmed = code.trim();
	if (!/^[A-Za-z0-9_]+$/.test(trimmed) || !trimmed.includes("_")) return trimmed;
	const words = trimmed.replace(/_+/g, " ").toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

function banKindLabel(kind: string, t: Translate): string {
	switch (kind) {
		case "profile":
			return t("account_status.ban_kinds.profile", { defaultValue: "Profile ban" });
		case "device":
			return t("account_status.ban_kinds.device", { defaultValue: "Device ban" });
		case "network":
			return t("account_status.ban_kinds.network", { defaultValue: "Network ban" });
		case "underage":
			return t("account_status.ban_kinds.underage", { defaultValue: "Underage" });
		default:
			return humanize(kind);
	}
}

function formatExpiry(expiresAt: number, language: string): string {
	// Grindr documents Unix seconds; read anything this large as milliseconds.
	const ms = expiresAt > 1e12 ? expiresAt : expiresAt * 1000;
	return new Date(ms).toLocaleString(language, { dateStyle: "medium", timeStyle: "short" });
}

function regionLabel(region: string, t: Translate): string | null {
	switch (region) {
		case "uk":
			return t("account_status.regions.uk", { defaultValue: "United Kingdom" });
		case "br":
			return t("account_status.regions.br", { defaultValue: "Brazil" });
		case "au":
			return t("account_status.regions.au", { defaultValue: "Australia" });
		case "us":
			return t("account_status.regions.us", { defaultValue: "United States" });
		default:
			return null;
	}
}

/** Rows shared by bans and timed bans: sub-reason and whether it was automatic. */
function banDetailRows(subReason: string | null | undefined, automated: boolean | null | undefined, t: Translate): Detail[] {
	const rows: Detail[] = [];
	if (subReason) {
		rows.push({
			label: t("account_status.details.sub_reason", { defaultValue: "Sub-reason" }),
			value: humanize(subReason),
		});
	}
	if (automated != null) {
		rows.push({
			label: t("account_status.details.automated", { defaultValue: "Automated" }),
			value: automated
				? t("account_status.details.yes", { defaultValue: "Yes" })
				: t("account_status.details.no", { defaultValue: "No" }),
		});
	}
	return rows;
}

function reasonRow(reason: string, t: Translate): Detail {
	return {
		label: t("account_status.details.reason", { defaultValue: "Reason" }),
		value: humanize(reason),
	};
}

function contentFor(status: AccountStatus, t: Translate, language: string) {
	if (status?.kind === "banned") {
		const { info } = status;
		const details: Detail[] = [
			{
				label: t("account_status.details.ban_type", { defaultValue: "Ban type" }),
				value: banKindLabel(info.kind, t),
			},
			...banDetailRows(info.subReason, info.automated, t),
		];
		// Code 28 (ACCOUNT_BANNED, a "device ban") is often not a ban at all:
		// Grindr refuses requests whose security headers/fingerprint it doesn't
		// trust this way. Signing out rotates the device identity, which is
		// usually what fixes it.
		if (info.kind === "device") {
			return {
				icon: <ShieldAlert className="h-9 w-9 text-[var(--accent)]" />,
				title: t("account_status.device_ban.title", { defaultValue: "Request Refused" }),
				description: t("account_status.device_ban.description", {
					defaultValue:
						"Grindr answered with ACCOUNT_BANNED (code 28). This is often not a real ban: Grindr blocked the request, for example because of the device fingerprint. Signing out creates a new device identity, which usually fixes it.",
				}),
				details,
			};
		}
		const reason = info.reason ? ` (${info.reason})` : "";
		return {
			icon: <Ban className="h-9 w-9 text-[var(--accent)]" />,
			title: t("account_status.banned.title", { defaultValue: "Account Banned" }),
			description: t("account_status.banned.description", {
				reason,
				defaultValue: "Grindr has banned this account{{reason}}. You can't sign in until the ban is lifted.",
			}),
			details,
		};
	}
	if (status?.kind === "restriction") {
		const { restriction } = status;
		if (restriction.kind === "ageVerification") {
			const details: Detail[] = [];
			const region = restriction.region ? regionLabel(restriction.region, t) : null;
			if (region) {
				details.push({
					label: t("account_status.details.region", { defaultValue: "Region" }),
					value: region,
				});
			} else if (restriction.reason) {
				// Not a regional check (e.g. BANNED_USER, VERIFICATION_REQUESTED).
				details.push(reasonRow(restriction.reason, t));
			}
			return {
				icon: <ShieldAlert className="h-9 w-9 text-[var(--accent)]" />,
				title: t("account_status.age_verification.title", { defaultValue: "Age Verification Required" }),
				description: t("account_status.age_verification.description", { defaultValue: "Grindr requires you to verify your age before continuing. Complete it in the official Grindr app, then sign in again. Free Grind does not bypass age verification." }),
				details,
			};
		}
		if (restriction.kind === "timedBan") {
			const details: Detail[] = [];
			if (restriction.reason) {
				details.push(reasonRow(restriction.reason, t));
			}
			details.push(...banDetailRows(restriction.subReason, restriction.automated, t));
			if (restriction.expiresAt != null) {
				details.push({
					label: t("account_status.details.banned_until", { defaultValue: "Banned until" }),
					value: formatExpiry(restriction.expiresAt, language),
				});
			}
			return {
				icon: <Clock className="h-9 w-9 text-[var(--accent)]" />,
				title: t("account_status.timed_ban.title", { defaultValue: "Temporarily Banned" }),
				description: t("account_status.timed_ban.description", {
					defaultValue: "Grindr has temporarily banned this account. You can use it again once the ban expires.",
				}),
				details,
			};
		}
		// TRUST_VENDOR_REJECTED (free-form reason text) and anything unmodelled.
		return {
			icon: <ShieldAlert className="h-9 w-9 text-[var(--accent)]" />,
			title: t("account_status.restricted.title", { defaultValue: "Account Restricted" }),
			description: t("account_status.restricted.description", { defaultValue: "Your account is currently restricted and can't be used. Check the official Grindr app for details." }),
			details: restriction.reason ? [reasonRow(restriction.reason, t)] : [],
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
	const { t, i18n } = useTranslation();
	const content = contentFor(status, t, i18n.language);
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
					{content.details.length > 0 && (
						<dl className="mt-5 w-full max-w-xs divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-left text-sm">
							{content.details.map((detail) => (
								<div key={detail.label} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
									<dt className="shrink-0 text-[var(--text-muted)]">{detail.label}</dt>
									<dd className="text-right font-medium text-[var(--text)]">{detail.value}</dd>
								</div>
							))}
						</dl>
					)}
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
