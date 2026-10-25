import { Fragment, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
	Ban,
	Check,
	ChevronRight,
	CircleCheck,
	Clock,
	Copy,
	ExternalLink,
	Globe,
	Info,
	Loader2,
	LogOut,
	ScrollText,
	ShieldAlert,
	ShieldOff,
	Wifi,
	type LucideIcon,
} from "lucide-react";
import toast from "react-hot-toast";
import { BotFilled, ClockFilled, UserFilled } from "./icons/FilledIcons";
import { FullscreenPrompt, fullscreenPrimaryButtonClass, fullscreenSecondaryButtonClass, fullscreenCardClass } from "./FullscreenPrompt";
import { CardDetailsSheet, GuidelineBlock, RichText } from "./GuidelineViolationParts";
import { useAuth } from "../contexts/useAuth";
import { useLogoutToNextAccount } from "../hooks/useLogoutToNextAccount";
import type { AccountStatus } from "../contexts/auth-context";
import type { AppError } from "../types/api";
import { hourCycleOptions } from "../utils/timeFormat";
import { banOffersAppeal, banReasonText, openBanAppeal, openCommunityGuidelines, type BanReasonText } from "../utils/guidelineViolations";

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
	permanent: boolean;
	/** Whether Grindr takes an appeal for this ban (web.grindr.com/ban-appeal). */
	appealable: boolean;
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
	/** Device/network blocks: what happened and what to try, styled like the reason card. */
	block?: BlockInfo;
};

type BlockInfo = {
	code: number;
	title: string;
	text: string;
	/** Things to try, each a meta row under the text. */
	fixes: { icon: ComponentType<{ className?: string }>; text: string }[];
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
		permanent,
		// Appeal eligibility is decided by the sub-reason (the first code).
		appealable: banOffersAppeal(codes[0], permanent),
	};
}

