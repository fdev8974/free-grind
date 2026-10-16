import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
	Ban,
	CalendarClock,
	ChevronRight,
	CircleCheck,
	Clock,
	Copy,
	Globe,
	Info,
	Loader2,
	ScrollText,
	ShieldAlert,
	type LucideIcon,
} from "lucide-react";
import toast from "react-hot-toast";
import { BotFilled, TagFilled } from "./icons/FilledIcons";
import { FullscreenPrompt, fullscreenPrimaryButtonClass, fullscreenSecondaryButtonClass } from "./FullscreenPrompt";
import { useAuth } from "../contexts/useAuth";
import type { AccountStatus } from "../contexts/auth-context";
import type { AppError } from "../types/api";
import { hourCycleOptions } from "../utils/timeFormat";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** `highlight` marks a value that needs the user's attention (accent color). */
type Detail = { icon: LucideIcon | ComponentType<{ className?: string }>; label: string; value: string; highlight?: boolean };

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

// Grindr documents Unix seconds; read anything this large as milliseconds.
function expiryMs(expiresAt: number): number {
	return expiresAt > 1e12 ? expiresAt : expiresAt * 1000;
}

function formatExpiry(expiresAt: number, language: string): string {
	return new Date(expiryMs(expiresAt)).toLocaleString(language, { dateStyle: "medium", timeStyle: "short", ...hourCycleOptions() });
}

/**
 * Whether a timed ban has run out, flipping to true at the expiry moment
 * while the prompt stays open. An unknown expiry counts as run out: Grindr
 * then decides whether the agreement can be accepted.
 */
