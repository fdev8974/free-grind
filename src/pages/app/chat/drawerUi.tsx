import { useCallback, useEffect, useRef, useState, type ChangeEvent, type HTMLAttributes, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Eye, Hourglass, Image as ImageIcon, Images, Infinity as InfinityIcon, Loader2, Play, RefreshCw, Repeat, Video, X } from "lucide-react";
import type { AlbumMediaCount } from "../../../types/chat-page";
import { CameraFilled, CameraPlusFilled } from "../../../components/icons/FilledIcons";
import { holdSheetDrag, SHEET_FOOTER_CLASS, SHEET_ICON_BUTTON_CLASS, SheetCloseButton, SheetCloseIcon, sheetButtonClass, useIsBottomSheetDetented } from "../../../components/ui/bottom-sheet";
import { haptic } from "../../../utils/haptics";
import freegrindLogo from "../../../images/freegrind-logo.webp";
import { proxyMediaUrl } from "../../../utils/mediaProxy";
import { SheetActionList } from "../../../components/ui/action-sheet";

// Shared building blocks for every media drawer sheet (chat drawer, collection
// editor, album "add from drawer", profile pictures), so they stay in sync:
// change the look here, not in each sheet.

export const drawerGridClass = (isDesktop: boolean) =>
	`grid gap-1.5 ${isDesktop ? "grid-cols-4" : "grid-cols-3"}`;

// Footer expiry buttons (ExpiryToggleButton, VideoExpiryButton): opaque over
// the footer fade, and "on" marked like a selected SheetChip (tinted fill and
// an inset accent ring), so it doesn't compete with the filled send button.
const EXPIRY_IDLE_CLASS =
	"bg-[color-mix(in_srgb,var(--text)_12%,var(--sheet-bg,var(--surface)))] text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_16%,var(--sheet-bg,var(--surface)))]";
const EXPIRY_ACTIVE_CLASS =
	"bg-[color-mix(in_srgb,var(--accent)_16%,var(--sheet-bg,var(--surface)))] text-[var(--text)] ring-2 ring-inset ring-[var(--accent)] [&>svg:first-child]:text-[var(--accent)]";

export const DRAWER_TILE_CLASS = "relative aspect-square overflow-hidden rounded-lg bg-[var(--surface-2)]";

type DrawerActionButtonProps = {
	icon: ReactNode;
	label: string;
	onClick: () => void;
	disabled?: boolean;
	/** "column" for a row of several actions, "row" for a single full-width one. */
	layout?: "column" | "row";
};

export function DrawerActionButton({ icon, label, onClick, disabled, layout = "column" }: DrawerActionButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`flex items-center rounded-[var(--radius-sm)] ink-tint-10 text-[var(--text)] transition active:scale-95 hover:ink-tint-14 disabled:pointer-events-none disabled:opacity-40 ${
				layout === "row" ? "w-full gap-3 px-3 py-2.5 text-left" : "flex-col gap-1.5 px-2 py-3"
			}`}
		>
			<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)]">
				{icon}
			</span>
			<span className={`font-semibold leading-tight ${layout === "row" ? "text-sm" : "text-xs"}`}>{label}</span>
		</button>
	);
}

/** Capture/upload actions as one flat row across the top of a media grid
 * (it spans all columns): much lower than a square tile, borderless, on a
 * see-through text tint (like the sheet chips), so it reads on every sheet
 * background; a darkened fill vanished on the plain dark theme. */
export function DrawerActionBar({
	actions,
	disabled,
}: {
	actions: { key: string; icon: ReactNode; label: string; onClick: () => void }[];
	disabled?: boolean;
}) {
	if (actions.length === 0) return null;
	return (
		<div className="col-span-full flex gap-1.5">
			{actions.map((action) => (
				<button
					key={action.key}
					type="button"
					onClick={action.onClick}
					disabled={disabled}
					className="flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg ink-tint-10 px-2 text-[var(--text)] transition active:scale-[0.97] hover:ink-tint-14 active:ink-tint-18 disabled:pointer-events-none disabled:opacity-40"
				>
					{/* Icon sized here rather than by the caller, so the bar doesn't depend on the icon's own classes. */}
					<span className="flex shrink-0 items-center justify-center text-[var(--accent-readable)] [&_svg]:h-[18px] [&_svg]:w-[18px]">{action.icon}</span>
					<span className="truncate text-[12.5px] font-semibold">{action.label}</span>
				</button>
			))}
		</div>
	);
}

