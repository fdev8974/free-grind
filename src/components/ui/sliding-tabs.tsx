import { useRef, type ReactNode, type TouchEvent } from "react";
import { cn } from "../../utils/cn";
import { haptic } from "../../utils/haptics";
import { isSheetDragHeld } from "./bottom-sheet";

export interface SlidingTab<T extends string> {
	value: T;
	label: string;
	icon?: ReactNode;
}

/** Segmented tab switcher with an accent pill that slides to the active tab
 * (sign-in method picker, chat drawer). Tabs share the track equally. */
export function SlidingTabs<T extends string>({
	tabs,
	value,
	onChange,
	className,
}: {
	tabs: SlidingTab<T>[];
	value: T;
	onChange: (value: T) => void;
	className?: string;
}) {
	const count = tabs.length;
	const index = Math.max(0, tabs.findIndex((tab) => tab.value === value));
	return (
		<div
			role="tablist"
			className={cn(
				"relative flex gap-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-1 shadow-sm",
				className,
			)}
		>
			{/* Sliding active indicator: one tab's share of the track minus the p-1 padding and gap-1 between the tabs. */}
			<span
				aria-hidden="true"
				className="absolute inset-y-1 left-1 rounded-[10px] bg-[var(--accent)] shadow-md shadow-[var(--accent)]/25 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
				style={{
					width: `calc((100% - ${8 + (count - 1) * 4}px) / ${count})`,
					transform: `translateX(calc(${index * 100}% + ${index * 4}px))`,
				}}
			/>
			{tabs.map((tab) => {
				const active = tab.value === value;
				return (
					<button
						key={tab.value}
						type="button"
						role="tab"
						aria-selected={active}
						onClick={() => {
							if (active) return;
							haptic(10);
							onChange(tab.value);
						}}
						className={cn(
							"relative z-10 flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[10px] py-2 text-sm font-medium transition-colors duration-300 active:scale-[0.97]",
							active ? "text-[var(--accent-contrast)]" : "text-[var(--text-muted)] hover:text-[var(--text)]",
						)}
					>
						{tab.icon}
						<span className="truncate">{tab.label}</span>
					</button>
				);
			})}
		</div>
	);
}

/**
 * Swipe left/right on a tab's content to switch to the next/previous tab, like
 * native tab pagers. Spread the result onto the content area. A mostly
 * vertical move is left to scrolling; sliders, maps and an open peek keep
 * their own gestures.
 */
export function useSwipeTabs<T extends string>(
	tabs: readonly T[],
	value: T,
	onChange: (value: T) => void,
	enabled = true,
) {
	const startRef = useRef<{ x: number; y: number; t: number } | null>(null);

	const onTouchStart = (event: TouchEvent<HTMLElement>) => {
		startRef.current = null;
		if (!enabled || event.touches.length !== 1) return;
		const target = event.target as HTMLElement;
		if (target.closest('input[type="range"], .maplibregl-map, [data-no-tab-swipe]')) return;
		const touch = event.touches[0];
		startRef.current = { x: touch.clientX, y: touch.clientY, t: event.timeStamp };
	};

	const onTouchEnd = (event: TouchEvent<HTMLElement>) => {
		const start = startRef.current;
		startRef.current = null;
		if (!start || isSheetDragHeld()) return;
		const touch = event.changedTouches[0];
		const dx = touch.clientX - start.x;
		const dy = touch.clientY - start.y;
		const dt = Math.max(1, event.timeStamp - start.t);
		// Clearly horizontal, and either far enough or a quick flick.
		if (Math.abs(dx) < 1.5 * Math.abs(dy)) return;
		if (Math.abs(dx) < 70 && !(Math.abs(dx) > 35 && Math.abs(dx) / dt > 0.5)) return;
		const index = tabs.indexOf(value);
		const next = tabs[index + (dx < 0 ? 1 : -1)];
		if (next === undefined) return;
		haptic(10);
		onChange(next);
	};

	return { onTouchStart, onTouchEnd, onTouchCancel: () => { startRef.current = null; } };
}
