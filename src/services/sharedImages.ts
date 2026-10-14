/**
 * sharedImages.ts — images shared into the app from Android's share sheet
 * (see ShareTargetBridge and the native ShareTarget.kt), held until a chat
 * picks them up. `conversationId` is set when the share came through a
 * Direct Share shortcut for one specific chat; null means "let the user
 * choose", which ChatPage does by showing a banner over the inbox.
 */

import { useSyncExternalStore } from "react";

export type PendingSharedImages = {
	files: File[];
	conversationId: string | null;
};

let pending: PendingSharedImages | null = null;
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) listener();
}

export function setPendingSharedImages(next: PendingSharedImages | null): void {
	pending = next;
	emit();
}

export function clearPendingSharedImages(): void {
	setPendingSharedImages(null);
}

/**
 * Hands the pending images to `conversationId` and clears them — unless
 * they were shared to a different chat, in which case they stay put.
 */
export function takePendingSharedImages(conversationId: string): File[] | null {
	if (!pending) return null;
	if (pending.conversationId && pending.conversationId !== conversationId) return null;
	const { files } = pending;
	setPendingSharedImages(null);
	return files;
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function usePendingSharedImages(): PendingSharedImages | null {
	return useSyncExternalStore(subscribe, () => pending);
}
