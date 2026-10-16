import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Clock, Flame, Images, Languages, LayoutGrid, Monitor, Moon, PanelBottom, Ruler, Sparkles, Sun, Type, Vibrate, X } from "lucide-react";
import toast from "react-hot-toast";
import { usePreferences, ACCENT_PRESETS, type ColorScheme } from "../../contexts/PreferencesContext";
import { PageHeader } from "../../components/PageHeader";
import { RightNowIcon } from "../../components/icons/RightNowIcon";
import { HAPTICS_ENABLED_KEY, isHapticsEnabled } from "../../utils/haptics";
import { getTimeFormat, TIME_FORMAT_KEY, type TimeFormat } from "../../utils/timeFormat";
import { NAV_FLOATING_KEY, NAV_SHOW_LABELS_KEY, NAV_STYLE_EVENT } from "../../components/NavBar";
import { isAndroid, isIos } from "../../services/saveMedia";
import { ToggleRow } from "../../components/ui/toggle-row";
import { BottomSheet, SheetClose } from "../../components/ui/bottom-sheet";
import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";
import { useTranslation } from "react-i18next";
import { useSettingsHighlight } from "../../hooks/useSettingsHighlight";
import {
	SUPPORTED_LOCALE_OPTIONS,
	resolveSupportedLocale,
} from "../../utils/locales";
import { type UnitsPreset } from "../../utils/units";

function normalizeHex(value: string): string {
	const cleaned = value.trim().replace(/^#/, "");
	if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
		return `#${cleaned
			.split("")
			.map((char) => char + char)
			.join("")
			.toLowerCase()}`;
	}
	if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
		return `#${cleaned.toLowerCase()}`;
	}
	return "";
}

function getContrastForHex(hexColor: string): "#1a1a1a" | "#ffffff" {
	const normalized = normalizeHex(hexColor);
	if (!normalized) {
		return "#1a1a1a";
	}

	const r = parseInt(normalized.slice(1, 3), 16);
	const g = parseInt(normalized.slice(3, 5), 16);
	const b = parseInt(normalized.slice(5, 7), 16);

	const toLinear = (channel: number) => {
		const normalizedChannel = channel / 255;
		if (normalizedChannel <= 0.03928) {
			return normalizedChannel / 12.92;
		}
		return ((normalizedChannel + 0.055) / 1.055) ** 2.4;
	};

	const luminance =
		0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
	const contrastWithDark = (luminance + 0.05) / 0.05;
	const contrastWithLight = 1.05 / (luminance + 0.05);

	return contrastWithDark >= contrastWithLight ? "#1a1a1a" : "#ffffff";
}


/** Settings row that picks one of several options from a bottom sheet — same
 * pattern as the translation provider picker, instead of a native <select>. */
