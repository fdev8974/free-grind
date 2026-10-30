import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Download, LockKeyhole, Upload, Workflow } from "lucide-react";
import { TagFilled } from "../../components/icons/FilledIcons";
import toast from "react-hot-toast";
import { PageHeader } from "../../components/PageHeader";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../contexts/useAuth";
import { getAutomationSettings, setAutomationSettings } from "../../utils/autoblock";
import {
	createEmptyAutomationRule,
	getAutomationRules,
	setAutomationRules,
	type AutomationRule,
	type AutomationRuleCondition,
} from "../../utils/automationRules";
import { AutomationRuleEditor } from "../../components/settings/AutomationRuleEditor";
import { useApiFunctions } from "../../hooks/useApiFunctions";
import { useSettingsHighlight } from "../../hooks/useSettingsHighlight";
import type { Album } from "../../types/albums";
import { BottomSheet, SheetClose, SheetCloseButton, SHEET_FOOTER_CLASS, sheetButtonClass } from "../../components/ui/bottom-sheet";
import { EmptyStateCreateButton, NATIVE_SHEET_BG, SectionAddButton } from "../../components/ui/action-sheet";
import { DrawerEmptyState } from "./chat/drawerUi";
import { SHEET_FIELD_CLASS, SheetSection } from "../../components/ui/sheet-section";
import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";
import { cn } from "../../utils/cn";

/** Same splitting as the rule matching (commas or new lines). */
function parseKeywords(text: string): string[] {
	return text.split(/[,\n]/).map((word) => word.trim()).filter((word) => word.length > 0);
}

