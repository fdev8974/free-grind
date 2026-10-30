import { Ban, ChevronRight, Code2, ExternalLink, GitBranch, HeartHandshake, Scale } from "lucide-react";
import { DiscordIcon, TelegramIcon } from "../../components/icons/BrandIcons";
import { HeartFilled, LockFilled, MegaphoneFilled } from "../../components/icons/FilledIcons";
import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import semver from "semver";
import { PageHeader } from "../../components/PageHeader";
import { VersionAnnouncement } from "../../components/VersionAnnouncement";
import { FullscreenPortal } from "../../components/FullscreenPrompt";
import { usePreferences } from "../../contexts/PreferencesContext";
import { VERSION_ANNOUNCEMENTS } from "../../data/versionAnnouncements";
import { triggerSinModeUnlock } from "../../utils/sinModeEasterEgg";
import { openExternalUrl } from "../../utils/githubIssues";
import logo from "../../images/freegrind-logo.webp";

type AboutIcon = ComponentType<{ className?: string }>;

const DEV_TAP_TARGET = 7;
const REPO_URL = "https://github.com/fdev8974/free-grind";
const DISCORD_URL = "https://discord.gg/cJqTaWPMFF";
const TELEGRAM_URL = "https://t.me/freegrind";

/**
 * "What's new" for the running version: its own entry (a pre-release shares
 * its final version's one), else the newest one released before it.
 */
function findCurrentAnnouncement(appVersion: string) {
	const release = semver.coerce(appVersion)?.version;
	const exact =
		VERSION_ANNOUNCEMENTS.find((a) => a.version === appVersion) ??
		VERSION_ANNOUNCEMENTS.find((a) => a.version === release);
	if (exact || !release) return exact ?? null;
	return (
		VERSION_ANNOUNCEMENTS.filter((a) => semver.valid(a.version) && semver.lte(a.version, release)).sort((a, b) =>
			semver.rcompare(a.version, b.version),
		)[0] ?? null
	);
}

function SectionLabel({ children }: { children: ReactNode }) {
	return <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">{children}</p>;
}

