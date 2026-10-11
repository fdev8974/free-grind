import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { getMessageTranslations, upsertMessageTranslations } from "../services/chatDb";
import type { StoredMessageTranslation } from "../types/chat-db";
import type { UiMessage } from "../types/chat-page";
import { getTranslatableMessageText, isLocalClientMessageId } from "../pages/app/chat/chatUtils";
import {
	batchForTranslation,
	getTranslationApiKey,
	getTranslationProvider,
	isAutoTranslateEnabled,
	isTranslationAvailable,
	isTranslationKeyError,
	isTranslationQuotaError,
	markTranslationApiKeyValid,
	resolveTranslateTargetLanguage,
	translateTexts,
	useAutoTranslateChanged,
} from "../utils/autoTranslate";
import { appLog } from "../utils/logger";

type TranslationStore = {
	// `${conversationId}|${targetLang}` the entries were loaded for.
	key: string;
	byMessageId: Map<string, StoredMessageTranslation>;
};

export type MessageTranslations = {
	/** messageId -> translated text, for every translation currently shown. */
	translations: Map<string, string>;
	/** Messages whose translation request is in flight right now. */
	translatingMessageIds: Set<string>;
	/**
	 * Whether translating is possible at all (feature on, working key) — when
	 * false, no translate entry point should be shown.
	 */
	available: boolean;
	/** Whether auto-translate is on for this conversation. */
	autoEnabled: boolean;
	/** Whether this message can be translated right now (available, incoming, has text). */
	canTranslate: (messageId: string) => boolean;
	/** Translates one message on demand, regardless of the auto-translate toggle. */
	translateMessage: (messageId: string) => void;
};

function normalizeForCompare(text: string): string {
	return text.trim().toLocaleLowerCase();
}

/**
 * Message translation for one conversation: loads previously stored
 * translations from chatDb, translates incoming text messages via the selected
 * provider (Google Translate, Gemini, ChatGPT or Claude) into the app language — automatically while auto-translate is on
 * for the conversation, or one message at a time on request — and persists
 * every result. Once stored, a translation stays visible (even after
 * auto-translate is turned off) for as long as a working key is set up.
 */
