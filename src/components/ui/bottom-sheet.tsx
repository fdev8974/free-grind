import { createContext, useCallback, useContext, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { platform } from "@tauri-apps/plugin-os";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

const BottomSheetContext = createContext<() => void>(() => {});
// Whether the enclosing sheet has detents (a fixed height its content fills).
const BottomSheetDetentedContext = createContext(false);

/** True inside an `expandable` sheet on mobile: the panel has a fixed height,
 * so a scroll area should fill it (`min-h-0 flex-1`) rather than cap itself. */
export const useIsBottomSheetDetented = () => useContext(BottomSheetDetentedContext);

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
	"aria-label"?: string;
}

export function SheetClose({ children, className, disabled, onClick, "aria-label": ariaLabel }: SheetCloseProps) {
	const close = useBottomSheetClose();
	return (
		<button
			type="button"
			disabled={disabled}
			className={className}
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
	"inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--text)_8%,transparent)] text-[var(--text-muted)] transition active:scale-90 active:bg-[color-mix(in_srgb,var(--text)_16%,transparent)] hover:bg-[color-mix(in_srgb,var(--text)_12%,transparent)] hover:text-[var(--text)] disabled:pointer-events-none disabled:opacity-40";

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

	const rootRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const lastDragEndRef = useRef(0);
	const dragYRef = useRef(0);
	const isDetented = expandable && !isDesktop;
	const [isExpanded, setIsExpanded] = useState(false);
	const isExpandedRef = useRef(false);
	const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight);

	useEffect(() => {
		if (!isDetented) return;
		const onResize = () => setViewportHeight(window.innerHeight);
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [isDetented]);

	// Detent heights, like iOS's medium/large: half the screen, and full
	// height minus a strip at the top so the page behind still peeks out.
	const mediumHeight = Math.round(viewportHeight * 0.55);
	const largeHeight = Math.round(Math.min(viewportHeight * 0.94, viewportHeight - 48));
	const detentsRef = useRef({ medium: mediumHeight, large: largeHeight });
	detentsRef.current = { medium: mediumHeight, large: largeHeight };

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

		const setDrag = (y: number) => {
			dragYRef.current = y;
			setDragY(y);
		};

		const setExpanded = (expanded: boolean) => {
			isExpandedRef.current = expanded;
			setIsExpanded(expanded);
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
			mode = !fromHandle && isScrolledAncestor(e.target) ? "ignore" : "pending";
		};

		const onMove = (e: TouchEvent) => {
			if (mode === "ignore") return;
			const touch = e.touches[0];
			const dx = touch.clientX - startX;
			const dy = touch.clientY - startY;

			if (mode === "pending") {
				if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
				// Content hands over an upward drag only while the sheet can
				// still grow; otherwise that's a normal scroll.
				const canGrow = isDetented && !isExpandedRef.current;
				if (Math.abs(dx) > Math.abs(dy) || (!fromHandle && dy < 0 && !canGrow)) {
					mode = "ignore";
					return;
				}
				mode = "drag";
				startY = touch.clientY;
				setIsDragging(true);
			}

			e.preventDefault();
			samples.push({ t: e.timeStamp, y: touch.clientY });
			if (samples.length > 8) samples.shift();
			const delta = touch.clientY - startY;
			setDrag(isDetented ? delta : Math.max(0, delta));
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
			const y = dragYRef.current;
			const velocity = releaseVelocity(e.timeStamp);
			const isFlick = Math.abs(velocity) > 0.6;

			if (isDetented) {
				const { medium, large } = detentsRef.current;
				const startHeight = isExpandedRef.current ? large : medium;
				const height = startHeight - y;
				const closeLine = medium - Math.min(medium * 0.3, 180);
				if (isFlick && velocity < 0) setExpanded(true);
				// A downward flick from full height settles at medium first,
				// like iOS, unless it was already dragged past it.
				else if (isFlick && velocity > 0) {
					if (isExpandedRef.current && height > medium - 40) setExpanded(false);
					else animateCloseRef.current();
				} else if (height < closeLine) animateCloseRef.current();
				else setExpanded(height > (medium + large) / 2);
			} else {
				const panelHeight = panel.offsetHeight || 1;
				if ((isFlick && velocity > 0 && y > 20) || y > Math.min(panelHeight * 0.3, 180)) animateCloseRef.current();
			}
			setDrag(0);
			setIsDragging(false);
		};

		root.addEventListener("touchstart", onStart, { passive: true });
		root.addEventListener("touchmove", onMove, { passive: false });
		root.addEventListener("touchend", onEnd);
		root.addEventListener("touchcancel", onEnd);
		return () => {
			root.removeEventListener("touchstart", onStart);
			root.removeEventListener("touchmove", onMove);
			root.removeEventListener("touchend", onEnd);
			root.removeEventListener("touchcancel", onEnd);
		};
	}, [isDesktop, isDetented]);

	const isShown = isVisible && !isClosing;
	const isAnimating = isVisible && !isDragging;

	// An expandable sheet's drag first changes its height between the detents
	// and only slides it down once it's below medium. Past full height it
	// rubber-bands instead of following the finger 1:1.
	let panelHeight: number | undefined;
	let offsetY = dragY;
	if (isDetented) {
		const target = (isExpanded ? largeHeight : mediumHeight) - dragY;
		if (target >= mediumHeight) {
			panelHeight = target > largeHeight ? largeHeight + Math.sqrt(target - largeHeight) * 3 : target;
			offsetY = 0;
		} else {
			panelHeight = mediumHeight;
			offsetY = mediumHeight - target;
		}
	}
	const transform = isShown ? `translateY(${offsetY}px)` : "translateY(110%)";
	// Scrim follows the sheet while dragging, like the native ones do.
	const visibleHeight = panelHeight ?? (panelRef.current?.offsetHeight || 1);
	const scrimOpacity = isShown ? 1 - Math.min(1, offsetY / visibleHeight) : 0;
	const easing = "0.32s cubic-bezier(0.32, 0.72, 0, 1)";

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
					aria-hidden
					className={`absolute inset-0 ${isDesktop ? "bg-black/45 backdrop-blur-sm" : "bg-black/50"}`}
					style={{
						opacity: scrimOpacity,
						transition: isAnimating ? "opacity 0.3s ease" : "none",
					}}
				/>
				<div
					ref={panelRef}
					className={`relative flex flex-col ${bg} shadow-2xl overflow-hidden overscroll-contain ${isDesktop ? "w-full max-w-[800px] mx-auto rounded-t-2xl border-x border-t border-[var(--border)]" : `w-full border-t border-[var(--border)] ${isDetented && isExpanded && dragY <= 0 ? "rounded-t-[16px]" : "rounded-t-[24px]"}`} ${panelClassName}`}
					style={{
						transform,
						height: panelHeight,
						transition: isAnimating ? `transform ${easing}, height ${easing}, border-radius ${easing}` : "none",
						willChange: "transform",
						paddingBottom: "max(16px, env(safe-area-inset-bottom))",
						minHeight: isDesktop || isDetented ? undefined : "50dvh",
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
