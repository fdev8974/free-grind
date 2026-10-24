import { useState, type ReactNode } from "react";
import { ChevronRight, ScrollText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BottomSheet, SheetCloseButton } from "./ui/bottom-sheet";
import { useDesktopBreakpoint } from "../hooks/useDesktopBreakpoint";
import type { GuidelineText } from "../utils/guidelineViolations";

/**
 * A full-width row at the bottom of a card that opens `children` in a
 * bottom sheet, so the long explanations don't stretch the prompt itself.
 */
export function CardDetailsSheet({ label, title, children }: { label: string; title: string; children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const isDesktop = useDesktopBreakpoint();

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="flex w-full items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 text-left text-sm font-semibold text-[var(--accent)] transition hover:bg-[var(--surface-2)]"
			>
				{label}
				<ChevronRight className="h-4 w-4 shrink-0" />
			</button>
			{open && (
				<BottomSheet onClose={() => setOpen(false)} isDesktop={isDesktop} expandable panelClassName="max-h-[85dvh]" zIndex="z-[150]">
					<div className="flex items-start justify-between gap-3 px-4 pb-3">
						<p className="min-w-0 pt-1 text-base font-semibold leading-snug text-[var(--text)]">{title}</p>
						<SheetCloseButton />
					</div>
					<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-6" data-lenis-prevent>
						{children}
					</div>
				</BottomSheet>
			)}
		</>
	);
}

/** Paragraphs split on blank lines; lines starting with "• " become a list. */
export function RichText({ text, className = "" }: { text: string; className?: string }) {
	const blocks = text.split(/\n\s*\n/);
	return (
		<div className={`flex flex-col gap-2 text-sm leading-relaxed text-[var(--text-muted)] ${className}`}>
			{blocks.map((block, blockIndex) => {
				const lines = block.split("\n");
				const intro = lines.filter((line) => !line.startsWith("• "));
				const items = lines.filter((line) => line.startsWith("• ")).map((line) => line.slice(2));
				return (
					<div key={blockIndex}>
						{intro.length > 0 ? <p>{intro.join(" ")}</p> : null}
						{items.length > 0 ? (
							<ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 marker:text-[var(--accent)]">
								{items.map((item) => (
									<li key={item}>{item}</li>
								))}
							</ul>
						) : null}
					</div>
				);
			})}
		</div>
	);
}

/** The matching section of Grindr's community guidelines, set off as a quote. */
export function GuidelineBlock({ guideline }: { guideline: GuidelineText }) {
	const { t } = useTranslation();
	return (
		<div className="rounded-2xl bg-[var(--surface-2)] p-3.5">
			<p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">
				<ScrollText className="h-3.5 w-3.5" />
				{t("community_guidelines.label", { defaultValue: "Community guideline" })}
			</p>
			<p className="mt-1 text-sm font-semibold text-[var(--text)]">{guideline.title}</p>
			<RichText text={guideline.text} className="mt-1.5 !text-xs" />
		</div>
	);
}
