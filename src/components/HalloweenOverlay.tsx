import { createPortal } from "react-dom";
import { useIsHalloween } from "../hooks/useIsHalloween";

export function HalloweenOverlay() {
	const isHalloween = useIsHalloween();
	if (!isHalloween) {
		return null;
	}

	return createPortal(
		<div className="halloween-vignette pointer-events-none fixed inset-0 z-[9998]" aria-hidden="true" />,
		document.body,
	);
}
