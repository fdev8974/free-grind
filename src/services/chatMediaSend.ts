/**
 * chatMediaSend.ts — the network half of sending a picture/video into a chat:
 * upload once, then send it as a message to one or more recipients. Shared by
 * ChatPage's attachment dialog (which layers its optimistic thread UI on top)
 * and the share sheet's "Send to…" picker, which sends without a chat open.
 *
 * An uploaded mediaId can be sent any number of times (drawer media relies on
 * the same), so sending one image to several chats uploads it only once.
 */

import type { createApiFunctions } from "./apiFunctions";
import { fetchAndStoreMedia } from "./mediaStore";
import { buildBinaryUpload, extractImageHashFromSignedUrl, getMediaCaptureTarget, videoMessageViews } from "../pages/app/chat/chatUtils";
import type { Message } from "../types/messages";
import type { UploadChatMediaResponse } from "../types/chat-service";

type ApiFunctions = ReturnType<typeof createApiFunctions>;

export const MAX_CHAT_MEDIA_BYTES = 12 * 1024 * 1024;
/** maxViews meaning "no limit" — the attachment dialog's default. */
export const UNLIMITED_VIEWS = 2147483647;

export type UploadedChatMedia = UploadChatMediaResponse & { isVideo: boolean };

export async function uploadChatMediaFile(
	api: Pick<ApiFunctions, "uploadChatMedia">,
	file: File,
	options: { looping: boolean; takenOnGrindr: boolean },
): Promise<UploadedChatMedia> {
	const isVideo = file.type.startsWith("video/");
	let durationSeconds: number | undefined;
	if (isVideo) {
		durationSeconds = await new Promise<number>((resolve) => {
			const video = document.createElement("video");
			video.preload = "metadata";
			const objectUrl = URL.createObjectURL(file);
			video.onloadedmetadata = () => {
				URL.revokeObjectURL(objectUrl);
				resolve(Math.ceil(video.duration));
			};
			video.onerror = () => {
				URL.revokeObjectURL(objectUrl);
				resolve(0);
			};
			video.src = objectUrl;
		});
	}
	const uploaded = await api.uploadChatMedia({
		multipart: await buildBinaryUpload(file),
		options: { looping: options.looping, takenOnGrindr: options.takenOnGrindr, durationSeconds },
	});
	return { ...uploaded, isVideo };
}

/**
 * Sends already-uploaded media to `targetProfileId` and captures it into
 * chatDb right away — otherwise the send has no media_files row until the
 * next reload, so it's missing from the "Sent" media tab and the full-screen
 * carousel until then.
 */
export async function sendUploadedChatMedia(
	api: Pick<ApiFunctions, "sendMessage">,
	uploaded: UploadedChatMedia,
	targetProfileId: number | string,
	options: { maxViews: number; replyToMessageId?: string | null },
): Promise<Message> {
	const { isVideo } = uploaded;
	const isImage = !isVideo;
	const imageUrl = uploaded.url;
	const imageHash = imageUrl ? uploaded.mediaHash || extractImageHashFromSignedUrl(imageUrl) : uploaded.mediaHash;
	const isOnceImage = isImage && options.maxViews === 1;
	// Videos are always a regular Video, "unlimited" included (see videoMessageViews).
	const videoViews = videoMessageViews(options.maxViews);
	const messageType = isVideo ? "Video" : isOnceImage ? "ExpiringImage" : "Image";
	const sentMessage = await api.sendMessage({
		type: messageType,
		target: { type: "Direct", targetId: Number(targetProfileId) },
		body: {
			mediaId: uploaded.mediaId,
			width: null,
			height: null,
			...(isVideo ? { viewsRemaining: videoViews, maxViews: videoViews } : {}),
			...(isOnceImage ? { viewsRemaining: 1, maxViews: 1, duration: 10 } : {}),
			...(imageUrl ? { url: imageUrl } : {}),
			...(isImage && imageHash ? { imageHash } : {}),
		},
		replyToMessageId: options.replyToMessageId ?? null,
	});

	const target = getMediaCaptureTarget(sentMessage);
	if (target) {
		void fetchAndStoreMedia({
			mediaKey: target.mediaKey,
			kind: target.kind,
			url: target.url,
			conversationId: sentMessage.conversationId,
			messageId: sentMessage.messageId,
			viewOnce: target.viewOnce,
		});
	}
	return sentMessage;
}

export type BatchSendResult = { sent: number; failed: number };

/**
 * Sends every file to every recipient: each file is uploaded once, then sent
 * to each recipient in turn. Failures are counted per (file, recipient)
 * message — a failed upload counts once for every recipient it was meant for.
 */
export async function sendChatMediaBatch(
	api: Pick<ApiFunctions, "uploadChatMedia" | "sendMessage">,
	files: File[],
	recipientProfileIds: Array<number | string>,
	options: { maxViews: number },
	onProgress?: (done: number, total: number) => void,
): Promise<BatchSendResult> {
	const total = files.length * recipientProfileIds.length;
	let sent = 0;
	let failed = 0;
	const report = () => onProgress?.(sent + failed, total);
	for (const file of files) {
		let uploaded: UploadedChatMedia;
		try {
			if (file.size > MAX_CHAT_MEDIA_BYTES) throw new Error("too large");
			uploaded = await uploadChatMediaFile(api, file, { looping: false, takenOnGrindr: false });
		} catch {
			failed += recipientProfileIds.length;
			report();
			continue;
		}
		for (const recipient of recipientProfileIds) {
			try {
				await sendUploadedChatMedia(api, uploaded, recipient, options);
				sent++;
			} catch {
				failed++;
			}
			report();
		}
	}
	return { sent, failed };
}
