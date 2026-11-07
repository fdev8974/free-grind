/**
 * openChatState.ts — which chat thread ChatPage is actually showing right now.
 *
 * The route alone can't tell: the desktop split view switches conversations
 * in-page without touching the URL, and a chat opened from a profile sits on
 * `/chat?targetProfileId=…` until its conversation resolves. ChatPage keeps
 * this up to date so ChatRealtimeBridge can skip the in-app toast (and the
 * unread bump) for messages in the chat the user is already looking at.
 */

type OpenChat = { conversationId: string | null; profileId: string | null };

let openChat: OpenChat | null = null;

export function setOpenChat(next: OpenChat | null): void {
	openChat = next && (next.conversationId || next.profileId) ? next : null;
}

export function isChatOpen(conversationId: string, senderId: string | number | null | undefined): boolean {
	if (!openChat) return false;
	if (openChat.conversationId && openChat.conversationId === conversationId) return true;
	return senderId != null && openChat.profileId != null && openChat.profileId === String(senderId);
}
