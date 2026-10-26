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
	toast(label, { duration: 4000 });
}
