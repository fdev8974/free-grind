import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RangeSlider } from "../../components/ui/range-slider";
import { BottomSheet, SheetClose, useBottomSheetClose } from "../../components/ui/bottom-sheet";
import { SheetChip, SheetSection } from "../../components/ui/sheet-section";
import { usePreferences } from "../../contexts/PreferencesContext";
import { useManagedTagCategories } from "../../hooks/queries/useProfileQueries";
import { cn } from "../../utils/cn";
import { buildTagLabelMap } from "../../utils/tags";
import { type ManagedOption } from "./GridPage.types";
import type { ManagedTag } from "../../types/api-functions";
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
} from "./profile-option-builders";
import {
	cmToInches,
	gramsToKg,
	gramsToPounds,
	inchesToCm,
	kgToGrams,
	poundsToGrams,
} from "../../utils/units";

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
			isDesktop={isDesktop}
			bg="bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]"
			panelClassName="max-h-[92dvh] px-4"
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
	const [tribes, setTribes] = useState<number[]>(normalized.tribes);
	const [lookingFor, setLookingFor] = useState<number[]>(normalized.lookingFor);
	const [relationshipStatuses, setRelationshipStatuses] = useState<number[]>(normalized.relationshipStatuses);
	const [bodyTypes, setBodyTypes] = useState<number[]>(normalized.bodyTypes);
	const [sexualPositions, setSexualPositions] = useState<number[]>(normalized.sexualPositions);
	const [meetAt, setMeetAt] = useState<number[]>(normalized.meetAt);
	const [nsfwPics, setNsfwPics] = useState<number[]>(normalized.nsfwPics);
	const [tags, setTags] = useState<string[]>(normalized.tags);
	const [tagDraft, setTagDraft] = useState("");
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

	const tribeFilterOptions = useMemo<ManagedOption[]>(
		() => [{ value: -1, label: t("browse_filters.not_specified") }, ...getTribeOptions(t)],
		[t],
	);
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

	// Flat list of every managed tag across all categories — the filter only
	// ever needs to search/add individual tags, never browse by category.
	const allManagedTags = useMemo(
		() => (managedTagCategories ?? []).flatMap((category) => category.tags),
		[managedTagCategories],
	);

	// `tags` holds whatever actually gets sent to the server: a catalog tag's
	// stable `key` (see addManagedTag), or the raw typed text for a free-typed
	// tag that isn't in the catalog (addTag) — there's no key for those.
	const tagLabelByKey = useMemo(() => buildTagLabelMap(allManagedTags), [allManagedTags]);
	const tagLabel = (value: string) => tagLabelByKey.get(value) ?? value;

	const tagSearchResults = useMemo(() => {
		const query = tagDraft.trim().toLowerCase();
		if (!query) return [];
		return allManagedTags
			.filter((tag) => tag.text.toLowerCase().includes(query) && !tags.includes(tag.key))
			.slice(0, 8);
	}, [tagDraft, allManagedTags, tags]);

	const toggleBrowseFilter = (key: keyof BrowseFilters) => {
		setBrowseFilters((prev) => ({ ...prev, [key]: !prev[key] }));
	};

	const toggleMultiSelect = (value: number, setter: React.Dispatch<React.SetStateAction<number[]>>) => {
		setter((prev) => prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]);
	};

	const addTag = (value: string = tagDraft) => {
		const norm = value.trim().toLowerCase();
		if (!norm) return;
		setTags((prev) => prev.includes(norm) ? prev : [...prev, norm]);
		setTagDraft("");
	};

	const addManagedTag = (tag: ManagedTag) => {
		setTags((prev) => (prev.includes(tag.key) ? prev : [...prev, tag.key]));
		setTagDraft("");
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
			tribes, lookingFor, relationshipStatuses,
			bodyTypes, sexualPositions, meetAt,
			nsfwPics, tags,
			nicknameFilter,
		});
		handleClose();
	};

	const inputClassName = cn(
		"h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm text-[var(--text)] outline-none transition placeholder:text-[var(--text-muted)]",
		isExploreActive ? "focus:border-[var(--explore)]" : "focus:border-[var(--accent)]",
	);

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
						{option.label}
					</SheetChip>
				))}
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
				<SheetClose className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
					<X className="h-4 w-4" />
				</SheetClose>
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
					)}
					{renderChipSection(
						t("profile_editor.sections.states.tribes"),
						tribeFilterOptions,
						tribes,
						(value) => toggleMultiSelect(value, setTribes),
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
						<div className="flex gap-2">
							<input
								type="text"
								placeholder={t("browse_filters.tags_placeholder")}
								value={tagDraft}
								onChange={(e) => setTagDraft(e.target.value)}
								onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
								className={cn(inputClassName, "min-w-0 flex-1")}
							/>
							<button
								type="button"
								onClick={() => addTag()}
								disabled={!tagDraft.trim()}
								className="h-11 shrink-0 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 text-sm font-semibold text-[var(--text-muted)] transition hover:text-[var(--text)] disabled:opacity-50"
							>
								{t("browse_filters.add")}
							</button>
						</div>
						{tagSearchResults.length > 0 && (
							<div className="mt-2 flex flex-wrap gap-2">
								{tagSearchResults.map((tag) => (
									<SheetChip key={tag.tagId} active={false} onClick={() => addManagedTag(tag)} accentColor={accentColor} size="sm">
										+ {tag.text}
									</SheetChip>
								))}
							</div>
						)}
						{tags.length > 0 && (
							<div className="mt-2 flex flex-wrap gap-2">
								{tags.map((tag) => (
									<SheetChip
										key={tag}
										active
										onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
										accentColor={accentColor}
										size="sm"
									>
										<span className="inline-flex items-center gap-1">
											{tagLabel(tag)}
											<X className="h-3 w-3" />
										</span>
									</SheetChip>
								))}
							</div>
						)}
					</SheetSection>

					{renderToggleSection(t("browse_filters.local_filters.visiting_title"), localFilterOptions, true)}

					<SheetSection title={t("browse_filters.local_filters.name_title")} badge={localBadge}>
						<div className="relative">
							<Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
							<input
								type="text"
								value={nicknameFilter}
								onChange={(e) => setNicknameFilter(e.target.value)}
								placeholder={t("browse_filters.local_filters.nickname_placeholder")}
								className={cn(inputClassName, "pl-10 pr-10")}
							/>
							{nicknameFilter && (
								<button
									type="button"
									onClick={() => setNicknameFilter("")}
									className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-[var(--text-muted)] transition hover:text-[var(--text)]"
								>
									<X className="h-3.5 w-3.5" />
								</button>
							)}
						</div>
					</SheetSection>
				</div>
			</div>

			<div className="-mx-4 mt-3 flex shrink-0 gap-2 border-t border-[var(--border)] px-4 pt-3">
				<button
					type="button"
					onClick={clearAll}
					className="inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 text-sm font-semibold text-[var(--text-muted)] transition hover:text-[var(--text)]"
				>
					{t("browse_filters.clear_all")}
				</button>
				<button
					type="button"
					onClick={handleApply}
					style={{ backgroundColor: accentColor, borderColor: accentColor }}
					className={cn(
						"inline-flex h-11 flex-1 items-center justify-center rounded-xl border px-4 text-sm font-semibold transition hover:brightness-110 active:scale-[0.98]",
						isExploreActive ? "text-white" : "text-[var(--accent-contrast)]",
					)}
				>
					{t("browse_filters.apply")}
				</button>
			</div>
		</>
	);
}
