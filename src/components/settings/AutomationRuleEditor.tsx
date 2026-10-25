import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { AtSign, Ban, Calendar, ChevronDown, FileText, Flame, ImageOff, Image as ImageIcon, MessageCirclePlus, MessageSquare, Plus, Search, Trash2, User } from "lucide-react";
import toast from "react-hot-toast";
import { Slider } from "../ui/range-slider";
import type { Album } from "../../types/albums";
import type {
	AutomationRule,
	AutomationRuleAction,
	AutomationRuleCondition,
	AutomationTrigger,
} from "../../utils/automationRules";
import { getTapEmoji, tapLabel } from "../../pages/app/interest/interestUtils";
import {
	SheetCloseButton,
	SHEET_FOOTER_CLASS,
	SHEET_FOOTER_ICON_BUTTON_CLASS,
	sheetButtonClass,
} from "../ui/bottom-sheet";
import { NATIVE_SHEET_BG } from "../ui/action-sheet";
import { ControlledBottomSheet } from "../ui/controlled-sheet";
import { SelectSheet } from "../ui/select-sheet";
import { SHEET_FIELD_CLASS, SheetChip, SheetSection, SheetTextInput } from "../ui/sheet-section";
import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";
import { cn } from "../../utils/cn";

/** One condition or action of the rule: icon tile, content, remove button. */
function RuleItemCard({
	icon,
	iconClass,
	onRemove,
	children,
}: {
	icon: ReactNode;
	iconClass: string;
	onRemove?: () => void;
	children: ReactNode;
}) {
	return (
		<div className="flex items-start gap-3 rounded-2xl bg-[var(--surface-2)] p-3">
			<div className={cn("shrink-0 rounded-2xl p-2.5", iconClass)}>{icon}</div>
			<div className="min-w-0 flex-1 self-center">{children}</div>
			{onRemove && (
				<button
					type="button"
					onClick={onRemove}
					className="shrink-0 rounded-full p-2 text-[var(--text-muted)] transition hover:bg-red-500/12 hover:text-red-500"
				>
					<Trash2 className="h-4 w-4" />
				</button>
			)}
		</div>
	);
}

/** "Add …" row under a list of conditions or actions; opens a picker sheet. */
function AddItemButton({ label, onClick }: { label: string; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[color-mix(in_srgb,var(--text)_20%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--accent)] transition hover:ink-tint-6 active:scale-[0.99]"
		>
			<Plus className="h-4 w-4" />
			{label}
		</button>
	);
}

// The "doesn't contain" keyword conditions aren't a distinct entry in
// AutomationRuleCondition — they're the same type with `negate: true`. But in
// the editor's add-condition dropdown they're offered as separate picks (like
// age_above/age_below already are), fixed at creation time rather than an
// after-the-fact toggle, so a condition's title never has to change under you.
type KeywordNotConditionKind =
	| "bio_not_contains_keyword"
	| "message_not_contains_keyword"
	| "display_name_not_contains_keyword"
	| "x_handle_not_contains_keyword"
	| "instagram_handle_not_contains_keyword"
	| "facebook_handle_not_contains_keyword";
type ConditionKind = AutomationRuleCondition["type"] | KeywordNotConditionKind;
type ActionKind = AutomationRuleAction["type"];

const TRIGGER_KINDS: AutomationTrigger[] = ["new_chat", "message_received", "tap_received"];

const CONDITION_KINDS: ConditionKind[] = [
	"profile_picture",
	"age_above",
	"age_below",
	"display_name_contains_keyword",
	"display_name_not_contains_keyword",
	"bio_contains_keyword",
	"bio_not_contains_keyword",
	"message_contains_keyword",
	"message_not_contains_keyword",
	"has_x_handle",
	"x_handle_contains_keyword",
	"x_handle_not_contains_keyword",
	"has_instagram_handle",
	"instagram_handle_contains_keyword",
	"instagram_handle_not_contains_keyword",
	"has_facebook_handle",
	"facebook_handle_contains_keyword",
	"facebook_handle_not_contains_keyword",
];

