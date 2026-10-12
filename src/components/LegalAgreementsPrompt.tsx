import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, ExternalLink, FileText, Loader2, ScrollText, ShieldCheck, type LucideIcon } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { FullscreenPrompt, fullscreenPrimaryButtonClass, fullscreenSecondaryButtonClass } from "./FullscreenPrompt";
import {
	isLegalVersionOutdated,
	useAcceptLegalAgreements,
	useAcceptedLegalAgreements,
	useLegalAgreementsInfo,
} from "../hooks/queries/useLegalAgreementQueries";
import { appLog } from "../utils/logger";
import { SHOW_LEGAL_AGREEMENTS_EVENT } from "../utils/legalAgreementsDebug";

function openExternal(url: string) {
	openUrl(url).catch(() => window.open(url, "_blank"));
}

function PolicyRow({
	icon: Icon,
	title,
	outdated,
	acceptedAt,
	url,
}: {
	icon: LucideIcon;
	title: string;
	outdated: boolean;
	acceptedAt: number | null;
	url: string;
}) {
	const { t, i18n } = useTranslation();
	return (
		<button
			type="button"
			onClick={() => openExternal(url)}
			className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-[var(--surface-2)]"
		>
			<div className="shrink-0 rounded-2xl bg-[var(--surface-2)] p-2.5 text-[var(--accent)]">
				<Icon className="h-5 w-5" />
			</div>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-semibold leading-snug text-[var(--text)]">{title}</p>
				<p className={`mt-0.5 text-xs ${outdated ? "font-medium text-[var(--accent)]" : "text-[var(--text-muted)]"}`}>
					{outdated
						? t("legal_agreements.updated", { defaultValue: "New version available" })
						: acceptedAt
							? t("legal_agreements.accepted_on", {
									defaultValue: "Accepted on {{date}}",
									date: new Date(acceptedAt).toLocaleDateString(i18n.language, {
										day: "2-digit",
										month: "2-digit",
										year: "numeric",
									}),
								})
							: t("legal_agreements.up_to_date", { defaultValue: "Already accepted" })}
				</p>
			</div>
			<span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[var(--text-muted)]">
				{t("legal_agreements.read", { defaultValue: "Read" })}
				<ExternalLink className="h-3.5 w-3.5" />
			</span>
		</button>
	);
}

/**
 * Compares the user's accepted ToS / Privacy Policy versions against the
 * latest published ones on login and, when either is missing or outdated,
 * replaces the app with a full-page prompt until they're accepted.
 */
export function LegalAgreementsGate({ userId, children }: { userId: number; children: ReactNode }) {
	const { t } = useTranslation();
	// Set by the developer settings entry to show the prompt even when up to date.
	const [forced, setForced] = useState(false);

	const { data: info } = useLegalAgreementsInfo();
	const { data: accepted } = useAcceptedLegalAgreements(userId);
	const acceptMutation = useAcceptLegalAgreements(userId);

	useEffect(() => {
		const handleShow = () => setForced(true);
		window.addEventListener(SHOW_LEGAL_AGREEMENTS_EVENT, handleShow);
		return () => window.removeEventListener(SHOW_LEGAL_AGREEMENTS_EVENT, handleShow);
	}, []);

	if (!info || !accepted) {
		return <>{children}</>;
	}

	const tosOutdated = isLegalVersionOutdated(accepted.termsOfServiceVersion, info.latestTermsOfServiceVersion);
	const privacyOutdated = isLegalVersionOutdated(accepted.privacyPolicyVersion, info.latestPrivacyPolicyVersion);
	if (!forced && !tosOutdated && !privacyOutdated) {
		return <>{children}</>;
	}

	const handleAccept = async () => {
		try {
			await acceptMutation.mutateAsync({
				termsOfServiceVersion: info.latestTermsOfServiceVersion,
				privacyPolicyVersion: info.latestPrivacyPolicyVersion,
			});
			appLog.info("[Legal] accepted ToS/Privacy Policy", {
				tos: info.latestTermsOfServiceVersion,
				privacy: info.latestPrivacyPolicyVersion,
			});
			setForced(false);
		} catch (error) {
			appLog.error("[Legal] accepting legal agreements failed", error);
			toast.error(t("legal_agreements.accept_failed", { defaultValue: "Couldn't confirm the agreements. Please try again." }));
		}
	};

	return (
		<FullscreenPrompt
			icon={ShieldCheck}
			title={t("legal_agreements.title", { defaultValue: "Updated Terms" })}
			description={t("legal_agreements.description", {
				defaultValue: "Grindr has updated its policies. Please review and accept them to keep using your account.",
			})}
			footer={
				<>
					<button
						type="button"
						onClick={() => void handleAccept()}
						disabled={acceptMutation.isPending}
						className={fullscreenPrimaryButtonClass}
					>
						{acceptMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
						{t("legal_agreements.accept", { defaultValue: "Accept" })}
						{acceptMutation.isPending ? null : <ChevronRight className="h-4 w-4" />}
					</button>
					{forced && (
						<button
							type="button"
							onClick={() => setForced(false)}
							disabled={acceptMutation.isPending}
							className={fullscreenSecondaryButtonClass}
						>
							Close (debug)
						</button>
					)}
				</>
			}
		>
			<div className="surface-card divide-y divide-[var(--border)] overflow-hidden text-left">
				<PolicyRow
					icon={ScrollText}
					title={t("legal_agreements.tos_title", { defaultValue: "Terms of Service" })}
					outdated={tosOutdated}
					acceptedAt={accepted.termsAcceptedAt}
					url={info.termsOfServiceUrl}
				/>
				<PolicyRow
					icon={FileText}
					title={t("legal_agreements.privacy_title", { defaultValue: "Privacy Policy" })}
					outdated={privacyOutdated}
					acceptedAt={accepted.privacyAcceptedAt}
					url={info.privacyPolicyUrl}
				/>
			</div>
		</FullscreenPrompt>
	);
}
