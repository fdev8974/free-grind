import { ChevronLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../utils/cn";

type HeaderBackButtonProps = {
	onClick: () => void;
	label?: string;
	className?: string;
};

/** The one back arrow every page header uses: a bordered chip on desktop,
 * a bare, larger chevron on touch devices (see `.header-icon-btn`). Same size
 * as the profile page / photo viewer header buttons so it lands on the same pixel. */
export function HeaderBackButton({ onClick, label, className }: HeaderBackButtonProps) {
	const { t } = useTranslation();
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"header-icon-btn header-icon-btn--back inline-flex shrink-0 p-2 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]",
				className,
			)}
			aria-label={label ?? t("common.back")}
		>
			<ChevronLeft className="h-4 w-4" />
		</button>
	);
}
