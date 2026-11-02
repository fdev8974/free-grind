import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { useApiFunctions } from "../../../hooks/useApiFunctions";
import { appLog } from "../../../utils/logger";
import { uploadChatVideo } from "../../../services/chatMediaSend";
import { MAX_CHAT_MEDIA_BYTES } from "../../../services/stagedVideoUpload";
import { buildBinaryUpload } from "./chatUtils";
import { useDrawerAddActions } from "./drawerUi";
import { MediaEditTitle } from "./MediaEditSheet";
import { MediaEditStep, type MediaEdit } from "./MediaEditStep";
import { useUploadTiles } from "./useUploadTiles";

type PreparedUpload = MediaEdit;

/**
 * Adding new media to the drawer from a sheet that picks drawer media
 * (collection editor, album "add from drawer"): the add actions, then each
 * picked file through the same add step as the chat drawer (crop, taken on
 * Grindr, looping), then one upload round. `onUploaded` gets the new drawer
 * media after `onReloadMedia` has run.
 *
 * Render `inputs` once, `actions` as tiles/buttons, `uploadTiles` right
 * after them in the grid, and `step` (when set) in place of the sheet's
 * content, with `stepTitle` and `stop` in its header.
 */
export function useDrawerUploadQueue({
	onReloadMedia,
	onUploaded,
	allowVideo = true,
}: {
	onReloadMedia: () => Promise<void>;
	onUploaded: (uploaded: { mediaId: number; isVideo: boolean }[]) => void;
	allowVideo?: boolean;
}) {
	const { t } = useTranslation();
	const service = useApiFunctions();
	const uploadTiles = useUploadTiles();
	const { add: addUploadTiles, track: trackUpload, drop: dropUploadTiles } = uploadTiles;
	// Files still waiting for their add step, and the ones confirmed this round.
	const [pendingFiles, setPendingFiles] = useState<File[]>([]);
	const [pendingTotal, setPendingTotal] = useState(0);
	const preparedRef = useRef<PreparedUpload[]>([]);
	const pendingFile = pendingFiles[0] ?? null;

	const uploadPrepared = useCallback(
		async (batch: PreparedUpload[]) => {
			const uploadedMedia: { mediaId: number; isVideo: boolean }[] = [];
			const ids = addUploadTiles(batch.map(({ file }) => file));
			for (const [index, { file, takenOnGrindr, looping }] of batch.entries()) {
				const id = ids[index];
				const isVideo = file.type.startsWith("video/");
				// Videos are checked Rust-side, after the cut that may shrink them.
				if (!isVideo && file.size > MAX_CHAT_MEDIA_BYTES) {
					toast.error(t("chat.attachments.too_large"));
					dropUploadTiles([id]);
					continue;
				}
				try {
					const uploaded = await trackUpload(id, isVideo, async (onProgress) =>
						isVideo
							? uploadChatVideo(service, file, looping, onProgress)
							: service.uploadChatMedia({
									multipart: await buildBinaryUpload(file),
									options: { looping: false, takenOnGrindr },
								}),
					);
					await service.addMediaToDrawer(uploaded.mediaId);
					uploadedMedia.push({ mediaId: uploaded.mediaId, isVideo });
				} catch (uploadError) {
					appLog.error("[useDrawerUploadQueue] upload failed", uploadError);
					toast.error(
						uploadError instanceof Error ? uploadError.message : t("chat.errors.upload_media_failed"),
					);
					dropUploadTiles([id]);
				}
			}

			try {
				if (uploadedMedia.length > 0) await onReloadMedia();
			} finally {
				if (uploadedMedia.length > 0) onUploaded(uploadedMedia);
				dropUploadTiles(ids);
			}
		},
		[service, onReloadMedia, onUploaded, t, addUploadTiles, trackUpload, dropUploadTiles],
	);

	const pickFiles = useCallback(
		(files: File[]) => {
			const valid = files.filter((file) =>
				file.type.startsWith("image/") || (allowVideo && file.type.startsWith("video/")),
			);
			if (valid.length < files.length) {
				toast.error(t("chat_drawer.invalid_file_type"));
			}
			if (valid.length === 0) return;
			preparedRef.current = [];
			setPendingFiles(valid);
			setPendingTotal(valid.length);
		},
		[allowVideo, t],
	);

	// Moves to the next picked file. After the last one, everything confirmed uploads.
	const finishStep = useCallback(
		(prepared: PreparedUpload) => {
			preparedRef.current.push(prepared);
			const rest = pendingFiles.slice(1);
			setPendingFiles(rest);
			if (rest.length > 0) return;
			const batch = preparedRef.current;
			preparedRef.current = [];
			if (batch.length > 0) void uploadPrepared(batch);
		},
		[pendingFiles, uploadPrepared],
	);

	// Cancelling mid-pick drops the whole pick — the files confirmed so far
	// aren't uploaded either.
	const cancelSteps = useCallback(() => {
		preparedRef.current = [];
		setPendingFiles([]);
	}, []);

	const { actions, inputs } = useDrawerAddActions({
		onFiles: pickFiles,
		multiple: true,
		allowVideo,
	});

	const stepIndex = pendingTotal - pendingFiles.length + 1;
	const stepTitle = pendingFile ? (
		<MediaEditTitle
			file={pendingFile}
			index={stepIndex}
			total={pendingTotal}
			photoLabel={t("chat_drawer.add_photo")}
			videoLabel={t("chat_drawer.add_video", { defaultValue: "Add video" })}
		/>
	) : null;
	const step = pendingFile ? (
		// Not keyed per file: the step stays mounted and swaps its preview, so
		// the sheet keeps its height from one picked file to the next.
		<MediaEditStep file={pendingFile} hasNext={stepIndex < pendingTotal} onConfirm={finishStep} />
	) : null;

	return {
		actions,
		inputs,
		isUploading: uploadTiles.isUploading,
		/** Placeholder tiles of the running upload round, with their progress. */
		uploadTiles: uploadTiles.tiles,
		step,
		stepTitle,
		/** Header X during the step: cancels the pick, nothing is uploaded. */
		stop: cancelSteps,
	};
}