/** Editing the shared keyword list, with import/export as .txt. */
function ForbiddenKeywordsSheet({
	initialValue,
	onSave,
	onClose,
}: {
	initialValue: string;
	onSave: (value: string) => void;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const isDesktop = useDesktopBreakpoint();
	const [draft, setDraft] = useState(initialValue);
	const count = parseKeywords(draft).length;

	const handleExport = () => {
		const blob = new Blob([draft], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "free-grind-keywords.txt";
		a.click();
		URL.revokeObjectURL(url);
		toast.success(t("settings_automation.keywords_exported"));
	};

	const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = (event) => {
			setDraft(event.target?.result as string);
			toast.success(t("settings_automation.keywords_imported"));
		};
		reader.readAsText(file);
	};

	return (
		<BottomSheet
			onClose={onClose}
			expandable
			isDesktop={isDesktop}
			bg={NATIVE_SHEET_BG}
			panelClassName={isDesktop ? "max-h-[82dvh] px-4" : "px-4"}
		>
			<div className="mb-3 flex shrink-0 items-center justify-between gap-3">
				<h3 className="text-sm font-semibold text-[var(--text)]">{t("settings_automation.forbidden_keywords_title")}</h3>
				<SheetCloseButton />
			</div>
			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
				<SheetSection
					title={t("settings_automation.forbidden_list_row_title", { defaultValue: "Keyword list" })}
					value={t("settings_automation.forbidden_list_count", { count, defaultValue: "{{count}} keywords" })}
				>
					<textarea
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						placeholder={t("settings_automation.forbidden_editor_placeholder", { defaultValue: "snapchat, crypto, bot" })}
						rows={8}
						className={cn(SHEET_FIELD_CLASS, "resize-none px-4 py-3")}
					/>
					<p className="mt-2 px-1 text-xs leading-relaxed text-[var(--text-muted)]">
						{t("settings_automation.forbidden_editor_hint", {
							defaultValue: "Separate keywords with commas or new lines. They match whole words, upper or lower case doesn't matter.",
						})}
					</p>
				</SheetSection>
				<div className="mt-4 grid grid-cols-2 gap-2">
					<label className={cn(sheetButtonClass("secondary"), "h-10 cursor-pointer text-sm")}>
						<Upload className="h-4 w-4" />
						{t("settings_automation.import_txt")}
						<input type="file" accept=".txt" onChange={handleImport} className="hidden" />
					</label>
					<button type="button" onClick={handleExport} className={cn(sheetButtonClass("secondary"), "h-10 text-sm")}>
						<Download className="h-4 w-4" />
						{t("settings_automation.export_txt")}
					</button>
				</div>
			</div>
			<div className={SHEET_FOOTER_CLASS}>
				<SheetClose onClick={() => onSave(draft)} className={sheetButtonClass()}>
					{t("settings_automation.update_block_rules")}
				</SheetClose>
			</div>
		</BottomSheet>
	);
}

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

// Only the three top-level structural words (when / and / then) are
// highlighted bright; everything else — including the or/and used to join
// multiple triggers, conditions, or actions — stays subtle/muted.
function keyword(text: string, key: string): React.ReactNode {
	return (
		<span key={key} className="font-semibold text-[var(--text)]">
			{text}
		</span>
	);
}

// Pushes `items` into `nodes`, comma-separated with a plain-text `conjunction`
// before the last one (e.g. "a, b or c"). Only the three structural words
// (when / and / then) get the bright highlight treatment, not these.
function pushJoined(nodes: React.ReactNode[], items: string[], conjunction: string) {
	items.forEach((item, i) => {
		if (i > 0) {
			nodes.push(", ");
			if (i === items.length - 1) {
				nodes.push(`${conjunction} `);
			}
		}
		nodes.push(item);
	});
}

function describeCondition(c: AutomationRuleCondition, t: TFunc): string {
	switch (c.type) {
		case "profile_picture":
			return t(c.has ? "settings_automation.phrase_has_profile_picture" : "settings_automation.phrase_no_profile_picture");
		case "age_above":
			return t("settings_automation.phrase_age_above", { value: c.value });
		case "age_below":
			return t("settings_automation.phrase_age_below", { value: c.value });
		case "bio_contains_keyword":
			return renderKeywordCondition(t, "bio", c);
		case "message_contains_keyword":
			return renderKeywordCondition(t, "message", c);
		case "display_name_contains_keyword":
			return renderKeywordCondition(t, "display_name", c);
		case "has_x_handle":
			return t(c.has ? "settings_automation.phrase_has_x_handle" : "settings_automation.phrase_no_x_handle");
		case "has_instagram_handle":
			return t(c.has ? "settings_automation.phrase_has_instagram_handle" : "settings_automation.phrase_no_instagram_handle");
		case "has_facebook_handle":
			return t(c.has ? "settings_automation.phrase_has_facebook_handle" : "settings_automation.phrase_no_facebook_handle");
		case "x_handle_contains_keyword":
			return renderKeywordCondition(t, "x_handle", c);
		case "instagram_handle_contains_keyword":
			return renderKeywordCondition(t, "instagram_handle", c);
		case "facebook_handle_contains_keyword":
			return renderKeywordCondition(t, "facebook_handle", c);
	}
}

function renderKeywordCondition(
	t: TFunc,
	kind: "bio" | "message" | "display_name" | "x_handle" | "instagram_handle" | "facebook_handle",
	c: { useForbiddenList?: boolean; keywords: string; negate?: boolean },
): string {
	const variant = c.negate ? "prefix_not" : "prefix";
	const suffixVariant = c.negate ? "suffix_not" : "suffix";
	const prefix = t(`settings_automation.phrase_${kind}_${variant}`);
	const suffix = t(`settings_automation.phrase_${kind}_${suffixVariant}`).trim();
	const value = c.useForbiddenList ? t("settings_automation.keyword_source_forbidden") : `"${c.keywords}"`;
	return suffix ? `${prefix} ${value} ${suffix}` : `${prefix} ${value}`;
}

// Local copy of interestUtils.tapLabel's switch, kept in the simplified TFunc
// shape this file's describe* helpers use instead of the full i18next TFunction.
function tapTypeLabel(tapType: number, t: TFunc): string {
	switch (tapType) {
		case 0:
			return t("interest_page.tap_labels.friendly");
		case 1:
			return t("interest_page.tap_labels.hot");
		case 2:
			return t("interest_page.tap_labels.looking");
		default:
			return t("interest_page.tap_labels.default");
	}
}

function describeRule(rule: AutomationRule, t: TFunc): React.ReactNode[] {
	const triggerPhrases = rule.triggers.map((trig) => t(`settings_automation.trigger_phrase_${trig}`));
	const actionPhrases = rule.actions.map((a) =>
		a.type === "send_tap"
			? t("settings_automation.action_phrase_send_tap", { tapType: tapTypeLabel(a.tapType, t) })
			: t(`settings_automation.action_phrase_${a.type}`),
	);

	const or = t("settings_automation.rule_or_label");
	const and = t("settings_automation.rule_and_label");

	const nodes: React.ReactNode[] = [keyword(t("settings_automation.phrase_when"), "when"), " "];
	pushJoined(nodes, triggerPhrases, or);

	if (rule.conditions.length > 0) {
		const conditionPhrases = rule.conditions.map((c) => describeCondition(c, t));
		const conditionConjunction = rule.matchMode === "any" ? or : and;
		nodes.push(" ", keyword(and, "cond-lead"), " ");
		pushJoined(nodes, conditionPhrases, conditionConjunction);
	}

	nodes.push(" ", keyword(t("settings_automation.phrase_then"), "then"), " ");
	pushJoined(nodes, actionPhrases, and);
	return nodes;
}

export function SettingsAutomationPage() {
	const { t } = useTranslation();
	const highlightId = useSettingsHighlight();
	const apiFunctions = useApiFunctions();
	const { settingsReady } = useAuth();

	const [rules, setRules] = useState<AutomationRule[]>(() => getAutomationRules());
	const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
	const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);
	const [albums, setAlbums] = useState<Album[]>([]);

	useEffect(() => {
		apiFunctions.listAlbums().then(setAlbums).catch(() => {});
	}, [apiFunctions]);

	// The automation caches (rules + legacy auto-block settings) load
	// asynchronously right after login (see AuthContext) and only afterwards
	// does settingsReady flip true. Landing on this page before that finishes
	// would otherwise permanently freeze this page's state on an empty/stale
	// snapshot taken at mount — re-sync once the cache is guaranteed loaded.
	useEffect(() => {
		if (!settingsReady) return;
		setRules(getAutomationRules());
		setForbiddenWords(getAutomationSettings().forbiddenWords);
	}, [settingsReady]);

	const persistRules = (next: AutomationRule[]) => {
		setRules(next);
		void setAutomationRules(next);
	};

	const handleToggleRule = (id: string, enabled: boolean) => {
		persistRules(rules.map((r) => (r.id === id ? { ...r, enabled } : r)));
	};

	const handleSaveRule = (rule: AutomationRule) => {
		const exists = rules.some((r) => r.id === rule.id);
		persistRules(exists ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule]);
		setEditingRule(null);
		toast.success(t("settings_automation.rule_saved"));
	};

	const handleDeleteRule = () => {
		if (!deletingRuleId) return;
		if (rules.find((r) => r.id === deletingRuleId)?.locked) {
			setDeletingRuleId(null);
			return;
		}
		persistRules(rules.filter((r) => r.id !== deletingRuleId));
		setDeletingRuleId(null);
		setEditingRule(null);
		toast.success(t("settings_automation.rule_deleted"));
	};

	const [forbiddenWords, setForbiddenWords] = useState(() => getAutomationSettings().forbiddenWords);
	const [isKeywordsSheetOpen, setIsKeywordsSheetOpen] = useState(false);
	const keywordList = useMemo(() => parseKeywords(forbiddenWords), [forbiddenWords]);
	// The list does nothing on its own, so show which rules actually use it.
	const rulesUsingList = rules.filter((rule) =>
		rule.conditions.some((condition) => "useForbiddenList" in condition && condition.useForbiddenList),
	);

	const handleSaveKeywords = (value: string) => {
		setForbiddenWords(value);
		void setAutomationSettings({ forbiddenWords: value });
		toast.success(t("settings_automation.block_rules_updated"));
	};

	return (
		<section className="app-screen">
			<PageHeader
				backTo="/settings"
				title={t("settings.automation")}
				subtitle={t("settings.automation_desc")}
			/>

			<div className="grid min-w-0 gap-6">
				{/* CUSTOM RULES */}
				<div
					id="automation-custom-rules"
					className={`min-w-0 ${highlightId === "automation-custom-rules" ? "animate-settings-highlight rounded-2xl" : ""}`}
				>
					<div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
						<div className="flex min-w-0 items-center gap-2">
							<p className="truncate text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
								{t("settings_automation.custom_rules_title")}
							</p>
							<span className="shrink-0 rounded-md bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--accent-contrast)]">
								{t("settings_automation.experimental_badge")}
							</span>
						</div>
						{/* The empty state has its own create button. */}
						{settingsReady && rules.length > 0 && (
							<SectionAddButton
								label={t("settings_automation.add_rule")}
								onClick={() => setEditingRule(createEmptyAutomationRule())}
							/>
						)}
					</div>

					{!settingsReady ? (
						<div className="native-card flex items-center justify-center p-6">
							<p className="text-sm text-[var(--text-muted)]">{t("settings_automation.loading_rules")}</p>
						</div>
					) : rules.length === 0 ? (
						<div className="native-card overflow-hidden px-4">
							<DrawerEmptyState
								icon={<Workflow />}
								fanned={false}
								title={t("settings_automation.no_rules_yet")}
								hint={t("settings_automation.no_rules_hint", { defaultValue: "Rules run on their own when someone messages or taps you, e.g. block or answer them." })}
							>
								<EmptyStateCreateButton
									label={t("settings_automation.add_rule")}
									onClick={() => setEditingRule(createEmptyAutomationRule())}
								/>
							</DrawerEmptyState>
						</div>
					) : (
						<div className="native-group">
							{rules.map((rule) => (
								<div
									key={rule.id}
									role="button"
									tabIndex={0}
									onClick={() => setEditingRule(rule)}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") setEditingRule(rule);
									}}
									className="grid min-w-0 cursor-pointer gap-1.5 p-4 outline-none transition hover-fill"
								>
									<div className="flex min-w-0 items-center gap-3">
										<div className="relative shrink-0 rounded-2xl bg-indigo-500/15 p-2.5 text-indigo-400">
											<Workflow className="h-5 w-5" />
											{rule.locked && (
												<span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-[var(--surface)] bg-[var(--accent)] text-[var(--accent-contrast)]">
													<LockKeyhole className="h-2.5 w-2.5" />
												</span>
											)}
										</div>
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-semibold leading-snug">
												{rule.nameKey ? t(rule.nameKey) : rule.name}
											</p>
											<p className="truncate text-xs text-[var(--text-muted)]">
												{t(rule.locked ? "settings_automation.rule_type_builtin" : "settings_automation.rule_type_custom")}
											</p>
										</div>
										<label
											onClick={(e) => e.stopPropagation()}
											className="relative ml-1 inline-flex h-7 w-12 shrink-0 cursor-pointer items-center"
										>
											<input
												type="checkbox"
												checked={rule.enabled}
												onChange={(e) => handleToggleRule(rule.id, e.target.checked)}
												className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0"
											/>
											<span className="absolute inset-0 rounded-full border border-[var(--border)] bg-[var(--surface-2)] transition-colors peer-checked:border-transparent peer-checked:bg-[var(--accent)]" />
											<span className="absolute left-1 h-5 w-5 rounded-full bg-[var(--text)] transition-transform peer-checked:translate-x-5 peer-checked:bg-[var(--accent-contrast)]" />
										</label>
									</div>
									<p className="break-words pl-[52px] text-xs leading-relaxed text-[var(--text-muted)]">
										{describeRule(rule, t)}
									</p>
								</div>
							))}
						</div>
					)}
				</div>

				{/* FORBIDDEN KEYWORDS */}
				<div
					id="automation-forbidden-keywords"
					className={`min-w-0 ${highlightId === "automation-forbidden-keywords" ? "animate-settings-highlight rounded-2xl" : ""}`}
				>
					<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
						{t("settings_automation.forbidden_keywords_title")}
					</p>
					<div className="native-group">
						<button
							type="button"
							onClick={() => setIsKeywordsSheetOpen(true)}
							className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover-fill"
						>
							<div className="shrink-0 rounded-2xl bg-orange-500/15 p-2.5 text-orange-400">
								<TagFilled className="h-5 w-5" />
							</div>
							<div className="min-w-0 flex-1">
								<p className="text-sm font-semibold leading-snug">
									{t("settings_automation.forbidden_list_row_title", { defaultValue: "Keyword list" })}
								</p>
								<p className="mt-0.5 truncate text-xs leading-snug text-[var(--text-muted)]">
									{keywordList.length > 0
										? `${t("settings_automation.forbidden_list_count", { count: keywordList.length, defaultValue: "{{count}} keywords" })} · ${keywordList.slice(0, 4).join(", ")}${keywordList.length > 4 ? "…" : ""}`
										: t("settings_automation.forbidden_list_empty", { defaultValue: "No keywords yet" })}
								</p>
							</div>
							<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
						</button>

						{/* Where the list actually takes effect. */}
						<div className="px-4 py-3">
							<p className="text-xs font-semibold text-[var(--text-muted)]">
								{t("settings_automation.forbidden_used_by", { defaultValue: "Used by" })}
							</p>
							{rulesUsingList.length > 0 ? (
								<div className="mt-1">
									{rulesUsingList.map((rule) => (
										<button
											key={rule.id}
											type="button"
											onClick={() => setEditingRule(rule)}
											className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-xl px-2 py-2 text-left transition hover-fill"
										>
											<Workflow className="h-4 w-4 shrink-0 text-indigo-400" />
											<span className="min-w-0 flex-1 truncate text-sm">{rule.nameKey ? t(rule.nameKey) : rule.name}</span>
											<span
												className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
													rule.enabled ? "bg-emerald-500/15 text-emerald-500" : "ink-tint-10 text-[var(--text-muted)]"
												}`}
											>
												{rule.enabled
													? t("settings_automation.rule_on", { defaultValue: "On" })
													: t("settings_automation.rule_off", { defaultValue: "Off" })}
											</span>
										</button>
									))}
								</div>
							) : (
								<p className="mt-1 text-sm text-[var(--text-muted)]">
									{t("settings_automation.forbidden_not_used", { defaultValue: "No rule uses this list yet." })}
								</p>
							)}
						</div>
					</div>
					<p className="mt-2 px-4 text-xs leading-relaxed text-[var(--text-muted)]">
						{t("settings_automation.forbidden_usage_footnote", {
							defaultValue: "The list does nothing on its own. A rule uses it when one of its keyword conditions (name, bio, message or social handle) is set to “Forbidden Keywords” instead of its own words. The built-in “Forbidden keywords block” rule blocks anyone whose name, bio or message contains a keyword; turn it on above.",
						})}
					</p>
				</div>
			</div>

			{isKeywordsSheetOpen && (
				<ForbiddenKeywordsSheet
					initialValue={forbiddenWords}
					onSave={handleSaveKeywords}
					onClose={() => setIsKeywordsSheetOpen(false)}
				/>
			)}

			<AutomationRuleEditor
				isOpen={editingRule !== null}
				rule={editingRule}
				isNew={editingRule !== null && !rules.some((r) => r.id === editingRule.id)}
				albums={albums}
				onSave={handleSaveRule}
				onCancel={() => setEditingRule(null)}
				onDelete={
					editingRule && !editingRule.locked && rules.some((r) => r.id === editingRule.id)
						? () => setDeletingRuleId(editingRule.id)
						: undefined
				}
			/>

			<ConfirmDialog
				isOpen={deletingRuleId !== null}
				title={t("settings_automation.delete_rule")}
				message={t("settings_automation.delete_rule_confirm")}
				confirmLabel={t("settings_automation.delete_rule")}
				cancelLabel={t("settings_automation.cancel")}
				confirmTone="danger"
				onConfirm={handleDeleteRule}
				onCancel={() => setDeletingRuleId(null)}
			/>
		</section>
	);
}
