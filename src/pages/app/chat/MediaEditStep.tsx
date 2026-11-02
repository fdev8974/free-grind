import { Plus, RotateCw, SquareCenterlineDashedHorizontal, Repeat } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import ReactCrop, { centerCrop, makeAspectCrop, type Crop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { sheetButtonClass } from "../../../components/ui/bottom-sheet";
import { DrawerFooter, MediaToolButton, MediaToolDivider, TakenOnGrindrToolIcon } from "./drawerUi";
import { exportEditedImage } from "./editedImage";
import { TakenOnGrindrBadge } from "./TakenOnGrindrBadge";
import { VideoTrimmer } from "./VideoTrimmer";

/** A region of a photo, as fractions (0–1) of its width and height. */
export type ThumbnailCrop = { left: number; top: number; right: number; bottom: number };

/** What a confirmed MediaEditStep hands on: the edited file and its toggles,
 * with `thumbnailStep` the square picked for the thumbnail, and for a video
 * split into parts (see VideoTrimmer's onSplit) the parts, to go out in
 * order in place of `file` (see mediaEditFiles). */
export type MediaEdit = {
	file: File;
	takenOnGrindr: boolean;
	looping: boolean;
	thumbnail?: ThumbnailCrop;
	segments?: File[];
};

/** A confirmed edit as the files it goes out as: its parts when split, else itself. */
export function mediaEditFiles(edit: MediaEdit): MediaEdit[] {
	return edit.segments?.map((segment) => ({ ...edit, file: segment, segments: undefined })) ?? [edit];
}

/**
 * The edit step every picked photo or video goes through before it's sent
 * or uploaded — in the chat, the media drawers and the album editor:
 * crop/flip/rotate and "taken on Grindr" for photos, the trimmer and
 * looping for videos. Lives in a `px-4` sheet panel, below its header; the
 * footer holds the confirm button. Stays mounted from one picked file to
 * the next (see MediaEditSheet), so the sheet keeps its height.
 */
export function MediaEditStep({
	file,
	hasNext = false,
	confirmLabel,
	confirmIcon = <Plus className="h-4 w-4" />,
	footerLeft,
	maxVideoMs,
	showTakenOnGrindr = true,
	showLooping = true,
	allowVideoSplit = true,
	thumbnailStep,
	onThumbnailPhase,
	onConfirm,
}: {
	file: File;
	/** More picked files follow: confirming only moves on, nothing is added yet. */
	hasNext?: boolean;
	/** The last file's confirm button, "Add to drawer" by default. */
	confirmLabel?: string;
	/** Beside the last file's label; "Next" goes without. */
	confirmIcon?: ReactNode;
	/** Controls left of the confirm button (e.g. the chat's expiry). */
	footerLeft?: ReactNode;
	/** The trimmer's limit, see VideoTrimmer's maxMs. */
	maxVideoMs?: number;
	showTakenOnGrindr?: boolean;
	showLooping?: boolean;
	/** A video over the limit can be split into parts (see MediaEdit's segments). */
	allowVideoSplit?: boolean;
	/**
	 * Photos get a second step after the edit (profile photos): a square
	 * picked on the edited photo for the server-rendered thumbnail, handed
	 * on as `thumbnail`. The edit looks as everywhere else; the thumbnail
	 * step gets `title` as the sheet's title (see onThumbnailPhase).
	 */
	thumbnailStep?: { title: string; backLabel: string };
	/** Whether the thumbnail step is shown, for the sheet's title; reported before it's painted. */
	onThumbnailPhase?: (active: boolean) => void;
	onConfirm: (edit: MediaEdit) => void | Promise<void>;
}) {
	const { t } = useTranslation();
	const isVideo = file.type.startsWith("video/");
	const [takenOnGrindr, setTakenOnGrindr] = useState(false);
	const [looping, setLooping] = useState(false);
	// The video's parts while it's split in the trimmer.
	const [segments, setSegments] = useState<File[] | null>(null);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [crop, setCrop] = useState<Crop | undefined>(undefined);
	const [isDraggingCrop, setIsDraggingCrop] = useState(false);
	const [completedCrop, setCompletedCrop] = useState<PixelCrop | undefined>(undefined);
	// Flipped or rotated: the preview differs from `file` even uncropped.
	const [transformed, setTransformed] = useState(false);
	const imgRef = useRef<HTMLImageElement | null>(null);
	// The file previewUrl was made from — when the step moves on to the next
	// picked file, the old URL is already revoked.
	const [previewFile, setPreviewFile] = useState<File | null>(null);
	// The edited photo, once the edit is confirmed with `thumbnailStep`: the
	// step then shows it to pick the thumbnail on.
	const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
	const isThumbnailPhase = thumbnailFile != null;
	const shownFile = thumbnailFile ?? file;
	const onThumbnailPhaseRef = useRef(onThumbnailPhase);
	onThumbnailPhaseRef.current = onThumbnailPhase;
	useLayoutEffect(() => {
		onThumbnailPhaseRef.current?.(isThumbnailPhase);
	}, [isThumbnailPhase]);

	// Moving on to the next picked file, its image or video has no size until
	// it loaded — the step keeps its last height until then instead of the
	// sheet shrinking and growing back.
	const contentHeightRef = useRef(0);
	const contentObserverRef = useRef<ResizeObserver | null>(null);
	const contentRef = useCallback((node: HTMLDivElement | null) => {
		contentObserverRef.current?.disconnect();
		contentObserverRef.current = null;
		if (!node) return;
		const observer = new ResizeObserver(() => {
			contentHeightRef.current = node.offsetHeight;
		});
		observer.observe(node);
		contentObserverRef.current = observer;
	}, []);
	const [swapMinHeight, setSwapMinHeight] = useState<number | null>(null);
	const releaseSwapHeight = useCallback(() => setSwapMinHeight(null), []);
	const previousFileRef = useRef<File | null>(null);

	useEffect(() => {
		if (swapMinHeight == null) return;
		// In case the next file never reports itself loaded (e.g. a broken image).
		const timer = setTimeout(releaseSwapHeight, 2500);
		return () => clearTimeout(timer);
	}, [swapMinHeight, releaseSwapHeight]);

	// A new file starts over: toggles off, back at the edit.
	useLayoutEffect(() => {
		setThumbnailFile(null);
		setTakenOnGrindr(false);
		setLooping(false);
		setSegments(null);
	}, [file]);

	// A new preview (next file, or the thumbnail step's edited photo): fresh
	// crop, nothing turned. Layout effect, so the swap never paints the step
	// without its preview. Also on every switch between edit and thumbnail:
	// an untouched edit hands on `file` itself, so the shown file stays the
	// same, but the thumbnail's square mustn't become the edit's crop.
	useLayoutEffect(() => {
		const isSwap = previousFileRef.current != null;
		previousFileRef.current = shownFile;
		// The observer hasn't seen this commit yet, so this is the old file's height.
		setSwapMinHeight(isSwap && contentHeightRef.current > 0 ? contentHeightRef.current : null);
		setPreviewFile(shownFile);
		const url = URL.createObjectURL(shownFile);
		setPreviewUrl(url);
		setCrop(undefined);
		setCompletedCrop(undefined);
		setTransformed(false);
		return () => URL.revokeObjectURL(url);
	}, [shownFile, isThumbnailPhase]);

	// The edit starts on the whole image; the thumbnail's square is seeded
	// once the image has its size (see onImageLoad).
	useEffect(() => {
		if (!previewUrl || isThumbnailPhase) return;
		setCrop({ unit: "%", x: 0, y: 0, width: 100, height: 100 });
	}, [previewUrl, isThumbnailPhase]);

	const onImageLoad = useCallback(
		(event: SyntheticEvent<HTMLImageElement>) => {
			releaseSwapHeight();
			if (!isThumbnailPhase) return;
			// Square only — the server always renders thumbnails as squares. Sets
			// completedCrop too: react-image-crop only reports one after a drag.
			const { width, height } = event.currentTarget;
			const square = centerCrop(makeAspectCrop({ unit: "%", width: 90 }, 1, width, height), width, height);
			setCrop(square);
			setCompletedCrop({
				unit: "px",
				x: (square.x / 100) * width,
				y: (square.y / 100) * height,
				width: (square.width / 100) * width,
				height: (square.height / 100) * height,
			});
		},
		[isThumbnailPhase, releaseSwapHeight],
	);

	const applyTransform = useCallback(async (type: "flipH" | "rotateCw") => {
		const img = imgRef.current;
		if (!img || !img.complete || img.naturalWidth === 0) return;
		const sw = img.naturalWidth;
		const sh = img.naturalHeight;
		const canvas = document.createElement("canvas");
		canvas.width = type === "rotateCw" ? sh : sw;
		canvas.height = type === "rotateCw" ? sw : sh;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.translate(canvas.width / 2, canvas.height / 2);
		if (type === "flipH") ctx.scale(-1, 1);
		if (type === "rotateCw") ctx.rotate(Math.PI / 2);
		ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, "image/jpeg", 0.95),
		);
		if (!blob) return;
		// The crop is reset to the whole turned image (see the previewUrl
		// effect); the old one's pixels no longer fit it.
		setCompletedCrop(undefined);
		setTransformed(true);
		setPreviewUrl((prev) => {
			if (prev) URL.revokeObjectURL(prev);
			return URL.createObjectURL(blob);
		});
	}, []);

	const confirm = useCallback(async () => {
		if (isVideo) {
			await onConfirm({ file, takenOnGrindr: false, looping, ...(segments ? { segments } : {}) });
			return;
		}
		if (thumbnailFile) {
			const img = imgRef.current;
			const thumbnail = completedCrop?.width && completedCrop.height && img
				? {
						left: completedCrop.x / img.width,
						top: completedCrop.y / img.height,
						right: (completedCrop.x + completedCrop.width) / img.width,
						bottom: (completedCrop.y + completedCrop.height) / img.height,
					}
				: undefined;
			await onConfirm({ file: thumbnailFile, takenOnGrindr, looping: false, thumbnail });
			return;
		}
		const edited = await exportEditedImage(imgRef.current, file, completedCrop, transformed);
		if (thumbnailStep) {
			setThumbnailFile(edited);
			return;
		}
		await onConfirm({ file: edited, takenOnGrindr, looping: false });
	}, [file, thumbnailFile, thumbnailStep, completedCrop, transformed, onConfirm, isVideo, takenOnGrindr, looping, segments]);

	// Confirming only moves on: to the next picked file, or to the thumbnail.
	const goesOn = hasNext || (!!thumbnailStep && !isVideo && !isThumbnailPhase);

	return (
		<>
			{/* Scrolls on behind the floating footer, which pads this wrapper (not the options card). */}
			<div
				ref={contentRef}
				className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4"
				style={swapMinHeight != null ? { minHeight: swapMinHeight } : undefined}
				data-lenis-prevent
			>
			{/* Unmounted for the render that switches files, so the trimmer and
			    crop start fresh for the next one. */}
			{previewUrl && previewFile === shownFile && isVideo && (
				<div className="flex min-h-full flex-col">
					<VideoTrimmer
						file={file}
						src={previewUrl}
						previewHeight="45dvh"
						maxMs={maxVideoMs}
						onReady={releaseSwapHeight}
						onSplit={allowVideoSplit ? setSegments : undefined}
						tools={showLooping ? (
							<MediaToolButton
								icon={<Repeat />}
								label={t("chat.attachments.looping")}
								active={looping}
								onClick={() => setLooping((value) => !value)}
							/>
						) : undefined}
					/>
				</div>
			)}
			{previewUrl && previewFile === shownFile && !isVideo && (
				// Laid out like VideoTrimmer's root, so the tool row keeps the
				// same spacing as under a video.
				<div className="flex min-h-full flex-col gap-3">
				<div className="flex justify-center">
					<style>{`
						.drawer-crop .ReactCrop__crop-mask { display: none !important; }
						.drawer-crop .ReactCrop__crop-selection {
							background-image: none !important;
							animation: none !important;
							outline: none !important;
							border: 3px solid rgba(255,255,255,0.6) !important;
							border-radius: 20px !important;
							box-shadow: 0 0 0 9999px rgba(0,0,0,0.5) !important;
						}
						.drawer-crop .ReactCrop__drag-handle.ord-n, .drawer-crop .ReactCrop__drag-handle.ord-s, .drawer-crop .ReactCrop__drag-handle.ord-e, .drawer-crop .ReactCrop__drag-handle.ord-w { display: none !important; }

						.drawer-crop .ReactCrop__drag-handle {
							background: transparent !important;
							border: none !important;
							width: 18px !important;
							height: 18px !important;
						}
						.drawer-crop .ord-nw { transform: none !important; top: 6px !important; left: 6px !important; border-top: 2px solid white !important; border-left: 2px solid white !important; border-top-left-radius: 11px !important; }
						.drawer-crop .ord-ne { transform: none !important; top: 6px !important; right: 6px !important; border-top: 2px solid white !important; border-right: 2px solid white !important; border-top-right-radius: 11px !important; }
						.drawer-crop .ord-sw { transform: none !important; bottom: 6px !important; left: 6px !important; border-bottom: 2px solid white !important; border-left: 2px solid white !important; border-bottom-left-radius: 11px !important; }
						.drawer-crop .ord-se { transform: none !important; bottom: 6px !important; right: 6px !important; border-bottom: 2px solid white !important; border-right: 2px solid white !important; border-bottom-right-radius: 11px !important; }
						.drawer-crop .ReactCrop__drag-handle::after { content: ""; position: absolute; inset: -16px; } /* grabbable well beyond the drawn corner */
						/* The straight edges resize too, through invisible bars (none for a fixed aspect, where only corners can). */
						.drawer-crop { --rc-drag-bar-size: 24px; }
						.drawer-crop:not(.ReactCrop--fixed-aspect) .ReactCrop__drag-bar { display: block !important; }
						.drawer-crop .ord-nw, .drawer-crop .ord-se { cursor: nwse-resize !important; }
						.drawer-crop .ord-ne, .drawer-crop .ord-sw { cursor: nesw-resize !important; }
						.drawer-crop .ReactCrop__drag-bar.ord-n, .drawer-crop .ReactCrop__drag-bar.ord-s { cursor: ns-resize !important; }
						.drawer-crop .ReactCrop__drag-bar.ord-e, .drawer-crop .ReactCrop__drag-bar.ord-w { cursor: ew-resize !important; }

						@keyframes logo-shine {
							0%, 100% { filter: drop-shadow(0 0 2px rgba(255,140,0,0.3)) brightness(1); }
							50% { filter: drop-shadow(0 0 7px rgba(255,140,0,0.95)) brightness(1.25); }
						}
						.logo-shine { animation: logo-shine 2.8s ease-in-out infinite; }
					`}</style>
					<div data-sheet-no-drag className="relative overflow-hidden rounded-[20px]">
					<ReactCrop
						// A fresh one for the thumbnail's square, which is fixed in aspect.
						key={isThumbnailPhase ? "thumbnail" : "edit"}
						crop={crop}
						aspect={isThumbnailPhase ? 1 : undefined}
						onChange={(c) => {
							setIsDraggingCrop(true);
							setCrop(c);
						}}
						onComplete={(c) => {
							setIsDraggingCrop(false);
							setCompletedCrop(c);
						}}
						ruleOfThirds={isDraggingCrop}
						minWidth={150}
						minHeight={150}
						className="drawer-crop ReactCrop--no-animate"
						style={{ maxHeight: "50dvh", display: "block" }}
					>
						<img
							ref={imgRef}
							src={previewUrl}
							alt={t("common.preview")}
							className="block"
							style={{ maxHeight: "50dvh" }}
							onLoad={onImageLoad}
							onError={releaseSwapHeight}
						/>
					</ReactCrop>
					{takenOnGrindr && crop && (
						<div
							className="absolute inline-flex items-center gap-1.5 pointer-events-none"
							style={{
								left: `calc(${crop.unit === "%" ? crop.x + "%" : crop.x + "px"} + 10px)`,
								top: `calc(${crop.unit === "%" ? (crop.y + crop.height) + "%" : (crop.y + crop.height) + "px"} - 10px)`,
								transform: "translateY(-100%)",
							}}
						>
							<TakenOnGrindrBadge label={t("chat.time.just_now", { defaultValue: "just now" })} />
						</div>
					)}
				</div>
				</div>
				{/* None for the thumbnail: it's only picked, on the photo as edited
				    (taken on Grindr was set then, its badge still shows). */}
				{!isThumbnailPhase && (
					<div className="my-auto flex items-center justify-center gap-3 pt-2">
						<MediaToolButton icon={<SquareCenterlineDashedHorizontal />} label="Flip horizontal" onClick={() => void applyTransform("flipH")} />
						<MediaToolButton icon={<RotateCw />} label="Rotate clockwise" onClick={() => void applyTransform("rotateCw")} />
						{showTakenOnGrindr && (
							<>
								<MediaToolDivider />
								<MediaToolButton
									icon={<TakenOnGrindrToolIcon active={takenOnGrindr} />}
									label={t("chat.attachments.taken_on_grindr")}
									active={takenOnGrindr}
									onClick={() => setTakenOnGrindr((value) => !value)}
								/>
							</>
						)}
					</div>
				)}
				</div>
			)}
			</div>
			<DrawerFooter>
				{isThumbnailPhase && thumbnailStep ? (
					<button type="button" onClick={() => setThumbnailFile(null)} className={sheetButtonClass("secondary")}>
						{thumbnailStep.backLabel}
					</button>
				) : footerLeft}
				<button type="button" onClick={() => void confirm()} className={sheetButtonClass()}>
					{goesOn ? null : confirmIcon}
					<span className="truncate">
						{goesOn
							? t("chat.attachments.next", { defaultValue: "Next" })
							: confirmLabel ?? t("chat_drawer.add_to_drawer")}
					</span>
				</button>
			</DrawerFooter>
		</>
	);
}
