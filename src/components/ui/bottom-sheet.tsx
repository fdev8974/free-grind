import { createContext, useCallback, useContext, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { platform } from "@tauri-apps/plugin-os";

const BottomSheetContext = createContext<() => void>(() => {});

// Open sheets in mount order, so Escape only closes the topmost one when a
// sheet opens another on top of itself.
const openSheets: object[] = [];

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
	disabled?: boolean;
	onClick?: () => void;
}

export function SheetClose({ children, className, disabled, onClick }: SheetCloseProps) {
	const close = useBottomSheetClose();
	return (
		<button
			type="button"
			disabled={disabled}
			className={className}
			onClick={() => { onClick?.(); close(); }}
		>
			{children}
		</button>
	);
}

interface BottomSheetProps {
	onClose: () => void;
	onExpand?: () => void;
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
	onExpand,
	isDesktop = false,
	isProcessing = false,
	zIndex = "z-[60]",
	bg = "bg-[var(--surface)]",
	panelClassName = "",
	closeRef,
	children,
}: BottomSheetProps) {
	const [dragY, setDragY] = useState(0);
	const [isDragging, setIsDragging] = useState(false);
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

	const panelRef = useRef<HTMLDivElement>(null);
	const dragYRef = useRef(0);
	const onExpandRef = useRef(onExpand);
	useEffect(() => { onExpandRef.current = onExpand; }, [onExpand]);

	// Native-style drag: the whole sheet follows the finger, not just the
	// handle. A downward drag on the content only grabs the sheet when nothing
	// under the finger is scrolled down, so lists still scroll normally; a
	// mostly-horizontal move (sliders, carousels) is left alone. Registered
	// natively because React's touch listeners are passive and can't stop the
	// WebView's own overscroll once the sheet has taken the gesture.
	useEffect(() => {
		const panel = panelRef.current;
		if (!panel || isDesktop) return;

		let startX = 0;
		let startY = 0;
		let fromHandle = false;
		let mode: "pending" | "drag" | "ignore" = "ignore";
		let lastY = 0;
		let lastT = 0;
		let velocity = 0;

		const isScrolledAncestor = (target: EventTarget | null) => {
			for (let el = target as HTMLElement | null; el && el !== panel; el = el.parentElement) {
				if (el.dataset.sheetNoDrag !== undefined) return true;
				if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) {
					const overflowY = getComputedStyle(el).overflowY;
					if (overflowY === "auto" || overflowY === "scroll") return true;
				}
			}
			return false;
		};

		const setDrag = (y: number) => {
			dragYRef.current = y;
			setDragY(y);
		};

		const onStart = (e: TouchEvent) => {
			if (e.touches.length !== 1 || closingRef.current || isProcessingRef.current) {
				mode = "ignore";
				return;
			}
			const touch = e.touches[0];
			startX = touch.clientX;
			startY = touch.clientY;
			lastY = startY;
			lastT = e.timeStamp;
			velocity = 0;
			fromHandle = !!(e.target as HTMLElement).closest("[data-sheet-handle]");
			mode = !fromHandle && isScrolledAncestor(e.target) ? "ignore" : "pending";
		};

		const onMove = (e: TouchEvent) => {
			if (mode === "ignore") return;
			const touch = e.touches[0];
			const dx = touch.clientX - startX;
			const dy = touch.clientY - startY;

			if (mode === "pending") {
				if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
				// Content only hands over on a downward drag; an upward one is a
				// normal scroll. The handle takes both (up = expand).
				if (Math.abs(dx) > Math.abs(dy) || (!fromHandle && dy < 0)) {
					mode = "ignore";
					return;
				}
				mode = "drag";
				startY = touch.clientY;
				setIsDragging(true);
			}

			e.preventDefault();
			const delta = touch.clientY - startY;
			if (delta < -60 && fromHandle && onExpandRef.current) {
				onExpandRef.current();
				startY = touch.clientY;
				return;
			}
			const dt = e.timeStamp - lastT;
			if (dt > 0) velocity = 0.8 * ((touch.clientY - lastY) / dt) + 0.2 * velocity;
			lastY = touch.clientY;
			lastT = e.timeStamp;
			setDrag(Math.max(0, delta));
		};

		const onEnd = () => {
			if (mode !== "drag") {
				mode = "ignore";
				return;
			}
			mode = "ignore";
			const height = panel.offsetHeight || 1;
			const y = dragYRef.current;
			// Close on a flick even if it was short, or on a long slow drag.
			if ((velocity > 0.5 && y > 10) || y > Math.min(height * 0.3, 180)) animateCloseRef.current();
			setDrag(0);
			setIsDragging(false);
		};

		panel.addEventListener("touchstart", onStart, { passive: true });
		panel.addEventListener("touchmove", onMove, { passive: false });
		panel.addEventListener("touchend", onEnd);
		panel.addEventListener("touchcancel", onEnd);
		return () => {
			panel.removeEventListener("touchstart", onStart);
			panel.removeEventListener("touchmove", onMove);
			panel.removeEventListener("touchend", onEnd);
			panel.removeEventListener("touchcancel", onEnd);
		};
	}, [isDesktop]);

	const isShown = isVisible && !isClosing;
	const isAnimating = isVisible && !isDragging;
	const transform = isShown ? `translateY(${dragY}px)` : "translateY(110%)";
	// Scrim follows the sheet while dragging, like the native ones do.
	const panelHeight = panelRef.current?.offsetHeight || 1;
	const scrimOpacity = isShown ? 1 - Math.min(1, dragY / panelHeight) : 0;

	return (
		<BottomSheetContext.Provider value={animateClose}>
			<div
				className={`fixed inset-0 ${zIndex} flex flex-col justify-end no-touch-callout`}
				onClick={isProcessing ? undefined : animateClose}
			>
				<div
					aria-hidden
					className={`absolute inset-0 ${isDesktop ? "bg-black/45 backdrop-blur-sm" : "bg-black/50"}`}
					style={{
						opacity: scrimOpacity,
						transition: isAnimating ? "opacity 0.3s ease" : "none",
					}}
				/>
				<div
					ref={panelRef}
					className={`relative flex flex-col ${bg} shadow-2xl overflow-hidden overscroll-contain ${isDesktop ? "w-full max-w-[800px] mx-auto rounded-t-2xl border-x border-t border-[var(--border)]" : "w-full rounded-t-[24px] border-t border-[var(--border)]"} ${panelClassName}`}
					style={{
						transform,
						transition: isAnimating ? "transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)" : "none",
						willChange: "transform",
						paddingBottom: "max(16px, env(safe-area-inset-bottom))",
						minHeight: isDesktop ? undefined : "50dvh",
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
		</BottomSheetContext.Provider>
	);
}
