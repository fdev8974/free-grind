import { useCallback, useState } from "react";
import { useDesktopBreakpoint } from "./useDesktopBreakpoint";

/** Tap-to-reveal for blurred media, the same as chat media: on touch the first
 * tap unblurs an item and the next one opens it; on desktop hovering unblurs it
 * and a click opens it right away. Revealed items stay revealed while the
 * component using this is mounted. */
export function useBlurReveal(blurEnabled: boolean) {
	const isDesktop = useDesktopBreakpoint();
	const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
	const [hovered, setHovered] = useState<string | null>(null);

	const isBlurred = (key: string) =>
		blurEnabled && !revealed.has(key) && (!isDesktop || hovered !== key);

	/** For the tap handler: true when this tap revealed the item (so don't open it). */
	const revealOnTap = useCallback((key: string) => {
		if (!blurEnabled || isDesktop || revealed.has(key)) return false;
		setRevealed((previous) => new Set(previous).add(key));
		return true;
	}, [blurEnabled, isDesktop, revealed]);

	const hoverProps = (key: string) => isDesktop
		? {
			onMouseEnter: () => setHovered(key),
			onMouseLeave: () => setHovered((current) => (current === key ? null : current)),
		}
		: {};

	return { isBlurred, revealOnTap, hoverProps };
}
