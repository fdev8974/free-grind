import type { LucideIcon } from "lucide-react";
import { BottomSheet, SheetClose, SheetCloseButton } from "../../../components/ui/bottom-sheet";
import { cn } from "../../../utils/cn";

/** Same bg as the app's other native-style sheets (filters, location, chat drawer). */
export const NATIVE_SHEET_BG = "bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]";

/** Delay before opening a follow-up sheet from a sheet action, so the closing
 * sheet pops its history entry before the next one pushes its own. */
export function afterSheetClose(fn: () => void) {
	window.setTimeout(fn, 340);
}

export interface SheetAction {
	key: string;
	icon: LucideIcon;
	label: string;
	description?: string;
	/** Tile color classes, e.g. "bg-sky-500/15 text-sky-400". Ignored for danger actions. */
	iconClassName?: string;
	tone?: "default" | "danger";
	disabled?: boolean;
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
			className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)] disabled:opacity-50"
		>
			<div
				className={cn(
					"shrink-0 rounded-2xl p-2.5",
					isDanger ? "bg-red-500/15 text-red-400" : action.iconClassName ?? "bg-[var(--surface-2)] text-[var(--text-muted)]",
				)}
			>
				<action.icon className="h-5 w-5" />
			</div>
			<div className="min-w-0 flex-1">
				<p className={cn("text-sm font-semibold leading-snug", isDanger && "text-red-400")}>{action.label}</p>
				{action.description && (
					<p className="mt-0.5 text-xs text-[var(--text-muted)]">{action.description}</p>
				)}
			</div>
		</SheetClose>
	);
}

/** Native-style action sheet: a titled list of SheetActionRows. */
export function SheetActionList({
	title,
	actions,
	onClose,
	isDesktop,
}: {
	title: string;
	actions: SheetAction[];
	onClose: () => void;
	isDesktop: boolean;
}) {
	return (
		<BottomSheet onClose={onClose} isDesktop={isDesktop} bg={NATIVE_SHEET_BG} panelClassName="px-4">
			<div className="mb-2 flex items-center justify-between gap-3">
				<h3 className="min-w-0 truncate text-sm font-semibold text-[var(--text)]">{title}</h3>
				<SheetCloseButton />
			</div>
			<div className="-mx-1 pb-2">
				{actions.map((action) => (
					<SheetActionRow key={action.key} action={action} />
				))}
			</div>
		</BottomSheet>
	);
}
