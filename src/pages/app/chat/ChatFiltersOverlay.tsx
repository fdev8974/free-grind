import { useTranslation } from "react-i18next";
import { ChatFiltersPanel } from "./ChatFiltersPanel";
import { buildChatFiltersDraft, type ChatFiltersDraft } from "./chatUtils";
import { BottomSheet, SheetClose, SheetCloseButton } from "../../../components/ui/bottom-sheet";

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
			<div className="mb-3 flex items-center justify-between gap-3">
				<h3 className="text-sm font-semibold text-[var(--text)]">{t("right_now.filters")}</h3>
				<SheetCloseButton />
			</div>

			{/* The panel brings its own horizontal padding (the scroll area spans the full sheet width). */}
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
			<div className="-mx-4 mt-3 flex shrink-0 gap-2 border-t border-[var(--border)] px-4 pt-3">
				<SheetClose
					onClick={() => onApply(buildChatFiltersDraft({}))}
					className="inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 text-sm font-semibold text-[var(--text-muted)] transition hover:text-[var(--text)]"
				>
					{t("browse_filters.clear_all")}
				</SheetClose>
				<SheetClose
					onClick={() => onApply(draft)}
					className="inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)] transition hover:brightness-110 active:scale-[0.98]"
				>
					{t("browse_filters.apply")}
				</SheetClose>
			</div>
		</BottomSheet>
	);
}
