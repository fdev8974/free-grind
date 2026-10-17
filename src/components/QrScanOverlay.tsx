import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { X } from "lucide-react";
import { isAndroid } from "../services/saveMedia";

const CORNERS = [
	"left-0 top-0 rounded-tl-3xl border-l-4 border-t-4",
	"right-0 top-0 rounded-tr-3xl border-r-4 border-t-4",
	"bottom-0 left-0 rounded-bl-3xl border-b-4 border-l-4",
	"bottom-0 right-0 rounded-br-3xl border-b-4 border-r-4",
];

/**
 * Controls drawn over the camera while scanQrCode() runs. Portaled outside
 * #app, which is hidden (and see-through) during the scan — see layout.css.
 */
export function QrScanOverlay({
	hint,
	cancelLabel,
	onCancel,
}: {
	hint: string;
	cancelLabel: string;
	onCancel: () => void;
}) {
	const onCancelRef = useRef(onCancel);
	onCancelRef.current = onCancel;

	// Android back cancels the scan instead of navigating the page behind it.
	useEffect(() => {
		if (!isAndroid()) return;
		let cancelled = false;
		let unregister: (() => void) | null = null;
		onBackButtonPress(() => onCancelRef.current())
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

	return createPortal(
		<div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center px-6">
			<button
				type="button"
				onClick={() => onCancelRef.current()}
				aria-label={cancelLabel}
				className="absolute right-4 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition active:scale-95"
				style={{ top: "calc(env(safe-area-inset-top, 0px) + 16px)" }}
			>
				<X className="h-5 w-5" />
			</button>
			{/* Viewfinder: a clear square whose huge shadow dims everything
			    around it, marked by corner brackets. */}
			<div className="relative aspect-square w-[70vw] max-w-[280px] rounded-3xl shadow-[0_0_0_9999px_rgba(0,0,0,0.6)]">
				{CORNERS.map((corner) => (
					<span key={corner} className={`absolute h-10 w-10 border-white ${corner}`} />
				))}
			</div>
			<p className="mt-8 max-w-[280px] rounded-full bg-black/60 px-4 py-2 text-center text-sm text-white backdrop-blur">{hint}</p>
		</div>,
		document.body,
	);
}
