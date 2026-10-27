/**
 * NotificationReplyBridge — sends inline replies typed into an Android chat
 * notification (native side: NotificationReply.kt).
 *
 * MainActivity dispatches `fg:notification-reply` (and queues the reply on
 * window.__FG_NOTIFICATION_REPLIES for a WebView that wasn't listening yet).
 * Each reply is sent once, as a plain text message, and the outcome goes back
 * through FreeGrindBridge.notificationReplyResult so the notification can flag
 * a reply that didn't go out. A reply that only reaches the page much later
 * (it was typed while no WebView was alive) is dropped as failed instead of
 * surprising the other person with a stale message.
 */

import { useEffect, useRef } from "react";
import { useAuth } from "../contexts/useAuth";
import { useApiFunctions } from "../hooks/useApiFunctions";
import * as chatDb from "../services/chatDb";
import { appLog } from "../utils/logger";

type NotificationReply = {
	id?: string;
	conversationId?: string;
	targetProfileId?: string;
	text?: string;
	notificationTag?: string;
	createdAt?: number;
};

type ReplyBridge = {
	notificationReplyResult?: (json: string) => void;
};

declare global {
	interface Window {
		__FG_NOTIFICATION_REPLIES?: NotificationReply[];
	}
}

const MAX_REPLY_AGE_MS = 24 * 60 * 60_000;

function reportResult(reply: NotificationReply, ok: boolean) {
	try {
		(window as unknown as { FreeGrindBridge?: ReplyBridge }).FreeGrindBridge?.notificationReplyResult?.(
			JSON.stringify({ id: reply.id, notificationTag: reply.notificationTag, ok }),
		);
	} catch {
		// no-op outside the Android WebView
	}
}

export function NotificationReplyBridge() {
	const { userId, settingsReady } = useAuth();
	const apiFunctions = useApiFunctions();
	const apiFunctionsRef = useRef(apiFunctions);
	apiFunctionsRef.current = apiFunctions;
	// Native may dispatch the same reply twice (receiver + next WebView start).
	const handledIds = useRef(new Set<string>());

	const ready = settingsReady && userId != null;

	useEffect(() => {
		// Until signed in, replies stay queued on window for the next run.
		if (!ready) return;

		const send = async (reply: NotificationReply) => {
			const text = reply.text?.trim();
			if (!reply.conversationId || !reply.targetProfileId || !text) {
				reportResult(reply, false);
				return;
			}
			if (reply.createdAt && Date.now() - reply.createdAt > MAX_REPLY_AGE_MS) {
				appLog.warn("[notification-reply] Dropping stale reply", reply.id);
				reportResult(reply, false);
				return;
			}
			try {
				const sent = await apiFunctionsRef.current.sendText({
					targetProfileId: Number(reply.targetProfileId),
					text,
				});
				await chatDb.upsertMessages(sent.conversationId, [sent]).catch(() => {});
				reportResult(reply, true);
			} catch (error) {
				appLog.warn("[notification-reply] Failed to send reply", error);
				reportResult(reply, false);
			}
		};

		const drain = () => {
			const queue = Array.isArray(window.__FG_NOTIFICATION_REPLIES) ? window.__FG_NOTIFICATION_REPLIES : [];
			window.__FG_NOTIFICATION_REPLIES = [];
			for (const reply of queue) {
				const id = reply.id ?? "";
				if (!id || handledIds.current.has(id)) continue;
				handledIds.current.add(id);
				void send(reply);
			}
		};

		window.addEventListener("fg:notification-reply", drain);
		drain();
		return () => window.removeEventListener("fg:notification-reply", drain);
	}, [ready]);

	return null;
}
