import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { haptic } from "../../../utils/haptics";

// Shared look for the media drawer and the sheets that pick from it (collection
// editor, album "add from drawer"), so they stay visually in sync.

export const drawerGridClass = (isDesktop: boolean) =>
	`grid gap-0.5 ${isDesktop ? "grid-cols-5" : "grid-cols-4"}`;

export const DRAWER_TILE_CLASS = "relative aspect-square overflow-hidden rounded-md";

type DrawerActionButtonProps = {
	icon: ReactNode;
	label: string;
	onClick: () => void;
	disabled?: boolean;
	/** "column" for a row of several actions, "row" for a single full-width one. */
	layout?: "column" | "row";
};

export function DrawerActionButton({ icon, label, onClick, disabled, layout = "column" }: DrawerActionButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`flex items-center rounded-2xl bg-[var(--surface-2)] text-[var(--text)] transition active:scale-95 hover:bg-[color-mix(in_srgb,var(--surface-2)_80%,var(--text)_8%)] disabled:pointer-events-none disabled:opacity-40 ${
				layout === "row" ? "w-full gap-3 px-3 py-2.5 text-left" : "flex-col gap-1.5 px-2 py-3"
			}`}
		>
			<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)]">
				{icon}
			</span>
			<span className={`font-semibold leading-tight ${layout === "row" ? "text-sm" : "text-xs"}`}>{label}</span>
		</button>
	);
}

export type DrawerPreviewMedia = { src: string; isVideo: boolean };

const LONG_PRESS_MS = 400;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

/**
 * Press-and-hold "peek" for drawer tiles: holding a tile shows a large preview
 * until release. Spread `bind(media)` onto a tile and gate its click with
 * `consumeClick()` so the release after a peek doesn't also select the tile.
 */
export function useDrawerMediaPreview() {
	const [preview, setPreview] = useState<DrawerPreviewMedia | null>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const startRef = useRef<{ x: number; y: number } | null>(null);
	const suppressClickRef = useRef(false);

	const cancelTimer = useCallback(() => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	const end = useCallback(() => {
		cancelTimer();
		startRef.current = null;
		setPreview(null);
	}, [cancelTimer]);

	useEffect(() => cancelTimer, [cancelTimer]);

	const bind = useCallback(
		(media: DrawerPreviewMedia) => ({
			onPointerDown: (event: PointerEvent<HTMLElement>) => {
				if (event.pointerType === "mouse" && event.button !== 0) return;
				suppressClickRef.current = false;
				startRef.current = { x: event.clientX, y: event.clientY };
				cancelTimer();
				timerRef.current = setTimeout(() => {
					timerRef.current = null;
					suppressClickRef.current = true;
					haptic(20);
					setPreview(media);
				}, LONG_PRESS_MS);
			},
			onPointerMove: (event: PointerEvent<HTMLElement>) => {
				const start = startRef.current;
				if (!start || !timerRef.current) return;
				if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_MOVE_TOLERANCE_PX) {
					cancelTimer();
				}
			},
			onPointerUp: end,
			onPointerCancel: end,
			onPointerLeave: () => {
				// Leaving the tile only aborts a pending press; an open peek stays
				// until the finger is lifted.
				cancelTimer();
			},
			onContextMenu: (event: MouseEvent<HTMLElement>) => event.preventDefault(),
		}),
		[cancelTimer, end],
	);

	/** True (once) when the click that follows a peek should be ignored. */
	const consumeClick = useCallback(() => {
		const suppressed = suppressClickRef.current;
		suppressClickRef.current = false;
		return suppressed;
	}, []);

	return { preview, bind, consumeClick };
}

export function DrawerMediaPreview({ media }: { media: DrawerPreviewMedia | null }) {
	if (!media) return null;
	return createPortal(
		<div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-6 backdrop-blur-md animate-in fade-in duration-150">
			<div className="max-h-full max-w-full overflow-hidden rounded-2xl shadow-2xl animate-in zoom-in-90 duration-200">
				{media.isVideo ? (
					<video src={media.src} autoPlay muted loop playsInline className="max-h-[80dvh] max-w-full object-contain" />
				) : (
					<img src={media.src} alt="" className="max-h-[80dvh] max-w-full object-contain" />
				)}
			</div>
		</div>,
		document.body,
	);
}
