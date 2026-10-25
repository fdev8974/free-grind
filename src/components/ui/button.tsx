import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../../utils/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
	size?: ButtonSize;
	loading?: boolean;
	leftIcon?: React.ReactNode;
	rightIcon?: React.ReactNode;
}

// Pill shape and soft ink-tint fills, same family as sheetButtonClass in bottom-sheet.tsx.
const variantClassMap: Record<ButtonVariant, string> = {
	primary:
		"bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_4px_14px_rgba(0,0,0,0.2)] hover:brightness-110",
	secondary:
		"ink-tint-10 text-[var(--text)] hover:ink-tint-14 active:ink-tint-18",
	ghost:
		"bg-transparent text-[var(--text)] hover:ink-tint-8 active:ink-tint-12",
	danger:
		"bg-red-500/12 text-red-500 hover:bg-red-500/20",
};

const sizeClassMap: Record<ButtonSize, string> = {
	sm: "min-h-10 px-3 py-2 text-sm",
	md: "min-h-12 px-5 py-2.5 text-[15px]",
	lg: "min-h-12 px-5 py-3 text-base",
	icon: "h-11 w-11 p-0",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	(
		{
			className,
			variant = "secondary",
			size = "md",
			loading = false,
			disabled,
			leftIcon,
			rightIcon,
			children,
			...props
		},
		ref,
	) => {
		const isDisabled = disabled || loading;

		return (
			<button
				ref={ref}
				disabled={isDisabled}
				className={cn(
					"inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-[transform,filter,background-color,color] duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
					variantClassMap[variant],
					sizeClassMap[size],
					className,
				)}
				{...props}
			>
				{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : leftIcon}
				{children}
				{!loading ? rightIcon : null}
			</button>
		);
	},
);

Button.displayName = "Button";
