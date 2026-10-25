import { ArrowDown, Package, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type VersionCompareSide = {
	/** Small caps label above the title ("Installed build", "Latest"). */
	label: string;
	title: ReactNode;
	detail?: ReactNode;
	icon?: LucideIcon;
};

function VersionCompareRow({ side, highlight }: { side: VersionCompareSide; highlight?: boolean }) {
	const Icon = side.icon ?? Package;
	return (
		<div className="flex h-full items-center gap-3 px-4 py-3">
			<div
				className={`shrink-0 rounded-2xl ink-tint-8 p-2.5 ${highlight ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`}
			>
				<Icon className="h-5 w-5" />
			</div>
			<div className="min-w-0 flex-1">
				<p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{side.label}</p>
				<p className={`text-sm font-semibold leading-snug tabular-nums ${highlight ? "text-[var(--text)]" : "text-[var(--text-muted)]"}`}>
					{side.title}
				</p>
				{side.detail && <p className="mt-0.5 text-xs tabular-nums text-[var(--text-muted)]">{side.detail}</p>}
			</div>
		</div>
	);
}

/**
 * Installed → new comparison used by the update prompts: two equal-height rows
 * (so the arrow on the divider sits visually centered), the new one highlighted.
 * Renders no card of its own — place it inside a `fullscreenCardClass` card.
 */
export function VersionCompare({ from, to }: { from?: VersionCompareSide; to: VersionCompareSide }) {
	return (
		<div className="grid auto-rows-fr divide-y divide-[var(--border)]">
			{from && (
				<div className="relative">
					<VersionCompareRow side={from} />
					<div className="absolute bottom-0 left-6 z-10 flex translate-y-[calc(50%+0.5px)] rounded-full border border-[var(--border)] bg-[var(--surface)] p-1 text-[var(--text-muted)]">
						<ArrowDown className="h-3.5 w-3.5" />
					</div>
				</div>
			)}
			<VersionCompareRow side={to} highlight />
		</div>
	);
}