/** Empty state for a drawer tab: a small fanned stack of tiles with the tab's
 * icon, a title, a hint, and the tab's call to action below. `fanned={false}`
 * drops the tile stack (which reads as "media") and keeps just the glowing
 * icon, for empty states outside the drawer. */
export function DrawerEmptyState({
	icon,
	title,
	hint,
	fanned = true,
	children,
}: {
	icon: ReactNode;
	title: string;
	hint: string;
	fanned?: boolean;
	children?: ReactNode;
}) {
	const tileClass = "absolute inset-0 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] shadow-sm";
	return (
		<div className="flex flex-col items-center gap-5 px-2 pb-8 pt-10 text-center">
			<div className="relative h-24 w-32">
				{/* Soft glow from the gradient alone (no blur filter), kept inside the
				    empty state's padding so the scroll container doesn't clip it. */}
				<div
					aria-hidden="true"
					className="pointer-events-none absolute -inset-x-10 -inset-y-6"
					style={{ background: "radial-gradient(closest-side, color-mix(in srgb, var(--accent) 24%, transparent), transparent)" }}
				/>
				{fanned ? (
					<div className="absolute inset-y-2 left-1/2 aspect-square -translate-x-1/2">
						<div className={`${tileClass} -translate-x-7 -rotate-12 opacity-60`} />
						<div className={`${tileClass} translate-x-7 rotate-12 opacity-60`} />
						<div className={`${tileClass} flex items-center justify-center`}>
							<span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)] shadow-md shadow-[var(--accent)]/30">
								{icon}
							</span>
						</div>
					</div>
				) : (
					<div className="absolute inset-0 flex items-center justify-center">
						<span className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)] shadow-lg shadow-[var(--accent)]/30 [&_svg]:h-7 [&_svg]:w-7">
							{icon}
						</span>
					</div>
				)}
			</div>
			<div className="space-y-1">
				<p className="text-sm font-semibold text-[var(--text)]">{title}</p>
				<p className="mx-auto max-w-[17rem] text-xs leading-relaxed text-[var(--text-muted)]">{hint}</p>
			</div>
			{children}
		</div>
	);
}

export type DrawerPreviewMedia = {
	src: string;
	isVideo: boolean;
	/** Already-loaded lower-res image to show until `src` has loaded (images only). */
	placeholderSrc?: string;
};
/** A group peek (a collection): all its media at once, in order. */
export type DrawerPreviewGroup = { title: string; items: DrawerPreviewMedia[] };
export type DrawerPreviewContent = DrawerPreviewMedia | DrawerPreviewGroup;

/** Most media shown in a group peek; the rest is summed up as "+N". */
const GROUP_PREVIEW_MAX = 9;

const LONG_PRESS_MS = 400;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

/**
 * Press-and-hold "peek" for drawer tiles: holding a tile shows a large preview
 * until release. Spread `bind(media)` onto a tile and gate its click with
 * `consumeClick()` so the release after a peek doesn't also select the tile.
 */
export function useDrawerMediaPreview() {
	const [preview, setPreview] = useState<DrawerPreviewContent | null>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const startRef = useRef<{ x: number; y: number } | null>(null);
	const suppressClickRef = useRef(false);
	// While a peek is open the finger belongs to it: moving it mustn't start
	// dragging (or dismissing) the sheet underneath.
	const releaseSheetDragRef = useRef<(() => void) | null>(null);

	const releaseSheetDrag = useCallback(() => {
		releaseSheetDragRef.current?.();
		releaseSheetDragRef.current = null;
	}, []);

	const cancelTimer = useCallback(() => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	const end = useCallback(() => {
		cancelTimer();
		startRef.current = null;
		releaseSheetDrag();
		setPreview(null);
	}, [cancelTimer, releaseSheetDrag]);

	useEffect(() => () => {
		cancelTimer();
		releaseSheetDrag();
	}, [cancelTimer, releaseSheetDrag]);

	const bind = useCallback(
		(media: DrawerPreviewContent) => ({
			onPointerDown: (event: PointerEvent<HTMLElement>) => {
				if (event.pointerType === "mouse" && event.button !== 0) return;
				suppressClickRef.current = false;
				startRef.current = { x: event.clientX, y: event.clientY };
				cancelTimer();
				// Warm the cache during the hold so the peek usually opens already loaded.
				if (!("items" in media) && !media.isVideo) new Image().src = proxyMediaUrl(media.src);
				timerRef.current = setTimeout(() => {
					timerRef.current = null;
					suppressClickRef.current = true;
					haptic(20);
					releaseSheetDrag();
					releaseSheetDragRef.current = holdSheetDrag();
					setPreview(media);
				}, LONG_PRESS_MS);
			},
			onPointerMove: (event: PointerEvent<HTMLElement>) => {
				const start = startRef.current;
				if (!start || !timerRef.current) return;
				if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_MOVE_TOLERANCE_PX) {
					cancelTimer();
				}
			},
			onPointerUp: end,
			onPointerCancel: end,
			onPointerLeave: () => {
				// Leaving the tile only aborts a pending press; an open peek stays
				// until the finger is lifted.
				cancelTimer();
			},
			onContextMenu: (event: MouseEvent<HTMLElement>) => event.preventDefault(),
		}),
		[cancelTimer, end, releaseSheetDrag],
	);

	/** True (once) when the click that follows a peek should be ignored. */
	const consumeClick = useCallback(() => {
		const suppressed = suppressClickRef.current;
		suppressClickRef.current = false;
		return suppressed;
	}, []);

	return { preview, bind, consumeClick };
}

