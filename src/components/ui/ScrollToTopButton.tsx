import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp } from "lucide-react";
import { cn } from "../../utils/cn";

/** Floating "back to top" pill for a scrolling list: fades in once the list is
 * scrolled more than a screen down. Positioned absolutely — render it inside
 * the `relative` wrapper around the scroll element, not inside the scroller.
 * Mobile: centered above the bottom nav; desktop: bottom right, clear of the
 * centered action pills (Right Now, Sexual Health). */
export function ScrollToTopButton({ target, className }: { target: HTMLElement | null; className?: string }) {
	const { t } = useTranslation();
	const [isVisible, setIsVisible] = useState(false);

	useEffect(() => {
		if (!target) return;
		const update = () => setIsVisible(target.scrollTop > target.clientHeight);
		update();
		target.addEventListener("scroll", update, { passive: true });
		return () => target.removeEventListener("scroll", update);
	}, [target]);

	return (
		<button
			type="button"
			onClick={() => target?.scrollTo({ top: 0, behavior: "smooth" })}
			aria-label={t("common.scroll_to_top")}
			tabIndex={isVisible ? 0 : -1}
			className={cn(
				"glass-pill absolute z-30 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-[var(--text)] shadow-lg transition-all duration-200 active:scale-95",
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
