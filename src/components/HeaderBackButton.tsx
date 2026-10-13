import { ChevronLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../utils/cn";

type HeaderBackButtonProps = {
	onClick: () => void;
	label?: string;
	className?: string;
};

/** The one back arrow every page header uses: a bordered chip on desktop,
 * a bare, larger chevron on touch devices (see `.header-icon-btn`). Sits in
 * the same row as the page title, like the chat header. */
export function HeaderBackButton({ onClick, label, className }: HeaderBackButtonProps) {
	const { t } = useTranslation();
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"header-icon-btn header-icon-btn--back inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]",
				className,
			)}
			aria-label={label ?? t("common.back")}
		>
			<ChevronLeft className="h-5 w-5" />
		</button>
	);
}