function contentFor(status: AccountStatus, t: Translate, agreementPending: boolean): PromptContent | null {
	if (status?.kind === "banned") {
		const { info } = status;
		// Codes 28 (device) and 31 (SUSPICIOUS_NETWORK) block where the request
		// comes from, not the account for something it did: no guideline
		// reason, appeal or subscription note. Raw details stay behind Copy.
		// Code 28 is often not a ban at all: Grindr refuses requests whose
		// security headers/fingerprint it doesn't trust this way. Signing out
		// rotates the device identity, which is usually what fixes it.
		if (info.kind === "device") {
			return {
				icon: ShieldAlert,
				title: t("account_status.device_ban.title", { defaultValue: "Device Blocked" }),
				description: t("account_status.device_ban.description", { defaultValue: "You can't use your account on this device right now." }),
				details: [],
				block: {
					code: info.code,
					title: t("account_status.device_ban.card_title", { defaultValue: "Often not a real ban" }),
					text: t("account_status.device_ban.card_text", {
						defaultValue:
							"Grindr answered with ACCOUNT_BANNED, which it also sends for requests it doesn't trust, for example because of the device fingerprint.",
					}),
					fixes: [
						{
							icon: LogOut,
							text: t("account_status.device_ban.fix_sign_out", {
								defaultValue: "Signing out creates a new device identity, which usually fixes it.",
							}),
						},
					],
				},
			};
		}
		if (info.kind === "network") {
			return {
				icon: Globe,
				title: t("account_status.network_ban.title", { defaultValue: "Network Blocked" }),
				description: t("account_status.network_ban.description", { defaultValue: "You can't sign in from the network you're on right now." }),
				details: [],
				block: {
					code: info.code,
					title: t("account_status.network_ban.card_title", { defaultValue: "Suspicious network" }),
					text: t("account_status.network_ban.card_text", {
						defaultValue: "Grindr flags VPNs, proxies, and shared IP addresses this way. Your account itself isn't banned.",
					}),
					fixes: [
						{ icon: ShieldOff, text: t("account_status.network_ban.fix_vpn", { defaultValue: "Turn off your VPN or proxy." }) },
						{
							icon: Wifi,
							text: t("account_status.network_ban.fix_switch", {
								defaultValue: "Switch between Wi-Fi and mobile data, then sign in again.",
							}),
						},
					],
				},
			};
		}
		const underage = info.kind === "underage";
		return {
			icon: Ban,
			title: underage
				? t("account_status.underage_ban.title", { defaultValue: "Underage Account" })
				: t("account_status.banned.title", { defaultValue: "Account Banned" }),
			// The reason card names the reason, so the description doesn't.
			description: underage
				? t("account_status.underage_ban.description", {
						defaultValue: "You can't sign in until the ban is lifted. If you're 18 or older, appeal it to confirm your age.",
					})
				: t("account_status.banned.description", {
						reason: "",
						defaultValue: "Grindr has banned this account{{reason}}. You can't sign in until the ban is lifted.",
					}),
			details: [],
			// An underage ban without a sub-reason still gets the underage explanation.
			ban: banSummary(banKindLabel(info.kind, t), [info.subReason, info.reason, underage ? "UNDERAGE" : null], info.automated, true, t),
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

const INLINE_LINK_CLASS =
	"inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition hover:text-[var(--text)] active:scale-95";

const CARD_LABEL_CLASS = "text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]";

const META_ROW_CLASS = "flex items-start gap-2 text-xs leading-relaxed text-[var(--text-muted)]";
const META_ICON_CLASS = "mt-px h-4 w-4 shrink-0 text-[var(--accent)]";

/** A device/network block, laid out like ReasonCard: what happened, then what to try. */
function BlockCard({ block }: { block: BlockInfo }) {
	const { t } = useTranslation();
	return (
		<section className={`${fullscreenCardClass} px-4 py-4 text-left`}>
			<div className="flex items-center justify-between gap-3">
				<p className={CARD_LABEL_CLASS}>{t("account_status.what_happened", { defaultValue: "What happened" })}</p>
				<span className="shrink-0 rounded-full ink-tint-8 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--text-muted)]">
					{t("account_status.code_chip", { code: block.code, defaultValue: "Code {{code}}" })}
				</span>
			</div>
			<h2 className="mt-1.5 text-base font-semibold leading-snug text-[var(--text)]">{block.title}</h2>
			<p className="mt-1.5 text-sm leading-relaxed text-[var(--text-muted)]">{block.text}</p>
			{block.fixes.length > 0 ? (
				<div className="mt-3 flex flex-col gap-1.5">
					{block.fixes.map(({ icon: Icon, text }) => (
						<p key={text} className={META_ROW_CLASS}>
							<Icon className={META_ICON_CLASS} />
							{text}
						</p>
					))}
				</div>
			) : null}
		</section>
	);
}

/**
 * The ban's reason with its type chip, then meta rows (time left on a
 * running timed ban, who decided it) and the long explanation behind
 * "Learn more". Once a timed ban is over the prompt's title says so, so
 * there's no countdown then.
 */
function ReasonCard({ ban, expiresAt, now }: { ban: BanSummary; expiresAt?: number | null; now: number }) {
	const { t, i18n } = useTranslation();
	const { explanation } = ban;
	const title = explanation?.title ?? ban.fallbackTitle;
	const remaining = expiresAt != null ? expiryMs(expiresAt) - now : 0;

	return (
		<section className={`${fullscreenCardClass} overflow-hidden text-left`}>
			<div className="px-4 py-4">
				<div className="flex items-center justify-between gap-3">
					<p className={CARD_LABEL_CLASS}>{t("account_status.reason_label", { defaultValue: "Ban reason" })}</p>
					<span className="shrink-0 rounded-full ink-tint-8 px-2.5 py-0.5 text-[11px] font-semibold text-[var(--text-muted)]">
						{ban.kind}
					</span>
				</div>
				<h2 className="mt-1.5 text-base font-semibold leading-snug text-[var(--text)]">
					{title ?? t("account_status.reason_unknown", { defaultValue: "No reason given" })}
				</h2>
				{explanation ? <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-muted)]">{explanation.summary}</p> : null}
				{remaining > 0 || ban.automated != null ? (
					<div className="mt-3 flex flex-col gap-1.5">
						{expiresAt != null && remaining > 0 ? (
							<p className={META_ROW_CLASS}>
								<ClockFilled className={META_ICON_CLASS} />
								<span>
									<span className="font-semibold tabular-nums text-[var(--text)]">
										{t("account_status.ends_in", {
											time: formatRemaining(remaining, i18n.language),
											defaultValue: "Ends in {{time}}",
										})}
									</span>
									{" · "}
									{formatExpiry(expiresAt, i18n.language)}
								</span>
							</p>
						) : null}
						{ban.automated != null ? (
							<p className={META_ROW_CLASS}>
								{ban.automated ? <BotFilled className={META_ICON_CLASS} /> : <UserFilled className={META_ICON_CLASS} />}
								{ban.automated
									? t("account_status.details.decision_automated", { defaultValue: "We have used automated measures in making this decision." })
									: t("account_status.details.decision_human", {
											defaultValue: "A human moderator made this decision. We did not use automated measures.",
										})}
							</p>
						) : null}
					</div>
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
		<dl className={`${fullscreenCardClass} divide-y divide-[var(--border)] overflow-hidden text-left`}>
			{details.map(({ icon: Icon, label, value }) => (
				<div key={label} className="flex items-center gap-3 px-4 py-3.5">
					<div className="shrink-0 rounded-2xl ink-tint-8 p-2.5 text-[var(--accent)]">
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
			className={`flex cursor-pointer items-start gap-3 rounded-2xl px-4 py-3.5 text-left transition active:scale-[0.99] ${checked ? "accent-tint-18" : "ink-tint-12 hover:ink-tint-16"}`}
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
	// A permanent ban has nothing else to do, so its appeal is the main
	// button; a timed ban keeps Accept there and offers it as a link.
	const appealButton = !!content.ban?.appealable && content.ban.permanent;
	const appealLink = !!content.ban?.appealable && !content.ban.permanent;

	const links: { key: string; icon: LucideIcon; label: string; onClick: () => void }[] = [];
	if (appealLink) {
		links.push({ key: "appeal", icon: ExternalLink, label: t("account_status.appeal_link", { defaultValue: "Appeal" }), onClick: openBanAppeal });
	}
	if (showGuidelines) {
		links.push({
			key: "guidelines",
			icon: ExternalLink,
			label: t("account_status.read_guidelines", { defaultValue: "Community guidelines" }),
			onClick: openCommunityGuidelines,
		});
	}
	if (copyDetails) {
		links.push({ key: "copy", icon: Copy, label: t("account_status.banned.copy_details", { defaultValue: "Copy details" }), onClick: copyDetails });
	}

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

	const hasBody =
		content.details.length > 0 || !!content.ban || !!content.block || !!acceptBanAgreement || links.length > 0;

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
					{appealButton && (
						<button type="button" onClick={openBanAppeal} className={fullscreenPrimaryButtonClass}>
							{t("account_status.banned.appeal", { defaultValue: "Appeal Ban" })}
							<ExternalLink className="h-4 w-4" />
						</button>
					)}
					<button
						type="button"
						onClick={onSignOut}
						disabled={accepting}
						className={acceptBanAgreement || appealButton ? fullscreenSecondaryButtonClass : fullscreenPrimaryButtonClass}
					>
						{t("account_status.sign_out", { defaultValue: "Sign Out" })}
					</button>
				</>
			}
		>
			{hasBody ? (
				<div className="flex flex-col gap-3">
					{content.ban ? <ReasonCard ban={content.ban} expiresAt={content.expiresAt} now={now} /> : null}
					{content.block ? <BlockCard block={content.block} /> : null}
					{content.details.length > 0 ? <DetailList details={content.details} /> : null}
					{content.subscriptionNote ? (
						<p className="px-2 text-center text-xs leading-relaxed text-[var(--text-muted)]">
							{t("account_status.banned.subscriptions_description", {
								defaultValue: "A ban doesn't cancel a Grindr subscription. If you have one, cancel it in your app store's subscription settings.",
							})}
						</p>
					) : null}
					{links.length > 0 ? (
						<div className="flex flex-wrap items-center justify-center gap-x-1 text-xs font-medium text-[var(--text-muted)]">
							{links.map(({ key, icon: Icon, label, onClick }, index) => (
								<Fragment key={key}>
									{index > 0 ? <span aria-hidden>·</span> : null}
									<button type="button" onClick={onClick} className={INLINE_LINK_CLASS}>
										<Icon className="h-3.5 w-3.5" />
										{label}
									</button>
								</Fragment>
							))}
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
