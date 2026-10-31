import { AlertTriangle, ChevronRight, Download, ExternalLink, Loader2, Smartphone, Sparkles } from "lucide-react";
import { FullscreenPrompt, fullscreenPrimaryButtonClass, fullscreenSecondaryButtonClass } from "./FullscreenPrompt";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import semver from "semver";
import { processDismissCountdown, writeDismissedFlag } from "../utils/appStartDismissCountdown";
import { describeApkUpdateError, useApkUpdate } from "../services/apkUpdate";
import { getCurrentHotswapChannel, isHotswapAvailable, whenStartupHotswapSettled } from "../services/hotswap";
import { areUpdateChecksEnabled } from "../services/updateChecks";
import { formatRelativeTime } from "../utils/relativeTime";
import { VersionCompare } from "./ui/version-compare";
import { RELEASES_URL } from "../config/links-config";

const DEFAULT_RELEASES_URL = RELEASES_URL;
// Used when the release lookup fails: assume the running version is current,
// so being offline never flags a build (e.g. a pre-release) as outdated.
const DEFAULT_LATEST_VERSION = normalizeVersion(import.meta.env.VITE_APP_VERSION ?? "0.0.0");
const TARGET_OUTDATED_VERSIONS = new Set(["0.5.0", "0.5.1", "0.5.2", "0.5.3", "0.5.4", "5.0.0", "5.1.0", "5.2.0", "5.3.0", "5.4.0"]);
const OUTDATED_VERSION_REOPEN_COUNT = 5;
// Upper bound for waiting on the startup OTA check before judging the version.
const STARTUP_OTA_WAIT_MS = 30_000;

/**
 * Waits for the startup OTA check (main.tsx runs it in production builds). An
 * OTA update can bring the frontend up to the latest release, so judging the
 * version before that would flash the prompt right before the reload.
 */
function waitForStartupOta(): Promise<void> {
    if (!import.meta.env.PROD || !isHotswapAvailable()) return Promise.resolve();
    return Promise.race([
        whenStartupHotswapSettled(),
        new Promise<void>((resolve) => setTimeout(resolve, STARTUP_OTA_WAIT_MS)),
    ]);
}

export type ReleaseInfo = {
    latestVersion: string;
    releasesUrl: string;
    /** Release APK asset — enables the in-app download & install on Android. */
    apkUrl?: string;
    /** Releases on this channel, for the installed release's date and how many came after it. */
    releases?: { version: string; publishedAt: string | null }[];
};

function normalizeVersion(value: string): string {
    return value.trim().replace(/^v/i, "");
}

/**
 * Semver precedence (`1.0.0-beta.1 < 1.0.0-beta.2 < 1.0.0-rc.1 < 1.0.0`).
 * Coercion tolerates loose release names like `1.0`; unparseable versions
 * never count as outdated.
 */
export function isOlderVersion(currentVersion: string, latestVersion: string): boolean {
    const current = semver.coerce(currentVersion, { includePrerelease: true });
    const latest = semver.coerce(latestVersion, { includePrerelease: true });
    if (!current || !latest) return false;

    return semver.lt(current, latest);
}

function isTargetOutdatedVersion(value: string, releaseInfo: ReleaseInfo): boolean {
    const normalizedVersion = normalizeVersion(value);
    
    if (TARGET_OUTDATED_VERSIONS.has(normalizedVersion)) {
        return true;
    }

    return isOlderVersion(normalizedVersion, releaseInfo.latestVersion);
}

function buildDismissStorageKey(appVersion: string): string {
    return `outdated-version-dismissed-${normalizeVersion(appVersion)}`;
}

/**
 * The main app's APK (arm64-v8a only) is published as
 * `free-grind-v<version>.apk`. Prefers the exact name for this release, then
 * any `free-grind-v<x.y.z[-pre]>.apk` — never some other `.apk` that might
 * get attached to a release later.
 */