const PREVIEW_ANIMATION_MS = 180;
/** Longest a peek waits for its media before opening anyway. */
const PREVIEW_LOAD_TIMEOUT_MS = 1000;

export function DrawerMediaPreview({ media }: { media: DrawerPreviewContent | null }) {
	// Keep the last media mounted while it animates out, then drop it.
	const [shown, setShown] = useState<DrawerPreviewContent | null>(media);
	// Opening before the media has loaded would scale in an empty box that
	// then jumps to the media's size — a visible flicker on uncached files.
	// Tracked per media so a late load of the one animating out can't count
	// for the next peek.
	const [loadedMedia, setLoadedMedia] = useState<DrawerPreviewContent | null>(null);
	const [isVisible, setIsVisible] = useState(false);
	const isLoaded = media !== null && ("items" in media || loadedMedia === media);
	const markLoaded = useCallback(() => setLoadedMedia(shown), [shown]);

	useEffect(() => {
		if (media) {
			setShown(media);
			return;
		}
		setIsVisible(false);
		const timer = setTimeout(() => setShown(null), PREVIEW_ANIMATION_MS);
		return () => clearTimeout(timer);
	}, [media]);

	useEffect(() => {
		if (!media || isLoaded) return;
		const timer = setTimeout(() => setLoadedMedia(media), PREVIEW_LOAD_TIMEOUT_MS);
		return () => clearTimeout(timer);
	}, [media, isLoaded]);

	useEffect(() => {
		if (!media || !isLoaded) return;
		// Two frames so the hidden start state is painted before transitioning in.
		let inner = 0;
		const outer = requestAnimationFrame(() => {
			inner = requestAnimationFrame(() => setIsVisible(true));
		});
		return () => {
			cancelAnimationFrame(outer);
			cancelAnimationFrame(inner);
		};
	}, [media, isLoaded]);

	if (!shown) return null;
	const transition = `opacity ${PREVIEW_ANIMATION_MS}ms ease-out, transform ${PREVIEW_ANIMATION_MS}ms cubic-bezier(0.34, 1.3, 0.64, 1)`;
	return createPortal(
		<div
			className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-6 backdrop-blur-md"
			style={{ opacity: isVisible ? 1 : 0, transition: `opacity ${PREVIEW_ANIMATION_MS}ms ease-out` }}
		>
			<div
				className="max-h-full max-w-full overflow-hidden rounded-2xl shadow-2xl"
				style={{ opacity: isVisible ? 1 : 0, transform: `scale(${isVisible ? 1 : 0.88})`, transition }}
			>
				{"items" in shown ? (
					<DrawerPreviewGroupGrid group={shown} />
				) : shown.isVideo ? (
					<video
						src={proxyMediaUrl(shown.src, { as: "video" })}
						autoPlay
						muted
						loop
						playsInline
						onLoadedData={markLoaded}
						onError={markLoaded}
						className="max-h-[80dvh] max-w-full object-contain"
					/>
				) : (
					<DrawerPreviewImage key={shown.src} media={shown} onReady={markLoaded} />
				)}
			</div>
		</div>,
		document.body,
	);
}

/** A peek image. With a `placeholderSrc` (an already-loaded thumbnail) it opens
 * on that right away, scaled up to peek size, and fades the full file in on top
 * once it has loaded. `onReady` fires once there is something to show. */
