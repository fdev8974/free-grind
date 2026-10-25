import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import toastApi, { resolveValue, useToaster, type DefaultToastOptions, type Toast, type ToastPosition } from "react-hot-toast";
import { CheckCircle2, AlertCircle, Loader2, Info } from "lucide-react";

const POSITION: ToastPosition = "top-center";

const TOAST_OPTIONS: DefaultToastOptions = {
	duration: 2500,
	success: {
		icon: <CheckCircle2 className="w-5 h-5 text-green-500" />,
	},
	error: {
		icon: <AlertCircle className="w-5 h-5 text-red-500" />,
	},
	loading: {
		icon: <Loader2 className="w-5 h-5 text-[var(--accent)] animate-spin" />,
	},
	blank: {
		icon: <Info className="w-5 h-5 text-[var(--accent)]" />,
	},
};

const prefersReducedMotion =
	typeof window !== "undefined" && typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)").matches : false;

function offsetStyle(position: ToastPosition, offset: number): React.CSSProperties {
	const isTop = position.includes("top");
	const horizontal = position.includes("center")
		? { justifyContent: "center" as const }
		: position.includes("right")
			? { justifyContent: "flex-end" as const }
			: {};
	return {
		left: 0,
		right: 0,
		display: "flex",
		position: "absolute",
		transition: prefersReducedMotion ? undefined : "all 230ms cubic-bezier(.21,1.02,.73,1)",
		transform: `translateY(${offset * (isTop ? 1 : -1)}px)`,
		...(isTop ? { top: 0 } : { bottom: 0 }),
		...horizontal,
	};
}

// Same floating-glass look as the composer's popups, and the same slightly
// overshooting curve as the bottom sheets, so toasts read as part of the app
// rather than a web widget. Slides down from under the status bar, springs
// in, and can be flicked back up to dismiss.
const ENTER_EASING = "cubic-bezier(0.34, 1.3, 0.64, 1)";
const SWIPE_DISMISS_PX = 24;

function ToastPill({ toast }: { toast: Toast }) {
	// Starts hidden and flips to shown after the first paint, so the enter
	// transition actually runs.
	const [entered, setEntered] = useState(false);
	const [dragY, setDragY] = useState(0);
	const [isDragging, setIsDragging] = useState(false);
	const dragRef = useRef<{ pointerId: number; startY: number } | null>(null);

	useEffect(() => {
		let r2 = 0;
		const r1 = requestAnimationFrame(() => {
			r2 = requestAnimationFrame(() => setEntered(true));
		});
		return () => {
			cancelAnimationFrame(r1);
			cancelAnimationFrame(r2);
		};
	}, []);

	const shown = entered && toast.visible;
	const transform = shown
		? `translateY(${dragY}px) scale(1)`
		: "translateY(-140%) scale(0.92)";
	const transition = prefersReducedMotion
		? "opacity 150ms ease"
		: isDragging
			? "none"
			: shown
				? `transform 450ms ${ENTER_EASING}, opacity 200ms ease`
				: "transform 260ms cubic-bezier(0.32, 0.72, 0, 1), opacity 200ms ease";

	return (
		<div
			{...toast.ariaProps}
			// Touch only: a mouse drag here should keep selecting text.
			onPointerDown={(e) => {
				if (e.pointerType !== "touch") return;
				dragRef.current = { pointerId: e.pointerId, startY: e.clientY };
				setIsDragging(true);
			}}
			onPointerMove={(e) => {
				const drag = dragRef.current;
				if (!drag || drag.pointerId !== e.pointerId) return;
				const dy = e.clientY - drag.startY;
				// Follows the finger upwards, rubber-bands downwards.
				setDragY(dy < 0 ? dy : Math.sqrt(dy) * 2);
			}}
			onPointerUp={(e) => {
				const drag = dragRef.current;
				if (!drag || drag.pointerId !== e.pointerId) return;
				dragRef.current = null;
				setIsDragging(false);
				if (e.clientY - drag.startY < -SWIPE_DISMISS_PX) toastApi.dismiss(toast.id);
				setDragY(0);
			}}
			onPointerCancel={() => {
				dragRef.current = null;
				setIsDragging(false);
				setDragY(0);
			}}
			className="flex max-w-[min(420px,100%)] touch-pan-x items-center gap-2.5 rounded-[22px] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] py-2.5 pl-3 pr-4 text-sm font-medium text-[var(--text)] shadow-[0_-1px_4px_rgba(0,0,0,0.12),0_8px_32px_rgba(0,0,0,0.3)] ring-1 ring-[var(--border)]/40 backdrop-blur-xl"
			style={{
				opacity: shown ? 1 : 0,
				transform: prefersReducedMotion ? undefined : transform,
				transformOrigin: "top center",
				transition,
				...toast.style,
			}}
		>
			{toast.icon ? <span className="flex shrink-0 items-center">{toast.icon}</span> : null}
			<span className="min-w-0 break-words leading-snug">{resolveValue(toast.message, toast)}</span>
		</div>
	);
}

