/**
 * ShareTargetBridge — Android share sheet integration (native side:
 * ShareTarget.kt).
 *
 * Incoming: MainActivity dispatches `fg:share-intent` (and queues the payload
 * on window.__FG_SHARE_INTENTS for a WebView that wasn't listening yet) with
 * ids of the shared images it cached. Each image is pulled once through
 * FreeGrindBridge.takeSharedImage, handed to the sharedImages store, and the
 * app opens the target chat — or the inbox, where ChatPage asks which chat.
 *
 * Outgoing: keeps the share sheet's Direct Share row in step with the most
 * recent chats. The native side drops them again while a disguise is active.
 */

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/useAuth";
import * as chatDb from "../services/chatDb";
import { setPendingSharedImages } from "../services/sharedImages";
import { getOtherParticipant } from "../pages/app/chat/chatUtils";
import { getThumbImageUrl } from "../utils/media";
import { appLog } from "../utils/logger";

type SharePayload = {
	conversationId?: string | null;
	items?: Array<{ id?: string; mimeType?: string; name?: string }>;
};

type ShareBridge = {
	takeSharedImage?: (id: string) => string | null;
	publishShareShortcuts?: (chatsJson: string) => void;
};

declare global {
	interface Window {
		__FG_SHARE_INTENTS?: SharePayload[];
	}
}

const SHORTCUT_PUBLISH_INTERVAL_MS = 5 * 60_000;

function shareBridge(): ShareBridge | undefined {
	return (window as unknown as { FreeGrindBridge?: ShareBridge }).FreeGrindBridge;
}

function filesFromPayload(payload: SharePayload): File[] {
	const bridge = shareBridge();
	const files: File[] = [];
	for (const item of payload.items ?? []) {
		if (!item.id || !bridge?.takeSharedImage) continue;
		const base64 = bridge.takeSharedImage(item.id);
		if (!base64) continue;
		const type = item.mimeType || "image/jpeg";
		files.push(new File([base64ToBytes(base64)], item.name || "shared-image", { type }));
	}
	return files;
}

// Decoded by hand rather than fetch()ing a data: URL, which the CSP's
// connect-src doesn't allow.
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

export function ShareTargetBridge() {
	const navigate = useNavigate();
	const { userId, settingsReady } = useAuth();

	useEffect(() => {
		let cancelled = false;

		const drain = async () => {
			const queue = Array.isArray(window.__FG_SHARE_INTENTS) ? window.__FG_SHARE_INTENTS : [];
			window.__FG_SHARE_INTENTS = [];
			for (const payload of queue) {
				try {
					const files = filesFromPayload(payload);
					if (cancelled || files.length === 0) continue;
					const conversationId = payload.conversationId?.trim() || null;
					setPendingSharedImages({ files, conversationId });
					navigate(conversationId ? `/chat/${encodeURIComponent(conversationId)}` : "/chat", {
						state: { sharedAt: Date.now() },
					});
				} catch (error) {
					appLog.warn("[share] Failed to import shared images", error);
				}
			}
		};

		const onShareIntent = () => void drain();
		window.addEventListener("fg:share-intent", onShareIntent);
		void drain();
		return () => {
			cancelled = true;
			window.removeEventListener("fg:share-intent", onShareIntent);
		};
	}, [navigate]);

	useEffect(() => {
		if (!settingsReady || userId == null || !shareBridge()?.publishShareShortcuts) return;

		let lastPublishedAt = 0;
		const publish = async () => {
			const now = Date.now();
			if (now - lastPublishedAt < SHORTCUT_PUBLISH_INTERVAL_MS) return;
			lastPublishedAt = now;
			try {
				const conversations = await chatDb.listConversations();
				// listConversations sorts pinned chats first; Direct Share wants
				// the most recently active ones, pinned or not.
				const chats = conversations
					.filter((c) => !c.hidden && !c.blockState)
					.sort(
						(a, b) =>
							(b.entry.data.lastActivityTimestamp ?? 0) - (a.entry.data.lastActivityTimestamp ?? 0),
					)
					.slice(0, 8)
					.map((c) => {
						const hash = getOtherParticipant(c.entry, userId)?.primaryMediaHash;
						return {
							conversationId: c.conversationId,
							name: c.entry.data.name ?? "",
							avatarUrl: hash ? getThumbImageUrl(hash) : null,
						};
					});
				shareBridge()?.publishShareShortcuts?.(JSON.stringify(chats));
			} catch (error) {
				appLog.warn("[share] Failed to publish share shortcuts", error);
			}
		};

		// Once the inbox had a moment to load, then whenever the app is left —
		// which is when the share sheet is next going to be opened.
		const initial = setTimeout(() => void publish(), 15_000);
		const onVisibility = () => {
			if (document.hidden) void publish();
		};
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			clearTimeout(initial);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [settingsReady, userId]);

	return null;
}
