import type { CSSProperties, ReactNode } from "react";
import { Search, X } from "lucide-react";
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

/** Shared look of every toggle chip in the app (SheetChip and ui/chip's Chip):
 * surface-2 at rest, tinted with an inset ring in `--chip-accent` when active. */
export function sheetChipClassName({
	active,
	size = "md",
	onCard = false,
}: {
	active: boolean;
	size?: "sm" | "md";
	onCard?: boolean;
}) {
	return cn(
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
			className={sheetChipClassName({ active, size, onCard })}
		>
			{children}
		</button>
	);
}

/** Plain surface-2 container for list-style rows in a sheet section. */
export function SheetCard({ className, children }: { className?: string; children: ReactNode }) {
	return <div className={cn("rounded-2xl bg-[var(--surface-2)] px-4 py-3", className)}>{children}</div>;
}

/** Search field for a sheet: surface-2 fill, leading search icon, clear button. */
export function SheetSearchInput({
	value,
	onChange,
	placeholder,
	accentColor = "var(--accent)",
	onFocus,
	onBlur,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	accentColor?: string;
	onFocus?: () => void;
	onBlur?: () => void;
}) {
	return (
		<div className="relative" style={{ "--chip-accent": accentColor } as CSSProperties}>
			<Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
			<input
				type="text"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onFocus={onFocus}
				onBlur={onBlur}
				placeholder={placeholder}
				className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] pl-10 pr-10 text-sm text-[var(--text)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--chip-accent)]"
			/>
			{value && (
				<button
					type="button"
					onClick={() => onChange("")}
					className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-[var(--text-muted)] transition hover:text-[var(--text)]"
				>
					<X className="h-3.5 w-3.5" />
				</button>
			)}
		</div>
	);
}

/** "More…" text action under a chip row: centered, small bold uppercase in the
 * accent color. Takes its own full line even inside a flex-wrap chip row. */
export function SheetMoreButton({
	onClick,
	children,
	accentColor = "var(--accent)",
}: {
	onClick: () => void;
	children: ReactNode;
	accentColor?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			style={{ color: accentColor }}
			className="w-full basis-full py-1.5 text-center text-xs font-bold uppercase tracking-wider transition hover:brightness-110 active:scale-[0.98]"
		>
			{children}
		</button>
	);
}
