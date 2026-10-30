import { Check, Plus } from "lucide-react";
import { cloneElement, isValidElement, type ComponentType, type ReactElement } from "react";
import { BottomSheet, SheetClose, SheetCloseButton } from "./bottom-sheet";
import { cn } from "../../utils/cn";

/** Same bg as the app's other native-style sheets (filters, location, chat drawer). */
export const NATIVE_SHEET_BG = "bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]";

/** Delay before opening a follow-up sheet from a sheet action, so the closing
 * sheet pops its history entry before the next one pushes its own. */
export function afterSheetClose(fn: () => void) {
	window.setTimeout(fn, 340);
}

export interface SheetAction {
	key: string;
	/** Lucide or one of the app's filled icons — as a component, or an element
	 * (e.g. shared with a desktop context menu); either way it's sized to the tile. */
	icon: ComponentType<{ className?: string }> | ReactElement<{ className?: string }>;
	label: string;
	description?: string;
	/** Tile color classes, e.g. "bg-sky-500/15 text-sky-400". Ignored for danger actions. */
	iconClassName?: string;
	tone?: "default" | "danger";
	disabled?: boolean;
	/** The current choice, when the sheet picks one of several options: checkmark on the right. */
	selected?: boolean;
	/** Runs as the sheet starts closing; wrap follow-up sheets in afterSheetClose. */
	onSelect: () => void;
}

/** One action row of an action sheet: tinted icon tile, title, optional description. */
export function SheetActionRow({ action }: { action: SheetAction }) {
	const isDanger = action.tone === "danger";
	return (
		<SheetClose
			onClick={action.onSelect}
			disabled={action.disabled}
			className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition hover-fill active:bg-[var(--surface-2)] disabled:opacity-50"
		>
			<div
				className={cn(
					"shrink-0 rounded-2xl p-2.5",
					isDanger ? "bg-red-500/15 text-red-400" : action.iconClassName ?? "bg-[var(--surface-2)] text-[var(--text-muted)]",
				)}
			>
				{isValidElement(action.icon) ? (
					cloneElement(action.icon, { className: cn(action.icon.props.className, "h-5 w-5") })
				) : (
					<action.icon className="h-5 w-5" />
				)}
			</div>
			<div className="min-w-0 flex-1">
				<p className={cn("text-sm font-semibold leading-snug", isDanger && "text-red-400")}>{action.label}</p>
				{action.description && (
					<p className="mt-0.5 text-xs text-[var(--text-muted)]">{action.description}</p>
				)}
			</div>
			{action.selected ? <Check className="h-5 w-5 shrink-0 text-[var(--accent-readable)]" strokeWidth={2.5} /> : null}
		</SheetClose>
	);
}

/** Native-style action sheet: a titled list of SheetActionRows. */
export function SheetActionList({
	title,
	actions,
	onClose,
	isDesktop,
	expandable = false,
}: {
	title: string;
	actions: SheetAction[];
	onClose: () => void;
	isDesktop: boolean;
	/** For long lists: the sheet can be dragged up to almost full screen and the list scrolls inside it. */
	expandable?: boolean;
}) {
	return (
		<BottomSheet onClose={onClose} isDesktop={isDesktop} expandable={expandable} bg={NATIVE_SHEET_BG} panelClassName="px-4">
			<div className="mb-2 flex items-center justify-between gap-3">
				<h3 className="min-w-0 truncate text-sm font-semibold text-[var(--text)]">{title}</h3>
				<SheetCloseButton />
			</div>
			<div
				className={expandable ? "-mx-1 min-h-0 flex-1 overflow-y-auto pb-2" : "-mx-1 pb-2"}
				data-lenis-prevent={expandable || undefined}
			>
				{actions.map((action) => (
					<SheetActionRow key={action.key} action={action} />
				))}
			</div>
		</BottomSheet>
	);
}

/** Compact "+ New" pill for the right end of a section heading (Albums, Collections). */
export function SectionAddButton({
	label,
	onClick,
	disabled,
}: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className="ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-full accent-tint-14 px-2.5 text-xs font-semibold text-[var(--accent)] transition hover:accent-tint-22 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
		>
			<Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
			{label}
		</button>
	);
}

/** Primary button under a DrawerEmptyState, same as the chat drawer's empty-state create button. */
export function EmptyStateCreateButton({
	label,
	onClick,
	disabled,
}: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)] transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
		>
			<Plus className="h-4 w-4" />
			{label}
		</button>
	);
}
