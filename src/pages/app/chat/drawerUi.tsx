import { useCallback, useEffect, useRef, useState, type ChangeEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Check, Image as ImageIcon, Loader2, Play, RefreshCw, Video, X } from "lucide-react";
import { CameraFilled, CameraPlusFilled } from "../../../components/icons/FilledIcons";
import { SheetClose } from "../../../components/ui/bottom-sheet";
import { haptic } from "../../../utils/haptics";
import freegrindLogo from "../../../images/freegrind-logo.webp";

// Shared building blocks for every media drawer sheet (chat drawer, collection
// editor, album "add from drawer", profile pictures), so they stay in sync:
// change the look here, not in each sheet.

export const drawerGridClass = (isDesktop: boolean) =>
	`grid gap-0.5 ${isDesktop ? "grid-cols-4" : "grid-cols-3"}`;

export const DRAWER_TILE_CLASS = "relative aspect-square overflow-hidden rounded-md";

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
			className={`flex items-center rounded-2xl bg-[var(--surface-2)] text-[var(--text)] transition active:scale-95 hover:bg-[color-mix(in_srgb,var(--surface-2)_80%,var(--text)_8%)] disabled:pointer-events-none disabled:opacity-40 ${
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

/** Capture/upload action as a tile at the start of a media grid, same size as the media tiles. */
export function DrawerActionTile({ icon, label, onClick, disabled }: Omit<DrawerActionButtonProps, "layout">) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`${DRAWER_TILE_CLASS} flex flex-col items-center justify-center gap-2 border border-[var(--border)] bg-[var(--surface-2)] px-1.5 text-[var(--accent-readable)] transition active:scale-95 hover:bg-[color-mix(in_srgb,var(--surface-2)_80%,var(--text)_8%)] disabled:pointer-events-none disabled:opacity-40`}
		>
			{/* Icon sized here rather than by the caller, so the tile doesn't depend on the icon's own classes. */}
			<span className="flex shrink-0 items-center justify-center [&_svg]:h-6 [&_svg]:w-6">{icon}</span>
			<span className="line-clamp-2 max-w-full text-center text-[10.5px] font-medium leading-snug text-[var(--text-muted)]">{label}</span>
		</button>
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
	const tileClass = "absolute inset-0 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] shadow-sm";
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

export type DrawerPreviewMedia = { src: string; isVideo: boolean };
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

	const cancelTimer = useCallback(() => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	const end = useCallback(() => {
		cancelTimer();
		startRef.current = null;
		setPreview(null);
	}, [cancelTimer]);

	useEffect(() => cancelTimer, [cancelTimer]);

	const bind = useCallback(
		(media: DrawerPreviewContent) => ({
			onPointerDown: (event: PointerEvent<HTMLElement>) => {
				if (event.pointerType === "mouse" && event.button !== 0) return;
				suppressClickRef.current = false;
				startRef.current = { x: event.clientX, y: event.clientY };
				cancelTimer();
				timerRef.current = setTimeout(() => {
					timerRef.current = null;
					suppressClickRef.current = true;
					haptic(20);
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
		[cancelTimer, end],
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

export function DrawerMediaPreview({ media }: { media: DrawerPreviewContent | null }) {
	// Keep the last media mounted while it animates out, then drop it.
	const [shown, setShown] = useState<DrawerPreviewContent | null>(media);
	const [isVisible, setIsVisible] = useState(false);

	useEffect(() => {
		if (media) {
			setShown(media);
			// Two frames so the hidden start state is painted before transitioning in.
			let inner = 0;
			const outer = requestAnimationFrame(() => {
				inner = requestAnimationFrame(() => setIsVisible(true));
			});
			return () => {
				cancelAnimationFrame(outer);
				cancelAnimationFrame(inner);
			};
		}
		setIsVisible(false);
		const timer = setTimeout(() => setShown(null), PREVIEW_ANIMATION_MS);
		return () => clearTimeout(timer);
	}, [media]);

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
					<video src={shown.src} autoPlay muted loop playsInline className="max-h-[80dvh] max-w-full object-contain" />
				) : (
					<img src={shown.src} alt="" className="max-h-[80dvh] max-w-full object-contain" />
				)}
			</div>
		</div>,
		document.body,
	);
}

export const DRAWER_ICON_BUTTON_CLASS =
	"inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]";

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
	return (
		<div className={`flex items-center justify-between ${className}`}>
			<h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
			<div className="flex items-center gap-1">
				{actions}
				{onClose ? (
					<button type="button" onClick={onClose} className={DRAWER_ICON_BUTTON_CLASS}>
						<X className="h-4 w-4" />
					</button>
				) : (
					<SheetClose className={DRAWER_ICON_BUTTON_CLASS}>
						<X className="h-4 w-4" />
					</SheetClose>
				)}
			</div>
		</div>
	);
}

/** Scrollable drawer content with the shared loading, error (with retry) and
 * empty states; renders `children` (usually a DrawerGrid) otherwise. */
export function DrawerBody({
	isLoading,
	error,
	onRetry,
	retryLabel,
	empty,
	className = "max-h-[60vh]",
	children,
}: {
	isLoading?: boolean;
	error?: string | null;
	onRetry?: () => void;
	retryLabel?: string;
	/** Shown instead of `children` when set. */
	empty?: ReactNode;
	className?: string;
	children?: ReactNode;
}) {
	const { t } = useTranslation();
	let content: ReactNode;
	if (isLoading) {
		content = (
			<div className="flex h-full items-center justify-center py-8">
				<Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" />
			</div>
		);
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
		<div data-lenis-prevent className={`min-h-0 flex-1 overflow-y-auto ${className}`}>
			{content}
		</div>
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
	onSelect?: () => void;
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
	const select = () => {
		if (consumePreviewClick?.()) return;
		onSelect?.();
	};
	return (
		<div
			role="button"
			tabIndex={onSelect && !muted ? 0 : -1}
			{...previewProps}
			onClick={select}
			onKeyDown={(e) => { if (e.key === "Enter") onSelect?.(); }}
			className={`${DRAWER_TILE_CLASS} no-touch-callout transition ${onSelect ? "cursor-pointer" : "cursor-default"} ${busy ? "opacity-60" : ""} ${muted ? "pointer-events-none opacity-30" : ""}`}
			style={{ outline: selected ? "2px solid var(--accent)" : "none", outlineOffset: "-2px" }}
		>
			{isVideo ? (
				<>
					<video
						src={src}
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
				<img src={src} alt={alt ?? ""} draggable={false} className={`h-full w-full object-cover ${mediaClassName}`} />
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
			className={`absolute top-0.5 z-[1] inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80 disabled:opacity-60 ${corner === "left" ? "left-0.5" : "right-0.5"}`}
			aria-label={label}
			title={label}
		>
			{icon}
		</button>
	);
}

/** Bottom bar for the sheet's main action(s), separated by a full-width rule. */
export function DrawerFooter({ children }: { children: ReactNode }) {
	return <div className="mt-3 -mx-4 flex gap-2 border-t border-[var(--border)] px-4 pt-3">{children}</div>;
}

export const DRAWER_PRIMARY_BUTTON_CLASS =
	"inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)] transition hover:brightness-110 disabled:opacity-60";

export type DrawerAddAction = { key: string; label: string; icon: ReactNode; onClick: () => void };

/**
 * The drawer's add actions (take photo, record video, upload from device):
 * render `inputs` once in the sheet and `actions` as DrawerActionTile /
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
								src={item.src}
								preload="metadata"
								muted
								playsInline
								onLoadedMetadata={(e) => { e.currentTarget.currentTime = 0.001; }}
								className="h-full w-full object-cover"
							/>
						) : (
							<img src={item.src} alt="" className="h-full w-full object-cover" />
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
