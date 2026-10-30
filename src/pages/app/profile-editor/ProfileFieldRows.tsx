import { useLayoutEffect, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChevronRight, CircleDashed } from "lucide-react";
import { SelectSheet } from "../../../components/ui/select-sheet";
import { useDesktopBreakpoint } from "../../../hooks/useDesktopBreakpoint";
import { cn } from "../../../utils/cn";
import { ManagedOptionsPickerDialog } from "./ManagedOptionsPickerDialog";

type Option = { value: number; label: string };

/** A lucide icon or one of the app's own (e.g. brand marks), drawn in currentColor. */
export type FieldIcon = ComponentType<{ className?: string }>;

/** Hover fill for a clickable row: the accent mixed into the surface-2 card it
 * sits on (FieldSection sets --hover-base); pressing adds a bit more accent. */
export const FIELD_ROW_HOVER_CLASS = "hover-fill";

/** Small caps heading (plus an optional action on the right) above one card
 * of divided rows, styled like the profile view's lists. `footer` sits under the card. */
export function FieldSection({
	title,
	action,
	footer,
	className,
	children,
}: {
	title: string;
	action?: ReactNode;
	footer?: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	return (
		<section className={cn("min-w-0", className)}>
			<div className="mb-2 flex min-h-7 items-center justify-between gap-3">
				<h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">{title}</h3>
				{action}
			</div>
			{/* The profile view's list card. */}
			<div className="overflow-hidden divide-y divide-[var(--border)] rounded-2xl bg-[var(--surface-2)] [--hover-base:var(--surface-2)]">
				{children}
			</div>
			{footer}
		</section>
	);
}

/** Small pill action for a FieldSection heading (e.g. "Add"). */
export function FieldSectionAction({
	onClick,
	disabled,
	title,
	children,
}: {
	onClick: () => void;
	disabled?: boolean;
	title?: string;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={title}
			className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-semibold text-[var(--accent-readable)] transition hover:ink-tint-8 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
		>
			{children}
		</button>
	);
}

const ROW_CLASS = "flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left";

/** Leading row icon, the muted 16px glyph the profile view puts before its fields. */
function RowIcon({ icon: Icon }: { icon?: FieldIcon }) {
	return Icon ? <Icon className="h-4 w-4 shrink-0 text-[var(--text-muted)]" /> : null;
}

/** Row that shows the current value and opens a picker. */
export function PickerRow({
	icon,
	label,
	value,
	onClick,
	disabled,
}: {
	icon?: FieldIcon;
	label: string;
	/** Empty / null shows the "Not set" placeholder. */
	value: ReactNode;
	onClick: () => void;
	disabled?: boolean;
}) {
	const { t } = useTranslation();
	const isEmpty = value == null || value === "";
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={cn(ROW_CLASS, "transition disabled:cursor-not-allowed disabled:opacity-50", FIELD_ROW_HOVER_CLASS)}
		>
			<RowIcon icon={icon} />
			<span className="shrink-0 text-sm font-medium text-[var(--text)]">{label}</span>
			<span
				className={cn(
					"min-w-0 flex-1 truncate text-right text-sm text-[var(--text-muted)]",
					isEmpty && "opacity-60",
				)}
			>
				{isEmpty ? t("profile_editor.sections.states.not_set") : value}
			</span>
			<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
		</button>
	);
}

/** Pick one option (or "Not set") from a SelectSheet. Draft values are the
 * option's number as a string, "" for not set. */
export function SingleSelectField({
	icon,
	label,
	value,
	options,
	optionIcons,
	onChange,
}: {
	icon?: FieldIcon;
	label: string;
	value: string;
	options: Option[];
	/** Per-option icons in the sheet (e.g. the roles' icons, as in the browse filters). */
	optionIcons?: Partial<Record<number, FieldIcon>>;
	onChange: (value: string) => void;
}) {
	const { t } = useTranslation();
	const isDesktop = useDesktopBreakpoint();
	const [isOpen, setIsOpen] = useState(false);
	const selectedLabel = options.find((option) => String(option.value) === value)?.label ?? "";

	return (
		<>
			<PickerRow icon={icon} label={label} value={selectedLabel} onClick={() => setIsOpen(true)} />
			{/* Portaled out of the card: inside its divide-y list the overlay would
			    pick up the divider border. */}
			{isOpen && createPortal(
				<SelectSheet
					title={label}
					value={value}
					options={[
						// With option icons, "Not set" gets a neutral one so the labels line up.
						{ value: "", label: t("profile_editor.sections.states.not_set"), icon: optionIcons ? CircleDashed : undefined },
						...options.map((option) => ({
							value: String(option.value),
							label: option.label,
							icon: optionIcons?.[option.value],
						})),
					]}
					onSelect={onChange}
					onClose={() => setIsOpen(false)}
					isDesktop={isDesktop}
					expandable={options.length > 8}
				/>,
				document.body,
			)}
		</>
	);
}

