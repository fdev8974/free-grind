import toast from "react-hot-toast";
import { appLog } from "./logger";

// TEMP: diagnostics for the chat media tap that gets swallowed after closing
// the viewer with a swipe. Shows each step of the tap path as a toast. Remove
// this file and its call sites once the cause is found.
let seq = 0;

export function tapDebug(step: string) {
	seq += 1;
	const label = `#${seq} ${step}`;
	appLog.info("[tap-debug]", label);
	toast(label, { duration: 6000 });
}

/** Short description of an event target: tag, role, first classes. */
function describeTarget(target: EventTarget | null): string {
	if (!(target instanceof Element)) return String(target);
	const role = target.getAttribute("role");
	const cls = (target.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 3).join(".");
	return `${target.tagName.toLowerCase()}${role ? `[${role}]` : ""}${cls ? `.${cls}` : ""}`;
}

// For a few seconds after the viewer closes, every raw touch/click on the
// document is reported (capture phase, before anything can stop it), so we
// can see whether the next tap reaches the page at all and where it lands.
let watchUntil = 0;

export function watchRawTapsAfterClose() {
	watchUntil = Date.now() + 8000;
}

if (typeof document !== "undefined") {
	const report = (event: Event) => {
		if (Date.now() > watchUntil) return;
		const extra =
			event.type === "touchend" || event.type === "touchstart"
				? ` cancelable:${event.cancelable}`
				: event.type === "click"
					? ` prevented:${event.defaultPrevented}`
					: "";
		tapDebug(`raw ${event.type} -> ${describeTarget(event.target)}${extra}`);
	};
	for (const type of ["touchstart", "touchend", "touchcancel", "click"]) {
		document.addEventListener(type, report, { capture: true, passive: true });
	}
}
