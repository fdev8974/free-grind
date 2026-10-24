import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
	Ban,
	Check,
	ChevronRight,
	CircleCheck,
	Clock,
	Copy,
	CreditCard,
	ExternalLink,
	Globe,
	Info,
	Loader2,
	ScrollText,
	ShieldAlert,
	type LucideIcon,
} from "lucide-react";
import toast from "react-hot-toast";
import { BotFilled, TagFilled, UserFilled } from "./icons/FilledIcons";
import { FullscreenPrompt, fullscreenPrimaryButtonClass, fullscreenSecondaryButtonClass } from "./FullscreenPrompt";
import { CardDetailsSheet, GuidelineBlock, RichText } from "./GuidelineViolationParts";
import { useAuth } from "../contexts/useAuth";
import { useLogoutToNextAccount } from "../hooks/useLogoutToNextAccount";
import type { AccountStatus } from "../contexts/auth-context";
import type { AppError } from "../types/api";
import { hourCycleOptions } from "../utils/timeFormat";
import { banReasonText, openCommunityGuidelines, type BanReasonText } from "../utils/guidelineViolations";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** A plain label/value row, for the prompts that aren't guideline bans (device ban, age check, ...). */
type Detail = { icon: LucideIcon | ComponentType<{ className?: string }>; label: string; value: string };

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

/** "2d 4h" / "4h 12m" / "12m": the two largest units, localized. */
function formatRemaining(ms: number, language: string): string {
	const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
	const days = Math.floor(totalMinutes / 1440);
	const hours = Math.floor((totalMinutes % 1440) / 60);
	const minutes = totalMinutes % 60;
	const unit = (value: number, name: "day" | "hour" | "minute") =>
		new Intl.NumberFormat(language, { style: "unit", unit: name, unitDisplay: "narrow" }).format(value);
	if (days > 0) return hours > 0 ? `${unit(days, "day")} ${unit(hours, "hour")}` : unit(days, "day");
	if (hours > 0) return minutes > 0 ? `${unit(hours, "hour")} ${unit(minutes, "minute")}` : unit(hours, "hour");
	return unit(minutes, "minute");
}

/**
 * Current time for a running timed ban: ticks every minute (for the
 * countdown) and right at the expiry moment, so the prompt flips to the
 * agreement step while it stays open.
 */
function useTimedBanNow(status: AccountStatus): number {
	const expiresAt =
		status?.kind === "restriction" && status.restriction.kind === "timedBan"
			? status.restriction.expiresAt
			: undefined;
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (expiresAt == null) return;
		const remaining = expiryMs(expiresAt) - Date.now();
		if (remaining <= 0) return;
		const timer = window.setTimeout(() => setNow(Date.now()), Math.min(remaining + 500, 60_000));
		return () => window.clearTimeout(timer);
	}, [expiresAt, now]);

	return now;
}

