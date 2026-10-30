import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Slider } from "../../../components/ui/range-slider";
import { SHEET_GROUP_CLASS, SheetChip, SheetSection } from "../../../components/ui/sheet-section";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { formatDistanceForUnits } from "../../../utils/units";
import { getSexualPositionOptions, SEXUAL_POSITION_ICONS } from "../profile-option-builders";
import type { InboxFilterKey, InboxVisibilityFilter } from "../../../types/chat-page";
import type { ChatFiltersDraft } from "../chat/chatUtils";

/** One "Pinned"/"Archived"/"Hidden" row: label on the left, a 3-way chip
 * group (Show all/Hide/Only) on the right — a list row, one tile of a SHEET_GROUP_CLASS group. */
function VisibilityFilterRow({
	label,
	value,
	onChange,
}: {
	label: string;
	value: InboxVisibilityFilter;
	onChange: (v: InboxVisibilityFilter) => void;
}) {
	const { t } = useTranslation();
	const options: { value: InboxVisibilityFilter; label: string }[] = [
		{ value: "all", label: t("chat.filter.state_all", { defaultValue: "Show all" }) },
		{ value: "hide", label: t("chat.filter.state_hide", { defaultValue: "Hide" }) },
		{ value: "only", label: t("chat.filter.state_only", { defaultValue: "Only" }) },
	];
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
			<span className="text-sm font-semibold text-[var(--text)]">{label}</span>
			<div className="flex gap-1.5">
				{options.map((option) => (
					<SheetChip key={option.value} active={value === option.value} onClick={() => onChange(option.value)} size="sm" onCard>
						{option.label}
					</SheetChip>
				))}
			</div>
		</div>
	);
}

const distanceSteps = [
	100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400,
	1500, 1600, 1700, 1800, 1900, 2000, 2100, 2200, 2300, 2400, 2500, 3000, 3500,
	4000, 4500, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000, 13000, 14000,
	15000, 16000, 17000, 18000, 19000, 20000, 21000, 22000, 23000, 24000, 25000,
	30000, 35000, 40000, 45000, 50000, 55000, 60000, 65000, 70000, 75000,
];

type Props = {
	isDesktop: boolean;
	draft: ChatFiltersDraft;
	onChangeDraft: (draft: ChatFiltersDraft) => void;
	archivedCount: number;
	hiddenCount: number;
};

export function ChatFiltersPanel({ isDesktop: _isDesktop, draft, onChangeDraft, archivedCount, hiddenCount }: Props) {
	const { t } = useTranslation();
	const { unitsPreset } = usePreferences();

	const inboxFilterOptions: Array<{ key: InboxFilterKey; label: string }> = [
		{ key: "unreadOnly", label: t("chat_filters.options.unread") },
		{ key: "needsReplyOnly", label: t("chat_filters.options.needs_reply") },
		{ key: "favoritesOnly", label: t("browse_filters.options.favorites") },
		{ key: "chemistryOnly", label: t("chat_filters.options.chemistry") },
		{ key: "rightNowOnly", label: t("browse_filters.options.right_now") },
		{ key: "onlineNowOnly", label: t("browse_filters.options.online") },
	];

	const currentDistanceMeters = draft.distanceMeters === "" ? 75000 : Number(draft.distanceMeters);
	const currentDistanceIndex = distanceSteps.indexOf(currentDistanceMeters);
	const displayDistanceIndex = currentDistanceIndex === -1 ? distanceSteps.length - 1 : currentDistanceIndex;
	const distanceDisplay = formatDistanceForUnits(currentDistanceMeters, unitsPreset);

	const positionFilterOptions = useMemo(
		() => [
			{ value: -1, label: t("browse_filters.not_specified") },
			...getSexualPositionOptions(t).map((o) => ({ value: o.value, label: o.label })),
		],
		[t],
	);

	const toggle = (key: InboxFilterKey) =>
		onChangeDraft({ ...draft, [key]: !draft[key] });

	const togglePosition = (positionId: number) =>
		onChangeDraft({
			...draft,
			positions: draft.positions.includes(positionId)
				? draft.positions.filter((v) => v !== positionId)
				: [...draft.positions, positionId],
		});

	return (
		<div className="space-y-5 px-4 pb-2">
			<SheetSection title={t("browse_filters.quick_filters")}>
				<div className="flex flex-wrap gap-2">
					{inboxFilterOptions.map((filter) => (
						<SheetChip key={filter.key} active={Boolean(draft[filter.key])} onClick={() => toggle(filter.key)}>
							{filter.label}
						</SheetChip>
					))}
				</div>
			</SheetSection>

			{/* Pinned/Archived/Hidden visibility */}
			<SheetSection title={t("chat_filters.visibility", { defaultValue: "Visibility" })}>
				<div className={SHEET_GROUP_CLASS}>
					<VisibilityFilterRow
						label={t("chat.pinned")}
						value={draft.pinnedFilter}
						onChange={(pinnedFilter) => onChangeDraft({ ...draft, pinnedFilter })}
					/>
					{archivedCount > 0 && (
						<VisibilityFilterRow
							label={t("chat.archived.filter_label", { defaultValue: "Archived" })}
							value={draft.archivedFilter}
							onChange={(archivedFilter) => onChangeDraft({ ...draft, archivedFilter })}
						/>
					)}
					{hiddenCount > 0 && (
						<VisibilityFilterRow
							label={t("chat.hidden.filter_label", { defaultValue: "Hidden" })}
							value={draft.hiddenFilter}
							onChange={(hiddenFilter) => onChangeDraft({ ...draft, hiddenFilter })}
						/>
					)}
				</div>
			</SheetSection>

			<SheetSection title={t("chat_filters.max_distance")} value={distanceDisplay}>
				<div className="px-1">
					<Slider
						label={t("chat_filters.max_distance")}
						min={0}
						max={distanceSteps.length - 1}
						defaultValue={displayDistanceIndex}
						displayValue={distanceDisplay}
						activeColor="var(--accent)"
						hideHeader
						onChange={(index) => {
							const meters = distanceSteps[index];
							onChangeDraft({
								...draft,
								distanceMeters: index === distanceSteps.length - 1 ? "" : String(meters),
							});
						}}
					/>
				</div>
			</SheetSection>

			<SheetSection title={t("profile_editor.sections.states.position")}>
				<div className="flex flex-wrap gap-2">
					{positionFilterOptions.map(({ value: positionId, label }) => {
						const Icon = SEXUAL_POSITION_ICONS[positionId];
						return (
							<SheetChip key={positionId} active={draft.positions.includes(positionId)} onClick={() => togglePosition(positionId)}>
								{Icon ? (
									<span className="inline-flex items-center gap-1.5">
										<Icon className="h-3.5 w-3.5 shrink-0" />
										{label}
									</span>
								) : label}
							</SheetChip>
						);
					})}
				</div>
			</SheetSection>
		</div>
	);
}
