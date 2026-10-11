import { useEffect, useState } from "react";
import Anthropic from "@anthropic-ai/sdk";
import { getSetting, setSetting } from "../services/chatDb";

// --- AUTO-TRANSLATE SETTINGS ---
// The per-chat toggles are backed by the active profile's db, kept in an
// in-memory cache so the synchronous getters below can be read during render —
// same pattern as utils/privacy.ts. The provider choice and API keys are
// app-wide (shared by every account), so they live in localStorage instead.

interface AutoTranslateSettings {
	// conversationId -> enabled. Absent means off.
	enabledConversations: Record<string, boolean>;
}

const DEFAULT_AUTO_TRANSLATE_SETTINGS: AutoTranslateSettings = {
	enabledConversations: {},
};

const AUTO_TRANSLATE_SETTINGS_KEY = "autoTranslate";

let autoTranslateCache: AutoTranslateSettings = DEFAULT_AUTO_TRANSLATE_SETTINGS;

export async function loadAutoTranslateCache(): Promise<void> {
	try {
		const stored = await getSetting<Partial<AutoTranslateSettings>>(AUTO_TRANSLATE_SETTINGS_KEY);
		autoTranslateCache = { ...DEFAULT_AUTO_TRANSLATE_SETTINGS, ...stored };
	} catch {
		autoTranslateCache = DEFAULT_AUTO_TRANSLATE_SETTINGS;
	}
	notifyAutoTranslateChanged();
}

const AUTO_TRANSLATE_CHANGED_EVENT = "fg-auto-translate-changed";

function notifyAutoTranslateChanged() {
	window.dispatchEvent(new Event(AUTO_TRANSLATE_CHANGED_EVENT));
}

// Forces the calling component to re-render whenever auto-translate settings
// change anywhere in the app (key saved in settings, per-chat toggle in the
// thread header), so cache-derived values stay in sync.
export function useAutoTranslateChanged(): number {
	const [version, setVersion] = useState(0);

	useEffect(() => {
		const handler = () => setVersion((v) => v + 1);
		window.addEventListener(AUTO_TRANSLATE_CHANGED_EVENT, handler);
		return () => window.removeEventListener(AUTO_TRANSLATE_CHANGED_EVENT, handler);
	}, []);

	return version;
}

// --- PROVIDER & API KEYS ---

export type TranslationProvider = "google" | "gemini" | "openai" | "claude";

export const TRANSLATION_PROVIDERS: TranslationProvider[] = ["google", "gemini", "openai", "claude"];

const TRANSLATION_PROVIDER_STORAGE_KEY = "fg-translate-provider";
const API_KEY_STORAGE_KEYS: Record<TranslationProvider, string> = {
	google: "fg-google-translate-api-key",
	gemini: "fg-gemini-api-key",
	openai: "fg-openai-api-key",
	claude: "fg-anthropic-api-key",
};
// Set once the provider rejected the stored key (on save, or later at
// runtime); while set, every translate entry point in the chat UI is hidden.
const API_KEY_INVALID_STORAGE_KEYS: Record<TranslationProvider, string> = {
	google: "fg-google-translate-api-key-invalid",
	gemini: "fg-gemini-api-key-invalid",
	openai: "fg-openai-api-key-invalid",
	claude: "fg-anthropic-api-key-invalid",
};

