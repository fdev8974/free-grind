import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from "react";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { platform } from "@tauri-apps/plugin-os";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

const BottomSheetContext = createContext<() => void>(() => {});
// Whether the enclosing sheet has detents (a fixed height its content fills).
const BottomSheetDetentedContext = createContext(false);

/** How far the panel extends below the screen edge, hidden, so the bouncy
 * open/settle overshoot never reveals a gap underneath it. */
const SHEET_BLEED = 48;

/** True inside an `expandable` sheet on mobile: the panel has a fixed height,
 * so a scroll area should fill it (`min-h-0 flex-1`) rather than cap itself. */
export const useIsBottomSheetDetented = () => useContext(BottomSheetDetentedContext);

// Open sheets in mount order, so Escape only closes the topmost one when a
// sheet opens another on top of itself.
const openSheets: object[] = [];

// Active holds that keep sheets from taking a touch drag (see holdSheetDrag).
let sheetDragHolds = 0;

/** Keeps every sheet from starting a touch drag until the returned release
 * is called — for gestures that own the finger for a while, like the drawer's
 * hold-to-peek. Safe to release more than once. */
export function holdSheetDrag(): () => void {
	sheetDragHolds++;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		sheetDragHolds--;
	};
}

/** True while a holdSheetDrag() hold is active (e.g. a peek owns the finger). */
export const isSheetDragHeld = () => sheetDragHolds > 0;

/** Lets other back-button handlers (useAndroidBackToGrid) stand aside while a sheet handles it. */
export const isAnyBottomSheetOpen = () => openSheets.length > 0;

function isAndroid(): boolean {
	try {
		return platform() === "android";
	} catch {
		return false;
	}
}

// Each sheet tags its own history entry, so with sheets stacked a back press
// that lands on the lower sheet's entry still closes the upper one.
let nextSheetHistoryId = 1;
export const useBottomSheetClose = () => useContext(BottomSheetContext);

interface SheetCloseProps {
	children: ReactNode;
	className?: string;
	style?: CSSProperties;
	disabled?: boolean;
	onClick?: () => void;
	"aria-label"?: string;
}

export function SheetClose({ children, className, style, disabled, onClick, "aria-label": ariaLabel }: SheetCloseProps) {
	const close = useBottomSheetClose();
	return (
		<button
			type="button"
			disabled={disabled}
			className={className}
			style={style}
			aria-label={ariaLabel}
			onClick={() => { onClick?.(); close(); }}
		>
			{children}
		</button>
	);
}

/** Round, softly filled icon button for a sheet's header row (close and any
 * actions next to it). Tinted from --text so it reads on every sheet bg. */
export const SHEET_ICON_BUTTON_CLASS =
	"inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ink-tint-8 text-[var(--text-muted)] transition active:scale-90 active:ink-tint-16 hover:ink-tint-12 hover:text-[var(--text)] disabled:pointer-events-none disabled:opacity-40";

export function SheetCloseIcon() {
	return <X className="h-4 w-4" strokeWidth={2.5} />;
}

/** The sheet's close button, top right of its header. */
export function SheetCloseButton({ disabled, label }: { disabled?: boolean; label?: string }) {
	const { t } = useTranslation();
	return (
		<SheetClose disabled={disabled} className={SHEET_ICON_BUTTON_CLASS} aria-label={label ?? t("common.close")}>
			<SheetCloseIcon />
		</SheetClose>
	);
}

interface BottomSheetProps {
	onClose: () => void;
	/** Gives the sheet two native-style detents: it opens at medium height
	 * and can be dragged (or flicked) up to almost full screen and back. The
	 * panel then has a fixed height, so its scrolling content should be a
	 * `min-h-0 flex-1` child that fills it. Mobile only. */
	expandable?: boolean;
	isDesktop?: boolean;
	isProcessing?: boolean;
	zIndex?: string;
	bg?: string;
	panelClassName?: string;
	/** Receives the sheet's animated close, for code outside its children —
	 * e.g. a parent closing it once an async action succeeded. Use this
	 * instead of unmounting the sheet directly, which skips the slide-out
	 * and leaves its history entry behind. Works even while isProcessing. */
	closeRef?: MutableRefObject<(() => void) | null>;
	children: ReactNode;
}

