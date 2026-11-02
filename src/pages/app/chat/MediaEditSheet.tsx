import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";

import { NATIVE_SHEET_BG } from "../../../components/ui/action-sheet";
import { BottomSheet, SheetStepBadge } from "../../../components/ui/bottom-sheet";
import { DrawerHeader } from "./drawerUi";
import { MediaEditStep, type MediaEdit } from "./MediaEditStep";
import { VideoFormatsButton } from "./VideoFormatsSheet";

/** A MediaEditStep's header title: what's being done to this file, and
 * where it is in a multi-file pick. */
export function MediaEditTitle({
	file,
	index,
	total,
	photoLabel,
	videoLabel,
}: {
	file: File;
	/** 1-based. */
	index: number;
	total: number;
	photoLabel: string;
	videoLabel: string;
}) {
	return (
		<span className="flex min-w-0 items-center gap-2">
			<span className="truncate">{file.type.startsWith("video/") ? videoLabel : photoLabel}</span>
			{total > 1 && <SheetStepBadge index={index} total={total} />}
		</span>
	);
}

/**
 * Picked photos and videos, edited one after another in one sheet (see
 * MediaEditStep) before they're sent or uploaded — the chat's attachments
 * and the album editor's uploads. Each confirmed file goes to
 * `onConfirmFile`; `onDone(true)` follows once the last one was confirmed
 * and the sheet closed, `onDone(false)` when it was closed before — the
 * whole pick is cancelled then, the files confirmed so far included.
 */
export function MediaEditSheet({
	files,
	photoLabel,
	videoLabel,
	confirmLabel,
	confirmIcon,
	headerActions,
	footerLeft,
	maxVideoMs,
	showTakenOnGrindr,
	showLooping,
	thumbnailStep,
	isDesktop,
	zIndex,
	onFileShown,
	onConfirmFile,
	onDone,
}: {
	files: File[];
	/** Title for a photo / a video. */
	photoLabel: string;
	videoLabel: string;
	confirmLabel: string;
	confirmIcon?: ReactNode;
	/** More header controls for the current file, left of the video formats info. */
	headerActions?: (file: File) => ReactNode;
	footerLeft?: (file: File) => ReactNode;
	maxVideoMs?: number;
	showTakenOnGrindr?: boolean;
	showLooping?: boolean;
	/** See MediaEditStep's thumbnailStep. */
	thumbnailStep?: ComponentProps<typeof MediaEditStep>["thumbnailStep"];
	isDesktop: boolean;
	zIndex?: string;
	/** Each file as it comes up, before it's painted — for per-file options
	 * the caller keeps (e.g. the chat's expiry). */
	onFileShown?: (file: File) => void;
	onConfirmFile: (edit: MediaEdit) => void;
	onDone: (confirmed: boolean) => void;
}) {
	const [index, setIndex] = useState(0);
	// The step is picking a photo's thumbnail (see thumbnailStep): its title then.
	const [isThumbnailPhase, setIsThumbnailPhase] = useState(false);
	const confirmedRef = useRef(false);
	const closeRef = useRef<(() => void) | null>(null);
	const file = files[index];
	const isVideo = file.type.startsWith("video/");
	const hasNext = index + 1 < files.length;

	const onFileShownRef = useRef(onFileShown);
	onFileShownRef.current = onFileShown;
	useLayoutEffect(() => {
		onFileShownRef.current?.(file);
	}, [file]);

	const confirm = (edit: MediaEdit) => {
		onConfirmFile(edit);
		if (hasNext) {
			setIndex(index + 1);
			return;
		}
		confirmedRef.current = true;
		closeRef.current?.();
	};

	return (
		<BottomSheet
			onClose={() => onDone(confirmedRef.current)}
			closeRef={closeRef}
			isDesktop={isDesktop}
			bg={NATIVE_SHEET_BG}
			zIndex={zIndex}
			panelClassName="px-4"
		>
			<DrawerHeader
				title={
					<MediaEditTitle
						file={file}
						index={index + 1}
						total={files.length}
						photoLabel={isThumbnailPhase && thumbnailStep ? thumbnailStep.title : photoLabel}
						videoLabel={videoLabel}
					/>
				}
				actions={
					<>
						{headerActions?.(file)}
						{isVideo && <VideoFormatsButton isDesktop={isDesktop} />}
					</>
				}
			/>
			<MediaEditStep
				file={file}
				hasNext={hasNext}
				confirmLabel={confirmLabel}
				confirmIcon={confirmIcon}
				footerLeft={footerLeft?.(file)}
				maxVideoMs={maxVideoMs}
				showTakenOnGrindr={showTakenOnGrindr}
				showLooping={showLooping}
				thumbnailStep={thumbnailStep}
				onThumbnailPhase={setIsThumbnailPhase}
				onConfirm={confirm}
			/>
		</BottomSheet>
	);
}
