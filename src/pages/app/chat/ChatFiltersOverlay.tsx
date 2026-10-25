import { useTranslation } from "react-i18next";
import { ChatFiltersPanel } from "./ChatFiltersPanel";
import { buildChatFiltersDraft, type ChatFiltersDraft } from "./chatUtils";
import { BottomSheet, SheetClose, SheetCloseButton, SHEET_FOOTER_CLASS, sheetButtonClass } from "../../../components/ui/bottom-sheet";

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
			expandable
			isDesktop={isDesktop}
			bg="bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]"
			panelClassName={isDesktop ? "max-h-[92dvh] px-4" : "px-4"}
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
			<div className={SHEET_FOOTER_CLASS}>
				<SheetClose
					onClick={() => onApply(buildChatFiltersDraft({}))}
					className={sheetButtonClass("secondary")}
				>
					{t("browse_filters.clear_all")}
				</SheetClose>
				<SheetClose
					onClick={() => onApply(draft)}
					className={sheetButtonClass()}
				>
					{t("browse_filters.apply")}
				</SheetClose>
			</div>
		</BottomSheet>
	);
}
