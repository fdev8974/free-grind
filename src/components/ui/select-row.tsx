import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";
import { SelectSheet, type SelectSheetOption } from "./select-sheet";

/** Settings row that picks one of several options from a SelectSheet,
 * instead of a native <select> or a chip group. */
export function SelectRow<T extends string>({
	icon,
	iconClass,
	label,
	description,
	value,
	onChange,
	options,
	id,
	highlighted,
}: {
	icon: ReactNode;
	iconClass: string;
	label: string;
	description?: string;
	value: T;
	onChange: (v: T) => void;
	options: SelectSheetOption<T>[];
	id?: string;
	highlighted?: boolean;
}) {
	const isDesktop = useDesktopBreakpoint();
	const [isOpen, setIsOpen] = useState(false);
	const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

	return (
		<>
			<button
				id={id}
				type="button"
				onClick={() => setIsOpen(true)}
				className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition hover:bg-[var(--surface-2)] ${highlighted ? "animate-settings-highlight" : ""}`}
			>
				<div className={`rounded-2xl p-2.5 shrink-0 ${iconClass}`}>{icon}</div>
				<div className="min-w-0 flex-1">
					<p className="text-sm font-semibold leading-snug">{label}</p>
					{description && <p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">{description}</p>}
				</div>
				{/* The row is top-aligned for the icon; the value stays centered. */}
				<span className="flex max-w-[45%] shrink-0 items-center gap-3 self-center">
					<span className="truncate text-sm font-medium text-[var(--text-muted)]">{selectedLabel}</span>
					<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
				</span>
			</button>
			{/* Portaled out of the card: as a child of its divide-y list the fullscreen
			    overlay would pick up the divider border (a stray line while it fades in). */}
			{isOpen && createPortal(
				<SelectSheet
					title={label}
					description={description}
					value={value}
					options={options}
					onSelect={onChange}
					onClose={() => setIsOpen(false)}
					isDesktop={isDesktop}
				/>,
				document.body,
			)}
		</>
	);
}
