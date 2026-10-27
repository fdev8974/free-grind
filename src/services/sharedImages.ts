/**
 * sharedImages.ts — images shared into the app from Android's share sheet
 * (see ShareTargetBridge and the native ShareTarget.kt), held until a chat
 * picks them up. `conversationId` is the chat they go to — set right away
 * for a Direct Share target, or once the user picked one in
 * ShareChatPicker; null while that choice is still open.
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
 * Hands the pending images to `conversationId` and clears them — only if
 * they're addressed to that chat. Images with no chosen chat yet stay put,
 * even while some other chat happens to be open.
 */
export function takePendingSharedImages(conversationId: string): File[] | null {
	if (!pending || pending.conversationId !== conversationId) return null;
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
