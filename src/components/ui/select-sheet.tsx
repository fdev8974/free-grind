import { Check, Loader2 } from "lucide-react";
import { useState, type ComponentType, type ReactNode } from "react";
import { BottomSheet, SheetCloseButton, useBottomSheetClose } from "./bottom-sheet";
import { NATIVE_SHEET_BG } from "./action-sheet";
import { cn } from "../../utils/cn";

export interface SelectSheetOption<T extends string> {
	value: T;
	label: string;
	description?: string;
	/** Lucide or one of the app's filled icons, shown in a tinted tile. */
	icon?: ComponentType<{ className?: string }>;
	/** Tile color classes, e.g. "bg-sky-500/15 text-sky-400". */
	iconClassName?: string;
	disabled?: boolean;
}

interface SelectSheetProps<T extends string> {
	title: string;
	/** Short explanation under the title. */
	description?: ReactNode;
	value: T | null | undefined;
	options: SelectSheetOption<T>[];
	/**
	 * Called for an option other than the current one. The sheet closes right
	 * after a sync handler; an async one keeps it open with a spinner on the row
	 * until it resolves (closes) or rejects (stays open — the caller reports
	 * the error). Picking the current option just closes the sheet.
	 */
	onSelect: (value: T) => void | Promise<void>;
	onClose: () => void;
	isDesktop: boolean;
	/** Disables every row, e.g. while the current value is still loading. */
	disabled?: boolean;
	/** Color of the selection (row tint and check); defaults to the accent. */
	accentColor?: string;
	/** Text color on top of `accentColor`. */
	accentContrast?: string;
	/** Below the list, e.g. a loading or error note. */
	footer?: ReactNode;
	zIndex?: string;
}

/**
 * Single-choice picker sheet in the app's native sheet style (same bg, header
 * and rounded rows as the filter/location sheets and action sheets), with a
 * check mark on the selected option. Shared by every "pick one" sheet.
 */
export function SelectSheet<T extends string>({ onClose, isDesktop, zIndex, ...props }: SelectSheetProps<T>) {
	return (
		<BottomSheet
			onClose={onClose}
			isDesktop={isDesktop}
			zIndex={zIndex}
			bg={NATIVE_SHEET_BG}
			panelClassName={isDesktop ? "max-h-[82dvh] px-4" : "px-4"}
		>
			<SelectSheetContent {...props} />
		</BottomSheet>
	);
}

function SelectSheetContent<T extends string>({
	title,
	description,
	value,
	options,
	onSelect,
	disabled = false,
	accentColor = "var(--accent)",
	accentContrast = "var(--accent-contrast)",
	footer,
}: Omit<SelectSheetProps<T>, "onClose" | "isDesktop" | "zIndex">) {
	const close = useBottomSheetClose();
	const [pending, setPending] = useState<T | null>(null);

	const handleSelect = (next: T) => {
		if (next === value) {
			close();
			return;
		}
		const result = onSelect(next);
		if (!(result instanceof Promise)) {
			close();
			return;
		}
		setPending(next);
		result.then(
			() => {
				setPending(null);
				close();
			},
			() => setPending(null),
		);
	};

	return (
		<>
			<div className="mb-2 flex items-center justify-between gap-3">
				<div className="min-w-0">
					<h3 className="truncate text-sm font-semibold text-[var(--text)]">{title}</h3>
					{description && <p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">{description}</p>}
				</div>
				<SheetCloseButton />
			</div>
			<div
				role="radiogroup"
				aria-label={title}
				className="-mx-1 min-h-0 flex-1 overflow-y-auto pb-2"
				data-lenis-prevent
			>
				{options.map((option) => {
					const selected = option.value === value;
					const Icon = option.icon;
					return (
						<button
							key={option.value}
							type="button"
							role="radio"
							aria-checked={selected}
							disabled={disabled || pending !== null || option.disabled}
							onClick={() => handleSelect(option.value)}
							className={cn(
								"flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
								!selected && "hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)]",
							)}
							style={selected ? { background: `color-mix(in srgb, ${accentColor} 12%, transparent)` } : undefined}
						>
							{Icon && (
								<span className={cn("shrink-0 rounded-2xl p-2.5", option.iconClassName ?? "bg-[var(--surface-2)] text-[var(--text-muted)]")}>
									<Icon className="h-5 w-5" />
								</span>
							)}
							<span className="min-w-0 flex-1">
								<span className="block text-sm font-semibold leading-snug text-[var(--text)]">{option.label}</span>
								{option.description && (
									<span className="mt-0.5 block text-xs text-[var(--text-muted)]">{option.description}</span>
								)}
							</span>
							{pending === option.value ? (
								<Loader2 className="h-5 w-5 shrink-0 animate-spin text-[var(--text-muted)]" />
							) : (
								<span
									className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors"
									style={{
										borderColor: selected ? accentColor : "var(--border)",
										background: selected ? accentColor : "transparent",
									}}
								>
									{selected && <Check className="h-3 w-3" strokeWidth={3} style={{ color: accentContrast }} />}
								</span>
							)}
						</button>
					);
				})}
			</div>
			{footer}
		</>
	);
}