function pickApkAsset(
    assets: { name?: string; browser_download_url?: string }[],
    version: string,
): string | undefined {
    const usable = assets.filter(
        (asset): asset is { name: string; browser_download_url: string } =>
            typeof asset.name === "string" && typeof asset.browser_download_url === "string",
    );
    const exact = usable.find((asset) => asset.name === `free-grind-v${version}.apk`);
    if (exact) return exact.browser_download_url;
    return usable.find((asset) => /^free-grind-v\d+(\.\d+)*(-[0-9A-Za-z.-]+)?\.apk$/.test(asset.name))
        ?.browser_download_url;
}

type GitHubRelease = {
    name?: string;
    html_url?: string;
    draft?: boolean;
    prerelease?: boolean;
    published_at?: string | null;
    assets?: { name?: string; browser_download_url?: string }[];
};

/** Release names look like `Free Grind v1.0.0-beta.0 (abc1234)`. */
function parseReleaseVersion(release: GitHubRelease): string | null {
    const raw = release.name?.split(" ")[2];
    if (!raw) return null;
    const version = normalizeVersion(raw);
    return semver.valid(version) ? version : null;
}

/**
 * Highest published release by semver. GitHub's `releases/latest` skips
 * pre-releases entirely, so this walks the release list instead and only lets
 * pre-releases through when `includePrerelease` is set (non-stable channels).
 */
export async function fetchLatestRelease(signal: AbortSignal, includePrerelease: boolean): Promise<ReleaseInfo> {
    const response = await fetch(
        "https://api.github.com/repos/fdev8974/free-grind/releases?per_page=30",
        {
            headers: {
                Accept: "application/vnd.github+json",
            },
            signal,
        },
    );

    if (!response.ok) {
        throw new Error(`GitHub release lookup failed (${response.status})`);
    }

    const releases = (await response.json()) as GitHubRelease[];

    let latest: { release: GitHubRelease; version: string } | null = null;
    const channelReleases: { version: string; publishedAt: string | null }[] = [];
    for (const release of releases) {
        if (release.draft || (release.prerelease && !includePrerelease)) continue;
        const version = parseReleaseVersion(release);
        if (version) channelReleases.push({ version, publishedAt: release.published_at ?? null });
        // Strictly greater keeps the newest of several releases sharing a version
        // (the list is ordered newest first).
        if (version && (!latest || semver.gt(version, latest.version))) {
            latest = { release, version };
        }
    }

    if (!latest) {
        return { latestVersion: DEFAULT_LATEST_VERSION, releasesUrl: DEFAULT_RELEASES_URL };
    }

    return {
        latestVersion: latest.version,
        releasesUrl:
            typeof latest.release.html_url === "string" && latest.release.html_url.length > 0
                ? latest.release.html_url
                : DEFAULT_RELEASES_URL,
        apkUrl: pickApkAsset(latest.release.assets ?? [], latest.version),
        releases: channelReleases,
    };
}

/** "Released 3 days ago" for a version in the channel's release list, else null. */
function releasedAgo(t: TFunction, releaseInfo: ReleaseInfo, version: string): string | null {
	const publishedAt = releaseInfo.releases?.find((release) => release.version === normalizeVersion(version))?.publishedAt;
	const timestamp = publishedAt ? Date.parse(publishedAt) : NaN;
	return Number.isFinite(timestamp)
		? t("update_prompt.released_ago", { defaultValue: "Released {{time}}", time: formatRelativeTime(timestamp) })
		: null;
}