function DrawerPreviewImage({ media, onReady }: { media: DrawerPreviewMedia; onReady: () => void }) {
	const [aspect, setAspect] = useState<number | null>(null);
	const [isFullLoaded, setIsFullLoaded] = useState(false);
	const handleFullLoaded = () => {
		if (media.placeholderSrc) setIsFullLoaded(true);
		else onReady();
	};
	const fullImg = (
		<img
			ref={(el) => {
				if (el?.complete && el.naturalWidth) handleFullLoaded();
			}}
			src={proxyMediaUrl(media.src)}
			alt=""
			onLoad={handleFullLoaded}
			onError={media.placeholderSrc ? undefined : onReady}
			className={media.placeholderSrc ? "absolute inset-0 h-full w-full object-cover" : "max-h-[80dvh] max-w-full object-contain"}
			style={media.placeholderSrc ? { opacity: isFullLoaded ? 1 : 0, transition: `opacity ${PREVIEW_ANIMATION_MS}ms ease-out` } : undefined}
		/>
	);
	if (!media.placeholderSrc) return fullImg;

	const handlePlaceholder = (el: HTMLImageElement) => {
		if (el.naturalWidth && el.naturalHeight) setAspect(el.naturalWidth / el.naturalHeight);
		onReady();
	};
	return (
		<div className="relative">
			<img
				ref={(el) => {
					if (el?.complete && el.naturalWidth && aspect === null) handlePlaceholder(el);
				}}
				src={proxyMediaUrl(media.placeholderSrc)}
				alt=""
				onLoad={(event) => handlePlaceholder(event.currentTarget)}
				onError={onReady}
				// The thumbnail is smaller than the peek: size the box from its aspect
				// instead of its pixels so it fills the peek like the full file will.
				className="block max-h-[80dvh] max-w-full object-contain"
				style={aspect ? { aspectRatio: aspect, width: `min(calc(100vw - 3rem), calc(80dvh * ${aspect}))` } : undefined}
			/>
			{fullImg}
		</div>
	);
}

export const DRAWER_ICON_BUTTON_CLASS = SHEET_ICON_BUTTON_CLASS;

/** Sheet title row: title on the left, optional extra buttons, then close.
 * Pass `onClose` to close through your own handler instead of the sheet's. */
export function DrawerHeader({
	title,
	actions,
	onClose,
	className = "mb-4",
}: {
	title: ReactNode;
	actions?: ReactNode;
	onClose?: () => void;
	className?: string;
}) {
	const { t } = useTranslation();
	return (
		<div className={`flex items-center justify-between ${className}`}>
			<h3 className="min-w-0 truncate text-sm font-semibold text-[var(--text)]">{title}</h3>
			<div className="flex shrink-0 items-center gap-2">
				{actions}
				{onClose ? (
					<button type="button" onClick={onClose} className={DRAWER_ICON_BUTTON_CLASS} aria-label={t("common.close")}>
						<SheetCloseIcon />
					</button>
				) : (
					<SheetCloseButton />
				)}
			</div>
		</div>
	);
}

/** Placeholder tiles in the drawer grid's layout, shown while it loads. */
export function DrawerGridSkeleton({ isDesktop = false, count }: { isDesktop?: boolean; count?: number }) {
	const tiles = count ?? (isDesktop ? 12 : 9);
	return (
		<div className={drawerGridClass(isDesktop)} aria-busy="true">
			{Array.from({ length: tiles }, (_, i) => (
				<div key={i} className="aspect-square animate-pulse rounded-lg bg-[var(--surface-2)]" />
			))}
		</div>
	);
}

/** Scrollable drawer content with the shared loading, error (with retry) and
 * empty states; renders `children` (usually a DrawerGrid) otherwise. */
