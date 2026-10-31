/**
 * Shared building blocks of the developer inspector pages (API Inspector,
 * Push Inspector, Assignments): header icon buttons, search bar, timestamps,
 * copy and code blocks.
 */

import { Copy, Search, X } from "lucide-react";
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

/** Flat page search bar, like the one above the settings list — the floating
 * SheetSearchInput pill stands out against the page's cards. */
export function PageSearchBar({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
	return (
		<div className="settings-search-bar flex items-center gap-2.5 px-4 py-0.5">
			<Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
			<input
				type="search"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape") onChange("");
				}}
				placeholder={placeholder}
				className="h-11 min-w-0 flex-1 bg-transparent text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none"
			/>
			{value ? (
				<button
					type="button"
					onClick={() => onChange("")}
					className="shrink-0 rounded-full p-1 text-[var(--text-muted)] transition hover-fill hover:text-[var(--text)]"
					aria-label="Clear"
				>
					<X className="h-4 w-4" />
				</button>
			) : null}
		</div>
	);
}