const ACTION_KINDS: ActionKind[] = ["block", "send_message", "share_album", "send_tap"];

const TAP_TYPES = [0, 1, 2];

// Condition types that render as a keyword textarea (with the custom /
// forbidden-list toggle), same UI for all of them.
const KEYWORD_CONDITION_TYPES = [
	"bio_contains_keyword",
	"message_contains_keyword",
	"display_name_contains_keyword",
	"x_handle_contains_keyword",
	"instagram_handle_contains_keyword",
	"facebook_handle_contains_keyword",
] as const satisfies AutomationRuleCondition["type"][];
type KeywordConditionType = (typeof KEYWORD_CONDITION_TYPES)[number];

// Condition types that render as a simple "has X" / "no X" select, same UI
// for all of them (see the profile_picture pattern this generalizes from).
const HAS_CONDITION_TYPES = ["has_x_handle", "has_instagram_handle", "has_facebook_handle"] as const satisfies AutomationRuleCondition["type"][];
type HasConditionType = (typeof HAS_CONDITION_TYPES)[number];

type KeywordCondition = Extract<AutomationRuleCondition, { type: KeywordConditionType }>;

function isKeywordCondition(condition: AutomationRuleCondition): condition is KeywordCondition {
	return (KEYWORD_CONDITION_TYPES as readonly string[]).includes(condition.type);
}

const KEYWORD_NOT_KIND_BY_TYPE: Record<KeywordConditionType, KeywordNotConditionKind> = {
	bio_contains_keyword: "bio_not_contains_keyword",
	message_contains_keyword: "message_not_contains_keyword",
	display_name_contains_keyword: "display_name_not_contains_keyword",
	x_handle_contains_keyword: "x_handle_not_contains_keyword",
	instagram_handle_contains_keyword: "instagram_handle_not_contains_keyword",
	facebook_handle_contains_keyword: "facebook_handle_not_contains_keyword",
};

// Maps an add-dropdown `kind` to the actual stored condition type + negate
// flag (several kinds share the same underlying type).
function resolveConditionKind(kind: ConditionKind): { type: AutomationRuleCondition["type"]; negate: boolean } {
	const entry = (Object.entries(KEYWORD_NOT_KIND_BY_TYPE) as [KeywordConditionType, KeywordNotConditionKind][]).find(
		([, notKind]) => notKind === kind,
	);
	if (entry) return { type: entry[0], negate: true };
	return { type: kind as AutomationRuleCondition["type"], negate: false };
}

// Reverse of resolveConditionKind — used to look up the right label for an
// existing condition's title based on its stored type + negate flag.
function conditionKindOf(condition: AutomationRuleCondition): ConditionKind {
	if ((KEYWORD_CONDITION_TYPES as readonly string[]).includes(condition.type) && "negate" in condition && condition.negate) {
		return KEYWORD_NOT_KIND_BY_TYPE[condition.type as KeywordConditionType];
	}
	return condition.type;
}

function defaultCondition(kind: ConditionKind): AutomationRuleCondition {
	if (kind === "age_above" || kind === "age_below") return { type: kind, value: 25 };
	const { type, negate } = resolveConditionKind(kind);
	if ((KEYWORD_CONDITION_TYPES as readonly string[]).includes(type)) {
		return { type: type as KeywordConditionType, keywords: "", negate };
	}
	if ((HAS_CONDITION_TYPES as readonly string[]).includes(type)) {
		return { type: type as HasConditionType, has: false };
	}
	return { type: "profile_picture", has: false };
}



// "message_contains_keyword" needs message text, which only "new_chat" and
// "message_received" ever provide (tap events have none) — dead weight on a
// rule whose triggers no longer include either, so drop it automatically
// rather than leaving a condition that can never match.
function dropIncompatibleConditions(
	triggers: AutomationTrigger[],
	conditions: AutomationRuleCondition[],
): AutomationRuleCondition[] {
	const hasMessageTextTrigger = triggers.includes("new_chat") || triggers.includes("message_received");
	if (hasMessageTextTrigger) return conditions;
	return conditions.filter((c) => c.type !== "message_contains_keyword");
}

