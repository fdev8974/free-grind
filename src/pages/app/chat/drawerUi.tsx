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

/** Capture/upload action as a tile at the start of a media grid, same size as the media tiles. */
export function DrawerActionTile({ icon, label, onClick, disabled }: Omit<DrawerActionButtonProps, "layout">) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`${DRAWER_TILE_CLASS} flex flex-col items-center justify-center gap-2 border border-[var(--border)] bg-[var(--surface-2)] px-1.5 text-[var(--accent-readable)] transition active:scale-95 hover:bg-[color-mix(in_srgb,var(--surface-2)_80%,var(--text)_8%)] disabled:pointer-events-none disabled:opacity-40`}
		>
			{/* Icon sized here rather than by the caller, so the tile doesn't depend on the icon's own classes. */}
			<span className="flex shrink-0 items-center justify-center [&_svg]:h-6 [&_svg]:w-6">{icon}</span>
			<span className="line-clamp-2 max-w-full text-center text-[10.5px] font-medium leading-snug text-[var(--text-muted)]">{label}</span>
		</button>
	);
}

/** Empty state for a drawer tab: a small fanned stack of tiles with the tab's
 * icon, a title, a hint, and the tab's call to action below. */
export function DrawerEmptyState({
	icon,
	title,
	hint,
	children,
}: {
	icon: ReactNode;
	title: string;
	hint: string;
	children?: ReactNode;
}) {
	const tileClass = "absolute inset-0 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] shadow-sm";
	return (
		<div className="flex flex-col items-center gap-5 px-2 py-8 text-center">
			<div className="relative h-24 w-32">
				<div
					aria-hidden="true"
					className="absolute -inset-6 rounded-full blur-2xl"
					style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%)" }}
				/>
				<div className="absolute inset-y-2 left-1/2 aspect-square -translate-x-1/2">
					<div className={`${tileClass} -translate-x-7 -rotate-12 opacity-60`} />
					<div className={`${tileClass} translate-x-7 rotate-12 opacity-60`} />
					<div className={`${tileClass} flex items-center justify-center`}>
						<span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)] shadow-md shadow-[var(--accent)]/30">
							{icon}
						</span>
					</div>
				</div>
			</div>
			<div className="space-y-1">
				<p className="text-sm font-semibold text-[var(--text)]">{title}</p>
				<p className="mx-auto max-w-[17rem] text-xs leading-relaxed text-[var(--text-muted)]">{hint}</p>
			</div>
			{children}
		</div>
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

const PREVIEW_ANIMATION_MS = 180;

export function DrawerMediaPreview({ media }: { media: DrawerPreviewMedia | null }) {
	// Keep the last media mounted while it animates out, then drop it.
	const [shown, setShown] = useState<DrawerPreviewMedia | null>(media);
	const [isVisible, setIsVisible] = useState(false);

	useEffect(() => {
		if (media) {
			setShown(media);
			// Two frames so the hidden start state is painted before transitioning in.
			let inner = 0;
			const outer = requestAnimationFrame(() => {
				inner = requestAnimationFrame(() => setIsVisible(true));
			});
			return () => {
				cancelAnimationFrame(outer);
				cancelAnimationFrame(inner);
			};
		}
		setIsVisible(false);
		const timer = setTimeout(() => setShown(null), PREVIEW_ANIMATION_MS);
		return () => clearTimeout(timer);
	}, [media]);

	if (!shown) return null;
	const transition = `opacity ${PREVIEW_ANIMATION_MS}ms ease-out, transform ${PREVIEW_ANIMATION_MS}ms cubic-bezier(0.34, 1.3, 0.64, 1)`;
	return createPortal(
		<div
			className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-6 backdrop-blur-md"
			style={{ opacity: isVisible ? 1 : 0, transition: `opacity ${PREVIEW_ANIMATION_MS}ms ease-out` }}
		>
			<div
				className="max-h-full max-w-full overflow-hidden rounded-2xl shadow-2xl"
				style={{ opacity: isVisible ? 1 : 0, transform: `scale(${isVisible ? 1 : 0.88})`, transition }}
			>
				{shown.isVideo ? (
					<video src={shown.src} autoPlay muted loop playsInline className="max-h-[80dvh] max-w-full object-contain" />
				) : (
					<img src={shown.src} alt="" className="max-h-[80dvh] max-w-full object-contain" />
				)}
			</div>
		</div>,
		document.body,
	);
}
