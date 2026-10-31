import { useLayoutEffect, useState } from "react";

/**
 * The bottom safe-area inset, but only when it's tall enough to be Android
 * 3-button navigation (system buttons the UI must stay clear of); 0 for
 * gesture navigation / the iOS home indicator, which UI may overlap.
 */
export function useSystemNavInset(): number {
	const [inset, setInset] = useState(0);
	useLayoutEffect(() => {
		const probe = document.createElement("div");
		probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px)";
		document.body.appendChild(probe);
		const measure = () => {
			const value = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
			setInset(value > 40 ? value : 0);
		};
		measure();
		window.addEventListener("resize", measure);
		return () => {
			window.removeEventListener("resize", measure);
			probe.remove();
		};
	}, []);
	return inset;
}
