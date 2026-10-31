import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";
import { useMemo, useState } from "react";
import { Columns2, Columns3, Columns4, Languages, LayoutGrid, List, PanelBottom, Ruler, Type, Vibrate } from "lucide-react";
import { ClockFilled, FlameFilled, ImagesFilled, MessageCircleFilled, LayoutGridFilled, MonitorFilled, MoonFilled, PaletteFilled, SparklesFilled, SunFilled } from "../../components/icons/FilledIcons";
import toast from "react-hot-toast";
import { usePreferences, ACCENT_PRESETS, type ColorScheme } from "../../contexts/PreferencesContext";
import { PageHeader } from "../../components/PageHeader";
import { SchemePreview } from "../../components/SchemePreview";
import { RightNowIcon } from "../../components/icons/RightNowIcon";
import { HAPTICS_ENABLED_KEY, isHapticsEnabled } from "../../utils/haptics";
import { getTimeFormat, TIME_FORMAT_KEY, type TimeFormat } from "../../utils/timeFormat";
import { NAV_FLOATING_KEY, NAV_SHOW_LABELS_KEY, NAV_STYLE_EVENT, readNavBarStyle, type NavBarStyle } from "../../components/NavBar";
import { isAndroid, isIos } from "../../services/saveMedia";
import { ToggleRow } from "../../components/ui/toggle-row";
import { SelectRow } from "../../components/ui/select-row";
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
	const isDesktop = useDesktopBreakpoint();
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
		compactComposer,
		setPreferences,
	} = usePreferences();
	const [showRightNow, setShowRightNow] = useState(() => window.localStorage.getItem("fg-show-right-now") !== "false");
	const [isMobilePlatform] = useState(() => isAndroid() || isIos());
	// 4 columns only leave room for usable tiles on tablets; the shorter screen
	// edge keeps the check independent of orientation.
	const [isTablet] = useState(() => Math.min(window.screen.width, window.screen.height) >= 600);
	const [showNavLabels, setShowNavLabels] = useState(() => window.localStorage.getItem(NAV_SHOW_LABELS_KEY) === "true");
	const [hapticsEnabled, setHapticsEnabled] = useState(isHapticsEnabled);
	const [timeFormat, setTimeFormat] = useState<TimeFormat>(getTimeFormat);
	const [navBarStyle, setNavBarStyle] = useState<NavBarStyle>(readNavBarStyle);
	const [showInterest, setShowInterest] = useState(() => window.localStorage.getItem("fg-show-interest") !== "false");
	const [defaultInterestTab, setDefaultInterestTab] = useState(() => window.localStorage.getItem("fg-interest-default-tab") || "taps");
	const [viewsLayout, setViewsLayout] = useState(() => window.localStorage.getItem("fg-interest-views-layout") === "list" ? "list" : "grid");
	// AMOLED isn't a color scheme of its own: it's dark plus the pure-black
	// flag, offered as a fourth option like in the onboarding.
	const schemeOptions: {
		key: string;
		value: ColorScheme;
		amoled: boolean;
		label: string;
		icon: React.ReactNode;
	}[] = useMemo(
		() => [
			{ key: "system", value: "system", amoled: false, label: t("customizability.schemes.system"), icon: <MonitorFilled className="h-5 w-5" /> },
			{ key: "light", value: "light", amoled: false, label: t("customizability.schemes.light"), icon: <SunFilled className="h-5 w-5" /> },
			{ key: "dark", value: "dark", amoled: false, label: t("customizability.schemes.dark"), icon: <MoonFilled className="h-5 w-5" /> },
			{ key: "amoled", value: "dark", amoled: true, label: t("customizability.schemes.amoled", { defaultValue: "AMOLED" }), icon: <MoonFilled className="h-5 w-5" /> },
		],
		[t],
	);
	const isSchemeOptionActive = (option: { value: ColorScheme; amoled: boolean }) =>
		colorScheme === option.value && (option.value !== "dark" || amoledMode === option.amoled);
	const activeSchemeOption = schemeOptions.find(isSchemeOptionActive) ?? schemeOptions[0];
	const selectedLocale = resolveSupportedLocale(i18n.language);

	const handleSchemeChange = (scheme: ColorScheme, amoled: boolean) => {
		void setPreferences({ colorScheme: scheme, amoledMode: amoled });
	};

	const handleAccentChange = (preset: (typeof ACCENT_PRESETS)[number]) => {
		void setPreferences({ accentColor: preset.color, accentContrast: preset.contrast });
	};

	const handlePickColor = (value: string) => {
		const normalized = normalizeHex(value);
		if (!normalized) {
			return;
		}

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
					{/* One group: color scheme and accent color, each a tile with a row
					    header and its picker. */}
					<div className="native-group">
						<div
							id="cust-color-scheme"
							className={`px-4 pb-4 pt-3.5 ${highlightId === "cust-color-scheme" ? "animate-settings-highlight" : ""}`}
						>
							<div className="flex items-center gap-3">
								<div className="shrink-0 rounded-2xl bg-sky-500/15 p-2.5 text-sky-400">
									{activeSchemeOption.icon}
								</div>
								<div className="min-w-0 flex-1">
									<p className="text-sm font-semibold leading-snug">{t("customizability.color_scheme")}</p>
									<p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
										{activeSchemeOption.label}
									</p>
								</div>
							</div>
							{/* Fixed tile width from sm up, so the previews don't grow with the page. */}
							<div className="mt-3.5 grid grid-cols-4 gap-2 sm:grid-cols-[repeat(4,8rem)]">
								{schemeOptions.map((option) => {
									const { key, value, amoled, label } = option;
									const isActive = isSchemeOptionActive(option);
									return (
										<button
											key={key}
											// Settings search still jumps to AMOLED by its old anchor.
											id={key === "amoled" ? "cust-amoled" : undefined}
											type="button"
											onClick={() => handleSchemeChange(value, amoled)}
											aria-pressed={isActive}
											className={`flex flex-col gap-2 rounded-2xl p-1.5 pb-2.5 transition-[transform,background-color] duration-150 active:scale-[0.98] ${isActive ? "accent-tint-15 ring-2 ring-inset ring-[var(--accent)]" : "bg-[var(--surface-2)] hover:accent-tint-10"} ${key === "amoled" && highlightId === "cust-amoled" ? "animate-settings-highlight" : ""}`}
										>
											<SchemePreview scheme={value} amoled={amoled} />
											<span className={`text-xs font-medium ${isActive ? "text-[var(--accent-readable)]" : "text-[var(--text)]"}`}>{label}</span>
										</button>
									);
								})}
							</div>
						</div>
						<div
							id="cust-accent-color"
							className={`px-4 pb-4 pt-3.5 ${highlightId === "cust-accent-color" ? "animate-settings-highlight" : ""}`}
						>
							<div className="flex items-center gap-3">
								<div className="shrink-0 rounded-2xl accent-tint-15 p-2.5 text-[var(--accent)]">
									<PaletteFilled className="h-5 w-5" />
								</div>
								<div className="min-w-0 flex-1">
									<p className="text-sm font-semibold leading-snug">{t("customizability.accent_color")}</p>
									<p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
										{ACCENT_PRESETS.find((p) => p.color === accentColor)?.name ?? t("customizability.custom")}
									</p>
								</div>
							</div>

							{/* Compact chips: a color dot with its name, the active one tinted and
							    ringed in the accent like the color scheme tiles above. */}
							<div className="mt-3.5 flex flex-wrap gap-2">
								{ACCENT_PRESETS.map((preset) => {
									const isActive = accentColor === preset.color;
									return (
										<button
											key={preset.color}
											type="button"
											onClick={() => handleAccentChange(preset)}
											aria-pressed={isActive}
											className={`flex items-center gap-2 rounded-xl py-1.5 pl-1.5 pr-3 transition-[transform,background-color] duration-150 active:scale-[0.97] ${isActive ? "accent-tint-15 ring-2 ring-inset ring-[var(--accent)]" : "bg-[var(--surface-2)] hover:accent-tint-10"}`}
										>
											<span className="h-6 w-6 shrink-0 rounded-lg" style={{ background: preset.color }} />
											<span className={`text-xs font-medium ${isActive ? "text-[var(--accent-readable)]" : "text-[var(--text)]"}`}>{preset.name}</span>
										</button>
									);
								})}

								{/* Custom color: same chip, opens the native picker */}
								{(() => {
									const isCustom = !ACCENT_PRESETS.some((p) => p.color === accentColor);
									return (
										<label
											htmlFor="accent-color-picker"
											title={t("customizability.picker")}
											className={`flex cursor-pointer items-center gap-2 rounded-xl py-1.5 pl-1.5 pr-3 transition-[transform,background-color] duration-150 active:scale-[0.97] ${isCustom ? "accent-tint-15 ring-2 ring-inset ring-[var(--accent)]" : "bg-[var(--surface-2)] hover:accent-tint-10"}`}
										>
											<input
												id="accent-color-picker"
												type="color"
												value={normalizeHex(accentColor) || "#7c3aed"}
												onChange={(event) => handlePickColor(event.target.value)}
												className="sr-only"
											/>
											<span
												className="h-6 w-6 shrink-0 rounded-lg"
												style={{ background: isCustom ? accentColor : "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }}
											/>
											<span className={`text-xs font-medium ${isCustom ? "text-[var(--accent-readable)]" : "text-[var(--text)]"}`}>{t("customizability.custom")}</span>
										</label>
									);
								})()}
							</div>
						</div>

					</div>
				</div>

				{/* BROWSE PAGE (column count only affects the mobile app) */}
				<div>
					<SectionLabel>{t("customizability.grid_page")}</SectionLabel>
					<div className="native-group">
						{isMobilePlatform && (
							<SelectRow
								id="cust-browse-grid"
								highlighted={highlightId === "cust-browse-grid"}
								icon={<LayoutGridFilled className="h-5 w-5" />}
								iconClass="bg-blue-500/15 text-blue-400"
								label={t("customizability.grid_layout")}
								description={t("customizability.browse_grid_mobile_desc")}
								value={mobileGridColumns}
								onChange={(cols) => void setPreferences({ mobileGridColumns: cols })}
								options={[
									{ value: "2", label: t("customizability.columns_2"), icon: Columns2 },
									{ value: "3", label: t("customizability.columns_3"), icon: Columns3 },
									...(isTablet || mobileGridColumns === "4"
										? [{ value: "4" as const, label: t("customizability.columns_4"), icon: Columns4 }]
										: []),
								]}
							/>
						)}
						<ToggleRow
							id="cust-grid-tap-status"
							highlighted={highlightId === "cust-grid-tap-status"}
							icon={<FlameFilled className="h-5 w-5" />}
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
					<div className="native-group">
						{/* Bar style options only exist in the mobile app. */}
						{isMobilePlatform && (
							<>
								<SelectRow
									id="cust-nav-floating"
									highlighted={highlightId === "cust-nav-floating"}
									icon={<PanelBottom className="h-5 w-5" />}
									iconClass="bg-sky-500/15 text-sky-400"
									label={t("customizability.nav_style", { defaultValue: "Bar Style" })}
									description={t("customizability.nav_style_desc", { defaultValue: "How the navigation bar is shown." })}
									value={navBarStyle}
									onChange={(val) => {
										setNavBarStyle(val);
										window.localStorage.setItem(NAV_FLOATING_KEY, val === "fade" ? "fade" : String(val === "floating"));
										window.dispatchEvent(new Event(NAV_STYLE_EVENT));
									}}
									options={[
										{
											value: "solid",
											label: t("customizability.nav_style_solid", { defaultValue: "Full Width" }),
											description: t("customizability.nav_style_solid_desc", { defaultValue: "A solid bar across the full width of the screen." }),
										},
										{
											value: "floating",
											label: t("customizability.nav_style_floating", { defaultValue: "Floating" }),
											description: t("customizability.nav_style_floating_desc", { defaultValue: "A floating card above the content." }),
										},
										{
											value: "fade",
											label: t("customizability.nav_style_fade", { defaultValue: "Floating, Transparent" }),
											description: t("customizability.nav_style_fade_desc", { defaultValue: "Floating icons without a card, on a dark fade from the bottom edge." }),
										},
									]}
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
							icon={<FlameFilled className="h-5 w-5" />}
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
						<div className="native-group">
							<SelectRow
								icon={<FlameFilled className="h-5 w-5 opacity-50" />}
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
									{ value: "sent", label: t("customizability.interest_show_sent") },
								]}
							/>
							{/* Mobile only: desktop always shows interest as tiles. */}
							{!isDesktop && (
							<SelectRow
								id="cust-views-grid"
								highlighted={highlightId === "cust-views-grid"}
								icon={<LayoutGridFilled className="h-5 w-5" />}
								iconClass="bg-blue-500/15 text-blue-400"
								label={t("customizability.views_grid_layout")}
								description={t("customizability.views_display_desc")}
								// Mobile picks the column count right here; desktop's grid sizes itself.
								value={viewsLayout === "list" ? "list" : isMobilePlatform ? mobileViewsGridColumns : "grid"}
								onChange={(val) => {
									const layout = val === "list" ? "list" : "grid";
									setViewsLayout(layout);
									window.localStorage.setItem("fg-interest-views-layout", layout);
									if (val === "2" || val === "3" || val === "4") {
										void setPreferences({ mobileViewsGridColumns: val });
									}
								}}
								options={[
									{ value: "list", label: t("customizability.views_display_list"), icon: List },
									...(isMobilePlatform
										? [
											{ value: "2", label: t("customizability.columns_2"), icon: Columns2 },
											{ value: "3", label: t("customizability.columns_3"), icon: Columns3 },
											...(isTablet || mobileViewsGridColumns === "4"
												? [{ value: "4", label: t("customizability.columns_4"), icon: Columns4 }]
												: []),
										]
										: [{ value: "grid", label: t("customizability.views_display_grid"), icon: LayoutGrid }]),
								]}
							/>
							)}
						</div>
					</div>
				)}

				{/* CHAT */}
				<div>
					<SectionLabel>{t("customizability.chat_section", { defaultValue: "Chat Page" })}</SectionLabel>
					<div className="native-group">
						<ToggleRow
							id="cust-drawer-layout"
							highlighted={highlightId === "cust-drawer-layout"}
							icon={<ImagesFilled className="h-5 w-5" />}
							iconClass="bg-violet-500/15 text-violet-400"
							label={t("customizability.drawer_layout", { defaultValue: "Split Media Drawer into Categories" })}
							description={t("customizability.drawer_layout_desc", {
								defaultValue: "Show media, albums and collections in separate tabs instead of all on one page.",
							})}
							checked={splitDrawerCategories}
							onChange={(checked) => void setPreferences({ splitDrawerCategories: checked })}
						/>
						<ToggleRow
							id="cust-compact-composer"
							highlighted={highlightId === "cust-compact-composer"}
							icon={<MessageCircleFilled className="h-5 w-5" />}
							iconClass="bg-sky-500/15 text-sky-400"
							label={t("customizability.compact_composer", { defaultValue: "Compact Message Bar" })}
							description={t("customizability.compact_composer_desc", {
								defaultValue: "Put the media drawer button and a + menu with the other actions inside the message field instead of a row below it.",
							})}
							checked={compactComposer}
							onChange={(checked) => void setPreferences({ compactComposer: checked })}
						/>
					</div>
				</div>

				{/* VISUAL EFFECTS */}
				<div>
					<SectionLabel>{t("customizability.visual_effects")}</SectionLabel>
					<div className="native-group">
						{/* Off and both strengths in one picker. */}
						<SelectRow
							id="cust-reveal-effect"
							highlighted={highlightId === "cust-reveal-effect"}
							icon={<SparklesFilled className="h-5 w-5" />}
							iconClass="bg-violet-500/15 text-violet-400"
							label={t("customizability.reveal_effect.title")}
							description={t("customizability.reveal_effect.description")}
							value={revealEffectEnabled ? revealEffectStrength : "off"}
							onChange={(choice) =>
								void setPreferences(
									choice === "off"
										? { revealEffectEnabled: false }
										: { revealEffectEnabled: true, revealEffectStrength: choice },
								)}
							options={[
								{ value: "off", label: t("customizability.reveal_effect.strengths.off", { defaultValue: "Off" }) },
								{ value: "subtle", label: t("customizability.reveal_effect.strengths.subtle") },
								{ value: "pronounced", label: t("customizability.reveal_effect.strengths.pronounced") },
							]}
						/>
					</div>
				</div>

				{/* INTERACTION (mobile app only) */}
				{isMobilePlatform && (
					<div>
						<SectionLabel>{t("customizability.interaction")}</SectionLabel>
						<div className="native-group">
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
					<div className="native-group">
						<SelectRow
							id="cust-language"
							highlighted={highlightId === "cust-language"}
							icon={<Languages className="h-5 w-5" />}
							iconClass="bg-teal-500/15 text-teal-400"
							label={t("settings.language")}
							value={selectedLocale}
							onChange={(val) => void handleLocaleChange(val)}
							options={SUPPORTED_LOCALE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
							expandable
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
							icon={<ClockFilled className="h-5 w-5" />}
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
