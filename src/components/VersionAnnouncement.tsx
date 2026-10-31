import { ChevronRight, FlaskConical } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import semver from "semver";
import type { VersionAnnouncement as VersionAnnouncementData } from "../data/versionAnnouncements";
import { useHorizontalSwipe } from "../hooks/useHorizontalSwipe";
import logo from "../images/freegrind-logo.webp";
import { fullscreenCardClass, fullscreenIconTileClass, fullscreenPrimaryButtonClass, fullscreenSecondaryButtonClass } from "./FullscreenPrompt";

// Long announcements only show a sliding window of dots; the outermost ones
// shrink to hint that more pages follow (like iOS/Instagram page controls).
const MAX_VISIBLE_DOTS = 10;

function Dots({ total, current }: { total: number; current: number }) {
	if (total <= 1) {
		return null;
	}

	const visible = Math.min(total, MAX_VISIBLE_DOTS);
	const start = Math.max(0, Math.min(current - Math.floor(visible / 2), total - visible));
	const end = start + visible - 1;

	const dotScale = (i: number) => {
		if (i === current) return 1;
		const moreBefore = start > 0;
		const moreAfter = end < total - 1;
		if ((moreBefore && i === start) || (moreAfter && i === end)) return 0.5;
		if ((moreBefore && i === start + 1) || (moreAfter && i === end - 1)) return 0.75;
		return 1;
	};

	return (
		<div
			className="flex justify-center pb-3 pt-5"
			style={{ paddingTop: "max(36px, env(safe-area-inset-top))" }}
		>
			<div className="flex items-center justify-center">
				{Array.from({ length: total }).map((_, i) => {
					const inWindow = i >= start && i <= end;
					const scale = dotScale(i);
					return (
						<div
							key={i}
							className="h-1.5 rounded-full transition-all duration-300"
							style={{
								width: !inWindow ? 0 : i === current ? "24px" : "6px",
								margin: inWindow ? "0 4px" : 0,
								opacity: inWindow ? (scale < 1 ? 0.4 + scale * 0.6 : 1) : 0,
								transform: `scale(${scale})`,
								background: i <= current ? "var(--accent)" : "color-mix(in srgb, var(--text) 15%, transparent)",
							}}
						/>
					);
				})}
			</div>
		</div>
	);
}

/** `1.0.0-beta.2` → "Beta 2", `1.0.0-rc.1` → "Release Candidate 1"; null for releases. */
function getPrereleaseLabel(version: string, t: TFunction): string | null {
	const [tag, number] = semver.prerelease(version) ?? [];
	if (tag === undefined) return null;
	const labels: Record<string, string> = {
		alpha: t("version_announcement.prerelease.alpha", { defaultValue: "Alpha" }),
		beta: t("version_announcement.prerelease.beta", { defaultValue: "Beta" }),
		rc: t("version_announcement.prerelease.rc", { defaultValue: "Release Candidate" }),
	};
	const label = (typeof tag === "string" && labels[tag.toLowerCase()])
		|| t("version_announcement.prerelease.other", { defaultValue: "Pre-release" });
	return typeof number === "number" ? `${label} ${number}` : label;
}

