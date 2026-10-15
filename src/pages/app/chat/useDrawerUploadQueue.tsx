import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { useApiFunctions } from "../../../hooks/useApiFunctions";
import { appLog } from "../../../utils/logger";
import { buildBinaryUpload, getVideoDurationSeconds } from "./chatUtils";
import { DrawerAddMediaStep } from "./DrawerAddMediaStep";
import { useDrawerAddActions } from "./drawerUi";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

type PreparedUpload = { file: File; takenOnGrindr: boolean; looping: boolean };

/**
 * Adding new media to the drawer from a sheet that picks drawer media
 * (collection editor, album "add from drawer"): the add actions, then each
 * picked file through the same add step as the chat drawer (crop, taken on
 * Grindr, looping), then one upload round. `onUploaded` gets the new drawer
 * ids after `onReloadMedia` has run.
 *
 * Render `inputs` once, `actions` as tiles/buttons, and `step` (when set)
 * in place of the sheet's content, with `stepTitle` and `stop` in its header.
 */
export function useDrawerUploadQueue({
	onReloadMedia,
	onUploaded,
	allowVideo = true,
}: {
	onReloadMedia: () => Promise<void>;
	onUploaded: (mediaIds: number[]) => void;
	allowVideo?: boolean;
}) {
	const { t } = useTranslation();
	const service = useApiFunctions();
	const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
	// Files still waiting for their add step, and the ones confirmed this round.
	const [pendingFiles, setPendingFiles] = useState<File[]>([]);
	const [pendingTotal, setPendingTotal] = useState(0);
	const preparedRef = useRef<PreparedUpload[]>([]);
	const pendingFile = pendingFiles[0] ?? null;
	const isUploading = uploadProgress != null;

	const uploadPrepared = useCallback(
		async (batch: PreparedUpload[]) => {
			const uploadedIds: number[] = [];
			setUploadProgress({ done: 0, total: batch.length });
			for (const [index, { file, takenOnGrindr, looping }] of batch.entries()) {
				const isVideo = file.type.startsWith("video/");
				if (file.size > MAX_UPLOAD_BYTES) {
					toast.error(t("chat.attachments.too_large"));
					setUploadProgress({ done: index + 1, total: batch.length });
					continue;
				}
				try {
					const durationSeconds = isVideo ? await getVideoDurationSeconds(file) : undefined;
					const uploaded = await service.uploadChatMedia({
						multipart: await buildBinaryUpload(file),
						options: {
							looping: isVideo ? looping : false,
							takenOnGrindr: isVideo ? false : takenOnGrindr,
							...(durationSeconds != null ? { durationSeconds } : {}),
						},
					});
					await service.addMediaToDrawer(uploaded.mediaId);
					uploadedIds.push(uploaded.mediaId);
				} catch (uploadError) {
					appLog.error("[useDrawerUploadQueue] upload failed", uploadError);
					toast.error(
						uploadError instanceof Error ? uploadError.message : t("chat.errors.upload_media_failed"),
					);
				}
				setUploadProgress({ done: index + 1, total: batch.length });
			}

			try {
				if (uploadedIds.length > 0) await onReloadMedia();
			} finally {
				if (uploadedIds.length > 0) onUploaded(uploadedIds);
				setUploadProgress(null);
			}
		},
		[service, onReloadMedia, onUploaded, t],
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

	// Moves to the next picked file; `prepared` is null when this one was
	// skipped. After the last one (or `stop`), everything confirmed uploads.
	const finishStep = useCallback(
		(prepared: PreparedUpload | null, stop = false) => {
			if (prepared) preparedRef.current.push(prepared);
			const rest = stop ? [] : pendingFiles.slice(1);
			setPendingFiles(rest);
			if (rest.length > 0) return;
			const batch = preparedRef.current;
			preparedRef.current = [];
			if (batch.length > 0) void uploadPrepared(batch);
		},
		[pendingFiles, uploadPrepared],
	);

	const { actions, inputs } = useDrawerAddActions({
		onFiles: pickFiles,
		multiple: true,
		allowVideo,
		busy: isUploading,
		busyLabel: uploadProgress ? `${uploadProgress.done}/${uploadProgress.total}` : undefined,
	});

	const stepIndex = pendingTotal - pendingFiles.length + 1;
	const stepTitle = pendingFile
		? `${pendingFile.type.startsWith("video/")
			? t("chat_drawer.add_video", { defaultValue: "Add video" })
			: t("chat_drawer.add_photo")}${pendingTotal > 1 ? ` (${stepIndex}/${pendingTotal})` : ""}`
		: null;
	const step = pendingFile ? (
		<DrawerAddMediaStep
			key={stepIndex}
			file={pendingFile}
			isAdding={false}
			onCancel={() => finishStep(null)}
			onConfirm={(file, takenOnGrindr, looping) => finishStep({ file, takenOnGrindr, looping })}
		/>
	) : null;

	return {
		actions,
		inputs,
		isUploading,
		step,
		stepTitle,
		/** Header X during the step: skips the rest, still uploads what was confirmed. */
		stop: () => finishStep(null, true),
	};
}
