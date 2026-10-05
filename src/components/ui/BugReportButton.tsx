import { useTranslation } from "react-i18next";
import { Bug } from "lucide-react";
import { GITHUB_NEW_ISSUE_URL, openExternalUrl } from "../../utils/githubIssues";

export function BugReportButton() {
	const { t } = useTranslation();

	return (
		<button
			type="button"
			onClick={() => void openExternalUrl(GITHUB_NEW_ISSUE_URL)}
			className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
		>
			<Bug className="h-3.5 w-3.5" />
			{t("auth.bug_report.button")}
		</button>
	);
}
