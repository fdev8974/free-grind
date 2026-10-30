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
 * Installed → new comparison used by the update prompts: two rows, the new one
 * highlighted, with an arrow badge in the gap between them. Renders the rows
 * as direct children, so each is its own tile of the surrounding `native-group`.
 */
export function VersionCompare({ from, to }: { from?: VersionCompareSide; to: VersionCompareSide }) {
	return (
		<>
			{from && (
				<div className="relative">
					<VersionCompareRow side={from} />
					<div className="absolute bottom-0 left-6 z-10 flex translate-y-[calc(50%+2px)] rounded-full bg-[var(--surface-2)] p-1 text-[var(--text-muted)] shadow-[0_1px_4px_rgba(0,0,0,0.25)]">
						<ArrowDown className="h-3.5 w-3.5" />
					</div>
				</div>
			)}
			<VersionCompareRow side={to} highlight />
		</>
	);
}
