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

let touchStartInfo: { t: number; x: number; y: number } | null = null;

if (typeof document !== "undefined") {
	const report = (event: Event) => {
		if (Date.now() > watchUntil) return;
		let extra = "";
		if (event instanceof TouchEvent && event.type === "touchstart") {
			const touch = event.touches[0];
			touchStartInfo = touch ? { t: performance.now(), x: touch.clientX, y: touch.clientY } : null;
			extra = ` focus:${describeTarget(document.activeElement)}`;
		} else if (event instanceof TouchEvent && event.type === "touchend") {
			const touch = event.changedTouches[0];
			if (touchStartInfo && touch) {
				const ms = Math.round(performance.now() - touchStartInfo.t);
				const moved = Math.round(Math.hypot(touch.clientX - touchStartInfo.x, touch.clientY - touchStartInfo.y));
				extra = ` ${ms}ms moved:${moved}px`;
			}
		} else if (event.type === "click" && event instanceof MouseEvent) {
			extra = ` at ${Math.round(event.clientX)},${Math.round(event.clientY)} prevented:${event.defaultPrevented}`;
		}
		if (event instanceof TouchEvent && event.type === "touchstart" && event.touches[0]) {
			extra += ` at ${Math.round(event.touches[0].clientX)},${Math.round(event.touches[0].clientY)}`;
		}
		tapDebug(`raw ${event.type} -> ${describeTarget(event.target)}${extra}`);
	};
	for (const type of [
		"touchstart",
		"touchend",
		"touchcancel",
		"pointerdown",
		"pointerup",
		"pointercancel",
		"click",
		"contextmenu",
		"dragstart",
	]) {
		document.addEventListener(type, report, { capture: true, passive: true });
	}
	// Layout movement under the finger: scrolls (capture, scroll doesn't
	// bubble) with position/height, and media reloading in the page.
	document.addEventListener(
		"scroll",
		(event) => {
			if (Date.now() > watchUntil) return;
			const el = event.target;
			if (!(el instanceof HTMLElement)) return;
			tapDebug(`scroll ${describeTarget(el)} top:${Math.round(el.scrollTop)} h:${el.scrollHeight}`);
		},
		{ capture: true, passive: true },
	);
	document.addEventListener(
		"load",
		(event) => {
			if (Date.now() > watchUntil) return;
			const el = event.target;
			if (!(el instanceof HTMLImageElement)) return;
			tapDebug(`img load ${el.src.slice(0, 24)}… ${el.naturalWidth}x${el.naturalHeight}`);
		},
		{ capture: true },
	);
		// Bubble-phase check: did anything along the way cancel the touchend? This
	// runs after every other listener has had its chance.
	window.addEventListener("touchend", (event) => {
		if (Date.now() > watchUntil) return;
		tapDebug(`touchend after handlers: defaultPrevented:${event.defaultPrevented}`);
	});
}