export function useMessageTranslations(
	conversationId: string | null,
	messages: UiMessage[],
	userId: number | null,
): MessageTranslations {
	const { t, i18n } = useTranslation();
	const settingsVersion = useAutoTranslateChanged();
	// Re-read on every render; settingsVersion re-renders on any change.
	// A working key is what switches translation on — without one nothing is
	// translated and stored translations aren't shown either.
	const available = isTranslationAvailable();
	const autoEnabled = available && conversationId != null && isAutoTranslateEnabled(conversationId);
	const provider = getTranslationProvider();
	const apiKey = getTranslationApiKey(provider);
	const targetLang = resolveTranslateTargetLanguage(i18n.resolvedLanguage ?? i18n.language);
	const storeKey = `${conversationId}|${targetLang}`;

	const [store, setStore] = useState<TranslationStore | null>(null);
	const inFlightRef = useRef<Set<string>>(new Set());
	// Mirror of inFlightRef as state, so bubbles can show a "Translating…" row.
	const [inFlightKeys, setInFlightKeys] = useState<Set<string>>(() => new Set());
	// Messages whose auto-translation failed this session — not retried until
	// the settings change (new key, toggled off/on), so a bad key doesn't
	// hammer the API on every thread re-render.
	const failedRef = useRef<Set<string>>(new Set());
	const errorToastShownRef = useRef(false);

	useEffect(() => {
		failedRef.current = new Set();
		errorToastShownRef.current = false;
	}, [settingsVersion, storeKey]);

	useEffect(() => {
		if (conversationId == null || !available) {
			setStore(null);
			return;
		}
		let cancelled = false;
		void getMessageTranslations(conversationId, targetLang)
			.then((rows) => {
				if (cancelled) return;
				setStore({
					key: storeKey,
					byMessageId: new Map(rows.map((row) => [row.messageId, row])),
				});
			})
			.catch((error) => {
				appLog.warn("[auto-translate] failed to load stored translations", error);
				if (!cancelled) setStore({ key: storeKey, byMessageId: new Map() });
			});
		return () => {
			cancelled = true;
		};
	}, [conversationId, targetLang, storeKey, available]);

	const textsByMessageId = useMemo(() => {
		const map = new Map<string, string>();
		for (const message of messages) {
			if (userId != null && Number(message.senderId) === Number(userId)) continue;
			if (isLocalClientMessageId(message.messageId)) continue;
			const text = getTranslatableMessageText(message);
			if (text) map.set(message.messageId, text);
		}
		return map;
	}, [messages, userId]);

	const applyRows = useCallback(
		(rows: StoredMessageTranslation[]) => {
			setStore((current) => {
				if (!current || current.key !== storeKey) return current;
				const byMessageId = new Map(current.byMessageId);
				for (const row of rows) byMessageId.set(row.messageId, row);
				return { key: storeKey, byMessageId };
			});
		},
		[storeKey],
	);

	const showTranslationError = useCallback(
		(error: unknown) => {
			toast.error(
				isTranslationKeyError(error)
					? t("auto_translate.error_invalid_key", { defaultValue: "Translation failed. Check your API key. ({{message}})",
							message: error.message,
						})
					: isTranslationQuotaError(error)
						? t("auto_translate.error_quota", { defaultValue: "Translation limit reached. Try again later. ({{message}})",
								message: error.message,
							})
						: t("auto_translate.error_generic", { defaultValue: "Translation failed: {{message}}",
							message: error instanceof Error ? error.message : String(error),
						}),
			);
		},
		[t],
	);

	// Translates `pending` one request-sized batch at a time, persisting and
	// showing each batch as soon as it's done (so a long chat doesn't sit on
	// "Translating…" until every last message is through). Throws on the first
	// API failure; callers decide how to report it.
	const translateAndStore = useCallback(
		async (pending: Array<{ messageId: string; text: string }>) => {
			if (conversationId == null) return [];
			const flightKeyOf = (messageId: string) => `${storeKey}|${messageId}`;
			const settle = (items: Array<{ messageId: string }>) => {
				for (const { messageId } of items) inFlightRef.current.delete(flightKeyOf(messageId));
				setInFlightKeys(new Set(inFlightRef.current));
			};
			for (const { messageId } of pending) inFlightRef.current.add(flightKeyOf(messageId));
			setInFlightKeys(new Set(inFlightRef.current));

			const allRows: StoredMessageTranslation[] = [];
			const batches = batchForTranslation(pending, ({ text }) => text, provider);
			try {
				for (const batch of batches) {
					let results;
					try {
						results = await translateTexts(
							batch.map(({ text }) => text),
							targetLang,
							provider,
							apiKey,
						);
					} catch (error) {
						if (isTranslationKeyError(error)) markTranslationApiKeyValid(provider, false);
						throw error;
					}
					markTranslationApiKeyValid(provider, true);
					const rows: StoredMessageTranslation[] = batch.map(({ messageId, text }, index) => {
						const result = results[index];
						const detected = result.detectedSourceLanguage;
						const sameLanguage =
							(detected != null && detected.split("-")[0] === targetLang.split("-")[0]) ||
							normalizeForCompare(result.translatedText) === normalizeForCompare(text);
						return {
							messageId,
							sourceText: text,
							translatedText: sameLanguage ? null : result.translatedText,
							detectedSourceLang: detected,
						};
					});
					await upsertMessageTranslations(conversationId, targetLang, rows);
					applyRows(rows);
					settle(batch);
					allRows.push(...rows);
				}
				return allRows;
			} finally {
				settle(pending);
			}
		},
		[conversationId, storeKey, targetLang, provider, apiKey, applyRows],
	);

	useEffect(() => {
		if (!autoEnabled || store?.key !== storeKey) {
			return;
		}

		const pending: Array<{ messageId: string; text: string }> = [];
		for (const [messageId, text] of textsByMessageId) {
			const flightKey = `${storeKey}|${messageId}`;
			if (inFlightRef.current.has(flightKey) || failedRef.current.has(flightKey)) continue;
			const existing = store.byMessageId.get(messageId);
			if (existing && existing.sourceText === text) continue;
			pending.push({ messageId, text });
		}
		if (pending.length === 0) {
			return;
		}
		// Newest (bottom of the thread, what's on screen) first.
		pending.reverse();

		void translateAndStore(pending).catch((error) => {
			appLog.warn("[auto-translate] translation failed", error);
			for (const { messageId } of pending) failedRef.current.add(`${storeKey}|${messageId}`);
			if (!errorToastShownRef.current) {
				errorToastShownRef.current = true;
				showTranslationError(error);
			}
		});
	}, [autoEnabled, store, storeKey, textsByMessageId, translateAndStore, showTranslationError]);

	const canTranslate = useCallback(
		(messageId: string) => available && textsByMessageId.has(messageId),
		[available, textsByMessageId],
	);

	const translateMessage = useCallback(
		(messageId: string) => {
			const text = textsByMessageId.get(messageId);
			if (!available || !text || store?.key !== storeKey) return;
			if (inFlightRef.current.has(`${storeKey}|${messageId}`)) return;

			const notifySameLanguage = () =>
				toast(t("auto_translate.already_in_language", { defaultValue: "This message is already in your language." }));

			const existing = store.byMessageId.get(messageId);
			if (existing && existing.sourceText === text) {
				if (!existing.translatedText) notifySameLanguage();
				return;
			}

			void translateAndStore([{ messageId, text }])
				.then((rows) => {
					if (rows[0] && !rows[0].translatedText) notifySameLanguage();
				})
				.catch((error) => {
					appLog.warn("[auto-translate] manual translation failed", error);
					showTranslationError(error);
				});
		},
		[available, textsByMessageId, store, storeKey, t, translateAndStore, showTranslationError],
	);

	const translations = useMemo(() => {
		const map = new Map<string, string>();
		if (!available || store?.key !== storeKey) {
			return map;
		}
		for (const [messageId, text] of textsByMessageId) {
			const stored = store.byMessageId.get(messageId);
			if (stored?.translatedText && stored.sourceText === text) {
				map.set(messageId, stored.translatedText);
			}
		}
		return map;
	}, [available, store, storeKey, textsByMessageId]);

	const translatingMessageIds = useMemo(() => {
		const prefix = `${storeKey}|`;
		const ids = new Set<string>();
		for (const key of inFlightKeys) {
			if (key.startsWith(prefix)) ids.add(key.slice(prefix.length));
		}
		return ids;
	}, [inFlightKeys, storeKey]);

	return { translations, translatingMessageIds, available, autoEnabled, canTranslate, translateMessage };
}
