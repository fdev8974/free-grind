import { type LucideIcon } from "lucide-react";
import { createPortal } from "react-dom";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RangeSlider } from "../../components/ui/range-slider";
import { BottomSheet, useBottomSheetClose, SheetCloseButton, SHEET_FOOTER_CLASS, sheetButtonClass } from "../../components/ui/bottom-sheet";
import { SheetChip, SheetMoreButton, SheetSearchInput, SheetSection } from "../../components/ui/sheet-section";
import { usePreferences } from "../../contexts/PreferencesContext";
import { useManagedGenders, useManagedTagCategories } from "../../hooks/queries/useProfileQueries";
import { cn } from "../../utils/cn";
import { buildTagLabelMap } from "../../utils/tags";
import { type ManagedOption } from "./GridPage.types";
import {
	type BrowseFilters,
	type BrowseFiltersDraft,
	getDefaultBrowseFiltersDraft,
	normalizeBrowseFiltersDraft,
} from "./browse-filters-storage";
import {
	getBodyTypeOptions,
	getLookingForOptions,
	getMeetAtOptions,
	getNsfwOptions,
	getRelationshipStatusOptions,
	getSexualPositionOptions,
	getTribeOptions,
	SEXUAL_POSITION_ICONS,
	buildGenderOptions,
	getPrimaryGenderIds,
} from "./profile-option-builders";
import { ManagedOptionsPickerDialog } from "./profile-editor/ManagedOptionsPickerDialog";
import { TagsPickerDialog } from "./profile-editor/TagsPickerDialog";
import {
	cmToInches,
	gramsToKg,
	gramsToPounds,
	inchesToCm,
	kgToGrams,
	poundsToGrams,
} from "../../utils/units";

/** How many catalog tags show inline in the filter sheet before "More tags". */
const INLINE_TAG_COUNT = 7;

function formatInchesAsFeetInches(totalInches: number): string {
	const safe = Math.max(0, Math.round(totalInches));
	const feet = Math.floor(safe / 12);
	const inches = safe % 12;
	return `${feet}ft ${inches}in`;
}

interface BrowseFiltersOverlayProps {
	initialDraft: BrowseFiltersDraft;
	onClose: () => void;
	onApply: (draft: BrowseFiltersDraft) => void;
	/** Right Now and Favorites both rely on the real location/presence, which
	 * doesn't apply to a browsed-away explore location — hide those two quick
	 * filters while explore mode is active (mirrors GridPage's own filter row). */
	isExploreActive?: boolean;
	isDesktop: boolean;
}

export function BrowseFiltersOverlay({ onClose, isDesktop, ...props }: BrowseFiltersOverlayProps) {
	return (
		<BottomSheet
			onClose={onClose}
			expandable
			isDesktop={isDesktop}
			bg="bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]"
			panelClassName={isDesktop ? "max-h-[92dvh] px-4" : "px-4"}
		>
			<BrowseFiltersSheetContent {...props} />
		</BottomSheet>
	);
}

