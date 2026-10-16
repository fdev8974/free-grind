import { RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ChatFiltersPanel } from "./ChatFiltersPanel";
import { buildChatFiltersDraft, type ChatFiltersDraft } from "./chatUtils";
import { BottomSheet, SheetClose } from "../../../components/ui/bottom-sheet";

type Props = {
	isDesktop: boolean;
	draft: ChatFiltersDraft;
	onChangeDraft: (draft: ChatFiltersDraft) => void;
	onClose: () => void;
	onApply: (draft: ChatFiltersDraft) => void;
	archivedCount: number;
	hiddenCount: number;
};

export function ChatFiltersOverlay({
	isDesktop,
	draft,
	onChangeDraft,
	onClose,
	onApply,
	archivedCount,
	hiddenCount,
}: Props) {
	const { t } = useTranslation();

	return (
		<BottomSheet
			onClose={onClose}
			isDesktop={isDesktop}
			bg="bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]"
			panelClassName="max-h-[92dvh] px-4"
		>
			<div className="mb-1 flex items-center justify-between gap-3">
				<h3 className="text-sm font-semibold text-[var(--text)]">{t("right_now.filters")}</h3>
				<SheetClose className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
					<X className="h-4 w-4" />
				</SheetClose>
			</div>

			{/* The panel brings its own horizontal padding. */}
			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto" data-lenis-prevent>
				<ChatFiltersPanel
					isDesktop={isDesktop}
					draft={draft}
					onChangeDraft={onChangeDraft}
					archivedCount={archivedCount}
					hiddenCount={hiddenCount}
				/>
			</div>

			{/* SheetClose closes animated and pops the sheet's history entry. */}
			<div className="-mx-4 mt-1 flex shrink-0 gap-2 border-t border-[var(--border)] px-4 pt-3">
				<SheetClose
					onClick={() => onApply(buildChatFiltersDraft({}))}
					className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] px-4 text-sm font-bold text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)]"
				>
					<RotateCcw className="h-4 w-4" />
					{t("browse_filters.clear_all")}
				</SheetClose>
				<SheetClose
					onClick={() => onApply(draft)}
					className="group relative h-12 flex-1 overflow-hidden rounded-xl bg-[var(--accent)] text-sm font-bold text-[var(--accent-contrast)] transition hover:brightness-110 active:scale-[0.98]"
				>
					<span className="relative z-10">{t("browse_filters.apply")}</span>
					<div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
				</SheetClose>
			</div>
		</BottomSheet>
	);
}
