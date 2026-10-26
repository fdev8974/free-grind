import toast from "react-hot-toast";
import { appLog } from "./logger";

// TEMP: diagnostics for the album peek that opens, closes and opens again on
// the shared albums page. Shows each step as a toast. Remove this file and its
// call sites once the cause is found.
let seq = 0;
const startedAt = performance.now();

export function peekDebug(step: string) {
	seq += 1;
	const label = `#${seq} +${Math.round(performance.now() - startedAt) % 100000}ms ${step}`;
	appLog.info("[peek-debug]", label);
	toast(label, { duration: 8000 });
}