function ToastItem({ toast, offset, onHeightUpdate }: { toast: Toast; offset: number; onHeightUpdate: (id: string, height: number) => void }) {
	const ref = useRef<HTMLDivElement>(null);
	const position = toast.position || POSITION;

	useEffect(() => {
		const node = ref.current;
		if (!node) return;
		const update = () => onHeightUpdate(toast.id, node.getBoundingClientRect().height);
		update();
		const observer = new ResizeObserver(update);
		observer.observe(node);
		return () => observer.disconnect();
	}, [toast.id, onHeightUpdate]);

	return (
		<div ref={ref} style={{ ...offsetStyle(position, offset), pointerEvents: toast.visible ? "auto" : "none", zIndex: 9999 }}>
			<ToastPill toast={toast} />
		</div>
	);
}

// Elements that toasts should currently render into instead of the document
// body. A native <dialog> shown via showModal() is promoted to the browser's
// top layer, which always paints above regular document content regardless of
// z-index, so toasts rendered at the app root end up hidden behind the
// dialog's backdrop. An open dialog mounts a <ToasterHost /> and the single
// AppToaster portals into the most recently mounted one, putting the toasts
// in that same top-layer subtree so they paint above the backdrop.
//
// This must stay a portal of the one AppToaster rather than a second
// useToaster() instance: react-hot-toast 2.6's store, on unmount, removes the
// *first* subscriber with the same toaster id instead of its own. A second
// toaster unmounting therefore silently unsubscribed the app-wide one, which
// then froze on its last state — e.g. a toast visible forever.
let hosts: HTMLElement[] = [];
const hostListeners = new Set<() => void>();

function setHosts(next: HTMLElement[]) {
	hosts = next;
	hostListeners.forEach((l) => l());
}

function subscribeHosts(listener: () => void) {
	hostListeners.add(listener);
	return () => hostListeners.delete(listener);
}

const getActiveHost = () => hosts[hosts.length - 1] ?? null;

// Mount only while the surrounding top-layer element (e.g. dialog) is open —
// a host inside a closed dialog would render the toasts invisibly.
export function ToasterHost() {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		setHosts([...hosts, el]);
		return () => setHosts(hosts.filter((h) => h !== el));
	}, []);

	return <div ref={ref} />;
}

// This is a hand-rolled toaster (using react-hot-toast's exported ToastBar +
// useToaster primitives) instead of the library's own <Toaster>. The stock
// <Toaster> pauses its auto-dismiss timer on mouseenter and only resumes on
// mouseleave. Mobile webviews fire a synthetic mouseenter on tap but never a
// matching mouseleave, so any tap landing on/near a toast permanently
// freezes dismissal for every toast, fixable only by relaunching the app. We
// never wire up start/endPause at all here, so that state can't get stuck —
// and toast text (e.g. coordinates copied out for the locate triangulation
// feature) stays selectable, since we don't need to disable pointer events
// to work around the bug.
//
// Mount exactly once (main.tsx); use <ToasterHost /> inside dialogs.
export function AppToaster() {
	const { toasts, handlers } = useToaster(TOAST_OPTIONS);
	const host = useSyncExternalStore(subscribeHosts, getActiveHost);

	const content = (
		<div
			style={{
				position: "fixed",
				zIndex: 9999,
				// Offset the toast container to avoid overlapping with the device status bar or notch.
				// We use a larger offset to ensure visibility even if env() is not populated.
				top: "calc(env(safe-area-inset-top, 0px) + 54px)",
				left: 16,
				right: 16,
				bottom: 16,
				pointerEvents: "none",
			}}
		>
			{toasts.map((t) => (
				<ToastItem
					key={t.id}
					toast={t}
					offset={handlers.calculateOffset(t, { defaultPosition: POSITION })}
					onHeightUpdate={handlers.updateHeight}
				/>
			))}
		</div>
	);

	return host ? createPortal(content, host) : content;
}
