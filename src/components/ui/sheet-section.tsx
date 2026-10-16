import type { CSSProperties, ReactNode } from "react";
import { cn } from "../../utils/cn";

/** A labelled group inside a bottom sheet: small muted heading (plus an
 * optional current value on the right) above its content — same look as the
 * location sheet's sections. */
export function SheetSection({
	title,
	value,
	badge,
	className,
	children,
}: {
	title: string;
	value?: string;
	badge?: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	return (
		<section className={className}>
			<div className="mb-2 flex items-center justify-between gap-2 px-1">
				<div className="flex min-w-0 items-center gap-2">
					<p className="truncate text-xs font-semibold text-[var(--text-muted)]">{title}</p>
					{badge}
				</div>
				{value ? <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--text)]">{value}</span> : null}
			</div>
			{children}
		</section>
	);
}

/** Toggle chip matching the location sheet's LocationChip: surface-2 at rest,
 * tinted with an inset accent ring when active. */
export function SheetChip({
	active,
	onClick,
	children,
	accentColor = "var(--accent)",
	size = "md",
	onCard = false,
}: {
	active: boolean;
	onClick: () => void;
	children: ReactNode;
	/** Ring/tint color for the active state — explore mode passes its own. */
	accentColor?: string;
	size?: "sm" | "md";
	/** Sitting on a SheetCard (itself surface-2), so the resting chip needs a different fill. */
	onCard?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			style={{ "--chip-accent": accentColor } as CSSProperties}
			className={cn(
				"shrink-0 rounded-xl font-semibold transition active:scale-95",
				size === "sm" ? "px-3 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
				active
					? "bg-[color-mix(in_srgb,var(--chip-accent)_16%,var(--surface-2))] text-[var(--text)] ring-2 ring-inset ring-[var(--chip-accent)]"
					: cn(
							"text-[var(--text-muted)] hover:text-[var(--text)]",
							onCard
								? "bg-[var(--surface)] hover:bg-[color-mix(in_srgb,var(--surface)_80%,var(--text)_8%)]"
								: "bg-[var(--surface-2)] hover:bg-[color-mix(in_srgb,var(--surface-2)_80%,var(--text)_8%)]",
						),
			)}
		>
			{children}
		</button>
	);
}

/** Plain surface-2 container for list-style rows in a sheet section. */
export function SheetCard({ className, children }: { className?: string; children: ReactNode }) {
	return <div className={cn("rounded-2xl bg-[var(--surface-2)] px-4 py-3", className)}>{children}</div>;
}
