import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

interface ActionPillProps {
	icon: ReactNode;
	label: string;
	onClick: () => void;
	/** Right of the label, dimmed (e.g. a remaining time). */
	trailing?: ReactNode;
	/** 0–1: share of the pill shown as a lighter fill from the left, e.g. a session's time left. */
	progress?: number;
	disabled?: boolean;
	/** Fill color, a CSS color. */
	color?: string;
	/** Text/icon color on the fill. */
	textColor?: string;
}

/** Desktop counterpart of the round floating action buttons: a labelled pill
 * sitting centered at the bottom of the page. Icons passed in are resized to fit. */
export function ActionPill({
	icon,
	label,
	onClick,
	trailing,
	progress,
	disabled,
	color = "var(--accent)",
	textColor = "var(--accent-contrast)",
}: ActionPillProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={cn(
				"relative flex h-12 select-none items-center gap-2.5 overflow-hidden rounded-full px-6 text-sm font-bold",
				"transition-all duration-100 ease-out active:scale-95 hover:brightness-110 disabled:opacity-60 [&_svg]:h-5 [&_svg]:w-5",
			)}
			style={{
				background: progress === undefined ? color : `color-mix(in srgb, ${color} 55%, black)`,
				color: textColor,
				boxShadow: `0 10px 25px -5px color-mix(in srgb, ${color}, transparent 55%)`,
			}}
		>
			{progress !== undefined && (
				<span
					aria-hidden="true"
					className="absolute inset-y-0 left-0 transition-[width] duration-1000 ease-linear"
					style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%`, background: color }}
				/>
			)}
			<span className="relative flex items-center">{icon}</span>
			<span className="relative whitespace-nowrap">{label}</span>
			{trailing !== undefined && <span className="relative tabular-nums opacity-75">{trailing}</span>}
		</button>
	);
}