function readStorage(key: string): string | null {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStorage(key: string, value: string | null): void {
	try {
		if (value === null) {
			window.localStorage.removeItem(key);
		} else {
			window.localStorage.setItem(key, value);
		}
	} catch {
		// Storage unavailable — the value just won't persist.
	}
}

export function getTranslationProvider(): TranslationProvider {
	const stored = readStorage(TRANSLATION_PROVIDER_STORAGE_KEY);
	return TRANSLATION_PROVIDERS.includes(stored as TranslationProvider) ? (stored as TranslationProvider) : "google";
}

export function setTranslationProvider(provider: TranslationProvider): void {
	writeStorage(TRANSLATION_PROVIDER_STORAGE_KEY, provider);
	notifyAutoTranslateChanged();
}

export function getTranslationApiKey(provider: TranslationProvider = getTranslationProvider()): string {
	return readStorage(API_KEY_STORAGE_KEYS[provider]) ?? "";
}

export function setTranslationApiKey(provider: TranslationProvider, apiKey: string, valid: boolean): void {
	const trimmed = apiKey.trim();
	writeStorage(API_KEY_STORAGE_KEYS[provider], trimmed || null);
	writeStorage(API_KEY_INVALID_STORAGE_KEYS[provider], trimmed && !valid ? "true" : null);
	notifyAutoTranslateChanged();
}

export function isTranslationApiKeyInvalid(provider: TranslationProvider = getTranslationProvider()): boolean {
	return readStorage(API_KEY_INVALID_STORAGE_KEYS[provider]) === "true";
}

/** Records whether the stored key just worked or was rejected; notifies only on change. */
export function markTranslationApiKeyValid(provider: TranslationProvider, valid: boolean): void {
	if (isTranslationApiKeyInvalid(provider) === !valid) return;
	writeStorage(API_KEY_INVALID_STORAGE_KEYS[provider], valid ? null : "true");
	notifyAutoTranslateChanged();
}

/**
 * Whether translation is switched on: the selected provider has a key that
 * hasn't been rejected. There's no separate on/off setting — a working key
 * is what enables it. Gates every translation feature in the chat UI (menu
 * toggle, context menu, automatic translation, translations in bubbles).
 */
export function isTranslationAvailable(): boolean {
	return getTranslationApiKey() !== "" && !isTranslationApiKeyInvalid();
}

export function isAutoTranslateEnabled(conversationId: string): boolean {
	return autoTranslateCache.enabledConversations[conversationId] === true;
}

/** Optimistic: updates the cache and returns the new state synchronously, persists in the background. */
export function toggleAutoTranslate(conversationId: string): boolean {
	const nextState = !isAutoTranslateEnabled(conversationId);
	const enabledConversations = { ...autoTranslateCache.enabledConversations };
	if (nextState) {
		enabledConversations[conversationId] = true;
	} else {
		delete enabledConversations[conversationId];
	}
	autoTranslateCache = { ...autoTranslateCache, enabledConversations };
	void setSetting(AUTO_TRANSLATE_SETTINGS_KEY, autoTranslateCache);
	notifyAutoTranslateChanged();
	return nextState;
}

// --- TARGET LANGUAGE ---
// The app's locale codes don't all exist as translation targets — map the
// ones that don't onto the closest supported language.
const GOOGLE_TARGET_OVERRIDES: Record<string, string> = {
	"es-419": "es",
	"pt-BR": "pt",
	arz: "ar",
	dum: "ar",
};

export function resolveTranslateTargetLanguage(appLanguage: string | undefined): string {
	const language = appLanguage || "en";
	return GOOGLE_TARGET_OVERRIDES[language] ?? language.split("-")[0];
}

// --- TRANSLATION ---

export type TranslationResult = {
	translatedText: string;
	detectedSourceLanguage: string | null;
};

export class TranslationError extends Error {
	readonly status: number | null;

	constructor(message: string, status: number | null) {
		super(message);
		this.name = "TranslationError";
		this.status = status;
	}
}

/** True when the provider rejected the request because of the API key itself (not network/quota/input). */
export function isTranslationKeyError(error: unknown): error is TranslationError {
	if (!(error instanceof TranslationError)) return false;
	if (error.status === 401 || error.status === 403) return true;
	return error.status === 400 && /api key/i.test(error.message);
}

/** True when the provider's rate limit or quota (e.g. Gemini's free tier) is used up. */
export function isTranslationQuotaError(error: unknown): error is TranslationError {
	return error instanceof TranslationError && error.status === 429;
}

const BATCH_LIMITS: Record<TranslationProvider, { maxSegments: number; maxChars: number }> = {
	// v2 accepts at most 128 segments per request; Google recommends staying
	// under ~5k characters per request as well.
	google: { maxSegments: 100, maxChars: 5_000 },
	// Kept small so the first results show up quickly — an LLM request takes
	// seconds, not milliseconds, and nothing is shown until its batch is done.
	gemini: { maxSegments: 15, maxChars: 3_000 },
	openai: { maxSegments: 15, maxChars: 3_000 },
	claude: { maxSegments: 15, maxChars: 3_000 },
};

/** Splits `items` into batches that each fit in a single request to `provider`. */
export function batchForTranslation<T>(
	items: T[],
	getText: (item: T) => string,
	provider: TranslationProvider,
): T[][] {
	const { maxSegments, maxChars } = BATCH_LIMITS[provider];
	const batches: T[][] = [];
	let current: T[] = [];
	let currentChars = 0;
	for (const item of items) {
		const length = getText(item).length;
		if (current.length > 0 && (current.length >= maxSegments || currentChars + length > maxChars)) {
			batches.push(current);
			current = [];
			currentChars = 0;
		}
		current.push(item);
		currentChars += length;
	}
	if (current.length > 0) {
		batches.push(current);
	}
	return batches;
}

const REQUEST_TIMEOUT_MS = 45_000;

async function postJson(
	url: string,
	headers: Record<string, string>,
	body: unknown,
): Promise<{ response: Response; payload: any }> {
	// Without a timeout a stalled request would leave its messages showing
	// "Translating…" forever.
	const controller = new AbortController();
	const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	let response: Response;
	let payload: any;
	try {
		response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: JSON.stringify(body),
			signal: controller.signal,
		});
		payload = await response.json().catch(() => null);
	} catch (error) {
		throw new TranslationError(
			controller.signal.aborted
				? `Request timed out after ${REQUEST_TIMEOUT_MS / 1000} s`
				: error instanceof Error
					? error.message
					: String(error),
			null,
		);
	} finally {
		window.clearTimeout(timeout);
	}
	if (!response.ok) {
		throw new TranslationError(payload?.error?.message ?? `HTTP ${response.status}`, response.status);
	}
	return { response, payload };
}

