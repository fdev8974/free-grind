import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, ExternalLink, Flag, Loader2, TriangleAlert } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { FullscreenPrompt, fullscreenPrimaryButtonClass, fullscreenSecondaryButtonClass } from "./FullscreenPrompt";
import { CardDetailsSheet, GuidelineBlock, RichText } from "./GuidelineViolationParts";
import { useAccountWarnings, useAcknowledgeAccountWarnings } from "../hooks/queries/useWarningQueries";
import type { AccountWarning } from "../services/api/warningsMethods";
import { openCommunityGuidelines, warningText } from "../utils/guidelineViolations";
import { SHOW_ACCOUNT_WARNINGS_EVENT } from "../utils/accountWarningsDebug";
import { appLog } from "../utils/logger";

const PREVIEW_WARNINGS: AccountWarning[] = [
	{ warning: "MILD_INSULTS", count: 2 },
	{ warning: "UNWANTED_MESSAGING", count: 1 },
	{ warning: "DRUG_SOLICITATION", count: 1 },
];

function humanize(code: string): string {
	const words = code.trim().replace(/_+/g, " ").toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

function WarningCard({ warning }: { warning: AccountWarning }) {
	const { t } = useTranslation();
	const text = warningText(warning.warning, t);

	return (
		<article className="surface-card overflow-hidden text-left">
			<div className="flex items-start gap-3 px-4 py-4">
				<div className="shrink-0 rounded-2xl bg-[var(--surface-2)] p-2.5 text-[var(--accent)]">
					<Flag className="h-5 w-5" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-start gap-2">
						<h2 className="min-w-0 flex-1 text-sm font-semibold leading-snug text-[var(--text)]">
							{text?.title ?? humanize(warning.warning)}
						</h2>
						<span className="shrink-0 rounded-full accent-tint-15 px-2 py-0.5 text-xs font-semibold tabular-nums text-[var(--accent)]">
							{t("account_warnings.count", { count: warning.count, defaultValue: "{{count}}×" })}
						</span>
					</div>
					{text ? <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-muted)]">{text.content}</p> : null}
				</div>
			</div>
			{text ? (
				<CardDetailsSheet label={t("account_warnings.why", { defaultValue: "Why am I seeing this?" })} title={text.title}>
					<p className="text-sm leading-relaxed text-[var(--text)]">{text.reason}</p>
					{text.details ? <RichText text={text.details} /> : null}
					{text.guideline ? <GuidelineBlock guideline={text.guideline} /> : null}
				</CardDetailsSheet>
			) : null}
		</article>
	);
}

/**
 * Community-guidelines warnings, shown like the ban prompt but fetched
 * separately after login (GET /v2/warnings): they're not on the session
 * token. Replaces the app until the user acknowledges them (PUT /v1/warnings).
 */
export function AccountWarningsGate({ userId, children }: { userId: number; children: ReactNode }) {
	const { t } = useTranslation();
	// Set by the developer settings entry to show sample warnings.
	const [preview, setPreview] = useState(false);
	const { data: warnings, error } = useAccountWarnings(userId);
	const acknowledgeMutation = useAcknowledgeAccountWarnings(userId);

	useEffect(() => {
		const handleShow = () => setPreview(true);
		window.addEventListener(SHOW_ACCOUNT_WARNINGS_EVENT, handleShow);
		return () => window.removeEventListener(SHOW_ACCOUNT_WARNINGS_EVENT, handleShow);
	}, []);

	useEffect(() => {
		if (error) appLog.warn("[Warnings] loading account warnings failed", error);
	}, [error]);

	const shown = preview ? PREVIEW_WARNINGS : (warnings ?? []);
	if (shown.length === 0) {
		return <>{children}</>;
	}

	const handleAcknowledge = async () => {
		if (preview) {
			setPreview(false);
			return;
		}
		try {
			await acknowledgeMutation.mutateAsync();
			appLog.info("[Warnings] acknowledged", { warnings: shown.map((w) => w.warning) });
		} catch (ackError) {
			appLog.error("[Warnings] acknowledging warnings failed", ackError);
			toast.error(t("account_warnings.acknowledge_failed", { defaultValue: "Couldn't acknowledge the warnings. Please try again." }));
		}
	};

	return (
		<FullscreenPrompt
			icon={TriangleAlert}
			title={t("account_warnings.title", { defaultValue: "Warning" })}
			description={t("account_warnings.description", {
				defaultValue: "Your account has violated our Community Guidelines. If this happens again, you may be banned.",
			})}
			footer={
				<>
					<button
						type="button"
						onClick={() => void handleAcknowledge()}
						disabled={acknowledgeMutation.isPending}
						className={fullscreenPrimaryButtonClass}
					>
						{acknowledgeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
						{t("account_warnings.acknowledge", { defaultValue: "I Understand and Agree" })}
						{acknowledgeMutation.isPending ? null : <ChevronRight className="h-4 w-4" />}
					</button>
					<button type="button" onClick={openCommunityGuidelines} className={fullscreenSecondaryButtonClass}>
						<span className="inline-flex items-center justify-center gap-2">
							{t("account_warnings.read_guidelines", { defaultValue: "Read our guidelines" })}
							<ExternalLink className="h-4 w-4" />
						</span>
					</button>
				</>
			}
		>
			<div className="flex flex-col gap-3">
				{shown.map((warning) => (
					<WarningCard key={warning.warning} warning={warning} />
				))}
			</div>
		</FullscreenPrompt>
	);
}