export function DrawerBody({
	isLoading,
	isDesktop = false,
	error,
	onRetry,
	retryLabel,
	empty,
	className = "max-h-[60vh]",
	gestureProps,
	children,
}: {
	isLoading?: boolean;
	/** Column count of the loading skeleton, matching the DrawerGrid. */
	isDesktop?: boolean;
	error?: string | null;
	onRetry?: () => void;
	retryLabel?: string;
	/** Shown instead of `children` when set. */
	empty?: ReactNode;
	className?: string;
	/** Touch handlers for the scroll area, e.g. useSwipeTabs. */
	gestureProps?: HTMLAttributes<HTMLDivElement>;
	children?: ReactNode;
}) {
	const { t } = useTranslation();
	// In an expandable sheet the body fills whatever height the sheet has, so
	// a height cap passed for the fixed-size layout no longer applies.
	const isDetented = useIsBottomSheetDetented();
	let content: ReactNode;
	if (isLoading) {
		content = <DrawerGridSkeleton isDesktop={isDesktop} />;
	} else if (error) {
		content = (
			<div className="flex flex-col items-center justify-center gap-3 p-6 py-8 text-center">
				<ImageIcon className="h-8 w-8 text-[var(--text-muted)]" />
				<p className="text-xs text-[var(--text-muted)]">{error}</p>
				{onRetry ? (
					<button
						type="button"
						onClick={onRetry}
						className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-readable)]"
					>
						<RefreshCw className="h-3 w-3" />
						{retryLabel ?? t("chat_drawer.retry")}
					</button>
				) : null}
			</div>
		);
	} else {
		content = empty ?? children;
	}
	// min-h-0 + data-lenis-prevent: both are needed for the inner scroll to work in a sheet.
	return (
		<div data-lenis-prevent {...gestureProps} className={`min-h-0 flex-1 overflow-y-auto ${isDetented ? "" : className}`}>
			{content}
		</div>
	);
}

/** Centre icon + name and bottom image/video counts on a group tile (album, collection). */
export function GroupTileOverlay({ icon, name, counts, badge }: { icon: ReactNode; name: string; counts?: AlbumMediaCount; badge?: ReactNode }) {
	return (
		<>
			<div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-2 pb-3 text-white">
				<div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/35 backdrop-blur-md shadow-[0_2px_8px_rgba(0,0,0,0.35)]">
					{icon}
				</div>
				<p className="max-w-full truncate text-[11px] font-semibold leading-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">{name}</p>
			</div>
			<div className="pointer-events-none absolute inset-x-1.5 bottom-1.5 flex h-5 items-center justify-between gap-1 text-[10px] font-semibold tabular-nums text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
				<span className="inline-flex min-w-0 items-center gap-2">
					{counts && (counts.images > 0 || counts.videos === 0) ? (
						<span className="inline-flex items-center gap-0.5">
							<Images className="h-3 w-3" />
							{counts.images}
						</span>
					) : null}
					{counts && counts.videos > 0 ? (
						<span className="inline-flex items-center gap-0.5">
							<Video className="h-3 w-3" />
							{counts.videos}
						</span>
					) : null}
				</span>
				{badge}
			</div>
		</>
	);
}

export function DrawerGrid({ isDesktop, children }: { isDesktop: boolean; children: ReactNode }) {
	return <div className={drawerGridClass(isDesktop)}>{children}</div>;
}

/**
 * One media tile: thumbnail (image or video), selection overlay, dimming, an
 * optional delete button, and `children` for extra badges/overlays.
 * Without `onSelect` the tile isn't selectable.
 */
