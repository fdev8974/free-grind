import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { BottomSheet, SheetClose, SheetCloseButton, SHEET_FOOTER_CLASS, sheetButtonClass } from "../../../components/ui/bottom-sheet";
import { SheetChip, SheetMoreButton, SheetSection, SheetSearchInput } from "../../../components/ui/sheet-section";
import { useDesktopBreakpoint } from "../../../hooks/useDesktopBreakpoint";
import { useManagedTagCategories } from "../../../hooks/queries/useProfileQueries";
import type { ManagedTagCategory } from "../../../types/api-functions";
import { cn } from "../../../utils/cn";

const TAGS_PREVIEW_LIMIT = 7;

interface TagsPickerDialogProps {
	/** Selected catalog tag keys. */
	selected: string[];
	/** Omit for an unlimited selection (e.g. a browse filter). */
	max?: number;
	maxMessage?: string;
	/** Label of the footer button that closes the sheet. Selections apply live either way. */
	confirmLabel?: string;
	/** Active chip / confirm button color — explore mode passes its own. */
	accentColor?: string;
	onToggle: (tagKey: string) => void;
	onClose: () => void;
}

function TagCategorySection({
	category,
	selected,
	showAll,
	accentColor,
	onToggle,
}: {
	category: ManagedTagCategory;
	selected: string[];
	showAll: boolean;
	accentColor: string;
	onToggle: (tagKey: string) => void;
}) {
	const { t } = useTranslation();
	const [expanded, setExpanded] = useState(false);

	// Selected tags go first so the >7 preview cutoff can never hide a tag
	// the user already picked.
	const orderedTags = useMemo(() => {
		const isSelected = (tagKey: string) => selected.includes(tagKey);
		return [...category.tags].sort((a, b) => Number(isSelected(b.key)) - Number(isSelected(a.key)));
	}, [category.tags, selected]);

	// Desktop has room to just show everything, and while the search box is
	// focused every tag should be browsable/selectable too — the preview
	// cutoff only makes sense for the cramped, non-searching mobile view.
	const visibleTags = expanded || showAll ? orderedTags : orderedTags.slice(0, TAGS_PREVIEW_LIMIT);
	const hiddenCount = showAll ? 0 : orderedTags.length - visibleTags.length;

	return (
		<SheetSection title={category.possessiveText ?? category.text}>
			{/* Blocks the search input's blur on mousedown — otherwise clicking a
			    tag that's only visible because of showAll would collapse the
			    list back to 7 before the click could land on it. */}
			<div className="flex flex-wrap gap-2" onMouseDown={(event) => event.preventDefault()}>
				{visibleTags.map((tag) => (
					<SheetChip key={tag.tagId} active={selected.includes(tag.key)} onClick={() => onToggle(tag.key)} accentColor={accentColor}>
						{tag.text}
					</SheetChip>
				))}
				{hiddenCount > 0 && (
					<SheetMoreButton onClick={() => setExpanded(true)} accentColor={accentColor}>
						{t("profile_editor.tags_dialog.see_more", { count: hiddenCount })}
					</SheetMoreButton>
				)}
			</div>
		</SheetSection>
	);
}

export function TagsPickerDialog({
	selected,
	max,
	maxMessage,
	confirmLabel,
	accentColor = "var(--accent)",
	onToggle,
	onClose,
}: TagsPickerDialogProps) {
	const { t, i18n } = useTranslation();
	const isDesktop = useDesktopBreakpoint();
	const { data: categories, isLoading } = useManagedTagCategories(i18n.language);
	const [query, setQuery] = useState("");
	const [isSearchFocused, setIsSearchFocused] = useState(false);
	const showAll = isDesktop || isSearchFocused;

	const nonEmptyCategories = useMemo(
		() => (categories ?? []).filter((category) => category.tags.length > 0),
		[categories],
	);

	const filteredCategories = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		if (!normalizedQuery) {
			return nonEmptyCategories;
		}
		return nonEmptyCategories
			.map((category) => ({
				...category,
				tags: category.tags.filter((tag) => tag.text.toLowerCase().includes(normalizedQuery)),
			}))
			.filter((category) => category.tags.length > 0);
	}, [nonEmptyCategories, query]);

	const handleToggle = (tagKey: string) => {
		const alreadySelected = selected.includes(tagKey);
		if (!alreadySelected && max !== undefined && selected.length >= max) {
			if (maxMessage) toast.error(maxMessage);
			return;
		}
		onToggle(tagKey);
	};

	return (
		<BottomSheet
			onClose={onClose}
			expandable
			isDesktop={isDesktop}
			bg="bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]"
			panelClassName={isDesktop ? "max-h-[82dvh] px-4" : "px-4"}
		>
			<div className="mb-3 flex items-center justify-between gap-3">
				<h3 className="text-sm font-semibold text-[var(--text)]">
					{t("profile_editor.tags_dialog.title")}
				</h3>
				<SheetCloseButton />
			</div>
			<SheetSearchInput
				floating
				value={query}
				onChange={setQuery}
				onFocus={() => setIsSearchFocused(true)}
				onBlur={() => setIsSearchFocused(false)}
				placeholder={t("profile_editor.tags_dialog.search_placeholder")}
				accentColor={accentColor}
			/>
			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
				{isLoading ? (
					<p className="py-6 text-center text-sm text-[var(--text-muted)]">
						{t("profile_editor.loading")}
					</p>
				) : filteredCategories.length > 0 ? (
					<div className="space-y-5">
						{filteredCategories.map((category) => (
							<TagCategorySection
								key={category.text}
								category={category}
								selected={selected}
								showAll={showAll}
								accentColor={accentColor}
								onToggle={handleToggle}
							/>
						))}
					</div>
				) : (
					<p className="py-6 text-center text-sm text-[var(--text-muted)]">
						{query
							? t("profile_editor.tags_dialog.no_matches")
							: t("profile_editor.tags_dialog.unavailable")}
					</p>
				)}
			</div>
			<div className={SHEET_FOOTER_CLASS}>
				<SheetClose
					style={{ backgroundColor: accentColor }}
					className={cn(
						sheetButtonClass(),
						accentColor === "var(--accent)" ? "text-[var(--accent-contrast)]" : "text-white",
					)}
				>
					{confirmLabel ?? t("common.done", { defaultValue: "Done" })}
				</SheetClose>
			</div>
		</BottomSheet>
	);
}
