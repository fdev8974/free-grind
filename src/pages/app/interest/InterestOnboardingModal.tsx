import { History, Eye, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FullscreenPrompt, fullscreenPrimaryButtonClass } from "../../../components/FullscreenPrompt";

export function InterestOnboardingModal({ onConfirm }: { onConfirm: () => void }) {
	const { t } = useTranslation();

	return (
		<FullscreenPrompt
			overlay
			icon={Eye}
			title={t("interest_page.onboarding.title", "Profile Visitors")}
			description={t(
				"interest_page.onboarding.limitation_desc",
				"Grindr normally only shows the very last visitor in full. Others are typically hidden behind a paywall or shown as anonymous previews.",
			)}
			footer={
				<button type="button" onClick={onConfirm} className={fullscreenPrimaryButtonClass}>
					{t("interest_page.onboarding.button", "Got it!")}
				</button>
			}
		>
			<div className="surface-card overflow-hidden text-left">
				<div className="flex items-start gap-3 px-4 py-3.5">
					<div className="shrink-0 rounded-2xl bg-[var(--surface-2)] p-2.5 text-[var(--accent)]">
						<Sparkles className="h-5 w-5" />
					</div>
					<div className="min-w-0 flex-1">
						<p className="text-sm font-semibold leading-snug text-[var(--text)]">
							{t("interest_page.onboarding.recovery_title", "Smart Recovery")}
						</p>
						<p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">
							{t(
								"interest_page.onboarding.recovery_desc",
								"Free Grind automatically matches anonymous previews with your local history. If we find a match, we reveal the profile for you.",
							)}
						</p>
						<span className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)]">
							<History className="h-3.5 w-3.5" />
							{t("interest_page.recovered_tooltip", "Identified from local history")}
						</span>
					</div>
				</div>
			</div>
		</FullscreenPrompt>
	);
}
