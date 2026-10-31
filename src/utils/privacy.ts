import { useEffect, useState } from "react";
import { getSetting, setSetting } from "../services/chatDb";

// --- PER-CHAT READ RECEIPTS LOGIC ---
// Backed by the active profile's db, kept in an in-memory cache so the
// synchronous getters below (called from hot paths like chatService.ts and
// ChatRealtimeBridge.tsx) don't need to await a db round-trip — mirrors the
// pattern in utils/autoblock.ts.

interface PrivacySettings {
    hideReadReceiptsGlobal: boolean;
    showReadReceiptToggle: boolean;
    recordProfileViews: boolean;
    readReceiptsExceptions: Record<string, boolean>;
    incognitoMode: boolean;
}

const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
    hideReadReceiptsGlobal: false,
    showReadReceiptToggle: true,
    recordProfileViews: true,
    readReceiptsExceptions: {},
    incognitoMode: false,
};

const PRIVACY_SETTINGS_KEY = "privacy";

let privacyCache: PrivacySettings = DEFAULT_PRIVACY_SETTINGS;

export async function loadPrivacyCache(): Promise<void> {
    try {
        const stored = await getSetting<Partial<PrivacySettings>>(PRIVACY_SETTINGS_KEY);
        privacyCache = { ...DEFAULT_PRIVACY_SETTINGS, ...stored };
    } catch {
        privacyCache = DEFAULT_PRIVACY_SETTINGS;
    }
    try {
        localReadMarkers = (await getSetting<Record<string, string>>(LOCAL_READ_MARKERS_KEY)) ?? {};
    } catch {
        localReadMarkers = {};
    }
}

// --- LOCAL READ MARKERS ---
// With read receipts hidden (or incognito), markRead never reaches the server,
// so every /v4/inbox response keeps reporting the chat as unread. Remember the
// message we read up to locally instead, and treat the conversation as read
// for as long as the server's preview still points at that same message — a
// newer message changes the preview id and the server's count shows again.

const LOCAL_READ_MARKERS_KEY = "localReadMarkers";
// Oldest markers are dropped past this — a marker only matters until the
// conversation's next message, so long-idle ones are cheap to lose.
const MAX_LOCAL_READ_MARKERS = 1000;

let localReadMarkers: Record<string, string> = {};

export function setLocalReadMarker(conversationId: string, messageId: string): void {
    if (localReadMarkers[conversationId] === messageId) {
        return;
    }
    const { [conversationId]: _previous, ...rest } = localReadMarkers;
    const next: Record<string, string> = { ...rest, [conversationId]: messageId };
    const keys = Object.keys(next);
    for (let i = 0; i < keys.length - MAX_LOCAL_READ_MARKERS; i += 1) {
        delete next[keys[i]];
    }
    localReadMarkers = next;
    void setSetting(LOCAL_READ_MARKERS_KEY, localReadMarkers);
}

/** True when the conversation was read locally up to `latestMessageId` (the server's current preview). */
export function isReadLocallyUpTo(conversationId: string, latestMessageId: string | null | undefined): boolean {
    return latestMessageId != null && localReadMarkers[conversationId] === latestMessageId;
}

// localStorage writes don't trigger re-renders in other components, so anything
// that displays read-receipts state (e.g. the chat list) needs to be told to
// recompute when a toggle happens elsewhere (e.g. the chat thread header).
const READ_RECEIPTS_CHANGED_EVENT = "fg-read-receipts-changed";

function notifyReadReceiptsChanged() {
    window.dispatchEvent(new Event(READ_RECEIPTS_CHANGED_EVENT));
}

// Forces the calling component to re-render whenever read-receipts state
// changes anywhere in the app, so cache-derived values stay in sync.
export function useReadReceiptsChanged(): void {
    const [, setVersion] = useState(0);

    useEffect(() => {
        const handler = () => setVersion((v) => v + 1);
        window.addEventListener(READ_RECEIPTS_CHANGED_EVENT, handler);
        return () => window.removeEventListener(READ_RECEIPTS_CHANGED_EVENT, handler);
    }, []);
}

export function isReadReceiptsHidden(conversationId: string): boolean {
    const exception = privacyCache.readReceiptsExceptions[conversationId];
    if (typeof exception === "boolean") {
        return exception;
    }
    return privacyCache.hideReadReceiptsGlobal;
}

/** True when this chat's read-receipts state differs from the global setting (a per-chat override). */
export function isReadReceiptsOverridden(conversationId: string): boolean {
    return isReadReceiptsHidden(conversationId) !== privacyCache.hideReadReceiptsGlobal;
}

/** Optimistic: updates the cache and returns the new state synchronously, persists in the background. */
export function toggleReadReceiptsHidden(conversationId: string): boolean {
    const nextState = !isReadReceiptsHidden(conversationId);
    privacyCache = {
        ...privacyCache,
        readReceiptsExceptions: { ...privacyCache.readReceiptsExceptions, [conversationId]: nextState },
    };
    void setSetting(PRIVACY_SETTINGS_KEY, privacyCache);
    notifyReadReceiptsChanged();
    return nextState;
}

export function getShowReadReceiptToggle(): boolean {
    return privacyCache.showReadReceiptToggle;
}

export function getHideReadReceiptsGlobal(): boolean {
    return privacyCache.hideReadReceiptsGlobal;
}

export async function setHideReadReceiptsGlobal(value: boolean): Promise<void> {
    privacyCache = { ...privacyCache, hideReadReceiptsGlobal: value };
    await setSetting(PRIVACY_SETTINGS_KEY, privacyCache);
    notifyReadReceiptsChanged();
}

export async function setShowReadReceiptToggle(value: boolean): Promise<void> {
    privacyCache = { ...privacyCache, showReadReceiptToggle: value };
    await setSetting(PRIVACY_SETTINGS_KEY, privacyCache);
}

// --- RECORD PROFILE VIEWS SETTING ---

export function isRecordProfileViewsEnabled(): boolean {
    return privacyCache.recordProfileViews;
}

export async function setRecordProfileViewsEnabled(value: boolean): Promise<void> {
    privacyCache = { ...privacyCache, recordProfileViews: value };
    await setSetting(PRIVACY_SETTINGS_KEY, privacyCache);
}

// --- INCOGNITO MODE ---
// While on, the Grid never fetches nearby profiles (foreground or the
// background keep-online refresh in GridAutoRefreshBridge), so the account
// stops pinging the server for browse data and no longer shows as online to
// others. Read fresh on every GridPage mount, so no change-event plumbing is
// needed here — the toggle only lives on the Privacy settings page, a
// different route, so GridPage is always freshly (re)mounted after it changes.

export function getIncognitoMode(): boolean {
    return privacyCache.incognitoMode;
}

export async function setIncognitoMode(value: boolean): Promise<void> {
    privacyCache = { ...privacyCache, incognitoMode: value };
    await setSetting(PRIVACY_SETTINGS_KEY, privacyCache);
}