function BrowseFiltersSheetContent({
	initialDraft,
	onApply,
	isExploreActive = false,
}: Omit<BrowseFiltersOverlayProps, "onClose" | "isDesktop">) {
	const { t, i18n } = useTranslation();
	const { unitsPreset } = usePreferences();
	const { data: managedTagCategories } = useManagedTagCategories(i18n.language);
	const { data: managedGenders } = useManagedGenders();
	// Closes through the sheet so it animates out and pops its history entry.
	const handleClose = useBottomSheetClose();

	// Mirrors GridPage's own filter row: while browsing an explore location,
	// every accent-tinted element in this sheet switches to EXPLORE_COLOR
	// (see --explore in index.css) the same way it switches for Right Now.
	const accentColor = isExploreActive ? "var(--explore)" : "var(--accent)";

	const normalized = useMemo(() => normalizeBrowseFiltersDraft(initialDraft), [initialDraft]);

	const [browseFilters, setBrowseFilters] = useState<BrowseFilters>(normalized.browseFilters);
	const [ageMin, setAgeMin] = useState(normalized.ageMin);
	const [ageMax, setAgeMax] = useState(normalized.ageMax);
	const [heightCmMin, setHeightCmMin] = useState(normalized.heightCmMin);
	const [heightCmMax, setHeightCmMax] = useState(normalized.heightCmMax);
	const [weightGramsMin, setWeightGramsMin] = useState(normalized.weightGramsMin);
	const [weightGramsMax, setWeightGramsMax] = useState(normalized.weightGramsMax);
	const [genders, setGenders] = useState<number[]>(normalized.genders);
	const [tribes, setTribes] = useState<number[]>(normalized.tribes);
	const [tribesImInto, setTribesImInto] = useState<number[]>(normalized.tribesImInto);
	const [lookingFor, setLookingFor] = useState<number[]>(normalized.lookingFor);
	const [relationshipStatuses, setRelationshipStatuses] = useState<number[]>(normalized.relationshipStatuses);
	const [bodyTypes, setBodyTypes] = useState<number[]>(normalized.bodyTypes);
	const [sexualPositions, setSexualPositions] = useState<number[]>(normalized.sexualPositions);
	const [meetAt, setMeetAt] = useState<number[]>(normalized.meetAt);
	const [nsfwPics, setNsfwPics] = useState<number[]>(normalized.nsfwPics);
	const [tags, setTags] = useState<string[]>(normalized.tags);
	const [nicknameFilter, setNicknameFilter] = useState(normalized.nicknameFilter);

	const isImperialHeight = unitsPreset === "uk" || unitsPreset === "american";
	const isImperialWeight = unitsPreset === "american";

	const heightRange = isImperialHeight
		? { min: 35, max: 91, unit: "" }
		: { min: 90, max: 230, unit: "cm" };

	const weightRange = isImperialWeight
		? { min: 66, max: 440, unit: "lb" }
		: { min: 30, max: 200, unit: "kg" };

	const heightMinDefault = heightCmMin
		? (isImperialHeight ? Math.round(cmToInches(Number(heightCmMin))) : Number(heightCmMin))
		: heightRange.min;
	const heightMaxDefault = heightCmMax
		? (isImperialHeight ? Math.round(cmToInches(Number(heightCmMax))) : Number(heightCmMax))
		: heightRange.max;
	const weightMinDefault = weightGramsMin
		? (isImperialWeight ? Math.round(gramsToPounds(Number(weightGramsMin))) : Math.round(gramsToKg(Number(weightGramsMin))))
		: weightRange.min;
	const weightMaxDefault = weightGramsMax
		? (isImperialWeight ? Math.round(gramsToPounds(Number(weightGramsMax))) : Math.round(gramsToKg(Number(weightGramsMax))))
		: weightRange.max;

	const browseFilterOptions: Array<{ key: keyof BrowseFilters; label: string }> = useMemo(() => {
		const options: Array<{ key: keyof BrowseFilters; label: string }> = [
			{ key: "onlineOnly", label: t("browse_filters.options.online") },
			{ key: "hasAlbum", label: t("browse_filters.options.has_album") },
			{ key: "photoOnly", label: t("browse_filters.options.photo") },
			{ key: "faceOnly", label: t("browse_filters.options.face") },
			{ key: "notRecentlyChatted", label: t("browse_filters.options.no_recent_chat") },
			{ key: "fresh", label: t("browse_filters.options.fresh") },
			{ key: "rightNow", label: t("browse_filters.options.right_now") },
			{ key: "favorites", label: t("browse_filters.options.favorites") },
			{ key: "hot", label: t("browse_filters.options.hot") },
			{ key: "shuffle", label: t("browse_filters.options.shuffle") },
		];
		return isExploreActive ? options.filter((option) => option.key !== "rightNow" && option.key !== "favorites") : options;
	}, [t, isExploreActive]);

	const localFilterOptions: Array<{ key: keyof BrowseFilters; label: string }> = useMemo(() => [
		{ key: "isVisiting", label: t("browse_filters.local_filters.is_visiting") },
	], [t]);

	const genderFilterOptions = useMemo(() => buildGenderOptions(managedGenders), [managedGenders]);
	const primaryGenderIds = useMemo(() => getPrimaryGenderIds(managedGenders), [managedGenders]);
	// Primary genders inline, plus any selected non-primary ones so they stay visible/removable.
	const inlineGenderOptions = useMemo(() => {
		const inlineIds = [...primaryGenderIds, ...genders.filter((id) => !primaryGenderIds.includes(id))];
		return inlineIds
			.map((id) => genderFilterOptions.find((option) => option.value === id))
			.filter((option): option is ManagedOption => option !== undefined);
	}, [genderFilterOptions, primaryGenderIds, genders]);
	const [isGenderPickerOpen, setIsGenderPickerOpen] = useState(false);
	const tribeFilterOptions = useMemo<ManagedOption[]>(
		() => [{ value: -1, label: t("browse_filters.not_specified") }, ...getTribeOptions(t)],
		[t],
	);
	const tribesImIntoFilterOptions = useMemo<ManagedOption[]>(() => getTribeOptions(t), [t]);
	const lookingForFilterOptions = useMemo<ManagedOption[]>(
		() => [{ value: -1, label: t("browse_filters.not_specified") }, ...getLookingForOptions(t)],
		[t],
	);
	const relationshipFilterOptions = useMemo<ManagedOption[]>(
		() => [{ value: -1, label: t("browse_filters.not_specified") }, ...getRelationshipStatusOptions(t)],
		[t],
	);
	const bodyTypeFilterOptions = useMemo<ManagedOption[]>(
		() => [{ value: -1, label: t("browse_filters.not_specified") }, ...getBodyTypeOptions(t)],
		[t],
	);
	const sexualPositionFilterOptions = useMemo<ManagedOption[]>(
		() => [{ value: -1, label: t("browse_filters.not_specified") }, ...getSexualPositionOptions(t)],
		[t],
	);
	const meetAtFilterOptions = useMemo<ManagedOption[]>(
		() => [{ value: -1, label: t("browse_filters.not_specified") }, ...getMeetAtOptions(t)],
		[t],
	);
	const nsfwFilterOptions = useMemo<ManagedOption[]>(
		() => [{ value: -1, label: t("browse_filters.not_specified") }, ...getNsfwOptions(t)],
		[t],
	);

	// `tags` holds what gets sent to the server: catalog tag keys picked in
	// TagsPickerDialog. Filters saved before the picker may still hold raw
	// free-typed text with no catalog key — those render as-is.
	const allManagedTags = useMemo(
		() => (managedTagCategories ?? []).flatMap((category) => category.tags),
		[managedTagCategories],
	);
	const tagLabelByKey = useMemo(() => buildTagLabelMap(allManagedTags), [allManagedTags]);
	const tagLabel = (value: string) => tagLabelByKey.get(value) ?? value;
	// Like genders: the first few catalog tags inline, plus any selected ones
	// beyond those so they stay visible/removable; the rest live in the picker.
	const inlineTagKeys = useMemo(() => {
		const primaryKeys = allManagedTags.slice(0, INLINE_TAG_COUNT).map((tag) => tag.key);
		return [...primaryKeys, ...tags.filter((tag) => !primaryKeys.includes(tag))];
	}, [allManagedTags, tags]);
	const [isTagsPickerOpen, setIsTagsPickerOpen] = useState(false);

	const toggleBrowseFilter = (key: keyof BrowseFilters) => {
		setBrowseFilters((prev) => ({ ...prev, [key]: !prev[key] }));
	};

	const toggleMultiSelect = (value: number, setter: React.Dispatch<React.SetStateAction<number[]>>) => {
		setter((prev) => prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]);
	};

	const toggleTag = (tagKey: string) => {
		setTags((prev) => prev.includes(tagKey) ? prev.filter((v) => v !== tagKey) : [...prev, tagKey]);
	};

	const clearAll = () => {
		const cleared = { ...getDefaultBrowseFiltersDraft(), sortBy: normalized.sortBy };
		onApply(cleared);
		handleClose();
	};

	const handleApply = () => {
		onApply({
			sortBy: normalized.sortBy,
			browseFilters,
			ageMin, ageMax,
			heightCmMin, heightCmMax,
			weightGramsMin, weightGramsMax,
			genders, tribes, tribesImInto, lookingFor, relationshipStatuses,
			bodyTypes, sexualPositions, meetAt,
			nsfwPics, tags,
			nicknameFilter,
		});
		handleClose();
	};

	const localBadge = (
		<span className="inline-flex items-center rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
			{t("browse_filters.local_filters.badge")}
		</span>
	);

	const renderChipSection = (
		title: string,
		options: ManagedOption[],
		selectedValues: number[],
		onToggle: (value: number) => void,
		icons?: Record<number, LucideIcon>,
		trailing?: React.ReactNode,
	) => (
		<SheetSection title={title}>
			<div className="flex flex-wrap gap-2">
				{options.map((option) => (
					<SheetChip
						key={`${title}-${option.value}`}
						active={selectedValues.includes(option.value)}
						onClick={() => onToggle(option.value)}
						accentColor={accentColor}
					>
						{(() => {
							const Icon = icons?.[option.value];
							return Icon ? (
								<span className="inline-flex items-center gap-1.5">
									<Icon className="h-3.5 w-3.5 shrink-0" />
									{option.label}
								</span>
							) : option.label;
						})()}
					</SheetChip>
				))}
				{trailing}
			</div>
		</SheetSection>
	);

	const renderToggleSection = (
		title: string,
		options: Array<{ key: keyof BrowseFilters; label: string }>,
		isLocal?: boolean,
	) => (
		<SheetSection title={title} badge={isLocal ? localBadge : undefined}>
			<div className="flex flex-wrap gap-2">
				{options.map((filter) => (
					<SheetChip
						key={filter.key}
						active={Boolean(browseFilters[filter.key])}
						onClick={() => toggleBrowseFilter(filter.key)}
						accentColor={accentColor}
					>
						{filter.label}
					</SheetChip>
				))}
			</div>
		</SheetSection>
	);

	return (
		<>
			<div className="mb-3 flex items-center justify-between gap-3">
				<h3 className="text-sm font-semibold text-[var(--text)]">{t("browse_filters.title")}</h3>
				<SheetCloseButton />
			</div>

			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4" data-lenis-prevent>
				<div className="space-y-5 pb-2">
					{renderToggleSection(t("browse_filters.quick_filters"), browseFilterOptions)}

					<SheetSection
						title={t("browse_filters.age")}
						value={`${ageMin || 18}-${ageMax || 99}${(ageMax ? Number(ageMax) : 99) >= 99 ? "+" : ""}`}
					>
						<div className="px-1">
							<RangeSlider
								label={t("browse_filters.age")}
								min={18}
								max={99}
								minDefault={ageMin ? Number(ageMin) : 18}
								maxDefault={ageMax ? Number(ageMax) : 99}
								activeColor={accentColor}
								hideHeader
								onChange={(min, max) => {
									setAgeMin(min === 18 ? "" : String(min));
									setAgeMax(max === 99 ? "" : String(max));
								}}
							/>
						</div>
					</SheetSection>

					<SheetSection
						title={t("browse_filters.height")}
						value={`${isImperialHeight ? formatInchesAsFeetInches(heightMinDefault) : `${heightMinDefault}${heightRange.unit}`} - ${isImperialHeight ? formatInchesAsFeetInches(heightMaxDefault) : `${heightMaxDefault}${heightRange.unit}`}${heightMaxDefault >= heightRange.max ? "+" : ""}`}
					>
						<div className="px-1">
							<RangeSlider
								label={t("browse_filters.height")}
								unit={heightRange.unit}
								formatValue={isImperialHeight ? formatInchesAsFeetInches : undefined}
								min={heightRange.min}
								max={heightRange.max}
								minDefault={heightMinDefault}
								maxDefault={heightMaxDefault}
								activeColor={accentColor}
								hideHeader
								onChange={(min, max) => {
									const minCm = isImperialHeight ? Math.round(inchesToCm(min)) : min;
									const maxCm = isImperialHeight ? Math.round(inchesToCm(max)) : max;
									setHeightCmMin(min === heightRange.min ? "" : String(minCm));
									setHeightCmMax(max === heightRange.max ? "" : String(maxCm));
								}}
							/>
						</div>
					</SheetSection>

					<SheetSection
						title={t("browse_filters.weight")}
						value={`${weightMinDefault}${weightRange.unit} - ${weightMaxDefault}${weightRange.unit}${weightMaxDefault >= weightRange.max ? "+" : ""}`}
					>
						<div className="px-1">
							<RangeSlider
								label={t("browse_filters.weight")}
								unit={weightRange.unit}
								min={weightRange.min}
								max={weightRange.max}
								minDefault={weightMinDefault}
								maxDefault={weightMaxDefault}
								activeColor={accentColor}
								hideHeader
								onChange={(min, max) => {
									const minGrams = isImperialWeight ? Math.round(poundsToGrams(min)) : Math.round(kgToGrams(min));
									const maxGrams = isImperialWeight ? Math.round(poundsToGrams(max)) : Math.round(kgToGrams(max));
									setWeightGramsMin(min === weightRange.min ? "" : String(minGrams));
									setWeightGramsMax(max === weightRange.max ? "" : String(maxGrams));
								}}
							/>
						</div>
					</SheetSection>

					{renderChipSection(
						t("profile_editor.sections.states.position"),
						sexualPositionFilterOptions,
						sexualPositions,
						(value) => toggleMultiSelect(value, setSexualPositions),
						SEXUAL_POSITION_ICONS,
					)}
					{genderFilterOptions.length > 0 && renderChipSection(
						t("profile_editor.sections.identity.gender"),
						inlineGenderOptions,
						genders,
						(value) => toggleMultiSelect(value, setGenders),
						undefined,
						<SheetMoreButton onClick={() => setIsGenderPickerOpen(true)} accentColor={accentColor}>
							{t("profile_editor.sections.identity.gender_more")}
						</SheetMoreButton>,
					)}
					{renderChipSection(
						t("profile_editor.sections.states.tribes"),
						tribeFilterOptions,
						tribes,
						(value) => toggleMultiSelect(value, setTribes),
					)}
					{renderChipSection(
						t("browse_filters.tribes_theyre_into"),
						tribesImIntoFilterOptions,
						tribesImInto,
						(value) => toggleMultiSelect(value, setTribesImInto),
					)}
					{renderChipSection(
						t("profile_editor.sections.expectations.looking_for"),
						lookingForFilterOptions,
						lookingFor,
						(value) => toggleMultiSelect(value, setLookingFor),
					)}
					{renderChipSection(
						t("profile_editor.sections.states.relationship_status"),
						relationshipFilterOptions,
						relationshipStatuses,
						(value) => toggleMultiSelect(value, setRelationshipStatuses),
					)}
					{renderChipSection(
						t("profile_editor.sections.states.body_type"),
						bodyTypeFilterOptions,
						bodyTypes,
						(value) => toggleMultiSelect(value, setBodyTypes),
					)}
					{renderChipSection(
						t("profile_editor.sections.expectations.meet_at"),
						meetAtFilterOptions,
						meetAt,
						(value) => toggleMultiSelect(value, setMeetAt),
					)}
					{renderChipSection(
						t("profile_editor.sections.expectations.accept_nsfw"),
						nsfwFilterOptions,
						nsfwPics,
						(value) => toggleMultiSelect(value, setNsfwPics),
					)}

					<SheetSection title={t("browse_filters.tags")}>
						<div className="flex flex-wrap gap-2">
							{inlineTagKeys.map((tag) => (
								<SheetChip key={tag} active={tags.includes(tag)} onClick={() => toggleTag(tag)} accentColor={accentColor}>
									{tagLabel(tag)}
								</SheetChip>
							))}
							<SheetMoreButton onClick={() => setIsTagsPickerOpen(true)} accentColor={accentColor}>
								{t("browse_filters.tags_more", { defaultValue: "More tags" })}
							</SheetMoreButton>
						</div>
					</SheetSection>

					{renderToggleSection(t("browse_filters.local_filters.visiting_title"), localFilterOptions, true)}

					<SheetSection title={t("browse_filters.local_filters.name_title")} badge={localBadge}>
						<SheetSearchInput
							value={nicknameFilter}
							onChange={setNicknameFilter}
							placeholder={t("browse_filters.local_filters.nickname_placeholder")}
							accentColor={isExploreActive ? "var(--explore)" : "var(--accent)"}
						/>
					</SheetSection>
				</div>
			</div>

			<div className={SHEET_FOOTER_CLASS}>
				<button
					type="button"
					onClick={clearAll}
					className={sheetButtonClass("secondary")}
				>
					{t("browse_filters.clear_all")}
				</button>
				<button
					type="button"
					onClick={handleApply}
					style={{ backgroundColor: accentColor }}
					className={cn(sheetButtonClass(), isExploreActive && "text-white")}
				>
					{t("browse_filters.apply")}
				</button>
			</div>

			{/* Portaled so the filter sheet's panel transform can't clip this stacked sheet. */}
			{isGenderPickerOpen && createPortal(
				<ManagedOptionsPickerDialog
					title={t("profile_editor.sections.identity.gender_dialog_title")}
					searchPlaceholder={t("profile_editor.sections.identity.gender_search_placeholder")}
					noMatchesLabel={t("profile_editor.sections.identity.gender_no_matches")}
					options={genderFilterOptions}
					selected={genders}
					confirmLabel={t("browse_filters.apply")}
					accentColor={accentColor}
					onToggle={(value) => toggleMultiSelect(value, setGenders)}
					onClose={() => setIsGenderPickerOpen(false)}
				/>,
				document.body,
			)}
			{isTagsPickerOpen && createPortal(
				<TagsPickerDialog
					selected={tags}
					confirmLabel={t("browse_filters.apply")}
					accentColor={accentColor}
					onToggle={toggleTag}
					onClose={() => setIsTagsPickerOpen(false)}
				/>,
				document.body,
			)}
		</>
	);
}
