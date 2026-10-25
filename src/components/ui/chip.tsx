import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes } from "react";
import { cn } from "../../utils/cn";
import { sheetChipClassName } from "./sheet-section";

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	selected?: boolean;
	size?: "sm" | "md";
	/** Sitting on a surface-2 card, so the resting chip needs a different fill. */
	onCard?: boolean;
	/** Ring/tint color for the selected state. */
	accentColor?: string;
}

/** Same look as SheetChip (see sheetChipClassName), for toggle chips outside sheets. */
export function Chip({
	selected = false,
	size = "md",
	onCard = false,
	accentColor = "var(--accent)",
	className,
	style,
	type = "button",
	...props
}: ChipProps) {
	return (
		<button
			type={type}
			aria-pressed={selected}
			style={{ "--chip-accent": accentColor, ...style } as CSSProperties}
			className={cn(
				sheetChipClassName({ active: selected, size, onCard }),
				"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--chip-accent)] disabled:pointer-events-none disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
	variant?: "default" | "subtle";
}

export function Badge({
	variant = "default",
	className,
	...props
}: BadgeProps) {
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.1em]",
				variant === "default"
					? "bg-[var(--accent)]/90 text-[var(--accent-contrast)]"
					: "ink-tint-10 text-[var(--text-muted)]",
				className,
			)}
			{...props}
		/>
	);
}
