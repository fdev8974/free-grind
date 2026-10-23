import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

const PILL_CLASS =
	"inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full accent-tint-14 px-3 text-xs font-semibold text-[var(--accent)] transition";

/**
 * Soft accent pill on the right of a settings row ("Check Now", "Sync", …).
 * Without `onClick` it's a plain label, for rows that are themselves the button.
 */
export function RowActionPill({
	children,
	loading = false,
	loadingLabel,
	onClick,
	disabled,
	className,
}: {
	children: ReactNode;
	loading?: boolean;
	/** Replaces `children` while loading; the spinner shows either way.
	 * `false` shows the spinner alone, keeping the pill's width. */
	loadingLabel?: ReactNode | false;
	onClick?: () => void;
	disabled?: boolean;
	className?: string;
}) {
	const content = loading && loadingLabel === false ? (
		<span className="relative inline-flex items-center justify-center">
			<span className="invisible">{children}</span>
			<Loader2 className="absolute h-3.5 w-3.5 animate-spin" />
		</span>
	) : loading ? (
		<>
			<Loader2 className="h-3.5 w-3.5 animate-spin" />
			{loadingLabel ?? children}
		</>
	) : (
		children
	);
	if (!onClick) return <span className={cn(PILL_CLASS, className)}>{content}</span>;
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled || loading}
			className={cn(
				PILL_CLASS,
				"hover:accent-tint-22 active:scale-95 disabled:opacity-50",
				className,
			)}
		>
			{content}
		</button>
	);
}