function SelectRow({
	icon,
	iconClass,
	label,
	value,
	onChange,
	options,
	id,
	highlighted,
}: {
	icon: React.ReactNode;
	iconClass: string;
	label: string;
	value: string;
	onChange: (v: string) => void;
	options: { value: string; label: string }[];
	id?: string;
	highlighted?: boolean;
}) {
	const isDesktop = useDesktopBreakpoint();
	const [isOpen, setIsOpen] = useState(false);
	const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

	return (
		<>
			<button
				id={id}
				type="button"
				onClick={() => setIsOpen(true)}
				className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-[var(--surface-2)] ${highlighted ? "animate-settings-highlight" : ""}`}
			>
				<div className={`rounded-2xl p-2.5 shrink-0 ${iconClass}`}>{icon}</div>
				<p className="min-w-0 flex-1 text-sm font-semibold">{label}</p>
				<span className="max-w-[45%] shrink-0 truncate text-sm font-medium text-[var(--text-muted)]">{selectedLabel}</span>
				<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
			</button>
			{/* Portaled out of the card: as a child of its divide-y list the fullscreen
			    overlay would pick up the divider border (a stray line while it fades in). */}
			{isOpen && createPortal(
				<BottomSheet onClose={() => setIsOpen(false)} isDesktop={isDesktop} panelClassName="max-h-[82dvh]">
					<div className="flex items-center justify-between px-4 pb-3">
						<p className="text-sm font-semibold text-[var(--text)]">{label}</p>
						<SheetClose className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
							<X className="h-4 w-4" />
						</SheetClose>
					</div>
					<div className="min-h-0 flex-1 divide-y divide-[var(--border)] overflow-y-auto pb-4" data-lenis-prevent>
						{options.map((option) => (
							<SheetClose
								key={option.value}
								onClick={() => {
									if (option.value !== value) onChange(option.value);
								}}
								className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-[var(--surface-2)]"
							>
								<p className="min-w-0 flex-1 text-sm font-semibold leading-snug">{option.label}</p>
								{option.value === value && <Check className="h-5 w-5 shrink-0 text-[var(--accent)]" />}
							</SheetClose>
						))}
					</div>
				</BottomSheet>,
				document.body,
			)}
		</>
	);
}

function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
			{children}
		</p>
	);
}

export function CustomizabilityPage() {
	const { i18n, t } = useTranslation();
	const highlightId = useSettingsHighlight();
	const {
		colorScheme,
		amoledMode,
		accentColor,
		mobileGridColumns,
		mobileViewsGridColumns,
		unitsPreset,
		revealEffectEnabled,
		revealEffectStrength,
		showGridTapStatus,
		splitDrawerCategories,
		setPreferences,
	} = usePreferences();
	const [customHex, setCustomHex] = useState(accentColor);
	const [hexError, setHexError] = useState<string | null>(null);
	const [showRightNow, setShowRightNow] = useState(() => window.localStorage.getItem("fg-show-right-now") !== "false");
	const [isMobilePlatform] = useState(() => isAndroid() || isIos());
	const [showNavLabels, setShowNavLabels] = useState(() => window.localStorage.getItem(NAV_SHOW_LABELS_KEY) === "true");
	const [hapticsEnabled, setHapticsEnabled] = useState(isHapticsEnabled);
	const [timeFormat, setTimeFormat] = useState<TimeFormat>(getTimeFormat);
	const [floatingNav, setFloatingNav] = useState(() => window.localStorage.getItem(NAV_FLOATING_KEY) === "true");
	const [showInterest, setShowInterest] = useState(() => window.localStorage.getItem("fg-show-interest") !== "false");
	const [defaultInterestTab, setDefaultInterestTab] = useState(() => window.localStorage.getItem("fg-interest-default-tab") || "taps");
	const schemeOptions: {
		value: ColorScheme;
		label: string;
		icon: React.ReactNode;
	}[] = useMemo(
		() => [
			{
				value: "system",
				label: t("customizability.schemes.system"),
				icon: <Monitor className="h-5 w-5" />,
			},
			{
				value: "light",
				label: t("customizability.schemes.light"),
				icon: <Sun className="h-5 w-5" />,
			},
			{
				value: "dark",
				label: t("customizability.schemes.dark"),
				icon: <Moon className="h-5 w-5" />,
			},
		],
		[t],
	);
	const selectedLocale = resolveSupportedLocale(i18n.language);

	useEffect(() => {
		setCustomHex(accentColor);
	}, [accentColor]);

	const handleSchemeChange = (scheme: ColorScheme) => {
		void setPreferences({ colorScheme: scheme });
	};

	const handleAccentChange = (preset: (typeof ACCENT_PRESETS)[number]) => {
		void setPreferences({ accentColor: preset.color, accentContrast: preset.contrast });
	};

	const handleApplyCustomHex = () => {
		const normalized = normalizeHex(customHex);
		if (!normalized) {
			setHexError(t("customizability.hex_error"));
			return;
		}

		setHexError(null);
		void setPreferences({
			accentColor: normalized,
			accentContrast: getContrastForHex(normalized),
		});
	};

	const handlePickColor = (value: string) => {
		const normalized = normalizeHex(value);
		if (!normalized) {
			return;
		}

		setCustomHex(normalized);
		setHexError(null);
		void setPreferences({
			accentColor: normalized,
			accentContrast: getContrastForHex(normalized),
		});
	};

	const handleLocaleChange = async (locale: string) => {
		try {
			const nextLocale = resolveSupportedLocale(locale);
			await i18n.changeLanguage(nextLocale);
			document.documentElement.lang = nextLocale;
		} catch (error) {
			const message =
				error instanceof Error && error.message
					? error.message
					: "Failed to change language.";
			toast.error(message);
		}
	};

	const handleUnitsPresetChange = (preset: UnitsPreset) => {
		void setPreferences({ unitsPreset: preset });
	};

	return (
		<section className="app-screen">
			<PageHeader
				backTo="/settings"
				title={t("settings.customizability")}
				subtitle={t("customizability.subtitle")}
			/>

			<div className="grid gap-6">

				{/* APPEARANCE */}
				<div>
					<SectionLabel>{t("customizability.appearance")}</SectionLabel>
					<div className="grid gap-3">

						{/* Color Scheme */}
						<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
						<div
							id="cust-color-scheme"
							className={`p-4 ${highlightId === "cust-color-scheme" ? "animate-settings-highlight" : ""}`}
						>
							<p className="mb-3 text-sm font-semibold">{t("customizability.color_scheme")}</p>
							<div className="grid grid-cols-3 gap-2">
								{schemeOptions.map(({ value, label, icon }) => {
									const isActive = colorScheme === value;
									return (
										<button
											key={value}
											type="button"
											onClick={() => handleSchemeChange(value)}
											className="flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all"
											style={{
												borderColor: isActive ? "var(--accent)" : "var(--border)",
												background: isActive
													? "color-mix(in srgb, var(--accent) 12%, var(--surface))"
													: "var(--surface-2)",
												color: isActive ? "var(--accent-readable)" : "var(--text)",
											}}
										>
											{icon}
											<span className="text-xs font-medium">{label}</span>
										</button>
									);
								})}
							</div>
						</div>
						{/* Only meaningful when dark can be active ("system" may resolve to dark). */}
						{colorScheme !== "light" && (
							<ToggleRow
								id="cust-amoled"
								highlighted={highlightId === "cust-amoled"}
								icon={<Moon className="h-5 w-5" />}
								iconClass="bg-violet-500/15 text-violet-400"
								label={t("customizability.amoled.title")}
								description={t("customizability.amoled.desc")}
								checked={amoledMode}
								onChange={(checked) => void setPreferences({ amoledMode: checked })}
							/>
						)}
						</div>

						{/* Accent Color + Preview combined */}
						<div className="surface-card overflow-hidden">
						<div
							id="cust-accent-color"
							className={`p-4 ${highlightId === "cust-accent-color" ? "animate-settings-highlight" : ""}`}
						>
							<p className="mb-3 text-sm font-semibold">{t("customizability.accent_color")}</p>

							{/* Preset swatches + custom swatch in one row */}
							<div className="flex flex-wrap gap-3 p-1">
								{ACCENT_PRESETS.map((preset) => {
									const isActive = accentColor === preset.color;
									return (
										<button
											key={preset.color}
											type="button"
											onClick={() => handleAccentChange(preset)}
											title={preset.name}
											className="relative h-8 w-8 rounded-full transition-transform hover:scale-110 sm:h-10 sm:w-10"
											style={{
												background: preset.color,
												outline: isActive ? `2.5px solid ${preset.color}` : "none",
												outlineOffset: "3px",
											}}
										>
											{isActive && (
												<span
													className="absolute inset-0 flex items-center justify-center rounded-full text-xs font-bold sm:text-sm"
													style={{ color: preset.contrast }}
												>
													✓
												</span>
											)}
										</button>
									);
								})}

								{/* Custom color — same swatch style, opens native picker */}
								{(() => {
									const isCustom = !ACCENT_PRESETS.some((p) => p.color === accentColor);
									return (
										<label
											htmlFor="accent-color-picker"
											className="relative h-8 w-8 shrink-0 cursor-pointer rounded-full transition-transform hover:scale-110 sm:h-10 sm:w-10"
											style={{
												background: isCustom ? accentColor : "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
												outline: isCustom ? `2.5px solid ${accentColor}` : "none",
												outlineOffset: "3px",
											}}
											title={t("customizability.picker")}
										>
											<input
												id="accent-color-picker"
												type="color"
												value={normalizeHex(customHex) || "#7c3aed"}
												onChange={(event) => handlePickColor(event.target.value)}
												className="sr-only"
											/>
											{isCustom && (
												<span
													className="absolute inset-0 flex items-center justify-center rounded-full text-xs font-bold sm:text-sm"
													style={{ color: getContrastForHex(accentColor) }}
												>
													✓
												</span>
											)}
										</label>
									);
								})()}
							</div>

							{/* Hex input — applies on blur or Enter, no button needed */}
							<div className="mt-4">
								<div
									className={`flex h-10 items-center overflow-hidden rounded-lg border bg-[var(--surface-2)] px-3 transition-colors focus-within:border-[var(--accent)] ${
										hexError ? "border-red-400" : "border-[var(--border)]"
									}`}
								>
									<span
										className="mr-2.5 h-4 w-4 shrink-0 rounded-full border border-white/20"
										style={{ background: normalizeHex(customHex) || accentColor }}
									/>
									<input
										type="text"
										value={customHex}
										onChange={(e) => {
											setCustomHex(e.target.value);
											if (hexError) setHexError(null);
										}}
										onBlur={handleApplyCustomHex}
										onKeyDown={(e) => { if (e.key === "Enter") handleApplyCustomHex(); }}
										placeholder="#22c55e"
										className="h-full flex-1 bg-transparent font-mono text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
									/>
									<span className="ml-2 text-xs text-[var(--text-muted)]">
										{ACCENT_PRESETS.find((p) => p.color === accentColor)?.name ?? t("customizability.custom")}
									</span>
								</div>
								{hexError && <p className="mt-1.5 text-xs text-red-400">{hexError}</p>}
							</div>
						</div>
						{/* Preview — inline below hex input */}
						<div className="border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-4 flex flex-col gap-3">
							<div className="flex flex-wrap gap-2">
								<button
									type="button"
									className="inline-flex h-9 items-center rounded-lg px-4 text-sm font-semibold"
									style={{ background: "var(--accent)", color: "var(--accent-contrast)" }}
								>
									{t("customizability.preview_primary")}
								</button>
								<button
									type="button"
									className="inline-flex h-9 items-center rounded-lg border px-4 text-sm font-semibold"
									style={{ borderColor: "var(--accent)", color: "var(--accent-readable)" }}
								>
									{t("customizability.preview_outlined")}
								</button>
								<button
									type="button"
									className="inline-flex h-9 items-center rounded-lg px-4 text-sm font-semibold"
									style={{
										background: "color-mix(in srgb, var(--accent) 15%, transparent)",
										color: "var(--accent-readable)",
									}}
								>
									{t("customizability.preview_subtle")}
								</button>
							</div>
							<div className="flex items-center gap-2">
								<div
									className="flex h-9 flex-1 items-center rounded-lg border px-3 text-sm text-[var(--text-muted)]"
									style={{ borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent) 6%, var(--surface))" }}
								>
									<span className="mr-2 h-2 w-2 rounded-full" style={{ background: "var(--accent)" }} />
									{t("customizability.preview_input")}
								</div>
								<span
									className="inline-flex h-6 items-center rounded-full px-2.5 text-xs font-bold"
									style={{ background: "var(--accent)", color: "var(--accent-contrast)" }}
								>
									{t("customizability.preview_badge")}
								</span>
							</div>
						</div>
						</div>

					</div>
				</div>

				{/* GRID PAGE (column count only affects the mobile app) */}
				<div>
					<SectionLabel>{t("customizability.grid_page")}</SectionLabel>
					<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
						{isMobilePlatform && (
							<div
								id="cust-browse-grid"
								className={`p-4 ${highlightId === "cust-browse-grid" ? "animate-settings-highlight" : ""}`}
							>
								<div className="flex items-start gap-3">
									<div className="rounded-2xl bg-blue-500/15 p-2.5 text-blue-400 shrink-0">
										<LayoutGrid className="h-5 w-5" />
									</div>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-semibold leading-snug">{t("customizability.grid_layout")}</p>
										<p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">
											{t("customizability.browse_grid_mobile_desc")}
										</p>
										<div className="mt-3 grid grid-cols-3 gap-2">
											{(["2", "3", "4"] as const).map((cols) => (
												<button
													key={cols}
													type="button"
													onClick={() => void setPreferences({ mobileGridColumns: cols })}
													className="rounded-xl border-2 p-3 text-sm font-semibold transition-all"
													style={{
														borderColor: mobileGridColumns === cols ? "var(--accent)" : "var(--border)",
														background: mobileGridColumns === cols
															? "color-mix(in srgb, var(--accent) 12%, var(--surface))"
															: "var(--surface-2)",
														color: mobileGridColumns === cols ? "var(--accent-readable)" : "var(--text)",
													}}
												>
													{t(`customizability.columns_${cols}`)}
												</button>
											))}
										</div>
									</div>
								</div>
							</div>
						)}
						<ToggleRow
							id="cust-grid-tap-status"
							highlighted={highlightId === "cust-grid-tap-status"}
							icon={<Flame className="h-5 w-5" />}
							iconClass="bg-orange-500/15 text-orange-400"
							label={t("customizability.show_grid_tap_status", { defaultValue: "Show Taps on the Grid" })}
							description={t("customizability.show_grid_tap_status_desc", {
								defaultValue: "Show a small flame on grid tiles of profiles you've tapped or who tapped you in the last 24 hours.",
							})}
							checked={showGridTapStatus}
							onChange={(checked) => void setPreferences({ showGridTapStatus: checked })}
						/>
					</div>
				</div>

				{/* NAVIGATION */}
				<div>
					<SectionLabel>{t("customizability.navigation_bar")}</SectionLabel>
					<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
						{/* Bar style options only exist in the mobile app. */}
						{isMobilePlatform && (
							<>
								<ToggleRow
									id="cust-nav-floating"
									highlighted={highlightId === "cust-nav-floating"}
									icon={<PanelBottom className="h-5 w-5" />}
									iconClass="bg-sky-500/15 text-sky-400"
									label={t("customizability.nav_floating")}
									description={t("customizability.nav_floating_desc")}
									checked={floatingNav}
									onChange={(checked) => {
										setFloatingNav(checked);
										window.localStorage.setItem(NAV_FLOATING_KEY, String(checked));
										window.dispatchEvent(new Event(NAV_STYLE_EVENT));
									}}
								/>
								<ToggleRow
									id="cust-nav-show-labels"
									highlighted={highlightId === "cust-nav-show-labels"}
									icon={<Type className="h-5 w-5" />}
									iconClass="bg-sky-500/15 text-sky-400"
									label={t("customizability.nav_show_labels")}
									description={t("customizability.nav_show_labels_desc")}
									checked={showNavLabels}
									onChange={(checked) => {
										setShowNavLabels(checked);
										window.localStorage.setItem(NAV_SHOW_LABELS_KEY, String(checked));
										window.dispatchEvent(new Event(NAV_STYLE_EVENT));
									}}
								/>
							</>
						)}
						<ToggleRow
							id="cust-show-right-now"
							highlighted={highlightId === "cust-show-right-now"}
							icon={<RightNowIcon className="h-5 w-5" />}
							iconClass="bg-[var(--right-now-soft)] text-[var(--right-now)]"
							label={t("customizability.show_right_now")}
							description={t("customizability.show_right_now_desc")}
							checked={showRightNow}
							onChange={(checked) => {
								setShowRightNow(checked);
								window.localStorage.setItem("fg-show-right-now", String(checked));
								window.location.reload();
							}}
						/>
						<ToggleRow
							id="cust-show-interest"
							highlighted={highlightId === "cust-show-interest"}
							icon={<Flame className="h-5 w-5" />}
							iconClass="bg-yellow-500/15 text-yellow-400"
							label={t("customizability.show_interest")}
							description={t("customizability.show_interest_desc")}
							checked={showInterest}
							onChange={(checked) => {
								setShowInterest(checked);
								window.localStorage.setItem("fg-show-interest", String(checked));
								window.location.reload();
							}}
						/>
					</div>
				</div>

				{/* INTEREST PAGE */}
				{showInterest && (
					<div>
						<SectionLabel>{t("customizability.interest_page")}</SectionLabel>
						<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
							<SelectRow
								icon={<Flame className="h-5 w-5 opacity-50" />}
								iconClass="bg-yellow-500/10 text-yellow-400"
								label={t("customizability.default_view")}
								value={defaultInterestTab}
								onChange={(val) => {
									setDefaultInterestTab(val);
									window.localStorage.setItem("fg-interest-default-tab", val);
									window.localStorage.setItem("fg-interest-last-tab", val);
								}}
								options={[
									{ value: "taps", label: t("customizability.interest_show_taps") },
									{ value: "views", label: t("customizability.interest_show_views") },
								]}
							/>
							{isMobilePlatform && (
								<div
									id="cust-views-grid"
									className={`p-4 ${highlightId === "cust-views-grid" ? "animate-settings-highlight" : ""}`}
								>
									<div className="flex items-start gap-3">
										<div className="rounded-2xl bg-blue-500/15 p-2.5 text-blue-400 shrink-0">
											<LayoutGrid className="h-5 w-5" />
										</div>
										<div className="min-w-0 flex-1">
											<p className="text-sm font-semibold leading-snug">{t("customizability.views_grid_layout")}</p>
											<p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">
												{t("customizability.views_grid_mobile_desc")}
											</p>
											<div className="mt-3 grid grid-cols-3 gap-2">
												{(["2", "3", "4"] as const).map((cols) => (
													<button
														key={cols}
														type="button"
														onClick={() => void setPreferences({ mobileViewsGridColumns: cols })}
														className="rounded-xl border-2 p-3 text-sm font-semibold transition-all"
														style={{
															borderColor: mobileViewsGridColumns === cols ? "var(--accent)" : "var(--border)",
															background: mobileViewsGridColumns === cols
																? "color-mix(in srgb, var(--accent) 12%, var(--surface))"
																: "var(--surface-2)",
															color: mobileViewsGridColumns === cols ? "var(--accent-readable)" : "var(--text)",
														}}
													>
														{t(`customizability.columns_${cols}`)}
													</button>
												))}
											</div>
										</div>
									</div>
								</div>
							)}
						</div>
					</div>
				)}

				{/* CHAT */}
				<div>
					<SectionLabel>{t("customizability.chat_section", { defaultValue: "Chat Page" })}</SectionLabel>
					<div className="surface-card overflow-hidden">
						<ToggleRow
							id="cust-drawer-layout"
							highlighted={highlightId === "cust-drawer-layout"}
							icon={<Images className="h-5 w-5" />}
							iconClass="bg-violet-500/15 text-violet-400"
							label={t("customizability.drawer_layout", { defaultValue: "Split Media Drawer into Categories" })}
							description={t("customizability.drawer_layout_desc", {
								defaultValue: "Show media, albums and collections in separate tabs instead of all on one page.",
							})}
							checked={splitDrawerCategories}
							onChange={(checked) => void setPreferences({ splitDrawerCategories: checked })}
						/>
					</div>
				</div>

				{/* VISUAL EFFECTS */}
				<div>
					<SectionLabel>{t("customizability.visual_effects")}</SectionLabel>
					<div className="surface-card overflow-hidden">
						<ToggleRow
							id="cust-reveal-effect"
							highlighted={highlightId === "cust-reveal-effect"}
							icon={<Sparkles className="h-5 w-5" />}
							iconClass="bg-violet-500/15 text-violet-400"
							label={t("customizability.reveal_effect.title")}
							description={t("customizability.reveal_effect.enable_desc")}
							checked={revealEffectEnabled}
							onChange={(checked) => void setPreferences({ revealEffectEnabled: checked })}
						/>
						{revealEffectEnabled && (
							<div className="grid grid-cols-2 gap-2 pb-4 pl-[68px] pr-[76px]">
								{(["subtle", "pronounced"] as const).map((s) => (
									<button
										key={s}
										type="button"
										onClick={() => void setPreferences({ revealEffectStrength: s })}
										className="rounded-xl border-2 p-3 text-sm font-semibold transition-all"
										style={{
											borderColor: revealEffectStrength === s ? "var(--accent)" : "var(--border)",
											background: revealEffectStrength === s
												? "color-mix(in srgb, var(--accent) 12%, var(--surface))"
												: "var(--surface-2)",
											color: revealEffectStrength === s ? "var(--accent-readable)" : "var(--text)",
										}}
									>
										{t(`customizability.reveal_effect.strengths.${s}`)}
									</button>
								))}
							</div>
						)}
					</div>
				</div>

				{/* INTERACTION (mobile app only) */}
				{isMobilePlatform && (
					<div>
						<SectionLabel>{t("customizability.interaction")}</SectionLabel>
						<div className="surface-card overflow-hidden">
							<ToggleRow
								id="cust-haptics"
								highlighted={highlightId === "cust-haptics"}
								icon={<Vibrate className="h-5 w-5" />}
								iconClass="bg-rose-500/15 text-rose-400"
								label={t("customizability.haptic_feedback")}
								description={t("customizability.haptic_feedback_desc")}
								checked={hapticsEnabled}
								onChange={(checked) => {
									setHapticsEnabled(checked);
									window.localStorage.setItem(HAPTICS_ENABLED_KEY, String(checked));
								}}
							/>
						</div>
					</div>
				)}

				{/* REGIONAL */}
				<div>
					<SectionLabel>{t("customizability.regional")}</SectionLabel>
					<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
						<SelectRow
							id="cust-language"
							highlighted={highlightId === "cust-language"}
							icon={<Languages className="h-5 w-5" />}
							iconClass="bg-teal-500/15 text-teal-400"
							label={t("settings.language")}
							value={selectedLocale}
							onChange={(val) => void handleLocaleChange(val)}
							options={SUPPORTED_LOCALE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
						/>
						<SelectRow
							id="cust-units"
							highlighted={highlightId === "cust-units"}
							icon={<Ruler className="h-5 w-5" />}
							iconClass="bg-cyan-500/15 text-cyan-400"
							label={t("customizability.units")}
							value={unitsPreset}
							onChange={(val) => handleUnitsPresetChange(val as UnitsPreset)}
							options={[
								{ value: "world", label: t("customizability.units_world") },
								{ value: "uk", label: t("customizability.units_uk") },
								{ value: "american", label: t("customizability.units_american") },
							]}
						/>
						<SelectRow
							id="cust-time-format"
							highlighted={highlightId === "cust-time-format"}
							icon={<Clock className="h-5 w-5" />}
							iconClass="bg-indigo-500/15 text-indigo-400"
							label={t("customizability.time_format")}
							value={timeFormat}
							onChange={(val) => {
								setTimeFormat(val as TimeFormat);
								window.localStorage.setItem(TIME_FORMAT_KEY, val);
							}}
							options={[
								{ value: "system", label: t("customizability.time_format_system") },
								{ value: "12h", label: t("customizability.time_format_12h") },
								{ value: "24h", label: t("customizability.time_format_24h") },
							]}
						/>
					</div>
				</div>

			</div>
		</section>
	);
}
