import type { HTMLAttributes } from "react";
import { cn } from "../../utils/cn";

type CardVariant = "default" | "muted" | "soft" | "native";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
	variant?: CardVariant;
}

const variantClassMap: Record<CardVariant, string> = {
	default: "surface-card",
	muted: "surface-card bg-[var(--surface-2)]",
	soft: "surface-card bg-[color-mix(in_srgb,var(--surface)_88%,var(--accent)_12%)]",
	/** Borderless, see .native-card in index.css. */
	native: "native-card",
};

export function Card({ className, variant = "default", ...props }: CardProps) {
	return <div className={cn(variantClassMap[variant], className)} {...props} />;
}