// --- Google Translate (Cloud Translation v2, API key auth) ---

const GOOGLE_TRANSLATE_ENDPOINT = "https://translation.googleapis.com/language/translate/v2";

// The API returns HTML entities even with format=text in some edge cases
// (e.g. &#39;), so decode them defensively.
function decodeHtmlEntities(value: string): string {
	if (!value.includes("&")) {
		return value;
	}
	const textarea = document.createElement("textarea");
	textarea.innerHTML = value;
	return textarea.value;
}

async function translateChunkWithGoogle(
	texts: string[],
	targetLanguage: string,
	apiKey: string,
): Promise<TranslationResult[]> {
	const { response, payload } = await postJson(
		`${GOOGLE_TRANSLATE_ENDPOINT}?key=${encodeURIComponent(apiKey)}`,
		{},
		{ q: texts, target: targetLanguage, format: "text" },
	);

	const translations = payload?.data?.translations as
		| Array<{ translatedText?: string; detectedSourceLanguage?: string }>
		| undefined;
	if (!Array.isArray(translations) || translations.length !== texts.length) {
		throw new TranslationError("Unexpected response from Google Translate", response.status);
	}

	return translations.map((translation) => ({
		translatedText: decodeHtmlEntities(translation.translatedText ?? ""),
		detectedSourceLanguage: translation.detectedSourceLanguage ?? null,
	}));
}

// --- LLM providers (Gemini, ChatGPT, Claude) ---
// All three get the same dating-app-aware prompt and return one
// {translation, sourceLanguage} object per input message.

function getLanguageName(languageCode: string): string {
	try {
		return new Intl.DisplayNames(["en"], { type: "language" }).of(languageCode) ?? languageCode;
	} catch {
		return languageCode;
	}
}

function buildLlmSystemPrompt(targetLanguage: string): string {
	const languageName = getLanguageName(targetLanguage);
	return [
		`You translate chat messages from a gay dating app (like Grindr) into ${languageName} (${targetLanguage}).`,
		"",
		"The messages are written between gay men flirting, sexting and arranging dates or hookups. They are informal and often short, with typos, missing punctuation and accents, emojis, abbreviations and gay dating / sexual slang in any language.",
		"Interpret every message the way a gay man on a dating app would mean it, and translate its intended meaning naturally and idiomatically, as a native speaker would write it in that context. Examples of slang to read correctly:",
		"- Position abbreviations: top/bottom/vers/side; Spanish \"act\"/\"pas\"/\"vers\" = activo/pasivo/versátil; Portuguese \"ativo\"/\"passivo\"/\"versátil\"; French \"actif\"/\"passif\".",
		"- Sexual slang is meant sexually, not as an insult: e.g. Spanish \"mamón\" = a guy who likes giving blowjobs, \"mamada\" = blowjob, \"follar\" = to fuck.",
		"- Dating app shorthand: host/travel, nsa, ltr, fwb, dl/discreet, rn, hmu, wyd, into, pics, face pic, PrEP, neg, poz, U=U, cut/uncut, BB, 420, PnP.",
		"",
		"Rules:",
		"- Keep the tone: flirty, explicit, crude or casual stays exactly that. Never censor, soften, moralize, explain or add anything.",
		"- Keep emojis, names, numbers and URLs unchanged.",
		`- If a message is already in ${languageName}, return it unchanged.`,
		"- If a word or abbreviation is genuinely ambiguous, prefer the meaning that fits a gay dating chat.",
		"",
		"The input is a JSON array of messages. Return exactly one result per input message, in the same order, each with the translated message (\"translation\") and the ISO 639-1 code of the message's original language (\"sourceLanguage\").",
	].join("\n");
}

