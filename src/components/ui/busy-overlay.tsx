import { Loader2 } from "lucide-react";
import { cn } from "../../utils/cn";

/**
 * Blocks the screen for a short wait (e.g. opening an album): a frosted pill
 * with a spinner, like the floating search pills, over a light dim.
 */
export function BusyOverlay({ label, zIndex = "z-[85]" }: { label: string; zIndex?: string }) {
	return (
		<div className={cn("fixed inset-0 flex items-center justify-center bg-black/30 p-4 animate-in fade-in duration-200", zIndex)}>
			<div
				role="status"
				className="flex items-center gap-2.5 rounded-full bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] px-5 py-3 text-sm font-medium text-[var(--text)] shadow-[0_2px_6px_rgba(0,0,0,0.18),0_8px_28px_rgba(0,0,0,0.32)] ring-1 ring-[var(--border)]/50 backdrop-blur-xl"
			>
				<Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
				{label}
			</div>
		</div>
	);
}
