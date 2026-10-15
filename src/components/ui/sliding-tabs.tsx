import type { ReactNode } from "react";
import { cn } from "../../utils/cn";
import { haptic } from "../../utils/haptics";

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
