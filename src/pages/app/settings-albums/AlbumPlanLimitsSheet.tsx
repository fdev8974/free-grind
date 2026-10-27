import { Film, HardDrive, Images, Share2 } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "../../../components/ui/bottom-sheet";
import { NATIVE_SHEET_BG } from "../../../components/ui/action-sheet";
import { SheetSection } from "../../../components/ui/sheet-section";
import type { AlbumLimits } from "../../../types/albums";
import { DrawerHeader } from "../chat/drawerUi";
import { formatMs } from "./settingsAlbumsUtils";

function LimitRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
	return (
		<div className="flex items-center gap-3 px-4 py-3">
			<span className="shrink-0 text-[var(--text-muted)]">{icon}</span>
			<p className="min-w-0 flex-1 text-sm text-[var(--text-muted)]">{label}</p>
			<span className="shrink-0 rounded-lg bg-[var(--surface)] px-2.5 py-1 text-xs font-semibold tabular-nums">
				{value}
			</span>
		</div>
	);
}

/** The album plan (subscription) with its limits, and how many albums are used. */
export function AlbumPlanLimitsSheet({
	limits,
	albumCount,
	onClose,
	isDesktop,
}: {
	limits: AlbumLimits;
	/** Own albums in use; the usage bar is left out while it's unknown. */
	albumCount: number | null;
	onClose: () => void;
	isDesktop: boolean;
}) {
	const { t } = useTranslation();
	const maxAlbums = limits.maxAlbums ?? 1;
	const subscriptionType = limits.subscriptionType ?? null;
	const planLabel = useMemo(() => {
		if (!subscriptionType) return null;
		return subscriptionType.replace(/Albums$/i, "").trim() || subscriptionType;
	}, [subscriptionType]);

	return (
		<BottomSheet
			onClose={onClose}
			expandable
			isDesktop={isDesktop}
			bg={NATIVE_SHEET_BG}
			panelClassName={isDesktop ? "max-h-[82dvh] px-4" : "px-4"}
		>
			<DrawerHeader
				title={
					<span className="flex items-center gap-2">
						{t("settings_albums.limits_title", { defaultValue: "Plan Limits" })}
						{planLabel && (
							<span className="rounded-full accent-tint-15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--accent)]">
								{planLabel}
							</span>
						)}
					</span>
				}
			/>
			<div className="-mx-4 min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-2" data-lenis-prevent>
				{albumCount != null && (
					<SheetSection
						title={t("settings_albums.limits_albums_used", { defaultValue: "Albums" })}
						value={`${albumCount} / ${maxAlbums}`}
					>
						<div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
							<div
								className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
								style={{ width: `${Math.min(100, (albumCount / maxAlbums) * 100)}%` }}
							/>
						</div>
					</SheetSection>
				)}
				<SheetSection title={t("settings_albums.limits_details", { defaultValue: "Details" })}>
					<div className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl bg-[var(--surface-2)]">
						{limits.maxContentItemsPerAlbum != null && (
							<LimitRow icon={<Images className="h-4 w-4" />} label={t("settings_albums.limits_items_per_album", { defaultValue: "Items per Album" })} value={String(limits.maxContentItemsPerAlbum)} />
						)}
						{limits.maxVideosPerAlbum != null && (
							<LimitRow icon={<Film className="h-4 w-4" />} label={t("settings_albums.limits_videos_per_album", { defaultValue: "Videos per Album" })} value={String(limits.maxVideosPerAlbum)} />
						)}
						{limits.maxVideoLength != null && (
							<LimitRow icon={<Film className="h-4 w-4" />} label={t("settings_albums.limits_max_video_length", { defaultValue: "Max Video Length" })} value={formatMs(limits.maxVideoLength)} />
						)}
						{limits.minVideoLength != null && (
							<LimitRow icon={<Film className="h-4 w-4" />} label={t("settings_albums.limits_min_video_length", { defaultValue: "Min Video Length" })} value={formatMs(limits.minVideoLength)} />
						)}
						{limits.maxContentSizeHumanReadable != null && (
							<LimitRow icon={<HardDrive className="h-4 w-4" />} label={t("settings_albums.limits_storage", { defaultValue: "Max File Size" })} value={limits.maxContentSizeHumanReadable} />
						)}
						{limits.maxShares != null && (
							<LimitRow icon={<Share2 className="h-4 w-4" />} label={t("settings_albums.limits_shares", { defaultValue: "Shares" })} value={String(limits.maxShares)} />
						)}
						{limits.maxShareableAlbums != null && (
							<LimitRow icon={<Share2 className="h-4 w-4" />} label={t("settings_albums.limits_shareable_albums", { defaultValue: "Shareable Albums" })} value={String(limits.maxShareableAlbums)} />
						)}
						{limits.maxViewableAlbums != null && (
							<LimitRow icon={<Images className="h-4 w-4" />} label={t("settings_albums.limits_viewable_albums", { defaultValue: "Viewable Albums (others)" })} value={String(limits.maxViewableAlbums)} />
						)}
						{limits.maxViewableVideos != null && (
							<LimitRow icon={<Film className="h-4 w-4" />} label={t("settings_albums.limits_viewable_videos", { defaultValue: "Viewable Videos (others)" })} value={String(limits.maxViewableVideos)} />
						)}
					</div>
				</SheetSection>
			</div>
		</BottomSheet>
	);
}