/** An unknown expiry counts as run out: Grindr then decides whether the agreement can be accepted. */
function timedBanExpired(status: AccountStatus, now: number): boolean {
	if (status?.kind !== "restriction" || status.restriction.kind !== "timedBan") return false;
	const { expiresAt } = status.restriction;
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

function reasonRow(reason: string, t: Translate): Detail {
	return {
		icon: Info,
		label: t("account_status.details.reason", { defaultValue: "Reason" }),
		value: humanize(reason),
	};
}

/** What a guideline ban (permanent or timed) shows in its reason card. */
type BanSummary = {
	/** Ban type chip, e.g. "Profile ban" / "Temporary ban". */
	kind: string;
	/** Known explanation, or null when only the raw code is available. */
	explanation: BanReasonText | null;
	/** The raw code, readable, when there's no explanation for it. */
	fallbackTitle: string | null;
	automated: boolean | null;
};

type PromptContent = {
	icon: LucideIcon;
	title: string;
	description: string;
	details: Detail[];
	ban?: BanSummary;
	/** Timed bans: when the suspension ends. */
	expiresAt?: number | null;
	/** Permanent bans: a ban doesn't cancel a store subscription. */
	subscriptionNote?: boolean;
};

function banSummary(
	kind: string,
	codes: (string | null | undefined)[],
	automated: boolean | null | undefined,
	permanent: boolean,
	t: Translate,
): BanSummary {
	const explanation = banReasonText(codes, permanent, t);
	const rawCode = codes.find((code): code is string => !!code);
	return {
		kind,
		explanation,
		fallbackTitle: !explanation && rawCode ? humanize(rawCode) : null,
		automated: automated ?? null,
	};
}

function contentFor(status: AccountStatus, t: Translate, agreementPending: boolean): PromptContent | null {
	if (status?.kind === "banned") {
		const { info } = status;
		// Code 28 (ACCOUNT_BANNED, a "device ban") is often not a ban at all:
		// Grindr refuses requests whose security headers/fingerprint it doesn't
		// trust this way. Signing out rotates the device identity, which is
		// usually what fixes it.
		if (info.kind === "device") {
			const details: Detail[] = [
				{
					icon: Ban,
					label: t("account_status.details.ban_type", { defaultValue: "Ban type" }),
					value: banKindLabel(info.kind, t),
				},
			];
			if (info.reason) details.push(reasonRow(info.reason, t));
			if (info.subReason) {
				details.push({
					icon: TagFilled,
					label: t("account_status.details.sub_reason", { defaultValue: "Sub-reason" }),
					value: humanize(info.subReason),
				});
			}
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
		return {
			icon: Ban,
			title: t("account_status.banned.title", { defaultValue: "Account Banned" }),
			// The reason card names the reason, so the description doesn't.
			description: t("account_status.banned.description", {
				reason: "",
				defaultValue: "Grindr has banned this account{{reason}}. You can't sign in until the ban is lifted.",
			}),
			details: [],
			ban: banSummary(banKindLabel(info.kind, t), [info.subReason, info.reason], info.automated, true, t),
			subscriptionNote: true,
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
			const shared = {
				details: [],
				ban: banSummary(
					t("account_status.ban_kinds.timed", { defaultValue: "Temporary ban" }),
					[restriction.subReason, restriction.reason],
					restriction.automated,
					false,
					t,
				),
				expiresAt: restriction.expiresAt,
			};
			if (restriction.agreementCompleted) {
				return {
					icon: CircleCheck,
					title: t("account_status.timed_ban.agreement_completed_title", { defaultValue: "All Set" }),
					description: t("account_status.timed_ban.agreement_completed_description", {
						defaultValue: "You've accepted Grindr's ban agreement. There's nothing else you need to do.",
					}),
					...shared,
				};
			}
			if (agreementPending) {
				return {
					icon: ScrollText,
					title: t("account_status.timed_ban.expired_title", { defaultValue: "Agreement Required" }),
					description: t("account_status.timed_ban.expired_description", {
						defaultValue: "Your suspension is over. Review why it happened and agree to Grindr's guidelines to use this account again.",
					}),
					...shared,
				};
			}
			return {
				icon: Clock,
				title: t("account_status.timed_ban.title", { defaultValue: "Temporarily Banned" }),
				description: t("account_status.timed_ban.description", {
					defaultValue: "Grindr has temporarily suspended this account. You can use it again once the suspension ends.",
				}),
				...shared,
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

const CARD_LABEL_CLASS = "text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]";

/** Big countdown to the end of a timed ban, or that it's over. */
function CountdownCard({ expiresAt, now }: { expiresAt: number; now: number }) {
	const { t, i18n } = useTranslation();
	const remaining = expiryMs(expiresAt) - now;
	const date = formatExpiry(expiresAt, i18n.language);
	const running = remaining > 0;

	return (
		<section className="surface-card flex items-center gap-4 px-4 py-4 text-left">
			<div
				className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
					running ? "bg-[var(--surface-2)] text-[var(--accent)]" : "bg-[var(--accent)] text-[var(--accent-contrast)]"
				}`}
			>
				{running ? <Clock className="h-6 w-6" /> : <Check className="h-6 w-6" strokeWidth={2.5} />}
			</div>
			<div className="min-w-0 flex-1">
				<p className={CARD_LABEL_CLASS}>
					{running
						? t("account_status.countdown.remaining", { defaultValue: "Remaining" })
						: t("account_status.countdown.ended_title", { defaultValue: "Suspension over" })}
				</p>
				{running ? (
					<p className="mt-0.5 text-2xl font-bold tabular-nums leading-tight text-[var(--text)]">
						{formatRemaining(remaining, i18n.language)}
					</p>
				) : null}
				<p className={`text-xs text-[var(--text-muted)] ${running ? "mt-0.5" : "mt-1"}`}>
					{running
						? t("account_status.countdown.until", { date, defaultValue: "Until {{date}}" })
						: t("account_status.countdown.ended_on", { date, defaultValue: "Ended {{date}}" })}
				</p>
			</div>
		</section>
	);
}

/** The ban's reason with its type chip, who decided it, and the long explanation behind "Learn more". */
function ReasonCard({ ban }: { ban: BanSummary }) {
	const { t } = useTranslation();
	const { explanation } = ban;
	const title = explanation?.title ?? ban.fallbackTitle;

	return (
		<section className="surface-card overflow-hidden text-left">
			<div className="px-4 py-4">
				<div className="flex items-center justify-between gap-3">
					<p className={CARD_LABEL_CLASS}>{t("account_status.reason_label", { defaultValue: "Ban reason" })}</p>
					<span className="shrink-0 rounded-full bg-[var(--surface-2)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--text-muted)]">
						{ban.kind}
					</span>
				</div>
				<h2 className="mt-1.5 text-base font-semibold leading-snug text-[var(--text)]">
					{title ?? t("account_status.reason_unknown", { defaultValue: "No reason given" })}
				</h2>
				{explanation ? <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-muted)]">{explanation.summary}</p> : null}
				{ban.automated != null ? (
					<p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-[var(--text-muted)]">
						{ban.automated ? (
							<BotFilled className="mt-px h-4 w-4 shrink-0 text-[var(--accent)]" />
						) : (
							<UserFilled className="mt-px h-4 w-4 shrink-0 text-[var(--accent)]" />
						)}
						{ban.automated
							? t("account_status.details.decision_automated", { defaultValue: "We have used automated measures in making this decision." })
							: t("account_status.details.decision_human", {
									defaultValue: "A human moderator made this decision. We did not use automated measures.",
								})}
					</p>
				) : null}
			</div>
			{explanation && (explanation.details || explanation.guideline) ? (
				<CardDetailsSheet label={t("account_status.learn_more", { defaultValue: "Learn more" })} title={explanation.title}>
					{explanation.details ? <RichText text={explanation.details} /> : null}
					{explanation.guideline ? <GuidelineBlock guideline={explanation.guideline} /> : null}
				</CardDetailsSheet>
			) : null}
		</section>
	);
}

function DetailList({ details }: { details: Detail[] }) {
	return (
		<dl className="surface-card divide-y divide-[var(--border)] overflow-hidden text-left">
			{details.map(({ icon: Icon, label, value }) => (
				<div key={label} className="flex items-center gap-3 px-4 py-3.5">
					<div className="shrink-0 rounded-2xl bg-[var(--surface-2)] p-2.5 text-[var(--accent)]">
						<Icon className="h-5 w-5" />
					</div>
					<div className="min-w-0 flex-1">
						<dt className="text-xs text-[var(--text-muted)]">{label}</dt>
						<dd className="mt-0.5 text-sm font-semibold leading-snug text-[var(--text)]">{value}</dd>
					</div>
				</div>
			))}
		</dl>
	);
}

/** "I've read the guidelines" checkbox that unlocks accepting the ban agreement. */
function AgreementCheckbox({ checked, onChange, disabled }: { checked: boolean; onChange: (checked: boolean) => void; disabled: boolean }) {
	const { t } = useTranslation();
	return (
		<label
			className={`surface-card flex cursor-pointer items-start gap-3 px-4 py-3.5 text-left transition hover:bg-[var(--surface-2)] ${checked ? "ring-1 ring-[var(--accent)]" : ""}`}
		>
			<input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
			<span
				aria-hidden
				className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition ${
					checked ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]" : "border-[var(--border)]"
				}`}
			>
				{checked ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
			</span>
			<span className="min-w-0 flex-1">
				<span className="block text-sm font-semibold leading-snug text-[var(--text)]">
					{checked
						? t("account_status.timed_ban.agreed_label", { defaultValue: "Read and agreed to guidelines" })
						: t("account_status.timed_ban.agree_label", { defaultValue: "Read and agree to guidelines" })}
				</span>
				<span className="mt-0.5 block text-xs leading-relaxed text-[var(--text-muted)]">
					{t("account_status.timed_ban.agree_hint", {
						defaultValue: "Read and agree to the guidelines above to gain access to your account.",
					})}
				</span>
			</span>
		</label>
	);
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
	const { t } = useTranslation();
	const now = useTimedBanNow(status);
	const [accepting, setAccepting] = useState(false);
	const [agreed, setAgreed] = useState(false);
	// banDetails.isAgreementCompleted decides when Grindr says; only without
	// it does the ban's expiry stand in for it.
	const agreementCompleted =
		status?.kind === "restriction" && status.restriction.kind === "timedBan"
			? status.restriction.agreementCompleted
			: undefined;
	const agreementPending = agreementCompleted === false || (agreementCompleted == null && timedBanExpired(status, now));
	const content = contentFor(status, t, agreementPending);
	if (!content) {
		return null;
	}

	const rawDetails =
		status?.kind === "banned" ? status.info : status?.kind === "restriction" && status.restriction.kind === "timedBan" ? status.restriction : null;
	const copyDetails = rawDetails
		? () => {
				navigator.clipboard
					.writeText(JSON.stringify(rawDetails, null, 2))
					.then(() => toast.success(t("account_status.banned.copy_details_success", { defaultValue: "Details copied to clipboard" })))
					.catch(() => {});
			}
		: null;

	// Real bans are guideline violations; a device ban or age check is not.
	const showGuidelines = !!content.ban;

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

	const hasBody = content.details.length > 0 || !!content.ban || content.expiresAt != null || !!acceptBanAgreement;

	return (
		<FullscreenPrompt
			icon={content.icon}
			title={content.title}
			description={content.description}
			footer={
				<>
					{acceptBanAgreement && (
						<button
							type="button"
							onClick={acceptBanAgreement}
							disabled={accepting || !agreed}
							className={fullscreenPrimaryButtonClass}
						>
							{accepting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
							{t("account_status.timed_ban.accept", { defaultValue: "Accept & Continue" })}
							{accepting ? null : <ChevronRight className="h-4 w-4" />}
						</button>
					)}
					<div className="flex gap-2">
						{showGuidelines && (
							<button type="button" onClick={openCommunityGuidelines} className={fullscreenSecondaryButtonClass}>
								<span className="inline-flex items-center justify-center gap-2">
									<ExternalLink className="h-4 w-4" />
									{t("account_status.read_guidelines", { defaultValue: "Guidelines" })}
								</span>
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
					</div>
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
			{hasBody ? (
				<div className="flex flex-col gap-3">
					{content.expiresAt != null ? <CountdownCard expiresAt={content.expiresAt} now={now} /> : null}
					{content.ban ? <ReasonCard ban={content.ban} /> : null}
					{content.details.length > 0 ? <DetailList details={content.details} /> : null}
					{content.subscriptionNote ? (
						<div className="flex items-start gap-3 rounded-2xl bg-[var(--surface-2)] px-4 py-3 text-left">
							<CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
							<p className="text-xs leading-relaxed text-[var(--text-muted)]">
								<span className="font-semibold text-[var(--text)]">
									{t("account_status.banned.subscriptions_title", { defaultValue: "Payments and subscriptions" })}
								</span>{" "}
								{t("account_status.banned.subscriptions_description", {
									defaultValue: "A ban doesn't cancel a Grindr subscription. If you have one, cancel it in your app store's subscription settings.",
								})}
							</p>
						</div>
					) : null}
					{acceptBanAgreement ? <AgreementCheckbox checked={agreed} onChange={setAgreed} disabled={accepting} /> : null}
				</div>
			) : null}
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
	const { accountStatus, acceptBanAgreement } = useAuth();
	const logoutToNextAccount = useLogoutToNextAccount();

	if (!accountStatus) {
		return <>{children}</>;
	}

	return (
		<div className="app-shell">
			<AccountStatusPromptView
				status={accountStatus}
				onSignOut={() => void logoutToNextAccount().catch(() => {})}
				onAcceptBanAgreement={acceptBanAgreement}
			/>
		</div>
	);
}
