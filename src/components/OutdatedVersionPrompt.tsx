import { ChevronRight, Download, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import semver from "semver";
import { processDismissCountdown, writeDismissedFlag } from "../utils/appStartDismissCountdown";
import { describeApkUpdateError, useApkUpdate } from "../services/apkUpdate";
import { getCurrentHotswapChannel, isHotswapAvailable, whenStartupHotswapSettled } from "../services/hotswap";

const DEFAULT_RELEASES_URL = "https://github.com/fdev8974/free-grind/releases";
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
};

function normalizeVersion(value: string): string {
    return value.trim().replace(/^v/i, "");
}

/**
 * Semver precedence (`1.0.0-beta.1 < 1.0.0-beta.2 < 1.0.0-rc.1 < 1.0.0`).
 * Coercion tolerates loose release names like `1.0`; unparseable versions
 * never count as outdated.
 */
function isOlderVersion(currentVersion: string, latestVersion: string): boolean {
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
 * The main app's APK is published as `free-grind-v<version>.apk`. Prefers the
 * exact name for this release, then any `free-grind-v<x.y.z[-pre]>.apk` — never some
 * other `.apk` that might get attached to a release later.
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
async function fetchLatestRelease(signal: AbortSignal, includePrerelease: boolean): Promise<ReleaseInfo> {
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
    for (const release of releases) {
        if (release.draft || (release.prerelease && !includePrerelease)) continue;
        const version = parseReleaseVersion(release);
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
    };
}

export function OutdatedVersionPromptView({
	appVersion,
	releaseInfo,
	onDismiss,
}: {
	appVersion: string;
	releaseInfo: ReleaseInfo;
	onDismiss: () => void;
}) {
	const apkUpdate = useApkUpdate(releaseInfo.apkUrl);
	const { phase } = apkUpdate.state;
	const isBusy = phase === "downloading" || phase === "verifying" || phase === "installing";

	return (
		<div className="fs-card-outer fs-card-overlay z-[110] no-touch-callout">
			<div className="fs-card-inner fs-card-lg flex flex-col">
				<div
					className="flex flex-1 flex-col items-center justify-center px-8 text-center"
					style={{
						paddingTop: "max(48px, env(safe-area-inset-top))",
						paddingBottom: "max(24px, env(safe-area-inset-bottom))",
					}}
				>
					<div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-[var(--surface-2)] border border-[var(--border)]">
						<Download className="h-9 w-9 text-[var(--accent)]" />
					</div>
					<h1 className="text-2xl font-bold text-[var(--text)]">Update Available</h1>
					<div className="flex flex-col items-center overflow-hidden">
						<p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--text-muted)]">
							You're using Free Grind {appVersion}, which is outdated.
						</p>
						<p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--text-muted)]">
							The latest version is {releaseInfo.latestVersion}.
						</p>
					</div>
				</div>

				<div
					className="flex min-h-44 shrink-0 flex-col justify-end gap-2 px-6"
					style={{ paddingBottom: "max(28px, calc(env(safe-area-inset-bottom) + 12px))" }}
				>
					{apkUpdate.supported ? (
						<>
							{apkUpdate.state.phase === "downloading" && (
								<div className="mb-1 flex flex-col gap-1.5">
									<div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
										<div
											className={`h-full rounded-full bg-[var(--accent)] transition-[width] duration-200 ${apkUpdate.state.progress === null ? "w-1/3 animate-pulse" : ""}`}
											style={apkUpdate.state.progress === null ? undefined : { width: `${Math.round(apkUpdate.state.progress * 100)}%` }}
										/>
									</div>
									<p className="text-center text-xs text-[var(--text-muted)]">
										{apkUpdate.state.progress === null
											? "Downloading…"
											: `Downloading… ${Math.round(apkUpdate.state.progress * 100)}%`}
									</p>
								</div>
							)}
							{phase === "needs-permission" && (
								<p className="mb-1 text-center text-xs leading-relaxed text-[var(--text-muted)]">
									Allow Free Grind to install apps, then come back here — the update continues automatically.
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
								className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] py-3.5 text-sm font-semibold text-[var(--accent-contrast)] transition hover:brightness-110 disabled:opacity-70"
							>
								{isBusy && <Loader2 className="h-4 w-4 animate-spin" />}
								{phase === "downloading"
									? "Downloading…"
									: phase === "verifying"
										? "Verifying…"
										: phase === "installing"
											? "Installing…"
											: phase === "installed"
												? "Installed"
												: phase === "needs-permission"
													? "Allow installs"
													: phase === "error"
														? "Try again"
														: <>Download & install {releaseInfo.latestVersion}<Download className="h-4 w-4" /></>}
							</button>
							<div className="flex gap-2">
								<a
									href={releaseInfo.releasesUrl}
									target="_blank"
									rel="noreferrer"
									className="flex-1 rounded-xl py-3 text-center text-sm font-medium text-[var(--text-muted)] transition hover:text-[var(--text)]"
								>
									Open on GitHub
								</a>
								<button
									type="button"
									onClick={onDismiss}
									disabled={isBusy}
									className="flex-1 rounded-xl py-3 text-sm font-medium text-[var(--text-muted)] transition hover:text-[var(--text)] disabled:opacity-50"
								>
									Dismiss
								</button>
							</div>
						</>
					) : (
						<>
							<a
								href={releaseInfo.releasesUrl}
								target="_blank"
								rel="noreferrer"
								className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] py-3.5 text-sm font-semibold text-[var(--accent-contrast)] transition hover:brightness-110"
							>
								Get {releaseInfo.latestVersion}
								<ChevronRight className="h-4 w-4" />
							</a>
							<button
								type="button"
								onClick={onDismiss}
								className="w-full rounded-xl py-3 text-sm font-medium text-[var(--text-muted)] transition hover:text-[var(--text)]"
							>
								Dismiss
							</button>
						</>
					)}
				</div>
			</div>
		</div>
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
    
    const [isDismissed, setIsDismissed] = useState(() =>
        processDismissCountdown(dismissStorageKey)
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
