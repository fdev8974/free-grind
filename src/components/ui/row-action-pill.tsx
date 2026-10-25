import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

const PILL_CLASS =
	"inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold transition";

const TONE_CLASS = {
	accent: "accent-tint-14 text-[var(--accent)]",
	/** Destructive row actions ("Delete all", "Reset all settings"). */
	danger: "bg-red-500/12 text-red-500",
	neutral: "ink-tint-10 text-[var(--text)]",
} as const;

const TONE_HOVER_CLASS = {
	accent: "hover:accent-tint-22",
	danger: "hover:bg-red-500/20",
	neutral: "hover:ink-tint-14",
} as const;

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
	tone = "accent",
	className,
}: {
	children: ReactNode;
	loading?: boolean;
	/** Replaces `children` while loading; the spinner shows either way.
	 * `false` shows the spinner alone, keeping the pill's width. */
	loadingLabel?: ReactNode | false;
	onClick?: () => void;
	disabled?: boolean;
	tone?: keyof typeof TONE_CLASS;
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
	if (!onClick) return <span className={cn(PILL_CLASS, TONE_CLASS[tone], className)}>{content}</span>;
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled || loading}
			className={cn(
				PILL_CLASS,
				TONE_CLASS[tone],
				TONE_HOVER_CLASS[tone],
				"active:scale-95 disabled:opacity-50",
				className,
			)}
		>
			{content}
		</button>
	);
}