type LlmTranslationItem = { translation?: unknown; sourceLanguage?: unknown } | null;

// JSON Schema shared by ChatGPT and Claude (both require an object at the
// root and, in strict mode, closed objects with every property required).
const LLM_RESULT_JSON_SCHEMA = {
	type: "object",
	properties: {
		translations: {
			type: "array",
			items: {
				type: "object",
				properties: {
					translation: { type: "string" },
					sourceLanguage: { type: "string" },
				},
				required: ["translation", "sourceLanguage"],
				additionalProperties: false,
			},
		},
	},
	required: ["translations"],
	additionalProperties: false,
};

/** Parses a model's JSON output (an array, or `{translations: [...]}`) into results. */
function parseLlmTranslations(
	text: string,
	expectedCount: number,
	providerLabel: string,
	status: number | null,
	stopDetail: string | null,
): TranslationResult[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new TranslationError(
			stopDetail ? `${providerLabel} stopped early (${stopDetail})` : `Unexpected response from ${providerLabel}`,
			status,
		);
	}
	const items = Array.isArray(parsed) ? parsed : (parsed as { translations?: unknown } | null)?.translations;
	if (!Array.isArray(items) || items.length !== expectedCount) {
		throw new TranslationError(`Unexpected response from ${providerLabel}`, status);
	}
	return (items as LlmTranslationItem[]).map((item) => ({
		translatedText: typeof item?.translation === "string" ? item.translation.trim() : "",
		detectedSourceLanguage:
			typeof item?.sourceLanguage === "string" && item.sourceLanguage.trim()
				? item.sourceLanguage.trim().toLowerCase()
				: null,
	}));
}

// --- Gemini (Gemini API, API key from Google AI Studio) ---

const GEMINI_MODEL = "gemini-3.8-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Chat messages are routinely explicit — without this, Gemini would refuse
// to translate a good part of them.
const GEMINI_SAFETY_SETTINGS = [
	"HARM_CATEGORY_HARASSMENT",
	"HARM_CATEGORY_HATE_SPEECH",
	"HARM_CATEGORY_SEXUALLY_EXPLICIT",
	"HARM_CATEGORY_DANGEROUS_CONTENT",
].map((category) => ({ category, threshold: "BLOCK_NONE" }));

async function translateChunkWithGemini(
	texts: string[],
	targetLanguage: string,
	apiKey: string,
): Promise<TranslationResult[]> {
	const { response, payload } = await postJson(
		GEMINI_ENDPOINT,
		{ "x-goog-api-key": apiKey },
		{
			systemInstruction: { parts: [{ text: buildLlmSystemPrompt(targetLanguage) }] },
			contents: [{ role: "user", parts: [{ text: JSON.stringify(texts) }] }],
			safetySettings: GEMINI_SAFETY_SETTINGS,
			generationConfig: {
				responseMimeType: "application/json",
				responseSchema: {
					type: "ARRAY",
					items: {
						type: "OBJECT",
						properties: {
							translation: { type: "STRING" },
							sourceLanguage: { type: "STRING" },
						},
						required: ["translation", "sourceLanguage"],
					},
				},
				thinkingConfig: { thinkingLevel: "low" },
			},
		},
	);

	const blockReason = payload?.promptFeedback?.blockReason;
	if (blockReason) {
		throw new TranslationError(`Gemini blocked the request (${blockReason})`, response.status);
	}

	const parts = (payload?.candidates?.[0]?.content?.parts ?? []) as Array<{ text?: string; thought?: boolean }>;
	const text = parts
		.filter((part) => !part.thought && typeof part.text === "string")
		.map((part) => part.text)
		.join("");
	const finishReason = payload?.candidates?.[0]?.finishReason;
	return parseLlmTranslations(
		text,
		texts.length,
		"Gemini",
		response.status,
		finishReason && finishReason !== "STOP" ? String(finishReason) : null,
	);
}

