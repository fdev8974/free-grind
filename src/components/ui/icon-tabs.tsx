import { useLayoutEffect, useRef, useState, type ComponentType, type CSSProperties } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "../../utils/cn";

export type IconTabConfig<K extends string> = {
	key: K;
	label: string;
	icon: ComponentType<{ className?: string }>;
	/** Total shown next to the label while the tab is active; omitted = no count. */
	total?: number;
	/** New items since last seen — a dot on the icon while the tab is inactive. */
	unread?: number;
	/** Shows a spinner in place of the total while it refreshes. */
	isRefreshing?: boolean;
	/** Tooltip for the total. */
	totalTitle?: string;
};

/** Segmented control: the active tab expands into a colored pill with icon,
 * label and total; inactive tabs collapse to just their icon (Interest tabs,
 * Right Now list/map). */
export function IconTabs<K extends string>({
	activeTab,
	tabs,
	onTabClick,
	color = "var(--accent)",
	contrastColor = "var(--accent-contrast)",
}: {
	activeTab: K;
	tabs: IconTabConfig<K>[];
	onTabClick: (tab: K) => void;
	/** Fill of the active pill and the unread dots. */
	color?: string;
	/** Text color on the active pill. */
	contrastColor?: string;
}) {
	const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
	const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
	const [isReady, setIsReady] = useState(false);

	const totalsKey = tabs.map((tab) => `${tab.total ?? ""}:${tab.isRefreshing ? 1 : 0}`).join(",");

	// Index of the currently active tab in the visual array
	const activeIndex = Math.max(tabs.findIndex((tab) => tab.key === activeTab), 0);

	// Sync indicator with the active tab's position and size in real-time
	useLayoutEffect(() => {
		const activeEl = tabsRef.current[activeIndex];
		if (!activeEl) return;

		const updateIndicator = () => {
			setIndicatorStyle({
				left: activeEl.offsetLeft,
				width: activeEl.offsetWidth,
			});
		};

		// Initial measurement
		updateIndicator();

		// The active tab grows/shrinks as its label and total animate in, and
		// neighbouring tabs shift with it — keep the pill glued to it throughout.
		const resizeObserver = new ResizeObserver(() => {
			updateIndicator();
		});

		// border-box: padding changes must count too, not just the content box.
		resizeObserver.observe(activeEl, { box: "border-box" });

		if (!isReady) {
			requestAnimationFrame(() => {
				requestAnimationFrame(() => setIsReady(true));
			});
		}

		return () => resizeObserver.disconnect();
	}, [activeIndex, isReady, totalsKey]);

	// 38px tall overall (32px tabs + 2px inset + border), same as the filter pills on Right Now / Inbox.
	return (
		<div
			className="glass-pill relative inline-flex items-center gap-0.5 p-0.5"
			// --pill-color tints the glass-pill frame too, which otherwise falls back to the accent.
			style={{ "--icon-tabs-color": color, "--icon-tabs-contrast": contrastColor, "--pill-color": color } as CSSProperties}
		>
			{/*
				The Sliding Pill:
				- Transitions width and position based on the measured active tab.
				- This creates a natural "stretch" look as it moves.
			*/}
			<div
				className={cn(
					"absolute top-0.5 bottom-0.5 rounded-full bg-[var(--icon-tabs-color)] shadow-sm",
					isReady ? "transition-all duration-300 ease-out" : "transition-none"
				)}
				style={{
					width: indicatorStyle.width,
					left: indicatorStyle.left,
				}}
			/>

			{tabs.map((tab, i) => {
				const isActive = activeIndex === i;
				const Icon = tab.icon;
				const hasUnread = !isActive && (tab.unread ?? 0) > 0;
				return (
					<button
						key={tab.key}
						ref={(el) => { tabsRef.current[i] = el; }}
						type="button"
						onClick={() => onTabClick(tab.key)}
						aria-label={tab.label}
						aria-pressed={isActive}
						className={cn(
							// Only colour/scale animate: an animated padding would leave the pill measuring a
							// mid-transition width. The sliding pill itself carries the motion.
							"relative z-10 flex h-8 items-center justify-center rounded-full transition-[color,transform] duration-300 ease-out active:scale-95",
							isActive
								// Without a total badge the label ends the pill, so it needs the same inset as the icon.
								? cn("gap-2 pl-3 text-[var(--icon-tabs-contrast)]", tab.total != null ? "pr-1" : "pr-3.5")
								: "w-9 text-[var(--text-muted)] hover:text-[var(--text)]",
						)}
					>
						<span className="relative flex shrink-0">
							<Icon className="h-[1.15rem] w-[1.15rem]" />
							{hasUnread && (
								<span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[var(--icon-tabs-color)] ring-2 ring-[var(--surface)]" />
							)}
						</span>
						{isActive && (
							<>
								<span className="whitespace-nowrap text-sm font-bold">{tab.label}</span>
								{tab.total != null && (
									<span
										className="relative flex h-6 min-w-[1.75rem] items-center justify-center rounded-full bg-white/20 px-2 text-xs font-bold tabular-nums"
										title={tab.totalTitle}
									>
										<span className={cn("transition-opacity duration-300", tab.isRefreshing ? "opacity-0" : "opacity-100")}>
											{tab.total}
										</span>
										{tab.isRefreshing && (
											<RefreshCw className="absolute h-3 w-3 animate-spin" />
										)}
									</span>
								)}
							</>
						)}
						{!isActive && hasUnread && <span className="sr-only">{tab.unread}</span>}
					</button>
				);
			})}
		</div>
	);
}
