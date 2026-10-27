import { useEffect } from "react";

/**
 * Publishes the on-screen keyboard height as `--keyboard-inset` on <html>.
 *
 * The mobile webview doesn't shrink the layout viewport when the keyboard
 * opens, so fixed/centered modals (native <dialog>s in particular) stay put
 * and end up hidden behind it. index.css reads this var to re-center open
 * dialogs inside the visible area. Same overlap math as the chat composer
 * (ChatThreadPanel), written straight to the DOM to avoid app-wide re-renders.
 */
export function useKeyboardInsetVar() {
	useEffect(() => {
		const viewport = typeof window !== "undefined" ? window.visualViewport : null;
		if (!viewport) {
			return;
		}

		const root = document.documentElement;
		let fullLayoutHeight = 0;
		let restingOverlap: number | null = null;

		const update = () => {
			fullLayoutHeight = Math.max(fullLayoutHeight, window.innerHeight);
			const visibleBottom = viewport.height + viewport.offsetTop;
			const overlap = Math.max(0, Math.round(fullLayoutHeight - visibleBottom));
			if (restingOverlap === null || overlap < restingOverlap) {
				restingOverlap = overlap;
			}
			const keyboardOverlap = overlap - restingOverlap;
			root.style.setProperty("--keyboard-inset", `${keyboardOverlap >= 60 ? keyboardOverlap : 0}px`);
		};

		update();
		viewport.addEventListener("resize", update);
		viewport.addEventListener("scroll", update);

		return () => {
			viewport.removeEventListener("resize", update);
			viewport.removeEventListener("scroll", update);
			root.style.removeProperty("--keyboard-inset");
		};
	}, []);
}