// --- ChatGPT (OpenAI Chat Completions, API key from platform.openai.com) ---

const OPENAI_MODEL = "gpt-5.4-mini";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

async function translateChunkWithOpenAI(
	texts: string[],
	targetLanguage: string,
	apiKey: string,
): Promise<TranslationResult[]> {
	const { response, payload } = await postJson(
		OPENAI_ENDPOINT,
		{ Authorization: `Bearer ${apiKey}` },
		{
			model: OPENAI_MODEL,
			messages: [
				{ role: "system", content: buildLlmSystemPrompt(targetLanguage) },
				{ role: "user", content: JSON.stringify(texts) },
			],
			response_format: {
				type: "json_schema",
				json_schema: { name: "translations", strict: true, schema: LLM_RESULT_JSON_SCHEMA },
			},
		},
	);

	const choice = payload?.choices?.[0];
	if (typeof choice?.message?.refusal === "string" && choice.message.refusal) {
		throw new TranslationError(`ChatGPT declined: ${choice.message.refusal}`, response.status);
	}
	const finishReason = choice?.finish_reason;
	return parseLlmTranslations(
		typeof choice?.message?.content === "string" ? choice.message.content : "",
		texts.length,
		"ChatGPT",
		response.status,
		finishReason && finishReason !== "stop" ? String(finishReason) : null,
	);
}

// --- Claude (Anthropic Messages API via the official SDK) ---

const CLAUDE_MODEL = "claude-opus-5-5";

async function translateChunkWithClaude(
	texts: string[],
	targetLanguage: string,
	apiKey: string,
): Promise<TranslationResult[]> {
	// The key belongs to the user and only ever goes to Anthropic from their
	// own device, which is what dangerouslyAllowBrowser is meant to allow.
	const client = new Anthropic({
		apiKey,
		dangerouslyAllowBrowser: true,
		timeout: REQUEST_TIMEOUT_MS,
		maxRetries: 1,
	});

	let response: Anthropic.Beta.BetaMessage;
	try {
		response = await client.beta.messages.create({
			model: CLAUDE_MODEL,
			max_tokens: 16000,
			// Server-side refusal fallback: a declined request is re-run on
			// Anthropic's recommended fallback model within the same call.
			betas: ["server-side-fallback-2026-07-01"],
			fallbacks: "default",
			system: buildLlmSystemPrompt(targetLanguage),
			messages: [{ role: "user", content: JSON.stringify(texts) }],
			output_config: {
				// Translation needs little reasoning; keeps latency and cost down.
				effort: "low",
				format: { type: "json_schema", schema: LLM_RESULT_JSON_SCHEMA },
			},
		});
	} catch (error) {
		if (error instanceof Anthropic.APIConnectionTimeoutError) {
			throw new TranslationError(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000} s`, null);
		}
		if (error instanceof Anthropic.APIError) {
			throw new TranslationError(error.message, error.status ?? null);
		}
		throw new TranslationError(error instanceof Error ? error.message : String(error), null);
	}

	if (response.stop_reason === "refusal") {
		throw new TranslationError("Claude declined to translate these messages", 200);
	}
	const text = response.content
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("");
	return parseLlmTranslations(
		text,
		texts.length,
		"Claude",
		200,
		response.stop_reason === "max_tokens" ? "max_tokens" : null,
	);
}

const CHUNK_TRANSLATORS: Record<
	TranslationProvider,
	(texts: string[], targetLanguage: string, apiKey: string) => Promise<TranslationResult[]>
> = {
	google: translateChunkWithGoogle,
	gemini: translateChunkWithGemini,
	openai: translateChunkWithOpenAI,
	claude: translateChunkWithClaude,
};

/** Translates `texts` into `targetLanguage`; results are in the same order as the input. */
export async function translateTexts(
	texts: string[],
	targetLanguage: string,
	provider: TranslationProvider,
	apiKey: string,
): Promise<TranslationResult[]> {
	const chunks = batchForTranslation(texts, (text) => text, provider);
	const translateChunk = CHUNK_TRANSLATORS[provider];
	const results: TranslationResult[] = [];
	for (const chunk of chunks) {
		results.push(...(await translateChunk(chunk, targetLanguage, apiKey)));
	}
	return results;
}