export function BottomSheet({
	onClose,
	expandable = false,
	isDesktop = false,
	isProcessing = false,
	zIndex = "z-[60]",
	bg = "bg-[var(--surface)]",
	panelClassName = "",
	closeRef,
	children,
}: BottomSheetProps) {
	const [isVisible, setIsVisible] = useState(false);
	const [isClosing, setIsClosing] = useState(false);
	const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const closingRef = useRef(false);
	const backAlreadyDoneRef = useRef(false);
	const didPushHistoryRef = useRef(false);
	const historyIdRef = useRef<number | null>(null);
	const animateCloseRef = useRef<() => void>(() => {});

	// useEffect fires after browser has painted — double RAF ensures initial
	// translateY(120%) is committed before we transition to translateY(0)
	useEffect(() => {
		let r1: number, r2: number;
		r1 = requestAnimationFrame(() => {
			r2 = requestAnimationFrame(() => setIsVisible(true));
		});
		return () => {
			cancelAnimationFrame(r1);
			cancelAnimationFrame(r2);
			if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
		};
	}, []);

	const closeAnimated = useCallback(() => {
		if (closingRef.current) return;
		closingRef.current = true;
		if (!backAlreadyDoneRef.current && didPushHistoryRef.current) {
			didPushHistoryRef.current = false;
			history.back();
		}
		setIsClosing(true);
		closeTimerRef.current = setTimeout(onClose, 320);
	}, [onClose]);

	const animateClose = useCallback(() => {
		if (isProcessing) return;
		closeAnimated();
	}, [isProcessing, closeAnimated]);

	useEffect(() => { animateCloseRef.current = animateClose; }, [animateClose]);

	useEffect(() => {
		if (!closeRef) return;
		closeRef.current = closeAnimated;
		return () => {
			if (closeRef.current === closeAnimated) closeRef.current = null;
		};
	}, [closeRef, closeAnimated]);

	const isProcessingRef = useRef(isProcessing);
	useEffect(() => { isProcessingRef.current = isProcessing; }, [isProcessing]);

	useEffect(() => {
		// Allocated once per sheet (not per effect run), so a StrictMode re-run
		// still matches the entry pushed by the first run.
		historyIdRef.current ??= nextSheetHistoryId++;
		const historyId = historyIdRef.current;
		if (!didPushHistoryRef.current) {
			didPushHistoryRef.current = true;
			history.pushState({ bottomSheet: true, bottomSheetId: historyId }, "");
		}
		const onPopState = () => {
			if (history.state?.bottomSheetId === historyId) return;
			if (closingRef.current) return;
			backAlreadyDoneRef.current = true;
			animateCloseRef.current();
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	const sheetIdRef = useRef({});
	useEffect(() => {
		const id = sheetIdRef.current;
		openSheets.push(id);
		return () => {
			const index = openSheets.indexOf(id);
			if (index !== -1) openSheets.splice(index, 1);
		};
	}, []);

	// Android back closes the topmost sheet directly instead of relying on the
	// WebView's own history back: on the grid no back handler is registered
	// (so back can leave the app there), and the native default only goes back
	// when canGoBack() says so, which isn't reliable for pushState entries.
	useEffect(() => {
		if (!isAndroid()) return;
		let cancelled = false;
		let unregister: (() => void) | null = null;
		onBackButtonPress(() => {
			if (openSheets[openSheets.length - 1] !== sheetIdRef.current) return;
			// A locked sheet can still have a non-sheet overlay stacked on top
			// with its own history entry (e.g. the album viewer over the album
			// sheet) — hand the back press to that overlay's popstate handler.
			if (isProcessingRef.current) {
				if (history.state?.bottomSheetId !== historyIdRef.current) history.back();
				return;
			}
			animateCloseRef.current();
		})
			.then((listener) => {
				if (cancelled) void listener.unregister();
				else unregister = () => void listener.unregister();
			})
			.catch(() => {});
		return () => {
			cancelled = true;
			unregister?.();
		};
	}, []);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (openSheets[openSheets.length - 1] !== sheetIdRef.current) return;
			if (e.key === "Escape" && !isProcessing) {
				e.stopImmediatePropagation();
				animateClose();
			}
		};
		window.addEventListener("keydown", onKeyDown, { capture: true });
		return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
	}, [isProcessing, animateClose]);

	const rootRef = useRef<HTMLDivElement>(null);
	const scrimRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const lastDragEndRef = useRef(0);
	const isDetented = expandable && !isDesktop;
	const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight);

	useEffect(() => {
		if (!isDetented) return;
		const onResize = () => setViewportHeight(window.innerHeight);
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [isDetented]);

	// Position state lives in refs and is written straight to the DOM, not
	// rendered: a drag moves the sheet every frame, and a React render per
	// touchmove (plus transitions toggling under it) made it stutter.
	const layoutRef = useRef({
		detented: isDetented,
		// Detent heights, like iOS's medium/large: half the screen, and full
		// height minus a strip at the top so the page behind still peeks out.
		medium: 0,
		large: 0,
		expanded: false,
		visible: false,
		dragY: 0,
		// Height of a non-detented sheet, measured when a drag starts.
		naturalHeight: 1,
	});
	const layout = layoutRef.current;
	layout.detented = isDetented;
	layout.visible = isVisible;
	layout.medium = Math.round(viewportHeight * 0.55);
	layout.large = Math.round(Math.min(viewportHeight * 0.94, viewportHeight - 48));

	const applyLayout = useCallback((animate: boolean) => {
		const panel = panelRef.current;
		const scrim = scrimRef.current;
		if (!panel || !scrim) return;
		const { detented, medium, large, expanded, visible, dragY } = layoutRef.current;
		const shown = visible && !closingRef.current;

		// An expandable sheet's drag first changes its height between the
		// detents and only slides it down once it's below medium. Past full
		// height it rubber-bands instead of following the finger 1:1.
		let height: number | null = null;
		let offsetY = Math.max(0, dragY);
		if (detented) {
			const target = (expanded ? large : medium) - dragY;
			if (target >= medium) {
				height = target > large ? large + Math.sqrt(target - large) * 3 : target;
				offsetY = 0;
			} else {
				height = medium;
				offsetY = medium - target;
			}
		}

		// Opening and settling overshoot slightly (~3%) for a bit of bounce; the
		// panel's offscreen bleed covers the gap that briefly opens below it.
		// Closing keeps the plain curve so it doesn't bob up on the way out.
		const easing = shown ? "0.45s cubic-bezier(0.34, 1.3, 0.64, 1)" : "0.32s cubic-bezier(0.32, 0.72, 0, 1)";
		panel.style.transition = animate ? `transform ${easing}, height ${easing}` : "none";
		panel.style.height = height === null ? "" : `${height + SHEET_BLEED}px`;
		panel.style.transform = shown ? `translateY(${offsetY}px)` : "translateY(110%)";
		// Scrim follows the sheet while dragging, like the native ones do.
		const visibleHeight = height ?? layoutRef.current.naturalHeight;
		scrim.style.transition = animate ? "opacity 0.3s ease" : "none";
		scrim.style.opacity = shown ? String(1 - Math.min(1, offsetY / visibleHeight)) : "0";
	}, []);

	// Before paint, so the sheet never shows a frame at its final position
	// before sliding in. Animated once it's visible (open, close, resize).
	useLayoutEffect(() => {
		applyLayout(isVisible);
	}, [applyLayout, isVisible, isClosing, isDetented, viewportHeight]);

	// Native-style drag: the whole sheet follows the finger, not just the
	// handle, and so does a drag that starts on the scrim above it. A
	// downward drag on the content only grabs the sheet when nothing under the
	// finger is scrolled down, so lists still scroll normally; a
	// mostly-horizontal move (sliders, carousels) is left alone. An expandable
	// sheet at medium height also takes upward drags, growing before its
	// content scrolls, like the native ones. Registered natively because
	// React's touch listeners are passive and can't stop the WebView's own
	// overscroll once the sheet has taken the gesture.
	useEffect(() => {
		const root = rootRef.current;
		const panel = panelRef.current;
		if (!root || !panel || isDesktop) return;

		let startX = 0;
		let startY = 0;
		let fromHandle = false;
		let mode: "pending" | "drag" | "ignore" = "ignore";
		// Recent finger positions, for the release velocity.
		let samples: { t: number; y: number }[] = [];
		let frame = 0;

		const isScrolledAncestor = (target: EventTarget | null) => {
			for (let el = target as HTMLElement | null; el && el !== panel; el = el.parentElement) {
				// Maps pan on every drag direction, so they always keep the gesture.
				if (el.dataset.sheetNoDrag !== undefined || el.classList.contains("maplibregl-map")) return true;
				if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) {
					const overflowY = getComputedStyle(el).overflowY;
					if (overflowY === "auto" || overflowY === "scroll") return true;
				}
			}
			return false;
		};

		// At most one layout write per frame, however many touchmoves arrive.
		const scheduleLayout = () => {
			if (frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				applyLayout(false);
			});
		};

		const onStart = (e: TouchEvent) => {
			if (e.touches.length !== 1 || closingRef.current || isProcessingRef.current) {
				mode = "ignore";
				return;
			}
			const touch = e.touches[0];
			startX = touch.clientX;
			startY = touch.clientY;
			samples = [{ t: e.timeStamp, y: startY }];
			const target = e.target as HTMLElement;
			fromHandle = !!target.closest("[data-sheet-handle]") || !panel.contains(target);
			mode = "pending";
		};

		const onMove = (e: TouchEvent) => {
			if (mode === "ignore") return;
			const touch = e.touches[0];
			const dx = touch.clientX - startX;
			const dy = touch.clientY - startY;
			const state = layoutRef.current;

			if (mode === "pending") {
				if (sheetDragHolds > 0) {
					mode = "ignore";
					return;
				}
				if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
				// Content hands over an upward drag only while the sheet can
				// still grow; otherwise that's a normal scroll.
				const canGrow = state.detented && !state.expanded;
				// Checked here rather than on touchstart, so content that only
				// claims the gesture after a long press (drag-to-reorder) wins.
				if (
					Math.abs(dx) > Math.abs(dy)
					|| (!fromHandle && dy < 0 && !canGrow)
					|| (!fromHandle && isScrolledAncestor(e.target))
				) {
					mode = "ignore";
					return;
				}
				mode = "drag";
				startY = touch.clientY;
				state.naturalHeight = panel.offsetHeight - SHEET_BLEED || 1;
			}

			e.preventDefault();
			samples.push({ t: e.timeStamp, y: touch.clientY });
			if (samples.length > 8) samples.shift();
			state.dragY = touch.clientY - startY;
			scheduleLayout();
		};

		const releaseVelocity = (now: number) => {
			// Only the last ~100ms count, so a drag that paused before lifting
			// isn't mistaken for a flick.
			const recent = samples.filter((sample) => now - sample.t <= 100);
			if (recent.length < 2) return 0;
			const first = recent[0];
			const last = recent[recent.length - 1];
			return last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
		};

		const onEnd = (e: TouchEvent) => {
			if (mode !== "drag") {
				mode = "ignore";
				return;
			}
			mode = "ignore";
			lastDragEndRef.current = performance.now();
			if (frame) {
				cancelAnimationFrame(frame);
				frame = 0;
			}
			const state = layoutRef.current;
			const y = state.dragY;
			const velocity = releaseVelocity(e.timeStamp);
			const isFlick = Math.abs(velocity) > 0.6;

			// Decide first, then animate once from where the finger left the
			// sheet, so closing doesn't bounce back to rest on the way out.
			let close = false;
			if (state.detented) {
				const { medium, large } = state;
				const height = (state.expanded ? large : medium) - y;
				const closeLine = medium - Math.min(medium * 0.3, 180);
				if (isFlick && velocity < 0) state.expanded = true;
				// A downward flick from full height settles at medium first,
				// like iOS, unless it was already dragged past it.
				else if (isFlick && velocity > 0) {
					if (state.expanded && height > medium - 40) state.expanded = false;
					else close = true;
				} else if (height < closeLine) close = true;
				else state.expanded = height > (medium + large) / 2;
			} else {
				close = (isFlick && velocity > 0 && y > 20) || y > Math.min(state.naturalHeight * 0.3, 180);
			}

			if (close) animateCloseRef.current();
			// When the close was refused (isProcessing) this settles it back.
			if (!close || !closingRef.current) state.dragY = 0;
			applyLayout(true);
		};

		root.addEventListener("touchstart", onStart, { passive: true });
		root.addEventListener("touchmove", onMove, { passive: false });
		root.addEventListener("touchend", onEnd);
		root.addEventListener("touchcancel", onEnd);
		return () => {
			if (frame) cancelAnimationFrame(frame);
			root.removeEventListener("touchstart", onStart);
			root.removeEventListener("touchmove", onMove);
			root.removeEventListener("touchend", onEnd);
			root.removeEventListener("touchcancel", onEnd);
		};
	}, [isDesktop, applyLayout]);

	return (
		<BottomSheetContext.Provider value={animateClose}>
		<BottomSheetDetentedContext.Provider value={isDetented}>
			<div
				ref={rootRef}
				className={`fixed inset-0 ${zIndex} flex flex-col justify-end no-touch-callout`}
				onClick={() => {
					// A drag that ended on the scrim isn't a tap on it.
					if (isProcessing || performance.now() - lastDragEndRef.current < 400) return;
					animateClose();
				}}
			>
				<div
					ref={scrimRef}
					aria-hidden
					className={`absolute inset-0 ${isDesktop ? "bg-black/45 backdrop-blur-sm" : "bg-black/50"}`}
				/>
				<div
					ref={panelRef}
					className={`relative flex flex-col ${bg} overflow-hidden overscroll-contain ${isDesktop ? "w-full max-w-[800px] mx-auto rounded-t-2xl border-x border-t border-[var(--border)] shadow-2xl" : "w-full rounded-t-[24px] shadow-[0_-1px_4px_rgba(0,0,0,0.25),0_-10px_36px_rgba(0,0,0,0.5)]"} ${panelClassName}`}
					// transform, height and transition are set by applyLayout.
					style={{
						willChange: "transform",
						// Extends SHEET_BLEED past the screen edge so the open/settle overshoot
						// never shows a gap under the sheet.
						marginBottom: -SHEET_BLEED,
						paddingBottom: `calc(max(16px, env(safe-area-inset-bottom)) + ${SHEET_BLEED}px)`,
						minHeight: isDesktop || isDetented ? undefined : `calc(50dvh + ${SHEET_BLEED}px)`,
					}}
					onClick={(e) => e.stopPropagation()}
				>
					{!isDesktop && (
						<div data-sheet-handle className="flex shrink-0 justify-center pt-3 pb-2 touch-none">
							<div className="h-1 w-9 rounded-full bg-[var(--text-muted)]/40" />
						</div>
					)}
					{isDesktop && <div className="pt-4" />}
					{children}
				</div>
			</div>
		</BottomSheetDetentedContext.Provider>
		</BottomSheetContext.Provider>
	);
}