export function DrawerMediaTile({
	src,
	isVideo = false,
	alt,
	selected = false,
	selectedContent,
	muted = false,
	busy = false,
	onSelect,
	previewProps,
	consumePreviewClick,
	mediaClassName = "",
	takenOnGrindr = false,
	onDelete,
	isDeleting = false,
	deleteLabel,
	children,
}: {
	src: string;
	isVideo?: boolean;
	alt?: string;
	selected?: boolean;
	/** What the selection overlay shows; a check mark by default. */
	selectedContent?: ReactNode;
	/** Can't be picked right now: faded out and not interactive. */
	muted?: boolean;
	/** Work in progress on this tile (e.g. adding, deleting). */
	busy?: boolean;
	/** Gets the tile element, e.g. for the viewer's hero open (getHeroRectFromElement). */
	onSelect?: (tile: HTMLElement) => void;
	/** From useDrawerMediaPreview: `bind(...)` result and its `consumeClick`. */
	previewProps?: Record<string, unknown>;
	consumePreviewClick?: () => boolean;
	mediaClassName?: string;
	/** Shows the "taken on Grindr" logo bottom left. */
	takenOnGrindr?: boolean;
	onDelete?: (event: MouseEvent<HTMLButtonElement>) => void;
	isDeleting?: boolean;
	deleteLabel?: string;
	children?: ReactNode;
}) {
	const select = (tile: HTMLElement) => {
		if (consumePreviewClick?.()) return;
		onSelect?.(tile);
	};
	return (
		<div
			role="button"
			tabIndex={onSelect && !muted ? 0 : -1}
			{...previewProps}
			onClick={(e) => select(e.currentTarget)}
			onKeyDown={(e) => { if (e.key === "Enter") onSelect?.(e.currentTarget); }}
			className={`${DRAWER_TILE_CLASS} no-touch-callout transition ${onSelect ? "cursor-pointer" : "cursor-default"} ${busy ? "opacity-60" : ""} ${muted ? "pointer-events-none opacity-30" : ""}`}
			style={{ outline: selected ? "2px solid var(--accent)" : "none", outlineOffset: "-2px" }}
		>
			{isVideo ? (
				<>
					<video
						src={proxyMediaUrl(src, { as: "video" })}
						preload="metadata"
						muted
						onLoadedMetadata={(e) => { e.currentTarget.currentTime = 0.001; }}
						className={`h-full w-full object-cover ${mediaClassName}`}
					/>
					<div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
						<div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm">
							<Play className="h-4 w-4 fill-white text-white" />
						</div>
					</div>
				</>
			) : (
				<img src={proxyMediaUrl(src)} alt={alt ?? ""} draggable={false} className={`h-full w-full object-cover ${mediaClassName}`} />
			)}

			{children}

			{selected ? (
				<div
					className="absolute inset-0 flex items-center justify-center"
					style={{ background: "color-mix(in srgb, var(--accent) 45%, transparent)" }}
				>
					{selectedContent ?? <Check className="h-5 w-5 text-white drop-shadow" />}
				</div>
			) : null}

			{takenOnGrindr ? (
				<img src={freegrindLogo} alt="" className="logo-shine pointer-events-none absolute bottom-1 left-1 h-4 w-4 rounded-full" />
			) : null}

			{onDelete ? (
				<DrawerTileCornerButton
					corner="left"
					icon={isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
					label={deleteLabel ?? ""}
					onClick={onDelete}
					disabled={isDeleting}
				/>
			) : null}
		</div>
	);
}

/** Small round button in a tile's top corner: delete (left) or edit (right). */
export function DrawerTileCornerButton({
	corner,
	icon,
	label,
	onClick,
	disabled,
}: {
	corner: "left" | "right";
	icon: ReactNode;
	label: string;
	onClick: (event: MouseEvent<HTMLButtonElement>) => void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={(event) => { event.stopPropagation(); onClick(event); }}
			onKeyDown={(event) => event.stopPropagation()}
			// Keeps a press on the button from starting the tile's hold-to-peek.
			onPointerDown={(event) => event.stopPropagation()}
			disabled={disabled}
			className={`absolute top-1.5 z-[1] inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80 disabled:opacity-60 ${corner === "left" ? "left-1.5" : "right-1.5"}`}
			aria-label={label}
			title={label}
		>
			{icon}
		</button>
	);
}

/** Bottom bar for the sheet's main action(s), floating over the content above. */
export function DrawerFooter({ children }: { children: ReactNode }) {
	return <div className={SHEET_FOOTER_CLASS}>{children}</div>;
}

export const DRAWER_PRIMARY_BUTTON_CLASS = sheetButtonClass();

/** maxViews of the video expiry choices; "unlimited" is the pickers' sentinel
 * (sent as MAX_VIDEO_VIEWS, see chatUtils' videoMessageViews). */
const VIDEO_VIEWS_UNLIMITED = 2147483647;

/** Footer pill for a video's views (unlimited, once, repeat): shows the
 * current choice and opens an action sheet with the three options. */
export function VideoExpiryButton({
	value,
	onChange,
	isDesktop,
	disabled,
}: {
	/** maxViews: 1 = once, 2 = repeat, anything else = unlimited. */
	value: number;
	onChange: (maxViews: number) => void;
	isDesktop: boolean;
	disabled?: boolean;
}) {
	const { t } = useTranslation();
	const [isOpen, setIsOpen] = useState(false);
	const options = [
		{ value: VIDEO_VIEWS_UNLIMITED, icon: InfinityIcon, iconClassName: "bg-sky-500/15 text-sky-400", label: t("chat_drawer.expiry.unlimited", { defaultValue: "Unlimited" }), description: t("chat_drawer.video_expiry_unlimited_desc", { defaultValue: "Can be watched as often as they like" }) },
		{ value: 1, icon: Eye, iconClassName: "bg-amber-500/15 text-amber-400", label: t("chat_drawer.expiry.once", { defaultValue: "Once" }), description: t("chat_drawer.video_expiry_once_desc", { defaultValue: "Can be watched one time" }) },
		{ value: 2, icon: Repeat, iconClassName: "bg-violet-500/15 text-violet-400", label: t("chat_drawer.expiry.repeat", { defaultValue: "Repeat" }), description: t("chat_drawer.video_expiry_repeat_desc", { defaultValue: "Can be watched twice" }) },
	];
	const current = options.find((option) => option.value === value) ?? options[0];
	const isLimited = current.value !== VIDEO_VIEWS_UNLIMITED;
	return (
		<>
			<button
				type="button"
				onClick={() => setIsOpen(true)}
				disabled={disabled}
				aria-haspopup="dialog"
				className={`inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-[transform,background-color,color] duration-150 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 ${
					isLimited
						? EXPIRY_ACTIVE_CLASS
						: EXPIRY_IDLE_CLASS
				}`}
			>
				<current.icon className="h-4 w-4" />
				<span>{current.label}</span>
				<ChevronDown className="h-3.5 w-3.5 opacity-70" />
			</button>
			{/* Portaled: this sits inside another (transformed) sheet, where a fixed sheet wouldn't cover the screen. */}
			{isOpen && createPortal(
				<SheetActionList
					title={t("chat_drawer.video_expiry_title", { defaultValue: "Video views" })}
					onClose={() => setIsOpen(false)}
					isDesktop={isDesktop}
					actions={options.map((option) => ({
						key: String(option.value),
						icon: option.icon,
						iconClassName: option.iconClassName,
						label: option.label,
						description: option.description,
						selected: option.value === current.value,
						onSelect: () => onChange(option.value),
					}))}
				/>,
				document.body,
			)}
		</>
	);
}

/** The FreeGrind logo as the "taken on Grindr" tool button's icon: muted
 * and grayscale while off, in full color while the watermark is on. */
export function TakenOnGrindrToolIcon({ active }: { active: boolean }) {
	return (
		<img
			src={freegrindLogo}
			alt=""
			className={`h-5 w-5 rounded-full transition ${active ? "" : "opacity-60 grayscale"}`}
		/>
	);
}

/** Thin vertical line between groups of MediaToolButtons (e.g. the
 * transforms and the watermark toggle). */
export function MediaToolDivider() {
	return <span aria-hidden="true" className="mx-1 h-6 w-px bg-[var(--border)]" />;
}

/** Round tool button under a media preview in the upload/edit sheets (flip,
 * rotate, the "taken on Grindr" watermark, looping). With `active` it is a
 * toggle, accent-tinted while on. */
export function MediaToolButton({
	icon,
	label,
	onClick,
	active,
}: {
	icon: ReactNode;
	label: string;
	onClick: () => void;
	active?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			aria-pressed={active}
			className={`${SHEET_ICON_BUTTON_CLASS} !h-10 !w-10 [&_svg]:h-5 [&_svg]:w-5 ${
				active ? "!bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] !text-[var(--accent-readable)]" : ""
			}`}
		>
			{icon}
		</button>
	);
}

/** Footer pill for a two-way expiry choice (unlimited or expiring, e.g. a
 * photo's 10 s): one tap flips it, instead of a dropdown with two entries.
 * Accent-tinted while expiring. */
export function ExpiryToggleButton({
	expiring,
	onChange,
	expiringLabel,
	disabled,
}: {
	expiring: boolean;
	onChange: (expiring: boolean) => void;
	/** Shown while expiring, e.g. "10s". */
	expiringLabel: string;
	disabled?: boolean;
}) {
	const { t } = useTranslation();
	const unlimitedLabel = t("chat_drawer.expiry.unlimited", { defaultValue: "Unlimited" });
	return (
		<button
			type="button"
			onClick={() => onChange(!expiring)}
			disabled={disabled}
			aria-pressed={expiring}
			title={expiring ? expiringLabel : unlimitedLabel}
			className={`inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold tabular-nums transition-[transform,background-color,color] duration-150 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 ${
				expiring
					? EXPIRY_ACTIVE_CLASS
					: EXPIRY_IDLE_CLASS
			}`}
		>
			{expiring ? <Hourglass className="h-4 w-4 animate-hourglass-rotate" /> : <InfinityIcon className="h-4 w-4" />}
			<span>{expiring ? expiringLabel : unlimitedLabel}</span>
		</button>
	);
}

export type DrawerAddAction = { key: string; label: string; icon: ReactNode; onClick: () => void };

/**
 * The drawer's add actions (take photo, record video, upload from device):
 * render `inputs` once in the sheet and `actions` as DrawerActionBar /
 * DrawerActionButton. `onFiles` gets whatever was picked.
 */
export function useDrawerAddActions({
	onFiles,
	multiple = false,
	allowVideo = true,
	busy = false,
	busyLabel,
}: {
	onFiles: (files: File[]) => void;
	/** Allow picking several files at once from the device. */
	multiple?: boolean;
	/** False drops "record video" and limits uploads to photos. */
	allowVideo?: boolean;
	/** Shows a spinner on the action that was used, while its upload runs. */
	busy?: boolean;
	/** Replaces that action's label while busy, e.g. with upload progress. */
	busyLabel?: string;
}) {
	const { t } = useTranslation();
	const uploadInputRef = useRef<HTMLInputElement | null>(null);
	const cameraInputRef = useRef<HTMLInputElement | null>(null);
	const cameraVideoInputRef = useRef<HTMLInputElement | null>(null);
	// Which action the current upload came from, so its status shows there.
	const [usedKey, setUsedKey] = useState<string | null>(null);

	const onChange = (event: ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(event.target.files ?? []);
		event.target.value = "";
		if (files.length > 0) onFiles(files);
	};

	const actions: DrawerAddAction[] = [
		{ key: "photo", label: t("chat_drawer.take_photo"), icon: <CameraFilled className="h-4 w-4" />, input: cameraInputRef },
		...(allowVideo
			? [{ key: "video", label: t("chat_drawer.record_video", { defaultValue: "Record video" }), icon: <Video className="h-4 w-4 fill-current" />, input: cameraVideoInputRef }]
			: []),
		{ key: "upload", label: t("chat_drawer.add_media", { defaultValue: "Add media" }), icon: <CameraPlusFilled className="h-4 w-4" />, input: uploadInputRef },
	].map(({ key, label, icon, input }) => {
		const isBusyHere = busy && key === (usedKey ?? "upload");
		return {
			key,
			label: isBusyHere && busyLabel ? busyLabel : label,
			icon: isBusyHere ? <Loader2 className="h-4 w-4 animate-spin" /> : icon,
			onClick: () => {
				setUsedKey(key);
				input.current?.click();
			},
		};
	});

	const inputs = (
		<>
			<input type="file" ref={uploadInputRef} onChange={onChange} accept={allowVideo ? "image/*,video/*" : "image/*"} multiple={multiple} className="hidden" />
			<input type="file" ref={cameraInputRef} onChange={onChange} accept="image/*" capture="environment" className="hidden" />
			{allowVideo ? (
				<input type="file" ref={cameraVideoInputRef} onChange={onChange} accept="video/*" capture="environment" className="hidden" />
			) : null}
		</>
	);

	return { actions, inputs };
}

function DrawerPreviewGroupGrid({ group }: { group: DrawerPreviewGroup }) {
	const visible = group.items.slice(0, GROUP_PREVIEW_MAX);
	const hidden = group.items.length - visible.length;
	const columns = visible.length <= 1 ? 1 : visible.length <= 4 ? 2 : 3;
	return (
		<div className="w-[min(85vw,380px)] bg-[var(--surface)] p-2">
			<p className="truncate px-1 pb-2 text-sm font-semibold text-[var(--text)]">{group.title}</p>
			<div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
				{visible.map((item, index) => (
					<div key={`${item.src}-${index}`} className="relative aspect-square overflow-hidden rounded-md bg-black">
						{item.isVideo ? (
							<video
								src={proxyMediaUrl(item.src, { as: "video" })}
								preload="metadata"
								muted
								playsInline
								onLoadedMetadata={(e) => { e.currentTarget.currentTime = 0.001; }}
								className="h-full w-full object-cover"
							/>
						) : (
							<img src={proxyMediaUrl(item.src)} alt="" className="h-full w-full object-cover" />
						)}
						{/* Send order, like the numbers in the collection editor. */}
						<span className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[11px] font-bold text-[var(--accent-contrast)]">
							{index + 1}
						</span>
						{item.isVideo ? (
							<Play className="absolute bottom-1 left-1 h-3.5 w-3.5 fill-white text-white drop-shadow" />
						) : null}
						{hidden > 0 && index === visible.length - 1 ? (
							<div className="absolute inset-0 flex items-center justify-center bg-black/55 text-lg font-bold text-white">
								+{hidden}
							</div>
						) : null}
					</div>
				))}
			</div>
		</div>
	);
}
