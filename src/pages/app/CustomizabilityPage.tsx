import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";
import { useEffect, useMemo, useState } from "react";
import { Columns2, Columns3, Columns4, Languages, LayoutGrid, List, PanelBottom, Ruler, Type, Vibrate } from "lucide-react";
import { ClockFilled, FlameFilled, ImagesFilled, MessageCircleFilled, LayoutGridFilled, MonitorFilled, MoonFilled, PaletteFilled, SparklesFilled, SunFilled } from "../../components/icons/FilledIcons";
import toast from "react-hot-toast";
import { usePreferences, ACCENT_PRESETS, type ColorScheme } from "../../contexts/PreferencesContext";
import { PageHeader } from "../../components/PageHeader";
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

/* Fixed palettes (index.css light / dark / AMOLED values) so every preview
   shows its scheme regardless of the one currently active. */
const SCHEME_PREVIEW_COLORS = {
	light: { bg: "#f5f7fa", card: "#ffffff", line: "#d7dce3" },
	dark: { bg: "#0f131a", card: "#161d27", line: "#2b3646" },
	amoled: { bg: "#000000", card: "#111418", line: "#1e232b" },
};

function SchemeMockup({ colors }: { colors: (typeof SCHEME_PREVIEW_COLORS)["light"] }) {
	return (
		<div className="flex h-full flex-col gap-1 p-2" style={{ background: colors.bg }}>
			<div className="h-1.5 w-1/2 rounded-full" style={{ background: "var(--accent)" }} />
			{[0, 1].map((i) => (
				<div key={i} className="flex flex-1 flex-col justify-center gap-1 rounded-md px-1.5" style={{ background: colors.card }}>
					<div className="h-1 w-3/4 rounded-full" style={{ background: colors.line }} />
					<div className="h-1 w-1/2 rounded-full" style={{ background: colors.line }} />
				</div>
			))}
		</div>
	);
}

