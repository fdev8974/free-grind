import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp } from "lucide-react";
import { cn } from "../../utils/cn";

/** Scrolls `target` to the top over a short ease-out, writing scrollTop
 * every frame instead of using a native smooth scroll. The lists this is used
 * on are virtualized, and a virtualizer corrects scrollTop whenever a row
 * scrolled into view measures differently than estimated — any such write
 * cancels a native smooth scroll partway up. Here a correction just gets
 * overwritten by the next frame. Returns a function that stops it. */
function animateScrollToTop(target: HTMLElement): () => void {
	const startTop = target.scrollTop;
	if (startTop <= 0) return () => {};
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		target.scrollTop = 0;
		return () => {};
	}
	const durationMs = Math.min(700, 250 + startTop / 25);
	const startedAt = performance.now();
	let frameId = 0;
	const stop = () => {
		cancelAnimationFrame(frameId);
		target.removeEventListener("wheel", stop);
		target.removeEventListener("touchstart", stop);
	};
	const step = (now: number) => {
		const progress = Math.min(1, (now - startedAt) / durationMs);
		const eased = 1 - (1 - progress) ** 3;
		target.scrollTop = startTop * (1 - eased);
		if (progress < 1) {
			frameId = requestAnimationFrame(step);
		} else {
			stop();
		}
	};
	// The user grabbing the list takes over.
	target.addEventListener("wheel", stop, { passive: true });
	target.addEventListener("touchstart", stop, { passive: true });
	frameId = requestAnimationFrame(step);
	return stop;
}

/** Floating "back to top" pill for a scrolling list: fades in once the list is
 * scrolled more than a screen down. Positioned absolutely — render it inside
 * the `relative` wrapper around the scroll element, not inside the scroller.
 * Mobile: centered above the bottom nav; desktop: bottom right, clear of the
 * centered action pills (Right Now, Sexual Health). */
export function ScrollToTopButton({ target, className }: { target: HTMLElement | null; className?: string }) {
	const { t } = useTranslation();
	const [isVisible, setIsVisible] = useState(false);
	const stopAnimationRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		if (!target) return;
		const update = () => setIsVisible(target.scrollTop > target.clientHeight);
		update();
		target.addEventListener("scroll", update, { passive: true });
		return () => {
			target.removeEventListener("scroll", update);
			stopAnimationRef.current?.();
		};
	}, [target]);

	return (
		<button
			type="button"
			onClick={() => {
				if (!target) return;
				stopAnimationRef.current?.();
				stopAnimationRef.current = animateScrollToTop(target);
			}}
			aria-label={t("common.scroll_to_top")}
			tabIndex={isVisible ? 0 : -1}
			className={cn(
				// Above the bottom nav (z-50), whose dark fade reaches up over this
				// spot, but below sheets/drawers and their backdrops (z-[60]).
				"glass-pill absolute z-[55] inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-[var(--text)] shadow-lg transition-all duration-200 active:scale-95",
				"bottom-[calc(var(--nav-height,env(safe-area-inset-bottom,0px))+0.75rem)] left-1/2 -translate-x-1/2",
				"rail:bottom-[var(--page-bottom)] rail:left-auto rail:right-6 rail:translate-x-0",
				isVisible ? "opacity-100" : "pointer-events-none translate-y-2 opacity-0",
				className,
			)}
		>
			<ArrowUp className="h-3.5 w-3.5" />
			{t("common.scroll_to_top")}
		</button>
	);
}