function defaultAction(kind: ActionKind, firstAlbum?: Album): AutomationRuleAction {
	if (kind === "send_message") return { type: "send_message", text: "" };
	if (kind === "share_album") {
		return { type: "share_album", albumId: firstAlbum ? Number(firstAlbum.albumId) : 0 };
	}
	if (kind === "send_tap") return { type: "send_tap", tapType: 1 };
	return { type: "block" };
}

export function AutomationRuleEditor({
	isOpen,
	rule,
	isNew,
	albums,
	onSave,
	onCancel,
	onDelete,
}: {
	isOpen: boolean;
	rule: AutomationRule | null;
	isNew: boolean;
	albums: Album[];
	onSave: (rule: AutomationRule) => void;
	onCancel: () => void;
	onDelete?: () => void;
}) {
	const { t } = useTranslation();
	const isDesktop = useDesktopBreakpoint();
	const [draft, setDraft] = useState<AutomationRule | null>(rule);
	// The picker sheet open on top: add a condition / action, or pick the album of an action.
	const [picker, setPicker] = useState<"condition" | "action" | { albumOf: number } | null>(null);

	useEffect(() => {
		// Keeps the last rule while the sheet slides out after closing.
		if (rule) setDraft(rule);
	}, [rule]);

	const conditionLabel = (kind: ConditionKind) => t(`settings_automation.condition_${kind}`);
	const actionLabel = (kind: ActionKind) => t(`settings_automation.action_${kind}`);

	const addCondition = (kind: ConditionKind) => {
		setDraft((prev) => prev && { ...prev, conditions: [...prev.conditions, defaultCondition(kind)] });
	};

	const updateCondition = (index: number, patch: Partial<AutomationRuleCondition>) => {
		setDraft((prev) => prev && {
			...prev,
			conditions: prev.conditions.map((c, i) => (i === index ? { ...c, ...patch } as AutomationRuleCondition : c)),
		});
	};

	const removeCondition = (index: number) => {
		setDraft((prev) => prev && { ...prev, conditions: prev.conditions.filter((_, i) => i !== index) });
	};

	const addAction = (kind: ActionKind) => {
		setDraft((prev) => prev && { ...prev, actions: [...prev.actions, defaultAction(kind, albums[0])] });
	};

	const updateAction = (index: number, patch: Partial<AutomationRuleAction>) => {
		setDraft((prev) => prev && {
			...prev,
			actions: prev.actions.map((a, i) => (i === index ? { ...a, ...patch } as AutomationRuleAction : a)),
		});
	};

	const removeAction = (index: number) => {
		setDraft((prev) => prev && { ...prev, actions: prev.actions.filter((_, i) => i !== index) });
	};

	const triggerLabel = (trigger: AutomationTrigger) => t(`settings_automation.rule_trigger_${trigger}`);

	const hasMessageTextTrigger =
		draft != null && (draft.triggers.includes("new_chat") || draft.triggers.includes("message_received"));
	const availableConditionKinds = CONDITION_KINDS.filter((kind) => {
		const { type, negate } = resolveConditionKind(kind);
		const alreadyPresent = draft?.conditions.some(
			(c) => c.type === type && !!("negate" in c ? c.negate : false) === negate,
		);
		const needsMessageText = kind === "message_contains_keyword" || kind === "message_not_contains_keyword";
		return !alreadyPresent && (!needsMessageText || hasMessageTextTrigger);
	});

	const handleSave = () => {
		if (!draft) return;
		if (!draft.name.trim()) {
			toast.error(t("settings_automation.rule_needs_name"));
			return;
		}
		if (draft.actions.length === 0) {
			toast.error(t("settings_automation.rule_needs_action"));
			return;
		}
		if (draft.actions.some((a) => a.type === "send_message" && !a.text.trim())) {
			toast.error(t("settings_automation.action_needs_message_text"));
			return;
		}
		onSave(draft);
	};

	const actionIcon = (kind: ActionKind) =>
		kind === "block" ? Ban : kind === "send_message" ? MessageSquare : kind === "share_album" ? ImageIcon : Flame;
	const removeIfUnlocked = (remove: () => void) => (draft?.locked ? undefined : remove);

	return (
		<ControlledBottomSheet
			isOpen={isOpen}
			onDismiss={onCancel}
			expandable
			isDesktop={isDesktop}
			bg={NATIVE_SHEET_BG}
			panelClassName={isDesktop ? "max-h-[88dvh] px-4" : "px-4"}
		>
			<div className="mb-3 flex shrink-0 items-center justify-between gap-3">
				<h3 className="text-sm font-semibold text-[var(--text)]">
					{t(isNew ? "settings_automation.add_rule" : "settings_automation.edit_rule")}
				</h3>
				<SheetCloseButton />
			</div>

			{draft && (
			<>
			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
				<div className="space-y-5">
				<SheetSection title={t("settings_automation.rule_name_label", { defaultValue: "Name" })}>
					<SheetTextInput
						value={draft.nameKey ? t(draft.nameKey) : draft.name}
						onChange={(name) => setDraft(draft && { ...draft, name, nameKey: undefined })}
						placeholder={t("settings_automation.rule_name_placeholder")}
						disabled={draft.locked}
					/>
				</SheetSection>

				<SheetSection title={t("settings_automation.trigger_label")}>
					<div className="flex flex-wrap gap-2">
						{TRIGGER_KINDS.map((trigger) => {
							const selected = draft.triggers.includes(trigger);
							const Icon = trigger === "tap_received" ? Flame : trigger === "message_received" ? MessageSquare : MessageCirclePlus;
							return (
								<SheetChip
									key={trigger}
									active={selected}
									onClick={() => {
										if (draft.locked) return;
										if (selected && draft.triggers.length <= 1) return; // keep at least one
										const nextTriggers = selected
											? draft.triggers.filter((t) => t !== trigger)
											: [...draft.triggers, trigger];
										setDraft(
											draft && {
												...draft,
												triggers: nextTriggers,
												conditions: dropIncompatibleConditions(nextTriggers, draft.conditions),
											},
										);
									}}
								>
									<span className="inline-flex items-center gap-1.5">
										<Icon className="h-3.5 w-3.5" />
										{triggerLabel(trigger)}
									</span>
								</SheetChip>
							);
						})}
					</div>
				</SheetSection>

				<SheetSection title={t("settings_automation.conditions_label")}>
					<div className="grid gap-2">
						{draft.conditions.length > 1 && (
							<div className="flex gap-2">
								{(["all", "any"] as const).map((mode) => (
									<SheetChip
										key={mode}
										size="sm"
										active={draft.matchMode === mode}
										onClick={() => !draft.locked && setDraft(draft && { ...draft, matchMode: mode })}
									>
										{t(`settings_automation.match_mode_${mode}`)}
									</SheetChip>
								))}
							</div>
						)}
						{draft.conditions.map((condition, index) => {
							const onRemove = removeIfUnlocked(() => removeCondition(index));

							if (condition.type === "age_above" || condition.type === "age_below") {
								return (
									<RuleItemCard key={condition.type} icon={<Calendar className="h-5 w-5" />} iconClass="bg-purple-500/15 text-purple-400" onRemove={onRemove}>
										<Slider
											label={conditionLabel(condition.type)}
											displayValue={String(condition.value)}
											activeColor="#a855f7"
											trackColor="color-mix(in srgb, var(--surface-2), black 20%)"
											min={18}
											max={99}
											defaultValue={condition.value}
											onChange={(value) => updateCondition(index, { value })}
										/>
									</RuleItemCard>
								);
							}

							if (isKeywordCondition(condition)) {
								const Icon =
									condition.type === "bio_contains_keyword" ? FileText
									: condition.type === "display_name_contains_keyword" ? User
									: condition.type === "message_contains_keyword" ? Search
									: AtSign;
								return (
									<RuleItemCard key={condition.type} icon={<Icon className="h-5 w-5" />} iconClass="bg-purple-500/15 text-purple-400" onRemove={onRemove}>
										<p className="text-sm font-medium">{conditionLabel(conditionKindOf(condition))}</p>
										<div className="mt-2 flex flex-wrap gap-2">
											{(["custom", "forbidden"] as const).map((source) => (
												<SheetChip
													key={source}
													size="sm"
													active={!!condition.useForbiddenList === (source === "forbidden")}
													onClick={() => updateCondition(index, { useForbiddenList: source === "forbidden" })}
												>
													{t(`settings_automation.keyword_source_${source}`)}
												</SheetChip>
											))}
										</div>
										{condition.useForbiddenList ? (
											<p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">
												{t("settings_automation.keyword_source_forbidden_hint")}
											</p>
										) : (
											<textarea
												value={condition.keywords}
												onChange={(e) => updateCondition(index, { keywords: e.target.value })}
												placeholder={t("settings_automation.condition_keywords_placeholder")}
												rows={2}
												className={cn(SHEET_FIELD_CLASS, "mt-2 resize-y bg-[var(--surface)] px-3 py-2.5")}
											/>
										)}
									</RuleItemCard>
								);
							}

							// Remaining condition types all share the `has: boolean` shape:
							// profile_picture plus the has_*_handle conditions. profile_picture
							// keeps its original translation keys; the handle conditions use a
							// `condition_<type>[_none|_has]` naming scheme instead.
							const titleKey =
								condition.type === "profile_picture" ? "condition_profile_picture" : `condition_${condition.type}`;
							const noneKey =
								condition.type === "profile_picture" ? "condition_no_profile_picture" : `condition_${condition.type}_none`;
							const hasKey =
								condition.type === "profile_picture" ? "condition_has_profile_picture" : `condition_${condition.type}_has`;
							return (
								<RuleItemCard
									key={condition.type}
									icon={condition.type === "profile_picture"
										? condition.has ? <ImageIcon className="h-5 w-5" /> : <ImageOff className="h-5 w-5" />
										: <AtSign className="h-5 w-5" />}
									iconClass="bg-purple-500/15 text-purple-400"
									onRemove={onRemove}
								>
									<p className="text-sm font-medium">{t(`settings_automation.${titleKey}`)}</p>
									<div className="mt-2 flex flex-wrap gap-2">
										{([false, true] as const).map((has) => (
											<SheetChip
												key={String(has)}
												size="sm"
												active={condition.has === has}
												onClick={() => updateCondition(index, { has })}
											>
												{t(`settings_automation.${has ? hasKey : noneKey}`)}
											</SheetChip>
										))}
									</div>
								</RuleItemCard>
							);
						})}

						{!draft.locked && availableConditionKinds.length > 0 && (
							<AddItemButton label={t("settings_automation.add_condition")} onClick={() => setPicker("condition")} />
						)}
					</div>
				</SheetSection>

				<SheetSection title={t("settings_automation.actions_label")}>
					<div className="grid gap-2">
						{draft.actions.map((action, index) => {
							const Icon = actionIcon(action.type);
							const album = action.type === "share_album"
								? albums.find((a) => Number(a.albumId) === action.albumId)
								: undefined;
							return (
								<RuleItemCard
									key={index}
									icon={<Icon className="h-5 w-5" />}
									iconClass="bg-orange-500/15 text-orange-400"
									onRemove={removeIfUnlocked(() => removeAction(index))}
								>
									<p className="text-sm font-medium">{actionLabel(action.type)}</p>
									{action.type === "send_tap" && (
										<>
											<div className="mt-2 flex flex-wrap gap-2">
												{TAP_TYPES.map((tapType) => (
													<SheetChip
														key={tapType}
														size="sm"
														active={action.tapType === tapType}
														onClick={() => !draft.locked && updateAction(index, { tapType })}
													>
														<span className="inline-flex items-center gap-1.5">
															<span>{getTapEmoji(tapType)}</span>
															{tapLabel(tapType, t)}
														</span>
													</SheetChip>
												))}
											</div>
											<p className="mt-1.5 text-xs text-[var(--text-muted)]">
												{t("settings_automation.action_send_tap_hint")}
											</p>
										</>
									)}
									{action.type === "send_message" && (
										<textarea
											value={action.text}
											onChange={(e) => updateAction(index, { text: e.target.value })}
											placeholder={t("settings_automation.action_send_message_placeholder")}
											rows={3}
											className={cn(SHEET_FIELD_CLASS, "mt-2 resize-y bg-[var(--surface)] px-3 py-2.5")}
										/>
									)}
									{action.type === "share_album" && (
										albums.length > 0 ? (
											<button
												type="button"
												onClick={() => setPicker({ albumOf: index })}
												className="mt-2 flex h-10 w-full items-center justify-between gap-2 rounded-xl bg-[var(--surface)] px-3 text-left text-sm text-[var(--text)] transition hover:ink-tint-6"
											>
												<span className="truncate">{album?.albumName || album?.albumId || action.albumId}</span>
												<ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
											</button>
										) : (
											<p className="mt-1 text-xs text-[var(--text-muted)]">
												{t("settings_automation.no_albums_hint")}
											</p>
										)
									)}
								</RuleItemCard>
							);
						})}

						{!draft.locked && (
							<AddItemButton label={t("settings_automation.add_action")} onClick={() => setPicker("action")} />
						)}
					</div>
				</SheetSection>
				</div>
			</div>

			<div className={SHEET_FOOTER_CLASS}>
				{onDelete && (
					<button
						type="button"
						onClick={onDelete}
						aria-label={t("settings_automation.delete_rule")}
						className={cn(SHEET_FOOTER_ICON_BUTTON_CLASS, "bg-red-500/12 text-red-500 hover:bg-red-500/20 hover:text-red-500")}
					>
						<Trash2 className="h-4 w-4" />
					</button>
				)}
				<button type="button" onClick={handleSave} className={sheetButtonClass()}>
					{t("settings_automation.save_rule")}
				</button>
			</div>
			</>
			)}

			{/* Pickers stacked on top; portaled so the panel's transform doesn't move them. */}
			{picker === "condition" && createPortal(
				<SelectSheet<ConditionKind>
					title={t("settings_automation.add_condition")}
					value={null}
					options={availableConditionKinds.map((kind) => ({ value: kind, label: conditionLabel(kind) }))}
					onSelect={addCondition}
					onClose={() => setPicker(null)}
					isDesktop={isDesktop}
				/>,
				document.body,
			)}
			{picker === "action" && createPortal(
				<SelectSheet<ActionKind>
					title={t("settings_automation.add_action")}
					value={null}
					options={ACTION_KINDS.map((kind) => ({
						value: kind,
						label: actionLabel(kind),
						icon: actionIcon(kind),
						iconClassName: "bg-orange-500/15 text-orange-400",
					}))}
					onSelect={addAction}
					onClose={() => setPicker(null)}
					isDesktop={isDesktop}
				/>,
				document.body,
			)}
			{picker !== null && typeof picker === "object" && draft?.actions[picker.albumOf]?.type === "share_album" && createPortal(
				<SelectSheet<string>
					title={actionLabel("share_album")}
					value={String((draft.actions[picker.albumOf] as Extract<AutomationRuleAction, { type: "share_album" }>).albumId)}
					options={albums.map((album) => ({ value: String(album.albumId), label: album.albumName || String(album.albumId) }))}
					onSelect={(albumId) => updateAction(picker.albumOf, { albumId: Number(albumId) })}
					onClose={() => setPicker(null)}
					isDesktop={isDesktop}
				/>,
				document.body,
			)}
		</ControlledBottomSheet>
	);
}
