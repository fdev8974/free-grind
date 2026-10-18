import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { BottomSheet, SheetClose, SheetCloseButton } from "../../../components/ui/bottom-sheet";
import { SheetChip, SheetSearchInput } from "../../../components/ui/sheet-section";
import { useDesktopBreakpoint } from "../../../hooks/useDesktopBreakpoint";
import { cn } from "../../../utils/cn";
import type { ManagedOption } from "../GridPage.types";

interface ManagedOptionsPickerDialogProps {
	title: string;
	searchPlaceholder: string;
	noMatchesLabel: string;
	options: ManagedOption[];
	selected: number[];
	/** Omit for an unlimited selection (e.g. a browse filter). */
	max?: number;
	maxMessage?: string;
	/** Label of the footer button that closes the sheet. Selections apply live either way. */
	confirmLabel: string;
	/** Active chip / confirm button color — explore mode passes its own. */
	accentColor?: string;
	onToggle: (value: number) => void;
	onClose: () => void;
}

export function ManagedOptionsPickerDialog({
	title,
	searchPlaceholder,
	noMatchesLabel,
	options,
	selected,
	max,
	maxMessage,
	confirmLabel,
	accentColor = "var(--accent)",
	onToggle,
	onClose,
}: ManagedOptionsPickerDialogProps) {
	const isDesktop = useDesktopBreakpoint();
	const [query, setQuery] = useState("");

	const filteredOptions = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		if (!normalizedQuery) {
			return options;
		}
		return options.filter((option) => option.label.toLowerCase().includes(normalizedQuery));
	}, [options, query]);

	const handleToggle = (value: number) => {
		const alreadySelected = selected.includes(value);
		if (!alreadySelected && max !== undefined && selected.length >= max) {
			if (maxMessage) toast.error(maxMessage);
			return;
		}
		onToggle(value);
	};

	return (
		<BottomSheet
			onClose={onClose}
			expandable
			isDesktop={isDesktop}
			bg="bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]"
			panelClassName={isDesktop ? "max-h-[82dvh] px-4" : "px-4"}
		>
			<div className="mb-3 flex items-center justify-between gap-3">
				<h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
				<SheetCloseButton />
			</div>
			<div className="mb-4">
				<SheetSearchInput
					value={query}
					onChange={setQuery}
					placeholder={searchPlaceholder}
					accentColor={accentColor}
				/>
			</div>
			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
				{filteredOptions.length > 0 ? (
					<div className="flex flex-wrap gap-2">
						{filteredOptions.map((option) => (
							<SheetChip
								key={option.value}
								active={selected.includes(option.value)}
								onClick={() => handleToggle(option.value)}
								accentColor={accentColor}
							>
								{option.label}
							</SheetChip>
						))}
					</div>
				) : (
					<p className="py-6 text-center text-sm text-[var(--text-muted)]">{noMatchesLabel}</p>
				)}
			</div>
			<div className="-mx-4 mt-3 flex shrink-0 border-t border-[var(--border)] px-4 pt-3">
				<SheetClose
					style={{ backgroundColor: accentColor }}
					className={cn(
						"inline-flex h-11 flex-1 items-center justify-center rounded-xl px-4 text-sm font-semibold transition hover:brightness-110 active:scale-[0.98]",
						accentColor === "var(--accent)" ? "text-[var(--accent-contrast)]" : "text-white",
					)}
				>
					{confirmLabel}
				</SheetClose>
			</div>
		</BottomSheet>
	);
}
