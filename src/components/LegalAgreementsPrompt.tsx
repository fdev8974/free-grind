import { useState } from "react";
import { ExternalLink, FileText, ScrollText, ShieldCheck } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { OnboardingItem, OnboardingModal } from "./OnboardingModal";
import {
	isLegalVersionOutdated,
	useAcceptLegalAgreements,
	useAcceptedLegalAgreements,
	useLegalAgreementsInfo,
} from "../hooks/queries/useLegalAgreementQueries";
import { appLog } from "../utils/logger";

function openExternal(url: string) {
	openUrl(url).catch(() => window.open(url, "_blank"));
}

/**
 * Compares the user's accepted ToS / Privacy Policy versions against the
 * latest published ones on login and asks for acceptance when either is
 * missing or outdated. Dismissing only hides it until the next app start.
 */
export function LegalAgreementsPrompt({ userId }: { userId: number }) {
	const { t } = useTranslation();
	const [dismissed, setDismissed] = useState(false);

	const { data: info } = useLegalAgreementsInfo();
	const { data: accepted } = useAcceptedLegalAgreements(userId);
	const acceptMutation = useAcceptLegalAgreements(userId);

	if (dismissed || !info || !accepted) {
		return null;
	}

	const tosOutdated = isLegalVersionOutdated(accepted.termsOfServiceVersion, info.latestTermsOfServiceVersion);
	const privacyOutdated = isLegalVersionOutdated(accepted.privacyPolicyVersion, info.latestPrivacyPolicyVersion);
	if (!tosOutdated && !privacyOutdated) {
		return null;
	}

	const handleAccept = async (): Promise<boolean> => {
		try {
			await acceptMutation.mutateAsync({
				termsOfServiceVersion: info.latestTermsOfServiceVersion,
				privacyPolicyVersion: info.latestPrivacyPolicyVersion,
			});
			appLog.info("[Legal] accepted ToS/Privacy Policy", {
				tos: info.latestTermsOfServiceVersion,
				privacy: info.latestPrivacyPolicyVersion,
			});
			return true;
		} catch (error) {
			appLog.error("[Legal] accepting legal agreements failed", error);
			toast.error(t("legal_agreements.accept_failed", { defaultValue: "Couldn't confirm the agreements. Please try again." }));
			return false;
		}
	};

	const linkClassName =
		"mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--accent)] transition hover:brightness-110";

	return (
		<OnboardingModal
			title={t("legal_agreements.title", { defaultValue: "Updated Terms" })}
			headerIcon={ShieldCheck}
			onClose={() => setDismissed(true)}
			onConfirm={() => setDismissed(true)}
			beforeConfirm={handleAccept}
			buttonLabel={t("legal_agreements.accept", { defaultValue: "Accept" })}
		>
			<p className="text-sm leading-relaxed text-[var(--text-muted)]">
				{t("legal_agreements.description", {
					defaultValue: "Grindr has updated its policies. Please review and accept them to keep using your account.",
				})}
			</p>
			<OnboardingItem
				icon={ScrollText}
				title={t("legal_agreements.tos_title", { defaultValue: "Terms of Service" })}
				description={
					tosOutdated
						? t("legal_agreements.updated", { defaultValue: "New version available" })
						: t("legal_agreements.up_to_date", { defaultValue: "Already accepted" })
				}
			>
				<button type="button" onClick={() => openExternal(info.termsOfServiceUrl)} className={linkClassName}>
					{t("legal_agreements.read", { defaultValue: "Read" })}
					<ExternalLink className="h-3.5 w-3.5" />
				</button>
			</OnboardingItem>
			<OnboardingItem
				icon={FileText}
				title={t("legal_agreements.privacy_title", { defaultValue: "Privacy Policy" })}
				description={
					privacyOutdated
						? t("legal_agreements.updated", { defaultValue: "New version available" })
						: t("legal_agreements.up_to_date", { defaultValue: "Already accepted" })
				}
			>
				<button type="button" onClick={() => openExternal(info.privacyPolicyUrl)} className={linkClassName}>
					{t("legal_agreements.read", { defaultValue: "Read" })}
					<ExternalLink className="h-3.5 w-3.5" />
				</button>
			</OnboardingItem>
		</OnboardingModal>
	);
}