export function OutdatedVersionPromptView({
	appVersion,
	releaseInfo,
	onDismiss,
	manual = false,
}: {
	appVersion: string;
	releaseInfo: ReleaseInfo;
	onDismiss: () => void;
	/** Opened from a manual check in Settings — plain "new version" wording instead of "outdated". */
	manual?: boolean;
}) {
	const { t } = useTranslation();
	const apkUpdate = useApkUpdate(releaseInfo.apkUrl);
	const { phase } = apkUpdate.state;
	const isBusy = phase === "downloading" || phase === "verifying" || phase === "installing";
	const installedReleasedAgo = releasedAgo(t, releaseInfo, appVersion);
	const latestReleasedAgo = releasedAgo(t, releaseInfo, releaseInfo.latestVersion);
	// Only worth saying when more than one release was skipped.
	const releasesAhead = (releaseInfo.releases ?? []).filter((release) => isOlderVersion(appVersion, release.version)).length;

	const footer = apkUpdate.supported ? (
		<>
			{apkUpdate.state.phase === "downloading" && (
				<div className="mb-1 flex flex-col gap-1.5">
					<div className="h-2 w-full overflow-hidden rounded-full ink-tint-10">
						<div
							className={`h-full rounded-full bg-[var(--accent)] transition-[width] duration-200 ${apkUpdate.state.progress === null ? "w-1/3 animate-pulse" : ""}`}
							style={apkUpdate.state.progress === null ? undefined : { width: `${Math.round(apkUpdate.state.progress * 100)}%` }}
						/>
					</div>
					<p className="text-center text-xs text-[var(--text-muted)]">
						{apkUpdate.state.progress === null
							? t("update_prompt.downloading", { defaultValue: "Downloading…" })
							: t("update_prompt.downloading_percent", {
									defaultValue: "Downloading… {{percent}}%",
									percent: Math.round(apkUpdate.state.progress * 100),
								})}
					</p>
				</div>
			)}
			{phase === "needs-permission" && (
				<p className="mb-1 text-center text-xs leading-relaxed text-[var(--text-muted)]">
					{t("update_prompt.needs_permission_hint", {
						defaultValue: "Allow Free Grind to install apps, then come back here — the update continues automatically.",
					})}
				</p>
			)}
			{apkUpdate.state.phase === "error" && (
				<p className="mb-1 text-center text-xs leading-relaxed text-red-400">
					{describeApkUpdateError(apkUpdate.state.code)}
				</p>
			)}
			<button
				type="button"
				disabled={isBusy || phase === "installed"}
				onClick={() => {
					if (phase === "needs-permission") apkUpdate.openPermissionSettings();
					else if (apkUpdate.state.phase === "error" && apkUpdate.state.code === "canceled") apkUpdate.installDownloaded();
					else apkUpdate.start();
				}}
				className={fullscreenPrimaryButtonClass}
			>
				{isBusy && <Loader2 className="h-4 w-4 animate-spin" />}
				{phase === "downloading"
					? t("update_prompt.downloading", { defaultValue: "Downloading…" })
					: phase === "verifying"
						? t("update_prompt.verifying", { defaultValue: "Verifying…" })
						: phase === "installing"
							? t("update_prompt.installing", { defaultValue: "Installing…" })
							: phase === "installed"
								? t("update_prompt.installed", { defaultValue: "Installed" })
								: phase === "needs-permission"
									? t("update_prompt.allow_installs", { defaultValue: "Allow installs" })
									: phase === "error"
										? t("update_prompt.try_again", { defaultValue: "Try again" })
										: <>{t("update_prompt.download_install", { defaultValue: "Download & install" })}<Download className="h-4 w-4" /></>}
			</button>
			<div className="flex gap-2">
				<a
					href={releaseInfo.releasesUrl}
					target="_blank"
					rel="noreferrer"
					className={`${fullscreenSecondaryButtonClass} inline-flex flex-1 items-center justify-center gap-1.5`}
				>
					{t("update_prompt.open_github", { defaultValue: "Open on GitHub" })}
					<ExternalLink className="h-3.5 w-3.5" />
				</a>
				<button type="button" onClick={onDismiss} disabled={isBusy} className={`${fullscreenSecondaryButtonClass} flex-1`}>
					{manual ? t("ota_prompt.later", { defaultValue: "Later" }) : t("update_prompt.dismiss", { defaultValue: "Dismiss" })}
				</button>
			</div>
		</>
	) : (
		<>
			<a href={releaseInfo.releasesUrl} target="_blank" rel="noreferrer" className={fullscreenPrimaryButtonClass}>
				{t("update_prompt.get_version", { defaultValue: "Get {{version}}", version: releaseInfo.latestVersion })}
				<ChevronRight className="h-4 w-4" />
			</a>
			<button type="button" onClick={onDismiss} className={fullscreenSecondaryButtonClass}>
				{manual ? t("ota_prompt.later", { defaultValue: "Later" }) : t("update_prompt.dismiss", { defaultValue: "Dismiss" })}
			</button>
		</>
	);

	return (
		<FullscreenPrompt
			icon={manual ? Download : AlertTriangle}
			title={t("update_prompt.title", { defaultValue: "Update Available" })}
			description={
				manual
					? t("update_prompt.description_manual", { defaultValue: "A new version of the app is ready to install." })
					: t("update_prompt.description_outdated", {
							defaultValue: "This version no longer receives over-the-air updates. Install the latest one to keep getting new features and fixes.",
						})
			}
			footer={footer}
		>
			<div className={"native-group text-left"}>
				<VersionCompare
					from={{
						icon: Smartphone,
						label: t("update_prompt.installed_label", { defaultValue: "Installed" }),
						title: appVersion,
						detail: installedReleasedAgo,
					}}
					to={{
						icon: Sparkles,
						label: t("update_prompt.latest_label", { defaultValue: "Latest" }),
						title: releaseInfo.latestVersion,
						detail:
							latestReleasedAgo || releasesAhead > 1 ? (
								<>
									{latestReleasedAgo}
									{releasesAhead > 1 && (
										<span className="font-medium text-[var(--accent)]">
											{latestReleasedAgo ? " · " : null}
											{t("update_prompt.releases_ahead", { defaultValue: "{{count}} releases newer", count: releasesAhead })}
										</span>
									)}
								</>
							) : undefined,
					}}
				/>
			</div>
		</FullscreenPrompt>
	);
}

