/**
 * Shared building blocks of the developer inspector pages (API Inspector,
 * Push Inspector): header icon buttons, timestamps, copy and code blocks.
 */

import { Copy } from "lucide-react";
import toast from "react-hot-toast";
import { SheetSection } from "../../../components/ui/sheet-section";
import { cn } from "../../../utils/cn";

export const HEADER_ICON_BUTTON_CLASS =
	"header-icon-btn inline-flex shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-2 text-[var(--text-muted)] transition-colors hover:text-[var(--text)] disabled:opacity-40";

export function formatTimestamp(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function copyText(text: string, what: string) {
	void navigator.clipboard.writeText(text).then(
		() => toast.success(`${what} copied`, { id: "inspector-copy" }),
		() => toast.error("Couldn't copy", { id: "inspector-copy" }),
	);
}

/** A labelled code block with its own copy button. */
export function CodeBlock({ title, text, tone = "default" }: { title: string; text: string | null; tone?: "default" | "error" }) {
	return (
		<SheetSection
			title={title}
			badge={text ? (
				<button
					type="button"
					onClick={() => copyText(text, title)}
					className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold text-[var(--accent)] transition hover:accent-tint-14"
				>
					<Copy className="h-3 w-3" />
					Copy
				</button>
			) : undefined}
		>
			{/* Full length: the sheet itself scrolls (and grows when expanded),
			    rather than a small box scrolling inside it. */}
			<pre
				className={cn(
					"min-w-0 whitespace-pre-wrap break-all rounded-xl px-3 py-2.5 font-mono text-xs leading-relaxed",
					tone === "error" ? "bg-red-500/10 text-red-500" : "bg-[var(--surface-2)] text-[var(--text)]",
					!text && "text-[var(--text-muted)]",
				)}
			>
				{text ?? "(empty)"}
			</pre>
		</SheetSection>
	);
}