/** Pick any number of options from a chip sheet; the row lists the picks. */
export function MultiSelectField({
	icon,
	label,
	values,
	options,
	onToggle,
	search,
	unavailableLabel,
}: {
	icon?: FieldIcon;
	label: string;
	values: number[];
	options: Option[];
	onToggle: (value: number) => void;
	/** For long lists (e.g. genders): a search field over the chips. */
	search?: { placeholder: string; noMatchesLabel: string };
	/** Shown instead of the picker while the options haven't loaded. */
	unavailableLabel?: string;
}) {
	const { t } = useTranslation();
	const [isOpen, setIsOpen] = useState(false);
	const summary = options
		.filter((option) => values.includes(option.value))
		.map((option) => option.label)
		.join(", ");

	if (options.length === 0 && unavailableLabel) {
		return (
			<div className={ROW_CLASS}>
				<RowIcon icon={icon} />
				<span className="shrink-0 text-sm font-medium text-[var(--text)]">{label}</span>
				<span className="min-w-0 flex-1 truncate text-right text-sm text-[var(--text-muted)] opacity-60">{unavailableLabel}</span>
			</div>
		);
	}

	return (
		<>
			<PickerRow icon={icon} label={label} value={summary} onClick={() => setIsOpen(true)} />
			{isOpen && createPortal(
				<ManagedOptionsPickerDialog
					title={label}
					searchPlaceholder={search?.placeholder}
					noMatchesLabel={search?.noMatchesLabel}
					options={options}
					selected={values}
					confirmLabel={t("common.done", { defaultValue: "Done" })}
					onToggle={onToggle}
					onClose={() => setIsOpen(false)}
				/>,
				document.body,
			)}
		</>
	);
}

/** On/off row with the app's switch (same look as ToggleRow), plus a leading icon. */
export function ToggleField({
	icon,
	label,
	description,
	checked,
	onChange,
}: {
	icon?: FieldIcon;
	label: string;
	description?: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<label className={cn(ROW_CLASS, "cursor-pointer", description && "items-start")}>
			{description ? <span className="mt-0.5"><RowIcon icon={icon} /></span> : <RowIcon icon={icon} />}
			<span className="min-w-0 flex-1">
				<span className="block text-sm font-medium text-[var(--text)]">{label}</span>
				{description && <span className="mt-0.5 block text-xs leading-relaxed text-[var(--text-muted)]">{description}</span>}
			</span>
			<span
				className="relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center"
				style={{
					"--toggle-active": "var(--accent)",
					"--toggle-thumb-active": "var(--accent-contrast)",
				} as CSSProperties}
			>
				<input
					type="checkbox"
					checked={checked}
					onChange={(event) => onChange(event.target.checked)}
					className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0"
				/>
				<span className="absolute inset-0 rounded-full border border-[var(--border)] bg-[var(--surface)] transition-colors peer-checked:border-transparent peer-checked:bg-[var(--toggle-active)]" />
				<span className="absolute left-1 h-5 w-5 rounded-full bg-[var(--text)] transition-transform peer-checked:translate-x-5 peer-checked:bg-[var(--toggle-thumb-active)]" />
			</span>
		</label>
	);
}

/** Single-line text typed straight into the row, right-aligned. */
export function TextField({
	icon,
	label,
	value,
	onChange,
	placeholder,
	maxLength,
	numeric,
	counter,
	error,
}: {
	icon?: FieldIcon;
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	maxLength?: number;
	numeric?: boolean;
	/** Shown after the input, e.g. "12/15". */
	counter?: string;
	error?: string | null;
}) {
	return (
		<div>
			<label className={cn(ROW_CLASS, "cursor-text")}>
				<RowIcon icon={icon} />
				<span className="shrink-0 text-sm font-medium text-[var(--text)]">{label}</span>
				<input
					type={numeric ? "number" : "text"}
					inputMode={numeric ? "numeric" : undefined}
					value={value}
					maxLength={maxLength}
					onChange={(event) => onChange(event.target.value)}
					placeholder={placeholder}
					className="min-w-0 flex-1 bg-transparent text-right text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] placeholder:opacity-60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
				/>
				{counter && <span className="shrink-0 text-xs tabular-nums text-[var(--text-muted)] opacity-70">{counter}</span>}
			</label>
			{error && <p className="-mt-1 px-4 pb-3 text-xs text-red-400">{error}</p>}
		</div>
	);
}

/** Multi-line text under its label, full row width. */
export function TextAreaField({
	icon,
	label,
	value,
	onChange,
	placeholder,
	maxLength,
	counter,
	error,
}: {
	icon?: FieldIcon;
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	maxLength?: number;
	counter?: string;
	error?: string | null;
}) {
	// Always as tall as its text (never scrolls inside): reset, then take the
	// content height — before paint, so typing never flickers. Width changes
	// re-wrap the text, so those re-measure too.
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	useLayoutEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		const fit = () => {
			el.style.height = "auto";
			el.style.height = `${el.scrollHeight}px`;
		};
		fit();
		if (!("ResizeObserver" in window)) return;
		let lastWidth = el.clientWidth;
		const observer = new ResizeObserver(() => {
			if (el.clientWidth === lastWidth) return;
			lastWidth = el.clientWidth;
			fit();
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, [value]);

	return (
		<label className="block cursor-text px-4 py-3">
			<span className="flex items-center gap-3">
				<RowIcon icon={icon} />
				<span className="flex-1 text-sm font-medium text-[var(--text)]">{label}</span>
				{counter && <span className="text-xs tabular-nums text-[var(--text-muted)] opacity-70">{counter}</span>}
			</span>
			<textarea
				ref={textareaRef}
				value={value}
				maxLength={maxLength}
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				rows={3}
				className="mt-2 block min-h-20 w-full resize-none overflow-hidden bg-transparent text-sm leading-relaxed text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] placeholder:opacity-60"
			/>
			{error && <span className="mt-1 block text-xs text-red-400">{error}</span>}
		</label>
	);
}
