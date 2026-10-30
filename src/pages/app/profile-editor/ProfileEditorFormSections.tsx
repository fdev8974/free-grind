import React, { useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
	AlertTriangle,
	AlignLeft,
	Bell,
	Cake,
	Calendar,
	ChevronRight,
	Clock,
	Compass,
	Eye,
	Flame,
	Globe,
	Hash,
	Heart,
	Images,
	Map as MapIcon,
	MapPin,
	MessageSquare,
	Plus,
	Ruler,
	Scale,
	Search,
	Shield,
	ShieldCheck,
	Syringe,
	Tag,
	User,
	UserRound,
	X,
	type LucideIcon,
} from "lucide-react";
import {
	DndContext,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
	type DragOverEvent,
	type DragStartEvent,
} from "@dnd-kit/core";
import {
	SortableContext,
	arrayMove,
	rectSortingStrategy,
	useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { haptic } from "../../../utils/haptics";
import { useDesktopBreakpoint } from "../../../hooks/useDesktopBreakpoint";
import { getThumbImageUrl } from "../../../utils/media";
import { proxyMediaUrl } from "../../../utils/mediaProxy";
import { sheetChipClassName } from "../../../components/ui/sheet-section";
import { SelectSheet } from "../../../components/ui/select-sheet";
import { Slider } from "../../../components/ui/range-slider";
import { TravelPlansSection } from "./TravelPlansSection";
import { SpotifyFavoritesSection } from "./SpotifyFavoritesSection";
import { TagsPickerDialog } from "./TagsPickerDialog";
import {
	FieldSection,
	FieldSectionAction,
	FieldStyleProvider,
	MultiSelectField,
	PickerRow,
	SingleSelectField,
	TextAreaField,
	TextField,
	ToggleField,
} from "./ProfileFieldRows";
import { SEXUAL_POSITION_ICONS } from "../profile-option-builders";
import { FacebookIcon, InstagramIcon, XIcon } from "../../../components/icons/BrandIcons";
import {
	MAX_PROFILE_PHOTOS,
	MAX_PROFILE_TAGS,
	MEDIA_MODERATION_STATE,
	toggleProfileTagText,
} from "./profileEditorUtils";
import type { ProfileEditorState } from "./useProfileEditor";

export type PhotoModeration = { state: number | null; reason: string | null };

type SortablePhotoSlotProps = {
	hash: string;
	slotIndex: number;
	moderation?: PhotoModeration;
	isSavingPhotos: boolean;
	isUploadingPhoto: boolean;
	onRemovePhoto: (hash: string) => void;
	t: ReturnType<typeof useTranslation>["t"];
};

function SortablePhotoSlot({
	hash,
	slotIndex,
	moderation,
	isSavingPhotos,
	isUploadingPhoto,
	onRemovePhoto,
	t,
}: SortablePhotoSlotProps) {
	const isBusy = isSavingPhotos || isUploadingPhoto;
	// The whole tile is the drag handle (mouse: after 8px, touch: long press —
	// see the sensors below), so it needs no grip of its own.
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
		useSortable({ id: hash, disabled: isBusy });

	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
	};

	const isPrimary = slotIndex === 0;
	const isPending = moderation?.state === MEDIA_MODERATION_STATE.PENDING;
	const isRejected = moderation?.state === MEDIA_MODERATION_STATE.REJECTED;
	// One pill style for every tile label: primary, pending, rejected.
	const pillClass = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm";

	return (
		<div
			ref={setNodeRef}
			style={style}
			{...attributes}
			{...listeners}
			// The long press that starts a touch drag mustn't open the browser's
			// image menu / callout or start a text selection.
			onContextMenu={(event) => event.preventDefault()}
			className={[
				"group relative aspect-square touch-manipulation select-none overflow-hidden rounded-2xl bg-[var(--surface-2)] outline-none transition-[scale,box-shadow] duration-150 [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
				isBusy ? "" : "cursor-grab active:cursor-grabbing",
				// Lifted while dragging: a bit bigger, accent ring, shadow.
				isDragging ? "z-10 scale-105 shadow-xl ring-2 ring-[var(--accent)]" : "",
			].join(" ")}
		>
			<img
				src={proxyMediaUrl(getThumbImageUrl(hash, "320x320"))}
				alt={`Profile photo ${slotIndex + 1}`}
				draggable={false}
				className={`pointer-events-none h-full w-full object-cover ${isRejected ? "opacity-50 grayscale" : ""}`}
			/>

			{(isPending || isRejected) && (
				<span
					title={moderation?.reason ?? undefined}
					className={`absolute left-1.5 top-1.5 ${pillClass} ${isRejected ? "bg-red-500/90" : "bg-amber-500/90"}`}
				>
					{isRejected ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
					{isRejected
						? t("profile_editor.sections.pictures.rejected")
						: t("profile_editor.sections.pictures.pending_moderation")}
				</span>
			)}

			{isPrimary && (
				<span className={`absolute bottom-1.5 left-1.5 ${pillClass} bg-[var(--accent)]`}>
					{t("profile_editor.sections.pictures.primary")}
				</span>
			)}

			{/* Small round remove button, like removing a song; it never starts a drag. */}
			<button
				type="button"
				onClick={() => void onRemovePhoto(hash)}
				onPointerDown={(event) => event.stopPropagation()}
				onTouchStart={(event) => event.stopPropagation()}
				onKeyDown={(event) => event.stopPropagation()}
				disabled={isBusy}
				aria-label={t("profile_editor.sections.pictures.remove")}
				title={t("profile_editor.sections.pictures.remove")}
				className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
			>
				<X className="h-3.5 w-3.5" />
			</button>
		</div>
	);
}

export type ToggleMultiValueKey =
	| "lookingFor"
	| "meetAt"
	| "grindrTribes"
	| "tribesImInto"
	| "genders"
	| "pronouns"
	| "sexualHealth"
	| "vaccines";

// Location Randomizer range in the official app (26.21: "Less" … "More").
const MAP_FUZZ_RADIUS_MIN = 50;
const MAP_FUZZ_RADIUS_MAX = 1500;
const MAP_FUZZ_RADIUS_STEP = 50;

const TEST_REMINDER_THRESHOLD_MONTHS = 3;
const LAST_TESTED_MONTH_RANGE = 24;

/** "Last tested" as a row opening a month list (the last 24 months, so no
 * future dates); draft value is "YYYY-MM", "" for not set. */
function LastTestedField({
	icon,
	label,
	value,
	onChange,
}: {
	icon?: LucideIcon;
	label: string;
	value: string;
	onChange: (value: string) => void;
}) {
	const { t, i18n } = useTranslation();
	const isDesktop = useDesktopBreakpoint();
	const [isOpen, setIsOpen] = useState(false);

	const options = useMemo(() => {
		const formatter = new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric", timeZone: "UTC" });
		const now = new Date();
		const months = Array.from({ length: LAST_TESTED_MONTH_RANGE }, (_, i) => {
			const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
			return {
				value: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
				label: formatter.format(date),
			};
		});
		// Keep an older saved month listed, so it still shows as selected.
		if (value && !months.some((month) => month.value === value)) {
			const [year, month] = value.split("-").map(Number);
			if (year && month) {
				months.push({ value, label: formatter.format(new Date(Date.UTC(year, month - 1, 1))) });
			}
		}
		return months;
	}, [i18n.language, value]);

	return (
		<>
			<PickerRow
				icon={icon}
				label={label}
				value={options.find((option) => option.value === value)?.label ?? ""}
				onClick={() => setIsOpen(true)}
			/>
			{isOpen && createPortal(
				<SelectSheet
					title={label}
					value={value}
					options={[{ value: "", label: t("profile_editor.sections.states.not_set") }, ...options]}
					onSelect={onChange}
					onClose={() => setIsOpen(false)}
					isDesktop={isDesktop}
					expandable
				/>,
				document.body,
			)}
		</>
	);
}

export function ProfileEditorFormSections({
	editor,
	layout = "page",
}: {
	editor: ProfileEditorState;
	/** "panel": always one column, for narrower hosts like the profile view's edit mode. */
	layout?: "page" | "panel";
}) {
	const { t } = useTranslation();
	const { testReminderDisabled, setPreferences } = usePreferences();
	const isDesktop = useDesktopBreakpoint();
	const {
		draft,
		unitsPreset,
		handleDraftChange: onDraftChange,
		toggleMultiValue: onToggleMultiValue,
		displayNameError,
		aboutMeError,
		tagsError,
		tagList,
		tagLabelByKey,
		options,
		profileId,
		spotifyTracks,
		isLoadingSpotify,
		setSpotifyDraft,
		travelPlans,
		isLoadingTravelPlans,
		setTravelDraft,
		settings,
		handleSettingsChange: onSettingsChange,
		photos,
	} = editor;
	const isImperialHeight = unitsPreset === "uk" || unitsPreset === "american";
	const isImperialWeight = unitsPreset === "american";
	const [activeId, setActiveId] = useState<string | null>(null);
	const [overId, setOverId] = useState<string | null>(null);
	const [isTagsDialogOpen, setIsTagsDialogOpen] = useState(false);

	// Mouse drags after a few pixels; touch only after a long press, so swiping
	// across the photos still scrolls the page. (A PointerSensor would also
	// catch touches and start dragging on every scroll that begins on a photo.)
	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
		useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 10 } }),
	);

	const liveOrder = useMemo(() => {
		if (!activeId || !overId || activeId === overId) return photos.hashes;
		const from = photos.hashes.indexOf(activeId);
		const to = photos.hashes.indexOf(overId);
		if (from === -1 || to === -1) return photos.hashes;
		return arrayMove(photos.hashes, from, to);
	}, [activeId, overId, photos.hashes]);

	// Haptics: a firm tick when the photo lifts, a light one for each new spot
	// it moves over, and one more when it lands somewhere new.
	const handleDndDragStart = ({ active }: DragStartEvent) => {
		setActiveId(String(active.id));
		haptic(15);
	};

	const handleDndDragOver = ({ over }: DragOverEvent) => {
		const nextOverId = over ? String(over.id) : null;
		if (nextOverId && nextOverId !== overId) haptic(6);
		setOverId(nextOverId);
	};

	const handleDndDragEnd = ({ active, over }: DragEndEvent) => {
		setActiveId(null);
		setOverId(null);
		if (!over || active.id === over.id) return;
		const from = photos.hashes.indexOf(String(active.id));
		const to = photos.hashes.indexOf(String(over.id));
		if (from === -1 || to === -1) return;
		haptic(10);
		void photos.handleReorder(arrayMove(photos.hashes, from, to));
	};

	const monthsSinceLastTested = useMemo(() => {
		if (!draft.lastTestedDate) return null;
		const timestamp = new Date(draft.lastTestedDate).getTime();
		if (Number.isNaN(timestamp)) return null;
		return (Date.now() - timestamp) / (1000 * 60 * 60 * 24 * 30.44);
	}, [draft.lastTestedDate]);

	const isTestOverdue =
		monthsSinceLastTested != null && monthsSinceLastTested >= TEST_REMINDER_THRESHOLD_MONTHS;

	const openPhotoDrawer = () => photos.setIsDrawerOpen(true);
	const isPhotoAddDisabled = photos.isUploading || photos.isSaving || photos.hashes.length >= MAX_PROFILE_PHOTOS;
	const fieldStyle = layout === "panel" ? "profile" : "card";
	// This component provides the field style, so it can't read it from context.
	const rowHoverClass = fieldStyle === "profile" ? "hover:bg-[var(--surface)] active:bg-[var(--surface)]" : "hover:bg-[var(--surface-2)]";
	const PositionIcon = (draft.sexualPosition ? SEXUAL_POSITION_ICONS[Number(draft.sexualPosition)] : undefined) ?? Compass;

	const picturesSection = (
		<FieldSection
			title={t("profile_editor.sections.pictures.title")}
			action={
				<FieldSectionAction onClick={openPhotoDrawer} disabled={isPhotoAddDisabled}>
					<Plus className="h-3.5 w-3.5" />
					{photos.isUploading
						? t("profile_editor.sections.pictures.uploading")
						: t("profile_editor.sections.pictures.add")}
					<span className="tabular-nums text-[var(--text-muted)]">
						{photos.hashes.length}/{MAX_PROFILE_PHOTOS}
					</span>
				</FieldSectionAction>
			}
			footer={
				<p className="mt-2 px-1 text-xs text-[var(--text-muted)]">
					{photos.isSaving
						? t("profile_editor.sections.pictures.saving")
						: t("profile_editor.sections.pictures.footer")}
				</p>
			}
		>
			<div className="p-3">
				<DndContext
					sensors={sensors}
					onDragStart={handleDndDragStart}
					onDragOver={handleDndDragOver}
					onDragEnd={handleDndDragEnd}
					onDragCancel={() => { setActiveId(null); setOverId(null); }}
				>
					<SortableContext items={photos.hashes} strategy={rectSortingStrategy}>
						<div className={`grid gap-2 ${isDesktop ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3"} rail:grid-cols-5`}>
							{photos.hashes.map((hash) => (
								<SortablePhotoSlot
									key={hash}
									hash={hash}
									slotIndex={liveOrder.indexOf(hash)}
									moderation={photos.moderationByHash.get(hash)}
									isSavingPhotos={photos.isSaving}
									isUploadingPhoto={photos.isUploading}
									onRemovePhoto={photos.handleRemove}
									t={t}
								/>
							))}
							{Array.from({ length: MAX_PROFILE_PHOTOS - photos.hashes.length }).map((_, i) => (
								<button
									key={`empty-${i}`}
									type="button"
									onClick={openPhotoDrawer}
									className="relative flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl ink-tint-6 text-[var(--text-muted)] transition-[transform,color] duration-150 hover:ink-tint-10 hover:text-[var(--accent)] active:scale-[0.98]"
								>
									<Plus className="h-5 w-5" />
									<span className="text-xs font-medium">
										{t("profile_editor.sections.pictures.add")}
									</span>
								</button>
							))}
						</div>
					</SortableContext>
				</DndContext>
			</div>
		</FieldSection>
	);

	// The sections below use the profile view's headings and field icons, so
	// editing reads like the profile it changes. Order follows it too (Expectations,
	// Health | Stats, Trips, Social, songs, account), except About comes before
	// Tags, so name and bio lead.
	const tagsSection = (
		<FieldSection title={t("profile_details.tags")}>
			{/* The picks as chips; editing happens in the picker. */}
			<button
				type="button"
				onClick={() => setIsTagsDialogOpen(true)}
				className={`block w-full px-4 py-3 text-left transition ${rowHoverClass}`}
			>
				<span className="flex min-h-6 items-center gap-3">
					<Tag className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
					<span className="flex-1 text-sm font-medium text-[var(--text)]">
						{t("profile_editor.sections.profile.my_tags")}
					</span>
					<span className="text-xs tabular-nums text-[var(--text-muted)] opacity-70">
						{tagList.length}/{MAX_PROFILE_TAGS}
					</span>
					<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
				</span>
				{tagList.length > 0 ? (
					<span
						className="mt-2 flex flex-wrap gap-1.5"
						style={{ "--chip-accent": "var(--accent)" } as CSSProperties}
					>
						{tagList.map((tag) => (
							<span key={tag} className={sheetChipClassName({ active: true, size: "sm" })}>
								{tagLabelByKey.get(tag) ?? tag}
							</span>
						))}
					</span>
				) : (
					<span className="mt-1 block pl-7 text-sm text-[var(--text-muted)] opacity-60">
						{t("profile_editor.sections.profile.no_tags_added")}
					</span>
				)}
				{tagsError && <span className="mt-1.5 block text-xs text-red-400">{tagsError}</span>}
			</button>
		</FieldSection>
	);

	const aboutSection = (
		<FieldSection title={t("profile_details.about")}>
			<TextField
				icon={UserRound}
				label={t("profile_editor.sections.profile.display_name")}
				value={draft.displayName}
				onChange={(value) => onDraftChange("displayName", value)}
				placeholder={t("profile_editor.sections.profile.display_name_placeholder")}
				maxLength={15}
				counter={`${draft.displayName.trim().length}/15`}
				error={displayNameError}
			/>
			<TextAreaField
				icon={AlignLeft}
				label={t("profile_editor.sections.profile.about_me")}
				value={draft.aboutMe}
				onChange={(value) => onDraftChange("aboutMe", value)}
				placeholder={t("profile_editor.sections.profile.about_me_placeholder")}
				maxLength={255}
				counter={`${draft.aboutMe.length}/255`}
				error={aboutMeError}
			/>
		</FieldSection>
	);

	const expectationsSection = (
		<FieldSection title={t("profile_details.expectations")}>
			<MultiSelectField
				icon={Search}
				label={t("profile_editor.sections.expectations.looking_for")}
				values={draft.lookingFor}
				options={options.lookingFor}
				onToggle={(value) => onToggleMultiValue("lookingFor", value)}
			/>
			<MultiSelectField
				icon={MapPin}
				label={t("profile_editor.sections.expectations.meet_at")}
				values={draft.meetAt}
				options={options.meetAt}
				onToggle={(value) => onToggleMultiValue("meetAt", value)}
			/>
			<SingleSelectField
				icon={Shield}
				label={t("profile_editor.sections.expectations.accept_nsfw")}
				value={draft.nsfw}
				options={options.nsfw}
				onChange={(value) => onDraftChange("nsfw", value)}
			/>
			<ToggleField
				icon={Eye}
				label={t("profile_editor.sections.states.show_tribes")}
				checked={draft.showTribes}
				onChange={(checked) => onDraftChange("showTribes", checked)}
			/>
			<MultiSelectField
				icon={Flame}
				label={t("profile_editor.sections.states.tribes")}
				values={draft.grindrTribes}
				options={options.tribe}
				onToggle={(value) => onToggleMultiValue("grindrTribes", value)}
			/>
			<MultiSelectField
				icon={Flame}
				label={t("profile_editor.sections.states.tribes_im_into")}
				values={draft.tribesImInto}
				options={options.tribe}
				onToggle={(value) => onToggleMultiValue("tribesImInto", value)}
			/>
			<MultiSelectField
				icon={User}
				label={t("profile_editor.sections.identity.gender")}
				values={draft.genders}
				// Primary genders first, like the official picker.
				options={[
					...options.gender.filter((option) => options.defaultGenderIds.includes(option.value)),
					...options.gender.filter((option) => !options.defaultGenderIds.includes(option.value)),
				]}
				onToggle={(value) => onToggleMultiValue("genders", value)}
				search={{
					placeholder: t("profile_editor.sections.identity.gender_search_placeholder"),
					noMatchesLabel: t("profile_editor.sections.identity.gender_no_matches"),
				}}
				unavailableLabel={t("profile_editor.sections.identity.gender_unavailable")}
			/>
			<MultiSelectField
				icon={MessageSquare}
				label={t("profile_editor.sections.identity.pronouns")}
				values={draft.pronouns}
				options={options.pronoun}
				onToggle={(value) => onToggleMultiValue("pronouns", value)}
				unavailableLabel={t("profile_editor.sections.identity.pronouns_unavailable")}
			/>
		</FieldSection>
	);

	const healthSection = (
		<FieldSection title={t("profile_details.health")}>
			<SingleSelectField
				icon={Shield}
				label={t("profile_editor.sections.health.hiv_status")}
				value={draft.hivStatus}
				options={options.hivStatus}
				onChange={(value) => onDraftChange("hivStatus", value)}
			/>
			<LastTestedField
				icon={Calendar}
				label={t("profile_editor.sections.health.last_tested")}
				value={draft.lastTestedDate}
				onChange={(value) => onDraftChange("lastTestedDate", value)}
			/>
			{isTestOverdue && (
				<div className="flex items-start gap-3 bg-amber-500/10 px-4 py-3">
					<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
					<p className="text-xs leading-relaxed text-amber-400">
						{t("profile_editor.sections.health.test_reminder")}
					</p>
				</div>
			)}
			<ToggleField
				icon={Bell}
				label={t("profile_editor.sections.health.test_reminder_toggle")}
				description={t("profile_editor.sections.health.test_reminder_toggle_desc")}
				checked={!testReminderDisabled}
				onChange={(checked) => void setPreferences({ testReminderDisabled: !checked })}
			/>
			<MultiSelectField
				icon={ShieldCheck}
				label={t("profile_editor.sections.health.health_practices")}
				values={draft.sexualHealth}
				options={options.sexualHealth}
				onToggle={(value) => onToggleMultiValue("sexualHealth", value)}
			/>
			<MultiSelectField
				icon={Syringe}
				label={t("profile_editor.sections.health.vaccinations")}
				values={draft.vaccines}
				options={options.vaccine}
				onToggle={(value) => onToggleMultiValue("vaccines", value)}
			/>
		</FieldSection>
	);

	const statsSection = (
		<FieldSection title={t("profile_details.stats")}>
			<ToggleField
				icon={Eye}
				label={t("profile_editor.sections.states.show_age")}
				checked={draft.showAge}
				onChange={(checked) => onDraftChange("showAge", checked)}
			/>
			<TextField
				icon={Cake}
				label={t("profile_editor.sections.states.age")}
				value={draft.age}
				onChange={(value) => onDraftChange("age", value)}
				placeholder="—"
				numeric
			/>
			<ToggleField
				icon={Eye}
				label={t("profile_editor.sections.states.show_position")}
				checked={draft.showPosition}
				onChange={(checked) => onDraftChange("showPosition", checked)}
			/>
			<SingleSelectField
				icon={PositionIcon}
				label={t("profile_editor.sections.states.position")}
				value={draft.sexualPosition}
				options={options.position}
				optionIcons={SEXUAL_POSITION_ICONS}
				onChange={(value) => onDraftChange("sexualPosition", value)}
			/>
			<TextField
				icon={Ruler}
				label={t("profile_editor.sections.states.height")}
				value={draft.height}
				onChange={(value) => onDraftChange("height", value)}
				placeholder={t(
					isImperialHeight
						? "profile_editor.sections.states.height_placeholder_in"
						: "profile_editor.sections.states.height_placeholder",
				)}
				numeric
			/>
			<TextField
				icon={Scale}
				label={t("profile_editor.sections.states.weight")}
				value={draft.weight}
				onChange={(value) => onDraftChange("weight", value)}
				placeholder={t(
					isImperialWeight
						? "profile_editor.sections.states.weight_placeholder_lb"
						: "profile_editor.sections.states.weight_placeholder",
				)}
				numeric
			/>
			<SingleSelectField
				icon={User}
				label={t("profile_editor.sections.states.body_type")}
				value={draft.bodyType}
				options={options.bodyType}
				onChange={(value) => onDraftChange("bodyType", value)}
			/>
			<SingleSelectField
				icon={Globe}
				label={t("profile_editor.sections.states.ethnicity")}
				value={draft.ethnicity}
				options={options.ethnicity}
				onChange={(value) => onDraftChange("ethnicity", value)}
			/>
			<SingleSelectField
				icon={Heart}
				label={t("profile_editor.sections.states.relationship_status")}
				value={draft.relationshipStatus}
				options={options.relationshipStatus}
				onChange={(value) => onDraftChange("relationshipStatus", value)}
			/>
		</FieldSection>
	);

	const socialSection = (
		<FieldSection title={t("profile_details.social")}>
			{([
				["instagram", InstagramIcon],
				["twitter", XIcon],
				["facebook", FacebookIcon],
			] as const).map(([network, NetworkIcon]) => (
				<TextField
					key={network}
					icon={NetworkIcon}
					label={t(`profile_editor.sections.social.${network}`)}
					value={draft[network]}
					onChange={(value) => onDraftChange(network, value)}
					placeholder={t("profile_editor.sections.social.placeholder")}
				/>
			))}
		</FieldSection>
	);

	// Map & Right Now — account settings (/v3/me/prefs/settings), saved with the profile.
	const mapSection = settings ? (
		<FieldSection title={t("profile_editor.sections.map.title", { defaultValue: "Map & Right Now" })}>
			<ToggleField
				icon={MapIcon}
				label={t("profile_editor.sections.map.show_on_map", { defaultValue: "Show Me on Map" })}
				description={t("profile_editor.sections.map.show_on_map_desc", {
					defaultValue: "Your profile appears on the map, always offset from your actual location.",
				})}
				checked={settings.showOnMap}
				onChange={(checked) => onSettingsChange({ showOnMap: checked })}
			/>
			{settings.showOnMap && (
				<div className="px-4 py-3">
					<Slider
						min={MAP_FUZZ_RADIUS_MIN}
						max={MAP_FUZZ_RADIUS_MAX}
						step={MAP_FUZZ_RADIUS_STEP}
						defaultValue={settings.mapLocationFuzzRadius ?? MAP_FUZZ_RADIUS_MIN}
						label={t("profile_editor.sections.map.location_randomizer", { defaultValue: "Location Randomizer" })}
						displayValue={
							settings.mapLocationFuzzRadius == null
								? t("profile_editor.sections.map.radius_default", { defaultValue: "Default" })
								: isImperialHeight
									? t("profile_editor.sections.map.radius_ft", {
											defaultValue: "~{{value}} ft radius",
											value: Math.round(settings.mapLocationFuzzRadius * 3.280839895),
										})
									: t("profile_editor.sections.map.radius_m", {
											defaultValue: "~{{value}} m radius",
											value: settings.mapLocationFuzzRadius,
										})
						}
						onChange={(value) => onSettingsChange({ mapLocationFuzzRadius: value })}
					/>
					<p className="mt-1 text-xs text-[var(--text-muted)]">
						{t("profile_editor.sections.map.location_randomizer_desc", {
							defaultValue: "For your privacy, your location on the map is offset within this range and updates as you move.",
						})}
					</p>
				</div>
			)}
			<ToggleField
				icon={Images}
				label={t("profile_editor.sections.map.view_right_now_nsfw", { defaultValue: "Explicit Images in Right Now" })}
				description={t("profile_editor.sections.map.view_right_now_nsfw_desc", {
					defaultValue: "Opt in to seeing explicit sexual and other adult content in Right Now.",
				})}
				checked={settings.viewRightNowNsfw}
				onChange={(checked) => onSettingsChange({ viewRightNowNsfw: checked })}
			/>
		</FieldSection>
	) : null;

	const accountSection = (
		<FieldSection title={t("profile_details.account_info")}>
			<div className="flex min-h-12 items-center gap-3 px-4 py-2.5">
				<Hash className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
				<span className="flex-1 text-sm font-medium text-[var(--text)]">
					{t("profile_editor.sections.other.user_id")}
				</span>
				<span className="select-text font-mono text-sm text-[var(--text-muted)]">
					{profileId ?? "—"}
				</span>
			</div>
		</FieldSection>
	);

	const firstStack = (
		<>
			{picturesSection}
			{aboutSection}
			{tagsSection}
			{expectationsSection}
			{healthSection}
		</>
	);
	const secondStack = (
		<>
			{statsSection}
			<TravelPlansSection
				plans={travelPlans}
				isLoading={isLoadingTravelPlans}
				disabled={profileId == null}
				onChange={setTravelDraft}
			/>
			{socialSection}
			<SpotifyFavoritesSection
				tracks={spotifyTracks}
				isLoading={isLoadingSpotify}
				disabled={profileId == null}
				onChange={setSpotifyDraft}
			/>
			{mapSection}
			{accountSection}
		</>
	);

	return (
		<FieldStyleProvider value={fieldStyle}>
			{layout === "page" ? (
				// Wide windows: two fixed stacks (not CSS columns, so sections never
				// jump between columns while editing); narrower, they stack in order.
				<div className="grid gap-6 min-[1400px]:grid-cols-2 min-[1400px]:items-start">
					<div className="grid min-w-0 gap-6">{firstStack}</div>
					<div className="grid min-w-0 gap-6">{secondStack}</div>
				</div>
			) : (
				// Same spacing as the profile view's sections.
				<div className="grid gap-8">
					{firstStack}
					{secondStack}
				</div>
			)}

			{isTagsDialogOpen && (
				<TagsPickerDialog
					selected={tagList}
					max={MAX_PROFILE_TAGS}
					maxMessage={t("profile_editor.errors.max_selection", { count: MAX_PROFILE_TAGS })}
					onToggle={(tagKey) => onDraftChange("profileTagsText", toggleProfileTagText(draft.profileTagsText, tagKey))}
					onClose={() => setIsTagsDialogOpen(false)}
				/>
			)}
		</FieldStyleProvider>
	);
}
