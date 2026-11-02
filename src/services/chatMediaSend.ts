/**
 * chatMediaSend.ts — the network half of sending a picture/video into a chat:
 * upload once, then send it as a message to one or more recipients. Shared by
 * ChatPage's attachment dialog (which layers its optimistic thread UI on top)
 * and the share sheet's "Send to…" picker, which sends without a chat open.
 *
 * An uploaded mediaId can be sent any number of times (drawer media relies on
 * the same), so sending one image to several chats uploads it only once.
 */

import toast from "react-hot-toast";

import i18n from "../i18n";
import type { createApiFunctions } from "./apiFunctions";
import { fetchAndStoreMedia } from "./mediaStore";
import {
	buildBinaryUpload,
	extractImageHashFromSignedUrl,
	getMediaCaptureTarget,
	getVideoDurationMs,
	videoMessageViews,
} from "../pages/app/chat/chatUtils";
import { MAX_CHAT_MEDIA_BYTES } from "./stagedVideoUpload";
import { resolveVideoEdit } from "./videoEdit";
import type { Message } from "../types/messages";
import type { UploadChatMediaResponse } from "../types/chat-service";

type ApiFunctions = ReturnType<typeof createApiFunctions>;

/** maxViews meaning "no limit" — the attachment dialog's default. */
export const UNLIMITED_VIEWS = 2147483647;

export type UploadedChatMedia = UploadChatMediaResponse & { isVideo: boolean };

function warnLandscapeKept() {
	toast(
		i18n.t("chat.attachments.landscape_kept", {
			defaultValue: "This device can't turn the video upright, so it was sent in landscape. The official app may not show it properly.",
		}),
	);
}

/**
 * Streams the video from disk (see stagedVideoUpload), cut to the window the
 * editor picked, or its first 15 s, and turned portrait when it's landscape
 * (see videoEdit). On a binary that predates streaming it is sent whole
 * instead. The webview's reading of the length is only a fallback for files
 * without one of their own. Videos are never signed: only in-app photo
 * captures are.
 */
export async function uploadChatVideo(
	api: Pick<ApiFunctions, "uploadChatMedia" | "uploadChatVideo">,
	file: File,
	looping: boolean,
): Promise<UploadChatMediaResponse> {
	const lengthMs = await getVideoDurationMs(file);
	const edit = await resolveVideoEdit(file);
	const streamed = await api.uploadChatVideo({
		file,
		looping,
		edit,
		onLandscapeKept: warnLandscapeKept,
		...(lengthMs != null ? { lengthMs } : {}),
	});
	if (streamed) return streamed;
	return api.uploadChatMedia({
		multipart: await buildBinaryUpload(file),
		options: { looping, takenOnGrindr: false, length: lengthMs ?? 0 },
	});
}

export async function uploadChatMediaFile(
	api: Pick<ApiFunctions, "uploadChatMedia" | "uploadChatVideo">,
	file: File,
	options: { looping: boolean; takenOnGrindr: boolean },
): Promise<UploadedChatMedia> {
	const isVideo = file.type.startsWith("video/");
	const uploaded = isVideo
		? await uploadChatVideo(api, file, options.looping)
		: await api.uploadChatMedia({
				multipart: await buildBinaryUpload(file),
				options: { looping: options.looping, takenOnGrindr: options.takenOnGrindr },
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
	api: Pick<ApiFunctions, "uploadChatMedia" | "uploadChatVideo" | "sendMessage">,
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
			// Videos are checked Rust-side, after the cut that may shrink them.
			if (!file.type.startsWith("video/") && file.size > MAX_CHAT_MEDIA_BYTES) throw new Error("too large");
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
