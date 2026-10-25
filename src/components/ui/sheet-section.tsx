import type { CSSProperties, ReactNode } from "react";
import { Loader2, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../utils/cn";
import { ToggleRow } from "./toggle-row";

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
 * a soft text tint at rest, tinted with an inset ring in `--chip-accent` when active. */
export function sheetChipClassName({
	active,
	size = "md",
}: {
	active: boolean;
	size?: "sm" | "md";
	/** No longer changes anything, see the resting fill below; kept for callers. */
	onCard?: boolean;
}) {
	return cn(
		"shrink-0 rounded-xl font-semibold transition active:scale-95",
		size === "sm" ? "px-3 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
		active
			? "bg-[color-mix(in_srgb,var(--chip-accent)_16%,var(--surface-2))] text-[var(--text)] ring-2 ring-inset ring-[var(--chip-accent)]"
			: // A see-through text tint rather than a fixed surface color, so the
				// resting chip reads on any background: sheets, SheetCards and the
				// page cards alike.
				"ink-tint-10 text-[var(--text-muted)] hover:ink-tint-14 hover:text-[var(--text)]",
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

export interface SheetToggleItem {
	key: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
	label: string;
	description?: string;
}

/** On/off options in a sheet as native-style list rows: one SheetCard, a
 * switch per row, dividers between them (e.g. a photo's upload options). */
export function SheetToggleList({ items, className }: { items: SheetToggleItem[]; className?: string }) {
	return (
		<SheetCard className={cn("divide-y divide-[var(--border)] py-0", className)}>
			{items.map((item) => (
				<ToggleRow
					key={item.key}
					checked={item.checked}
					onChange={item.onChange}
					label={item.label}
					description={item.description}
					padding="py-3"
				/>
			))}
		</SheetCard>
	);
}

/** Search field for a sheet: the round frosted pill of the map sheets'
 * search (MapSheetSearch), with a leading search icon and a clear button (or
 * a spinner while `isLoading`). `floating` pins it over the scroll area that
 * follows it, on a fade of the sheet's background, so the list scrolls on
 * behind the pill; the `.sheet-search` rule in index.css gives that next
 * element the matching top padding. */
export function SheetSearchInput({
	value,
	onChange,
	placeholder,
	accentColor = "var(--accent)",
	isLoading = false,
	floating = false,
	onFocus,
	onBlur,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	accentColor?: string;
	isLoading?: boolean;
	floating?: boolean;
	onFocus?: () => void;
	onBlur?: () => void;
}) {
	const { t } = useTranslation();
	const pill = (
		<div
			className="relative rounded-full bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] shadow-[0_2px_6px_rgba(0,0,0,0.14),0_8px_24px_rgba(0,0,0,0.22)] ring-1 ring-[var(--border)]/50 backdrop-blur-xl transition focus-within:ring-2 focus-within:ring-[var(--chip-accent)]"
			style={{ "--chip-accent": accentColor } as CSSProperties}
		>
			<Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
			<input
				type="text"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onFocus={onFocus}
				onBlur={onBlur}
				placeholder={placeholder}
				className="h-12 w-full rounded-full bg-transparent pl-11 pr-11 text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
			/>
			{isLoading ? (
				<Loader2 className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[var(--text-muted)]" />
			) : value ? (
				<button
					type="button"
					onClick={() => onChange("")}
					aria-label={t("common.clear", { defaultValue: "Clear" })}
					className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-[var(--text-muted)] transition hover:text-[var(--text)]"
				>
					<X className="h-3.5 w-3.5" />
				</button>
			) : null}
		</div>
	);
	if (!floating) return pill;
	return (
		<div className="sheet-search pointer-events-none relative z-10 -mx-4 -mb-[3.75rem] shrink-0 px-4 pb-3 [&>*]:pointer-events-auto bg-[linear-gradient(to_bottom,var(--sheet-bg)_0%,var(--sheet-bg)_45%,transparent)]">
			{pill}
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

/** Plain text field for a sheet (e.g. a name), same look as SheetSearchInput.
 * Enter or leaving the field calls `onCommit`; `trailing` sits inside on the right. */
export function SheetTextInput({
	value,
	onChange,
	onCommit,
	placeholder,
	maxLength,
	disabled,
	autoFocus,
	trailing,
	accentColor = "var(--accent)",
}: {
	value: string;
	onChange: (value: string) => void;
	onCommit?: () => void;
	placeholder?: string;
	maxLength?: number;
	disabled?: boolean;
	autoFocus?: boolean;
	trailing?: ReactNode;
	accentColor?: string;
}) {
	return (
		<div className="relative" style={{ "--chip-accent": accentColor } as CSSProperties}>
			<input
				type="text"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onBlur={onCommit}
				onKeyDown={(event) => {
					if (event.key === "Enter" && onCommit) {
						event.preventDefault();
						event.currentTarget.blur();
					}
				}}
				placeholder={placeholder}
				maxLength={maxLength}
				disabled={disabled}
				autoFocus={autoFocus}
				className={cn(
					"h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm text-[var(--text)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--chip-accent)] disabled:opacity-60",
					trailing ? "pr-10" : undefined,
				)}
			/>
			{trailing && (
				<div className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center text-[var(--text-muted)]">
					{trailing}
				</div>
			)}
		</div>
	);
}
