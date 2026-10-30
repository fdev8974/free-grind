import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { SelectSheet } from "../../../components/ui/select-sheet";
import { useDesktopBreakpoint } from "../../../hooks/useDesktopBreakpoint";
import { cn } from "../../../utils/cn";
import { ManagedOptionsPickerDialog } from "./ManagedOptionsPickerDialog";

type Option = { value: number; label: string };

/** Settings-style group: small caps heading (plus an optional action on the
 * right) above one native card of divided rows. `footer` sits under the card. */
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
			<div className="mb-2 flex min-h-7 items-center justify-between gap-3 px-1">
				<h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">{title}</h3>
				{action}
			</div>
			<div className="native-card overflow-hidden divide-y divide-[var(--border)]">{children}</div>
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

const ROW_CLASS = "flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left";

/** Row that shows the current value and opens a picker. */
export function PickerRow({
	label,
	value,
	onClick,
	disabled,
}: {
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
			className={cn(ROW_CLASS, "transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50")}
		>
			<span className="shrink-0 text-sm font-medium text-[var(--text)]">{label}</span>
			<span
				className={cn(
					"min-w-0 flex-1 truncate text-right text-sm",
					isEmpty ? "text-[var(--text-muted)] opacity-60" : "text-[var(--text-muted)]",
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
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: string;
	options: Option[];
	onChange: (value: string) => void;
}) {
	const { t } = useTranslation();
	const isDesktop = useDesktopBreakpoint();
	const [isOpen, setIsOpen] = useState(false);
	const selectedLabel = options.find((option) => String(option.value) === value)?.label ?? "";

	return (
		<>
			<PickerRow label={label} value={selectedLabel} onClick={() => setIsOpen(true)} />
			{/* Portaled out of the card: inside its divide-y list the overlay would
			    pick up the divider border. */}
			{isOpen && createPortal(
				<SelectSheet
					title={label}
					value={value}
					options={[
						{ value: "", label: t("profile_editor.sections.states.not_set") },
						...options.map((option) => ({ value: String(option.value), label: option.label })),
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
	label,
	values,
	options,
	onToggle,
	search,
	unavailableLabel,
}: {
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
				<span className="shrink-0 text-sm font-medium text-[var(--text)]">{label}</span>
				<span className="min-w-0 flex-1 truncate text-right text-sm text-[var(--text-muted)] opacity-60">{unavailableLabel}</span>
			</div>
		);
	}

	return (
		<>
			<PickerRow label={label} value={summary} onClick={() => setIsOpen(true)} />
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

/** Single-line text typed straight into the row, right-aligned. */
export function TextField({
	label,
	value,
	onChange,
	placeholder,
	maxLength,
	numeric,
	counter,
	error,
}: {
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
	label,
	value,
	onChange,
	placeholder,
	maxLength,
	counter,
	error,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	maxLength?: number;
	counter?: string;
	error?: string | null;
}) {
	return (
		<label className="block cursor-text px-4 py-3">
			<span className="flex items-center justify-between gap-3">
				<span className="text-sm font-medium text-[var(--text)]">{label}</span>
				{counter && <span className="text-xs tabular-nums text-[var(--text-muted)] opacity-70">{counter}</span>}
			</span>
			<textarea
				value={value}
				maxLength={maxLength}
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				rows={3}
				className="mt-2 block min-h-20 w-full resize-y bg-transparent text-sm leading-relaxed text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] placeholder:opacity-60"
			/>
			{error && <span className="mt-1 block text-xs text-red-400">{error}</span>}
		</label>
	);
}