function ProjectRow({
	icon: Icon,
	iconClass,
	label,
	description,
	right,
	onClick,
}: {
	icon: AboutIcon;
	iconClass: string;
	label: string;
	description?: string;
	right?: ReactNode;
	/** Without it the row is static (no press feedback). */
	onClick?: () => void;
}) {
	const Tag = onClick ? "button" : "div";
	return (
		<Tag
			{...(onClick ? { type: "button" as const, onClick } : {})}
			className={`flex w-full items-center gap-3 px-4 py-3.5 text-left ${onClick ? "transition-colors hover-fill" : ""}`}
		>
			<div className={`shrink-0 rounded-2xl p-2.5 ${iconClass}`}>
				<Icon className="h-5 w-5" />
			</div>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-semibold leading-snug">{label}</p>
				{description && <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">{description}</p>}
			</div>
			{right && <span className="flex shrink-0 items-center gap-2 text-[var(--text-muted)]">{right}</span>}
		</Tag>
	);
}

const externalIcon = <ExternalLink className="h-4 w-4 opacity-60" />;


export function AboutPage() {
	const { t } = useTranslation();
	const { developerMode, setPreferences } = usePreferences();
	const appVersion = import.meta.env.VITE_APP_VERSION;
	const announcement = useMemo(() => findCurrentAnnouncement(appVersion), [appVersion]);
	const [showAnnouncement, setShowAnnouncement] = useState(false);
	const [devTapCount, setDevTapCount] = useState(0);
	const [lastDevTapAt, setLastDevTapAt] = useState(0);

	const handleVersionTap = () => {
		const now = Date.now();
		const withinWindow = now - lastDevTapAt < 3000;
		const nextCount = withinWindow ? devTapCount + 1 : 1;
		setDevTapCount(nextCount);
		setLastDevTapAt(now);

		const remaining = DEV_TAP_TARGET - nextCount;
		if (remaining <= 0) {
			const nextMode = !developerMode;
			void setPreferences({ developerMode: nextMode });
			if (nextMode) {
				triggerSinModeUnlock();
			} else {
				toast.success("Developer Mode disabled");
			}
			setDevTapCount(0);
			setLastDevTapAt(0);
			return;
		}

		if (remaining <= 3) {
			toast(
				`Tap ${remaining} more ${remaining === 1 ? "time" : "times"} to ${developerMode ? "disable" : "enable"} Developer Mode`,
			);
		}
	};

	if (showAnnouncement && announcement) {
		return (
			<FullscreenPortal className="z-[300]">
				<VersionAnnouncement
					announcement={announcement}
					appVersion={announcement.version === semver.coerce(appVersion)?.version ? appVersion : undefined}
					buttonLabel={t("common.close", { defaultValue: "Close" })}
					onClose={() => setShowAnnouncement(false)}
				/>
			</FullscreenPortal>
		);
	}

	return (
		<section className="app-screen">
			<PageHeader backTo="/settings" title={t("settings.about")} />

			<div className="grid gap-6">
				<div className="native-group">
					{/* Tapping the app row 7 times toggles Developer Mode. */}
					<button
						type="button"
						onClick={handleVersionTap}
						className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover-fill"
					>
						<div className="shrink-0 rounded-2xl bg-slate-500/15 text-slate-400 p-2.5">
							<img src={logo} alt="" className="h-5 w-5 rounded-md object-cover" draggable={false} />
						</div>
						<div className="min-w-0 flex-1">
							<p className="text-sm font-semibold leading-snug">Free Grind</p>
							<p className="mt-0.5 text-xs text-[var(--text-muted)]">
								{t("about_page.tagline", { defaultValue: "The privacy-first, community-built client" })}
							</p>
						</div>
						<span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-semibold tabular-nums text-[var(--text-muted)]">
							v{appVersion}
						</span>
					</button>
				</div>

				<div>
					<SectionLabel>{t("about_page.section_principles", { defaultValue: "Why Free Grind" })}</SectionLabel>
					<div className="native-group">
						<ProjectRow
							icon={LockFilled}
							iconClass="bg-emerald-500/15 text-emerald-400"
							label={t("about_page.highlights.privacy_title", { defaultValue: "Privacy first" })}
							description={t("about_page.highlights.privacy_desc", { defaultValue: "No tracking, no engagement tricks." })}
						/>
						<ProjectRow
							icon={Code2}
							iconClass="bg-sky-500/15 text-sky-400"
							label={t("about_page.highlights.open_source_title", { defaultValue: "Open source" })}
							description={t("about_page.highlights.open_source_desc", { defaultValue: "All code is public on GitHub." })}
						/>
						<ProjectRow
							icon={Ban}
							iconClass="bg-amber-500/15 text-amber-400"
							label={t("about_page.highlights.no_ads_title", { defaultValue: "No ads" })}
							description={t("about_page.highlights.no_ads_desc", { defaultValue: "A clean interface, nothing in the way." })}
						/>
						<ProjectRow
							icon={HeartFilled}
							iconClass="bg-rose-500/15 text-rose-400"
							label={t("about_page.highlights.free_title", { defaultValue: "Free forever" })}
							description={t("about_page.highlights.free_desc", { defaultValue: "If someone asks you to pay, it's a scam." })}
						/>
					</div>
				</div>

				<div>
					<SectionLabel>{t("about_page.section_community", { defaultValue: "Community" })}</SectionLabel>
					<div className="native-group">
						{/* Brand colors as solid tiles on purpose: no color-mix (see accent-tint in index.css). */}
						<ProjectRow
							icon={DiscordIcon}
							iconClass="bg-[#5865F2] text-white"
							label={t("about_page.resources.discord_title")}
							description={t("about_page.discord_cta", { defaultValue: "Join the server" })}
							right={externalIcon}
							onClick={() => void openExternalUrl(DISCORD_URL)}
						/>
						<ProjectRow
							icon={TelegramIcon}
							iconClass="bg-[#229ED9] text-white"
							label={t("about_page.resources.telegram_title")}
							description={t("about_page.telegram_cta", { defaultValue: "Follow updates" })}
							right={externalIcon}
							onClick={() => void openExternalUrl(TELEGRAM_URL)}
						/>
					</div>
				</div>

				<div>
					<SectionLabel>{t("about_page.section_project", { defaultValue: "Project" })}</SectionLabel>
					<div className="native-group">
						{announcement && (
							<ProjectRow
								icon={MegaphoneFilled}
								iconClass="bg-[var(--surface-2)] text-[var(--accent)]"
								label={t("about_page.whats_new", { defaultValue: "What's New" })}
								description={t("about_page.whats_new_desc", {
									defaultValue: "Highlights of version {{version}}",
									version: announcement.version,
								})}
								right={<ChevronRight className="h-4 w-4 opacity-50" />}
								onClick={() => setShowAnnouncement(true)}
							/>
						)}
						<ProjectRow
							icon={GitBranch}
							iconClass="bg-green-500/15 text-green-400"
							label={t("about_page.resources.source_code_title")}
							description={t("about_page.resources.source_code_desc")}
							right={externalIcon}
							onClick={() => void openExternalUrl(REPO_URL)}
						/>
						<ProjectRow
							icon={HeartHandshake}
							iconClass="bg-rose-500/15 text-rose-400"
							label={t("about_page.resources.contributing_title")}
							description={t("about_page.resources.contributing_desc")}
							right={externalIcon}
							onClick={() => void openExternalUrl(`${REPO_URL}/blob/main/CONTRIBUTING.md`)}
						/>
						<ProjectRow
							icon={Scale}
							iconClass="bg-amber-500/15 text-amber-400"
							label={t("about_page.resources.licence_title")}
							description={t("about_page.commercial_note")}
							right={
								<>
									<span className="text-sm font-medium">{t("about_page.licence_value")}</span>
									{externalIcon}
								</>
							}
							onClick={() => void openExternalUrl(`${REPO_URL}/blob/main/LICENSE`)}
						/>
					</div>
				</div>

				{/* Attribution for the project's founder, who is no longer involved. */}
				<div className="px-4 pb-2 text-center text-xs leading-relaxed text-[var(--text-muted)]">
					<p>{t("about_page.founder_credit", { defaultValue: "Originally created by {{name}}.", name: "Jay Brammeld" })}</p>
					<p className="mt-0.5 opacity-70">{t("about_page.built_with", { defaultValue: "Built with {{stack}}", stack: "Tauri + React" })}</p>
				</div>
			</div>
		</section>
	);
}