/** Mini app preview for a color scheme; "system" splits light and dark diagonally. */
function SchemePreview({ scheme, amoled }: { scheme: ColorScheme; amoled: boolean }) {
	const dark = amoled ? SCHEME_PREVIEW_COLORS.amoled : SCHEME_PREVIEW_COLORS.dark;
	return (
		<div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl">
			<SchemeMockup colors={scheme === "dark" ? dark : SCHEME_PREVIEW_COLORS.light} />
			{scheme === "system" && (
				<div className="absolute inset-0" style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}>
					<SchemeMockup colors={dark} />
				</div>
			)}
		</div>
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
	const [customHex, setCustomHex] = useState(accentColor);
	const [hexError, setHexError] = useState<string | null>(null);
	const [showRightNow, setShowRightNow] = useState(() => window.localStorage.getItem("fg-show-right-now") !== "false");
	const [isMobilePlatform] = useState(() => isAndroid() || isIos());
	const [showNavLabels, setShowNavLabels] = useState(() => window.localStorage.getItem(NAV_SHOW_LABELS_KEY) === "true");
	const [hapticsEnabled, setHapticsEnabled] = useState(isHapticsEnabled);
	const [timeFormat, setTimeFormat] = useState<TimeFormat>(getTimeFormat);
	const [navBarStyle, setNavBarStyle] = useState<NavBarStyle>(readNavBarStyle);
	const [showInterest, setShowInterest] = useState(() => window.localStorage.getItem("fg-show-interest") !== "false");
	const [defaultInterestTab, setDefaultInterestTab] = useState(() => window.localStorage.getItem("fg-interest-default-tab") || "taps");
	const [viewsLayout, setViewsLayout] = useState(() => window.localStorage.getItem("fg-interest-views-layout") === "list" ? "list" : "grid");
	const schemeOptions: {
		value: ColorScheme;
		label: string;
		icon: React.ReactNode;
	}[] = useMemo(
		() => [
			{
				value: "system",
				label: t("customizability.schemes.system"),
				icon: <MonitorFilled className="h-5 w-5" />,
			},
			{
				value: "light",
				label: t("customizability.schemes.light"),
				icon: <SunFilled className="h-5 w-5" />,
			},
			{
				value: "dark",
				label: t("customizability.schemes.dark"),
				icon: <MoonFilled className="h-5 w-5" />,
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

						{/* Color Scheme: row header like the other settings rows, then a
						    mini app preview per scheme to pick from. */}
						<div className="native-group">
						<div
							id="cust-color-scheme"
							className={`px-4 pb-4 pt-3.5 ${highlightId === "cust-color-scheme" ? "animate-settings-highlight" : ""}`}
						>
							<div className="flex items-center gap-3">
								<div className="shrink-0 rounded-2xl bg-sky-500/15 p-2.5 text-sky-400">
									{schemeOptions.find((option) => option.value === colorScheme)?.icon}
								</div>
								<div className="min-w-0 flex-1">
									<p className="text-sm font-semibold leading-snug">{t("customizability.color_scheme")}</p>
									<p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
										{schemeOptions.find((option) => option.value === colorScheme)?.label}
									</p>
								</div>
							</div>
							{/* Fixed tile width from sm up, so the previews don't grow with the page. */}
							<div className="mt-3.5 grid grid-cols-3 gap-2 sm:grid-cols-[repeat(3,9rem)]">
								{schemeOptions.map(({ value, label }) => {
									const isActive = colorScheme === value;
									return (
										<button
											key={value}
											type="button"
											onClick={() => handleSchemeChange(value)}
											aria-pressed={isActive}
											className={`flex flex-col gap-2 rounded-2xl p-1.5 pb-2.5 transition-[transform,background-color] duration-150 active:scale-[0.98] ${isActive ? "accent-tint-15 ring-2 ring-inset ring-[var(--accent)]" : "bg-[var(--surface-2)] hover:accent-tint-10"}`}
										>
											<SchemePreview scheme={value} amoled={amoledMode} />
											<span className={`text-xs font-medium ${isActive ? "text-[var(--accent-readable)]" : "text-[var(--text)]"}`}>{label}</span>
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
								icon={<MoonFilled className="h-5 w-5" />}
								iconClass="bg-violet-500/15 text-violet-400"
								label={t("customizability.amoled.title")}
								description={t("customizability.amoled.desc")}
								checked={amoledMode}
								onChange={(checked) => void setPreferences({ amoledMode: checked })}
							/>
						)}
						</div>

						{/* Accent Color: swatches, hex field and preview as tiles of one group */}
						<div className="native-group">
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

							{/* Preset tiles + custom tile, styled like the color scheme tiles above:
							    a color block with its name below, the active one ringed in the accent. */}
							<div className="mt-3.5 grid grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,5.5rem)]">
								{ACCENT_PRESETS.map((preset) => {
									const isActive = accentColor === preset.color;
									return (
										<button
											key={preset.color}
											type="button"
											onClick={() => handleAccentChange(preset)}
											aria-pressed={isActive}
											className={`flex flex-col gap-1.5 rounded-2xl p-1.5 pb-2 transition-[transform,background-color] duration-150 active:scale-[0.98] ${isActive ? "accent-tint-15 ring-2 ring-inset ring-[var(--accent)]" : "bg-[var(--surface-2)] hover:accent-tint-10"}`}
										>
											<span className="aspect-[4/3] w-full rounded-xl" style={{ background: preset.color }} />
											<span className={`truncate text-center text-xs font-medium ${isActive ? "text-[var(--accent-readable)]" : "text-[var(--text)]"}`}>{preset.name}</span>
										</button>
									);
								})}

								{/* Custom color: same tile, opens the native picker */}
								{(() => {
									const isCustom = !ACCENT_PRESETS.some((p) => p.color === accentColor);
									return (
										<label
											htmlFor="accent-color-picker"
											title={t("customizability.picker")}
											className={`flex cursor-pointer flex-col gap-1.5 rounded-2xl p-1.5 pb-2 transition-[transform,background-color] duration-150 active:scale-[0.98] ${isCustom ? "accent-tint-15 ring-2 ring-inset ring-[var(--accent)]" : "bg-[var(--surface-2)] hover:accent-tint-10"}`}
										>
											<input
												id="accent-color-picker"
												type="color"
												value={normalizeHex(customHex) || "#7c3aed"}
												onChange={(event) => handlePickColor(event.target.value)}
												className="sr-only"
											/>
											<span
												className="aspect-[4/3] w-full rounded-xl"
												style={{ background: isCustom ? accentColor : "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }}
											/>
											<span className={`truncate text-center text-xs font-medium ${isCustom ? "text-[var(--accent-readable)]" : "text-[var(--text)]"}`}>{t("customizability.custom")}</span>
										</label>
									);
								})()}
							</div>
						</div>

						{/* Hex input — applies on blur or Enter, no button needed */}
						<div className="px-4 py-3">
								<div
									className={`flex h-10 items-center overflow-hidden rounded-xl border bg-[var(--surface-2)] px-3 transition-colors focus-within:border-[var(--accent)] ${
										hexError ? "border-red-400" : "border-transparent"
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
						{/* Preview */}
						<div className="flex flex-col gap-3 px-4 py-4">
							<div className="flex flex-wrap gap-2">
								<button
									type="button"
									className="inline-flex h-9 items-center rounded-full px-4 text-sm font-semibold"
									style={{ background: "var(--accent)", color: "var(--accent-contrast)" }}
								>
									{t("customizability.preview_primary")}
								</button>
								<button
									type="button"
									className="inline-flex h-9 items-center rounded-full border px-4 text-sm font-semibold"
									style={{ borderColor: "var(--accent)", color: "var(--accent-readable)" }}
								>
									{t("customizability.preview_outlined")}
								</button>
								<button
									type="button"
									className="inline-flex h-9 items-center rounded-full px-4 text-sm font-semibold"
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
									{ value: "2", label: t("customizability.columns_2") },
									{ value: "3", label: t("customizability.columns_3") },
									{ value: "4", label: t("customizability.columns_4") },
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
											{ value: "4", label: t("customizability.columns_4"), icon: Columns4 },
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
