import type { ReactNode } from "react";

// Shared look for the media drawer and the sheets that pick from it (collection
// editor, album "add from drawer"), so they stay visually in sync.

export const drawerGridClass = (isDesktop: boolean) =>
	`grid gap-0.5 ${isDesktop ? "grid-cols-5" : "grid-cols-4"}`;

export const DRAWER_TILE_CLASS = "relative aspect-square overflow-hidden rounded-md";

type DrawerActionButtonProps = {
	icon: ReactNode;
	label: string;
	onClick: () => void;
	disabled?: boolean;
	/** "column" for a row of several actions, "row" for a single full-width one. */
	layout?: "column" | "row";
};

export function DrawerActionButton({ icon, label, onClick, disabled, layout = "column" }: DrawerActionButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`flex items-center rounded-2xl bg-[var(--surface-2)] text-[var(--text)] transition active:scale-95 hover:bg-[color-mix(in_srgb,var(--surface-2)_80%,var(--text)_8%)] disabled:pointer-events-none disabled:opacity-40 ${
				layout === "row" ? "w-full gap-3 px-3 py-2.5 text-left" : "flex-col gap-1.5 px-2 py-3"
			}`}
		>
			<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)]">
				{icon}
			</span>
			<span className={`font-semibold leading-tight ${layout === "row" ? "text-sm" : "text-xs"}`}>{label}</span>
		</button>
	);
}