/**
 * Gates the routed app behind the outdated-version prompt — same slot in the
 * tree as onboarding/VersionAnnouncement/TestReminderGate in App.tsx, not a
 * floating overlay on top of the grid. That overlay approach left the card
 * transparent on mobile (fs-card-inner only gets a background at the 640px+
 * breakpoint), showing the grid bleeding through behind it.
 */
export function OutdatedVersionGate({ children }: { children: ReactNode }) {
    const appVersion = import.meta.env.VITE_APP_VERSION ?? "unknown";
    const normalizedAppVersion = normalizeVersion(appVersion);
    const dismissStorageKey = useMemo(
        () => buildDismissStorageKey(appVersion),
        [appVersion],
    );
    
    // With update checks turned off, no release lookup goes out at startup.
    const [isDismissed, setIsDismissed] = useState(() =>
        !areUpdateChecksEnabled() || processDismissCountdown(dismissStorageKey)
    );
    
    const [releaseInfo, setReleaseInfo] = useState<ReleaseInfo | null>(null);

    useEffect(() => {
        if (isDismissed) {
            return;
        }

        const controller = new AbortController();
        let cancelled = false;
        const latestRelease = fetchLatestRelease(controller.signal, getCurrentHotswapChannel() !== "main")
            .catch((): ReleaseInfo => ({
                latestVersion: DEFAULT_LATEST_VERSION,
                releasesUrl: DEFAULT_RELEASES_URL,
            }));
        void Promise.all([latestRelease, waitForStartupOta()]).then(([latest]) => {
            if (!cancelled) setReleaseInfo(latest);
        });

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [isDismissed]);

    const isVisible = useMemo(() => {
        if (isDismissed || !releaseInfo) {
            return false;
        }

        return isTargetOutdatedVersion(normalizedAppVersion, releaseInfo);
    }, [isDismissed, releaseInfo, normalizedAppVersion]);

    if (!isVisible || !releaseInfo) {
        return <>{children}</>;
    }

	return (
		<div className="app-shell">
			<OutdatedVersionPromptView
				appVersion={normalizedAppVersion}
				releaseInfo={releaseInfo}
				onDismiss={() => {
					writeDismissedFlag(dismissStorageKey, OUTDATED_VERSION_REOPEN_COUNT);
					setIsDismissed(true);
				}}
			/>
		</div>
	);
}
