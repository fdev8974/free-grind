import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ToastBar, useToaster, type DefaultToastOptions, type Toast, type ToastPosition } from "react-hot-toast";
import { CheckCircle2, AlertCircle, Loader2, Info } from "lucide-react";

const POSITION: ToastPosition = "top-center";

const TOAST_OPTIONS: DefaultToastOptions = {
	className:
		"surface-card !bg-[var(--surface)] !text-[var(--text)] !border-[var(--border)] !rounded-[var(--radius-md)] !px-4 !py-3 !shadow-2xl flex items-center gap-3",
	duration: 2500,
	style: {
		background: "var(--surface)",
		color: "var(--text)",
		border: "1px solid var(--border)",
	},
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
		icon: <Info className="w-5 h-5 text-blue-500" />,
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
			<ToastBar toast={toast} position={position} />
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