function useTimedBanExpired(status: AccountStatus): boolean {
	const expiresAt =
		status?.kind === "restriction" && status.restriction.kind === "timedBan"
			? status.restriction.expiresAt
			: undefined;
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (expiresAt == null) return;
		const remaining = expiryMs(expiresAt) - Date.now();
		if (remaining <= 0) return;
		// setTimeout overflows past ~24.8 days; re-arming then is enough.
		const timer = window.setTimeout(() => setNow(Date.now()), Math.min(remaining + 500, 2 ** 31 - 1));
		return () => window.clearTimeout(timer);
	}, [expiresAt, now]);

	if (status?.kind !== "restriction" || status.restriction.kind !== "timedBan") return false;
	return expiresAt == null || expiryMs(expiresAt) <= now;
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
			icon: TagFilled,
			label: t("account_status.details.sub_reason", { defaultValue: "Sub-reason" }),
			value: humanize(subReason),
		});
	}
	if (automated != null) {
		rows.push({
			icon: BotFilled,
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
		icon: Info,
		label: t("account_status.details.reason", { defaultValue: "Reason" }),
		value: humanize(reason),
	};
}

function contentFor(status: AccountStatus, t: Translate, language: string, agreementPending: boolean) {
	if (status?.kind === "banned") {
		const { info } = status;
		const details: Detail[] = [
			{
				icon: Ban,
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
				icon: ShieldAlert,
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
			icon: Ban,
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
					icon: Globe,
					label: t("account_status.details.region", { defaultValue: "Region" }),
					value: region,
				});
			} else if (restriction.reason) {
				// Not a regional check (e.g. BANNED_USER, VERIFICATION_REQUESTED).
				details.push(reasonRow(restriction.reason, t));
			}
			return {
				icon: ShieldAlert,
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
					icon: CalendarClock,
					label: t("account_status.details.banned_until", { defaultValue: "Banned until" }),
					value: formatExpiry(restriction.expiresAt, language),
				});
			}
			if (restriction.agreementCompleted != null || agreementPending) {
				details.push({
					icon: ScrollText,
					label: t("account_status.details.ban_agreement", { defaultValue: "Ban agreement" }),
					value: restriction.agreementCompleted
						? t("account_status.details.agreement_accepted", { defaultValue: "Accepted" })
						: t("account_status.details.agreement_pending", { defaultValue: "Not accepted yet" }),
					highlight: !restriction.agreementCompleted,
				});
			}
			if (restriction.agreementCompleted) {
				return {
					icon: CircleCheck,
					title: t("account_status.timed_ban.agreement_completed_title", { defaultValue: "All Set" }),
					description: t("account_status.timed_ban.agreement_completed_description", {
						defaultValue: "You've accepted Grindr's ban agreement. There's nothing else you need to do.",
					}),
					details,
				};
			}
			if (agreementPending) {
				return {
					icon: Clock,
					title: t("account_status.timed_ban.expired_title", { defaultValue: "Agreement Required" }),
					description: t("account_status.timed_ban.expired_description", {
						defaultValue: "Accept Grindr's ban agreement to use this account again.",
					}),
					details,
				};
			}
			return {
				icon: Clock,
				title: t("account_status.timed_ban.title", { defaultValue: "Temporarily Banned" }),
				description: t("account_status.timed_ban.description", {
					defaultValue: "Grindr has temporarily banned this account. You can use it again once the ban expires.",
				}),
				details,
			};
		}
		// TRUST_VENDOR_REJECTED (free-form reason text) and anything unmodelled.
		return {
			icon: ShieldAlert,
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
	onAcceptBanAgreement,
}: {
	status: AccountStatus;
	onSignOut: () => void;
	onAcceptBanAgreement?: () => Promise<void>;
}) {
	const { t, i18n } = useTranslation();
	const timedBanExpired = useTimedBanExpired(status);
	const [accepting, setAccepting] = useState(false);
	// banDetails.isAgreementCompleted decides when Grindr says; only without
	// it does the ban's expiry stand in for it.
	const agreementCompleted =
		status?.kind === "restriction" && status.restriction.kind === "timedBan"
			? status.restriction.agreementCompleted
			: undefined;
	const agreementPending = agreementCompleted === false || (agreementCompleted == null && timedBanExpired);
	const content = contentFor(status, t, i18n.language, agreementPending);
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

	const acceptBanAgreement =
		agreementPending && onAcceptBanAgreement
			? () => {
					setAccepting(true);
					onAcceptBanAgreement()
						.then(() => toast.success(t("account_status.timed_ban.accept_success", { defaultValue: "Agreement accepted" })))
						.catch((error: unknown) => {
							const message = (error as Partial<AppError> | null)?.prettyMessage;
							toast.error(message || t("account_status.timed_ban.accept_failed", { defaultValue: "Couldn't accept the agreement" }));
						})
						.finally(() => setAccepting(false));
				}
			: null;

	return (
		<FullscreenPrompt
			icon={content.icon}
			title={content.title}
			description={content.description}
			footer={
				<>
					{acceptBanAgreement && (
						<button type="button" onClick={acceptBanAgreement} disabled={accepting} className={fullscreenPrimaryButtonClass}>
							{accepting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
							{t("account_status.timed_ban.accept", { defaultValue: "Accept & Continue" })}
							{accepting ? null : <ChevronRight className="h-4 w-4" />}
						</button>
					)}
					{copyDetails && (
						<button type="button" onClick={copyDetails} className={fullscreenSecondaryButtonClass}>
							<span className="inline-flex items-center justify-center gap-2">
								<Copy className="h-4 w-4" />
								{t("account_status.banned.copy_details", { defaultValue: "Copy Details" })}
							</span>
						</button>
					)}
					<button
						type="button"
						onClick={onSignOut}
						disabled={accepting}
						className={acceptBanAgreement ? fullscreenSecondaryButtonClass : fullscreenPrimaryButtonClass}
					>
						{t("account_status.sign_out", { defaultValue: "Sign Out" })}
					</button>
				</>
			}
		>
			{content.details.length > 0 && (
				<dl className="surface-card divide-y divide-[var(--border)] overflow-hidden text-left">
					{content.details.map(({ icon: Icon, label, value, highlight }) => (
						<div key={label} className="flex items-center gap-3 px-4 py-3.5">
							<div className="shrink-0 rounded-2xl bg-[var(--surface-2)] p-2.5 text-[var(--accent)]">
								<Icon className="h-5 w-5" />
							</div>
							<div className="min-w-0 flex-1">
								<dt className="text-xs text-[var(--text-muted)]">{label}</dt>
								<dd
									className={`mt-0.5 text-sm font-semibold leading-snug ${highlight ? "text-[var(--accent)]" : "text-[var(--text)]"}`}
								>
									{value}
								</dd>
							</div>
						</div>
					))}
				</dl>
			)}
		</FullscreenPrompt>
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
	const { accountStatus, logout, acceptBanAgreement } = useAuth();

	if (!accountStatus) {
		return <>{children}</>;
	}

	return (
		<div className="app-shell">
			<AccountStatusPromptView
				status={accountStatus}
				onSignOut={() => void logout()}
				onAcceptBanAgreement={acceptBanAgreement}
			/>
		</div>
	);
}
