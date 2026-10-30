import React, { forwardRef, useCallback, useState } from "react";
import { cn } from "../../utils/cn";
import { ScrollToTopButton } from "./ScrollToTopButton";
import { FEED_HEADER_OFFSET, FEED_MASK_GRADIENT_STOP } from "../../config/design-config";

interface FeedScrollContainerProps extends React.HTMLAttributes<HTMLDivElement> {
	children: React.ReactNode;
	/** Floating "back to top" pill once the feed is scrolled a screen down. Default on. */
	showScrollToTop?: boolean;
}

export const FeedScrollContainer = forwardRef<HTMLDivElement, FeedScrollContainerProps>(
	({ children, className, showScrollToTop = true, ...props }, ref) => {
		const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

		// Memoized so its identity is stable across re-renders — an inline ref
		// callback gets a new identity every render, and React responds to that
		// by calling the old one with null then the new one with the node, on
		// every single re-render. Consumers of the forwarded ref (e.g. a
		// virtualizer's getScrollElement) would otherwise see it flicker to
		// null and back on every re-render of this component.
		const setRefs = useCallback(
			(node: HTMLDivElement | null) => {
				setScrollEl(node);
				if (typeof ref === "function") {
					ref(node);
				} else if (ref) {
					ref.current = node;
				}
			},
			[ref],
		);

		return (
			<div
				className="relative flex-1 min-h-0"
				style={{ marginTop: `-${FEED_HEADER_OFFSET}` }}
			>
				<div
					ref={setRefs}
					// Native scrolling only: keeps the global Lenis (SmoothScroll) from
					// hijacking the wheel here. A per-feed Lenis used to sit on this
					// element too, but this attribute disabled it anyway — all it still
					// did was run a rAF loop every frame and hold a non-passive wheel
					// listener, which made every wheel tick wait on the main thread
					// (busy re-rendering the virtualized grid) and the desktop grid stutter.
					data-lenis-prevent
					// Marks the page's feed for index.css, whose page headers get the same
					// right inset as this scrollbar's (always reserved) gutter.
					data-feed-scroll
					className={cn("h-full overflow-y-auto [scrollbar-gutter:stable]", className)}
					style={{
						paddingTop: FEED_HEADER_OFFSET,
						maskImage: `linear-gradient(to bottom, transparent, black ${FEED_MASK_GRADIENT_STOP})`,
						WebkitMaskImage: `linear-gradient(to bottom, transparent, black ${FEED_MASK_GRADIENT_STOP})`,
					}}
					{...props}
				>
					<div>
						{children}
					</div>
				</div>
				{showScrollToTop && <ScrollToTopButton target={scrollEl} />}
			</div>
		);
	}
);

FeedScrollContainer.displayName = "FeedScrollContainer";