export function VersionAnnouncement({
	announcement,
	appVersion,
	onClose,
	buttonLabel,
}: {
	announcement: VersionAnnouncementData;
	/** Running app version; may be a pre-release of `announcement.version`. */
	appVersion?: string;
	onClose: () => void;
	buttonLabel?: string;
}) {
	const { t } = useTranslation();
	const displayVersion = appVersion ?? announcement.version;
	const prereleaseLabel = getPrereleaseLabel(displayVersion, t);
	// The pre-release tag is shown as its label, so only the base version goes here.
	const baseVersion = semver.coerce(displayVersion)?.version ?? displayVersion;
	// -1 = intro page (headline/version), 0..items.length-1 = one item per page
	const [step, setStep] = useState(-1);
	// Which side the current page slides in from: 1 = forward, -1 = back.
	const [direction, setDirection] = useState<1 | -1>(1);

	const items = announcement.items;
	const isIntro = step === -1;
	const isLastItem = step === items.length - 1;
	const item = isIntro ? null : items[step];

	const goTo = (next: number) => {
		setDirection(next > step ? 1 : -1);
		setStep(next);
	};

	const handleAdvance = () => {
		if (isIntro) {
			if (items.length > 0) {
				goTo(0);
			} else {
				onClose();
			}
			return;
		}
		if (isLastItem) {
			onClose();
			return;
		}
		goTo(step + 1);
	};

	// Swiping only pages; closing stays a deliberate button tap.
	const swipe = useHorizontalSwipe({
		onNext: step < items.length - 1 ? () => goTo(step + 1) : undefined,
		onPrev: step > -1 ? () => goTo(step - 1) : undefined,
	});

	const isFinalPage = isIntro ? items.length === 0 : isLastItem;
	const Icon = item?.icon;
	const pageClass = direction > 0 ? "animate-step-in-next" : "animate-step-in-prev";

	return (
		<div className="fs-card-outer fs-card-overlay z-[300] no-touch-callout">
			<div className="fs-card-inner fs-card-lg flex flex-col" {...swipe}>
				{!isIntro && <Dots total={items.length} current={step} />}

				{isIntro ? (
					<div
						key="intro"
						className={`flex flex-1 flex-col items-center justify-center px-8 text-center ${pageClass}`}
						style={{
							paddingTop: "max(48px, env(safe-area-inset-top))",
							paddingBottom: "max(48px, calc(env(safe-area-inset-bottom) + 80px))",
						}}
					>
						<img src={logo} alt="" className="mb-6 h-16 w-16 rounded-2xl object-cover" />
						<h1 className="text-2xl font-bold text-[var(--text)]">
							{t("version_announcement.title", { defaultValue: "What's new in Free Grind" })}
						</h1>
						{announcement.tagline && (
							<p className="mt-1.5 max-w-xs text-base font-semibold text-[var(--accent)]">{announcement.tagline}</p>
						)}
						<p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--text-muted)]">
							{t("version_announcement.version", { version: baseVersion, defaultValue: "Version {{version}}" })}
							{prereleaseLabel && (
								<>
									{" · "}
									<span className="font-semibold text-[var(--accent)]">{prereleaseLabel}</span>
								</>
							)}
						</p>
						{prereleaseLabel && (
							<div className={`${fullscreenCardClass} mt-8 w-full max-w-sm overflow-hidden text-left`}>
								<div className="flex items-start gap-3 px-4 py-3.5">
									<div className="shrink-0 rounded-2xl ink-tint-8 p-2.5 text-[var(--accent)]">
										<FlaskConical className="h-5 w-5" />
									</div>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-semibold leading-snug text-[var(--text)]">
											{t("version_announcement.test_build_title", { defaultValue: "Test build" })}
										</p>
										<p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">
											{t("version_announcement.test_build_desc", {
												defaultValue: "This is a test build ahead of the final release, so expect some rough edges. Bugs reported now are fixed before everyone gets it.",
											})}
										</p>
									</div>
								</div>
							</div>
						)}
					</div>
				) : (
					<div key={step} className={`flex flex-1 flex-col items-center justify-center px-8 text-center ${pageClass}`}>
						<div className={`mb-6 ${fullscreenIconTileClass}`}>
							{Icon && <Icon className="h-9 w-9" />}
						</div>
						<h2 className="text-xl font-bold text-[var(--text)]">{item?.title}</h2>
						{/* min-h keeps the title in place for short descriptions without
						    cutting off long ones (or long translations). */}
						<div className="flex min-h-24 flex-col items-center">
							<p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--text-muted)]">
								{item?.description}
							</p>
						</div>
					</div>
				)}

				<div
					className="flex h-44 shrink-0 flex-col justify-end gap-2 px-6"
					style={{ paddingBottom: "max(28px, calc(env(safe-area-inset-bottom) + 12px))" }}
				>
					<button
						type="button"
						onClick={handleAdvance}
						className={fullscreenPrimaryButtonClass}
					>
						{!isIntro && isLastItem
							? buttonLabel ?? t("version_announcement.got_it", { defaultValue: "Got it" })
							: t("version_announcement.continue", { defaultValue: "Continue" })}
						<ChevronRight className="h-4 w-4" />
					</button>
					{!isFinalPage && (
						<button
							type="button"
							onClick={onClose}
							className={fullscreenSecondaryButtonClass}
						>
							{t("version_announcement.skip", { defaultValue: "Skip" })}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
