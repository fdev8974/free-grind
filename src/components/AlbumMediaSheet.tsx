import { Images, Loader2, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "./ui/bottom-sheet";
import { useDesktopBreakpoint } from "../hooks/useDesktopBreakpoint";
import { getHeroRectFromElement, type HeroRect } from "./PhotoViewer";
import {
	DRAWER_TILE_CLASS,
	DrawerBody,
	DrawerEmptyState,
	DrawerGrid,
	DrawerGridSkeleton,
	DrawerHeader,
	DrawerMediaPreview,
	DrawerMediaTile,
	useDrawerMediaPreview,
} from "../pages/app/chat/drawerUi";

export type AlbumMediaSheetItem = {
	contentId: number;
	contentType: string | null;
	thumbUrl: string | null;
	url: string | null;
	coverUrl: string | null;
	processing: boolean;
};

type Props = {
	albumName: string | null;
	content: AlbumMediaSheetItem[];
	onClose: () => void;
	/** `heroRect`: where the tapped tile's picture is, for the viewer's hero open. */
	onSelect: (index: number, heroRect?: HeroRect | null) => void;
	/** True while the full-screen viewer is open on top of this sheet — disables the sheet's own Escape/backdrop/swipe dismissal so those gestures act on the viewer instead of closing the (currently hidden) sheet underneath it. */
	locked?: boolean;
	/** The album's content is still loading: placeholder tiles instead of the empty state. */
	isLoading?: boolean;
};

/** Browse-first grid for an album's content — the same tiles, spacing and
 * hold-to-peek as the media drawers, but for a single album. Tapping an item
 * opens it in the full-screen album viewer at that index. */
export function AlbumMediaSheet({ albumName, content, onClose, onSelect, locked = false, isLoading = false }: Props) {
	const { t } = useTranslation();
	const isDesktop = useDesktopBreakpoint();
	const { preview, bind, consumeClick } = useDrawerMediaPreview();

	return (
		<BottomSheet
			onClose={onClose}
			isDesktop={isDesktop}
			isProcessing={locked}
			expandable
			panelClassName={isDesktop ? "max-h-[82dvh] px-4" : "px-4"}
		>
			<DrawerHeader title={albumName?.trim() || t("shared_albums.album_label")} className="mb-3 gap-3" />

			<DrawerBody
				isDesktop={isDesktop}
				className={isDesktop ? "min-h-[60vh] pb-4" : "pb-4"}
				empty={content.length === 0 && isLoading ? (
					<DrawerGridSkeleton isDesktop={isDesktop} />
				) : content.length === 0 ? (
					<div className="flex h-full items-center justify-center py-8">
						<DrawerEmptyState
							icon={<Images className="h-5 w-5" />}
							title={t("shared_albums.empty_album_title")}
							hint={t("shared_albums.empty_album_desc")}
						/>
					</div>
				) : undefined}
			>
				<DrawerGrid isDesktop={isDesktop}>
					{content.map((item, idx) => {
						const isVideo = item.contentType?.startsWith("video/") ?? false;
						// thumbUrl/coverUrl are always static preview images; `url` is
						// the raw media file (the actual video for video items), so it
						// only works as an <img> fallback for images — a <video src>
						// without a poster/seek hack renders blank (see PhotoViewer's
						// currentTime-seek workaround), so the grid always uses a still
						// image + a Play badge for videos instead of a <video> tag.
						const src = item.thumbUrl ?? item.coverUrl ?? (isVideo ? null : item.url);
						if (!src) {
							return (
								<button
									key={item.contentId}
									type="button"
									disabled={item.processing}
									onClick={() => onSelect(idx)}
									className={`${DRAWER_TILE_CLASS} flex items-center justify-center disabled:opacity-50`}
									aria-label={t("shared_albums.content_alt", { index: idx + 1 })}
								>
									<Images className="h-6 w-6 text-[var(--text-muted)] opacity-40" />
								</button>
							);
						}
						// The peek shows the real file when there is one (the video itself,
						// or the full-res image over the tile's already-loaded thumbnail).
						const peekSrc = item.url ?? src;
						const peekPlaceholder = !isVideo && peekSrc !== src ? src : undefined;
						return (
							<DrawerMediaTile
								key={item.contentId}
								src={src}
								alt={t("shared_albums.content_alt", { index: idx + 1 })}
								busy={item.processing}
								onSelect={item.processing ? undefined : (tile) => onSelect(idx, getHeroRectFromElement(tile))}
								previewProps={item.processing ? undefined : bind({ src: peekSrc, isVideo: isVideo && !!item.url, placeholderSrc: peekPlaceholder })}
								consumePreviewClick={consumeClick}
							>
								{isVideo && !item.processing && (
									<div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
										<div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm">
											<Play className="h-4 w-4 fill-white text-white" />
										</div>
									</div>
								)}
								{item.processing && (
									<div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
										<Loader2 className="h-5 w-5 animate-spin text-white" />
									</div>
								)}
							</DrawerMediaTile>
						);
					})}
				</DrawerGrid>
			</DrawerBody>

			<DrawerMediaPreview media={preview} />
		</BottomSheet>
	);
}
