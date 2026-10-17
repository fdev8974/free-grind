import { useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { AlertCircle, Bot, BrainCircuit, Check, CheckCircle2, ChevronRight, ExternalLink, Eye, EyeOff, KeyRound, Languages, Sparkles } from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { Button } from "../../components/ui/button";
import { BottomSheet, SheetClose, SheetCloseButton } from "../../components/ui/bottom-sheet";
import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";
import { useSettingsHighlight } from "../../hooks/useSettingsHighlight";
import {
	TRANSLATION_PROVIDERS,
	type TranslationProvider,
	getTranslationApiKey,
	getTranslationProvider,
	isTranslationApiKeyInvalid,
	isTranslationKeyError,
	markTranslationApiKeyValid,
	resolveTranslateTargetLanguage,
	setTranslationApiKey,
	setTranslationProvider,
	translateTexts,
} from "../../utils/autoTranslate";
import { openExternalUrl } from "../../utils/githubIssues";

type SetupStep = { key: string; title: string; desc: string; url?: string; linkLabel?: string };

const PROVIDER_INFO: Record<
	TranslationProvider,
	{ icon: typeof Languages; label: string; tagline: string; desc: string; keyLabel: string }
> = {
	google: {
		icon: Languages,
		label: "Google Translate",
		tagline: "Fast, literal translation",
		desc: "Fast, literal machine translation. Often misses slang and abbreviations.",
		keyLabel: "Google Cloud API key",
	},
	gemini: {
		icon: Sparkles,
		label: "Gemini",
		tagline: "Understands slang · free tier",
		desc: "AI translation that understands gay dating slang, abbreviations and context. Free tier with daily limits.",
		keyLabel: "Gemini API key",
	},
	openai: {
		icon: Bot,
		label: "ChatGPT",
		tagline: "Understands slang · paid",
		desc: "AI translation by OpenAI that understands slang, abbreviations and context. Paid per use, a chat message costs a fraction of a cent.",
		keyLabel: "OpenAI API key",
	},
	claude: {
		icon: BrainCircuit,
		label: "Claude",
		tagline: "Understands slang · paid",
		desc: "AI translation by Anthropic that understands slang, abbreviations and context. Paid per use, the most expensive option here.",
		keyLabel: "Anthropic API key",
	},
};

const PROVIDER_ICON_CLASSES: Record<TranslationProvider, string> = {
	google: "bg-cyan-500/15 text-cyan-400",
	gemini: "bg-violet-500/15 text-violet-400",
	openai: "bg-emerald-500/15 text-emerald-400",
	claude: "bg-orange-500/15 text-orange-400",
};

const GOOGLE_SETUP_STEPS: SetupStep[] = [
	{
		key: "project",
		title: "Create a Google Cloud project",
		desc: "Sign in to the Google Cloud Console with your Google account and create a new project (or pick an existing one).",
		url: "https://console.cloud.google.com/projectcreate",
		linkLabel: "Create project",
	},
	{
		key: "billing",
		title: "Enable billing",
		desc: "The Translation API needs a billing account on the project. The first 500,000 characters per month are free, which is plenty for chat messages.",
		url: "https://console.cloud.google.com/billing",
		linkLabel: "Open billing",
	},
	{
		key: "api",
		title: "Enable the Cloud Translation API",
		desc: "Open the Cloud Translation API in the API library and click Enable.",
		url: "https://console.cloud.google.com/apis/library/translate.googleapis.com",
		linkLabel: "Open Translation API",
	},
	{
		key: "key",
		title: "Create an API key",
		desc: "Go to APIs & Services → Credentials, click Create credentials → API key and copy it. Recommended: edit the key and restrict it to the Cloud Translation API.",
		url: "https://console.cloud.google.com/apis/credentials",
		linkLabel: "Open credentials",
	},
	{
		key: "paste",
		title: "Paste it here",
		desc: "Paste the key into the field above, tap Save and then Test key to check that it works.",
	},
];

const GEMINI_SETUP_STEPS: SetupStep[] = [
	{
		key: "gemini_studio",
		title: "Open Google AI Studio",
		desc: "Sign in to Google AI Studio with your Google account and accept the terms.",
		url: "https://aistudio.google.com/apikey",
		linkLabel: "Open AI Studio",
	},
	{
		key: "gemini_key",
		title: "Create an API key",
		desc: "Click Create API key, pick or create a project and copy the key. No billing is needed for the free tier.",
	},
	{
		key: "gemini_billing",
		title: "Optional: enable billing",
		desc: "The free tier has daily limits, and Google may use free-tier content to improve its products. With billing enabled your messages aren't used for that, and a chat message costs only a fraction of a cent.",
		url: "https://ai.google.dev/gemini-api/docs/pricing",
		linkLabel: "View pricing",
	},
	{
		key: "paste",
		title: "Paste it here",
		desc: "Paste the key into the field above, tap Save and then Test key to check that it works.",
	},
];

const OPENAI_SETUP_STEPS: SetupStep[] = [
	{
		key: "openai_platform",
		title: "Open the OpenAI Platform",
		desc: "Sign in to the OpenAI Platform with your OpenAI account. This is separate from a ChatGPT subscription.",
		url: "https://platform.openai.com/api-keys",
		linkLabel: "Open API keys",
	},
	{
		key: "openai_billing",
		title: "Add credit",
		desc: "The API is prepaid. Add a small amount under Billing; a few dollars last a long time for chat messages.",
		url: "https://platform.openai.com/settings/organization/billing/overview",
		linkLabel: "Open billing",
	},
	{
		key: "openai_key",
		title: "Create an API key",
		desc: "Click Create new secret key and copy it right away; it's only shown once.",
	},
	{
		key: "paste",
		title: "Paste it here",
		desc: "Paste the key into the field above, tap Save and then Test key to check that it works.",
	},
];

const CLAUDE_SETUP_STEPS: SetupStep[] = [
	{
		key: "claude_console",
		title: "Open the Claude Console",
		desc: "Sign in to the Claude Console with your Anthropic account. This is separate from a Claude.ai subscription.",
		url: "https://platform.claude.com/settings/keys",
		linkLabel: "Open API keys",
	},
	{
		key: "claude_billing",
		title: "Add credit",
		desc: "The API is prepaid. Buy credits under Billing before the key can be used.",
		url: "https://platform.claude.com/settings/billing",
		linkLabel: "Open billing",
	},
	{
		key: "claude_key",
		title: "Create an API key",
		desc: "Click Create Key, give it a name and copy it right away; it's only shown once.",
	},
	{
		key: "paste",
		title: "Paste it here",
		desc: "Paste the key into the field above, tap Save and then Test key to check that it works.",
	},
];

const SETUP_STEPS: Record<TranslationProvider, SetupStep[]> = {
	google: GOOGLE_SETUP_STEPS,
	gemini: GEMINI_SETUP_STEPS,
	openai: OPENAI_SETUP_STEPS,
	claude: CLAUDE_SETUP_STEPS,
};

export function SettingsTranslationPage() {
	const { t, i18n } = useTranslation();
	const highlightId = useSettingsHighlight();

	const [provider, setProvider] = useState<TranslationProvider>(() => getTranslationProvider());
	const [savedApiKey, setSavedApiKey] = useState(() => getTranslationApiKey(provider));
	const [apiKeyDraft, setApiKeyDraft] = useState(savedApiKey);
	const [showApiKey, setShowApiKey] = useState(false);
	const [isTesting, setIsTesting] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [savedKeyInvalid, setSavedKeyInvalid] = useState(() => isTranslationApiKeyInvalid(provider));
	const [isProviderSheetOpen, setIsProviderSheetOpen] = useState(false);
	const isDesktop = useDesktopBreakpoint();
	const providerInfo = PROVIDER_INFO[provider];
	const ProviderIcon = providerInfo.icon;

	function handleSelectProvider(next: TranslationProvider) {
		if (next === provider || isSaving || isTesting) return;
		setTranslationProvider(next);
		setProvider(next);
		const key = getTranslationApiKey(next);
		setSavedApiKey(key);
		setApiKeyDraft(key);
		setSavedKeyInvalid(isTranslationApiKeyInvalid(next));
		setShowApiKey(false);
	}

	const targetLang = resolveTranslateTargetLanguage(i18n.resolvedLanguage ?? i18n.language);
	const isDirty = apiKeyDraft.trim() !== savedApiKey;

	// Throws only for errors that aren't about the key itself (network, quota…).
	async function verifyKey(key: string): Promise<{ valid: true; sample: string } | { valid: false; message: string }> {
		try {
			const [result] = await translateTexts(["Hello, how are you?"], targetLang, provider, key);
			return { valid: true, sample: result?.translatedText ?? "" };
		} catch (error) {
			if (isTranslationKeyError(error)) {
				return { valid: false, message: error.message };
			}
			throw error;
		}
	}

	function storeKey(key: string, valid: boolean) {
		setTranslationApiKey(provider, key, valid);
		setSavedApiKey(key);
		setApiKeyDraft(key);
		setSavedKeyInvalid(Boolean(key) && !valid);
	}

	async function handleSave() {
		const next = apiKeyDraft.trim();
		if (!next) {
			storeKey("", true);
			toast.success(t("auto_translate.key_removed", { defaultValue: "API key removed." }));
			return;
		}
		setIsSaving(true);
		try {
			const result = await verifyKey(next);
			storeKey(next, result.valid);
			if (result.valid) {
				toast.success(t("auto_translate.key_saved", { defaultValue: "API key saved." }));
			} else {
				toast.error(t("auto_translate.key_saved_invalid", { defaultValue: "Saved, but {{provider}} rejected this key: {{message}}", provider: providerInfo.label, message: result.message }));
			}
		} catch (error) {
			// Couldn't reach the provider — keep the key and let the chat UI find out later.
			storeKey(next, true);
			toast.error(t("auto_translate.key_saved_unverified", { defaultValue: "Saved, but the key couldn't be checked: {{message}}",
				message: error instanceof Error ? error.message : String(error),
			}));
		} finally {
			setIsSaving(false);
		}
	}

	async function handleTest() {
		const key = apiKeyDraft.trim();
		if (!key) return;
		setIsTesting(true);
		try {
			const result = await verifyKey(key);
			if (key === savedApiKey) {
				markTranslationApiKeyValid(provider, result.valid);
				setSavedKeyInvalid(!result.valid);
			}
			if (result.valid) {
				toast.success(t("auto_translate.test_success", { defaultValue: "Key works: \"{{text}}\"", text: result.sample }));
			} else {
				toast.error(t("auto_translate.test_failed", { defaultValue: "Translation failed: {{message}}", message: result.message }));
			}
		} catch (error) {
			toast.error(
				t("auto_translate.test_failed", { defaultValue: "Translation failed: {{message}}",
					message: error instanceof Error ? error.message : String(error),
				}),
			);
		} finally {
			setIsTesting(false);
		}
	}

	return (
		<section className="app-screen">
			<PageHeader
				backTo="/settings"
				title={t("settings.translation", { defaultValue: "Translation" })}
				subtitle={t("settings.translation_desc", { defaultValue: "Translate chat messages into your app language, one at a time or automatically per chat." })}
			/>

			<div className="grid gap-6">
				<div>
					<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
						{t("auto_translate.api_section", { defaultValue: "Provider & API key" })}
					</p>
					<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
						<button
							id="translation-provider"
							type="button"
							onClick={() => setIsProviderSheetOpen(true)}
							disabled={isSaving || isTesting}
							className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-[var(--surface-2)] disabled:opacity-60 ${highlightId === "translation-provider" ? "animate-settings-highlight" : ""}`}
						>
							<div className={`shrink-0 rounded-2xl p-2.5 ${PROVIDER_ICON_CLASSES[provider]}`}>
								<ProviderIcon className="h-5 w-5" />
							</div>
							<div className="min-w-0 flex-1">
								<p className="text-sm font-semibold leading-snug">{t("auto_translate.provider_label", { defaultValue: "Provider" })}</p>
								<p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
									{t(`auto_translate.provider_${provider}_tagline`, { defaultValue: providerInfo.tagline })}
								</p>
							</div>
							<span className="shrink-0 text-sm font-medium text-[var(--text-muted)]">
								{t(`auto_translate.provider_${provider}`, { defaultValue: providerInfo.label })}
							</span>
							<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
						</button>
						<div
							id="translation-api-key"
							className={`p-4 ${highlightId === "translation-api-key" ? "animate-settings-highlight" : ""}`}
						>
							<div className="flex items-start gap-3">
								<div className="shrink-0 rounded-2xl bg-cyan-500/15 p-2.5 text-cyan-400">
									<KeyRound className="h-5 w-5" />
								</div>
								<div className="min-w-0 flex-1">
									<p className="text-sm font-semibold leading-snug">{t(`auto_translate.api_key_label_${provider}`, { defaultValue: providerInfo.keyLabel })}</p>
									<p className="mt-0.5 text-xs text-[var(--text-muted)] leading-relaxed">
										{t("auto_translate.api_key_desc", { defaultValue: "Used for all chat translations. One key for the whole app, stored only on this device." })}
									</p>
								</div>
							</div>
							<div className="mt-3 flex items-stretch gap-2">
								<div className="relative min-w-0 flex-1">
									<input
										type={showApiKey ? "text" : "password"}
										value={apiKeyDraft}
										onChange={(event) => setApiKeyDraft(event.target.value)}
										placeholder={t("auto_translate.api_key_placeholder", { defaultValue: "Paste your API key" })}
										autoComplete="off"
										autoCorrect="off"
										autoCapitalize="off"
										spellCheck={false}
										className="input-field pr-10 font-mono text-sm"
									/>
									<span className="absolute right-3 top-1/2 -translate-y-1/2">
										<button
											type="button"
											onClick={() => setShowApiKey((value) => !value)}
											className="flex items-center p-0 text-[var(--text-muted)] hover:text-[var(--text)]"
											tabIndex={-1}
											aria-label={showApiKey ? t("auto_translate.hide_key", { defaultValue: "Hide key" }) : t("auto_translate.show_key", { defaultValue: "Show key" })}
										>
											{showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
										</button>
									</span>
								</div>
								<Button type="button" variant="primary" size="sm" className="h-auto shrink-0" onClick={() => void handleSave()} loading={isSaving} disabled={!isDirty || isSaving}>
									{t("common.save")}
								</Button>
								<Button
									type="button"
									size="sm"
									className="h-auto shrink-0"
									onClick={() => void handleTest()}
									loading={isTesting}
									disabled={!apiKeyDraft.trim() || isTesting}
								>
									{t("auto_translate.test_key", { defaultValue: "Test key" })}
								</Button>
							</div>
							{savedApiKey && !isDirty && (
								<p className={`mt-2 flex items-center gap-1.5 text-xs ${savedKeyInvalid ? "text-red-400" : "text-emerald-400"}`}>
									{savedKeyInvalid ? <AlertCircle className="h-3.5 w-3.5 shrink-0" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
									{savedKeyInvalid
										? t("auto_translate.key_status_invalid", { defaultValue: "This key doesn't work. Translate options in chats are hidden until it's fixed." })
										: t("auto_translate.key_status_valid", { defaultValue: "Key is set up. Translate options are available in chats." })}
								</p>
							)}
						</div>
					</div>
				</div>

				<div>
					<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
						{t("auto_translate.guide_section", { defaultValue: "Get an API key" })}
					</p>
					<div className="surface-card overflow-hidden">
						<ol className="divide-y divide-[var(--border)]">
							{SETUP_STEPS[provider].map((step, index) => (
								<li key={step.key} className="flex items-start gap-3 px-4 py-3.5">
									<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-500/15 text-xs font-semibold text-cyan-400">
										{index + 1}
									</span>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-semibold leading-snug">
											{t(`auto_translate.guide_${step.key}_title`, { defaultValue: step.title })}
										</p>
										<p className="mt-0.5 text-xs text-[var(--text-muted)] leading-relaxed">
											{t(`auto_translate.guide_${step.key}_desc`, { defaultValue: step.desc })}
										</p>
										{step.url && (
											<button
												type="button"
												onClick={() => void openExternalUrl(step.url!)}
												className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1 text-xs font-medium text-[var(--text)] transition hover:border-[var(--accent)]/50"
											>
												<ExternalLink className="h-3.5 w-3.5" />
												{t(`auto_translate.guide_${step.key}_link`, { defaultValue: step.linkLabel })}
											</button>
										)}
									</div>
								</li>
							))}
						</ol>
					</div>
				</div>
			</div>

			{isProviderSheetOpen && (
				<BottomSheet onClose={() => setIsProviderSheetOpen(false)} isDesktop={isDesktop} panelClassName="max-h-[82dvh]">
					<div className="flex items-center justify-between px-4 pb-3">
						<p className="text-sm font-semibold text-[var(--text)]">
							{t("auto_translate.provider_sheet_title", { defaultValue: "Translation provider" })}
						</p>
						<SheetCloseButton />
					</div>
					<div className="min-h-0 flex-1 divide-y divide-[var(--border)] overflow-y-auto pb-4" data-lenis-prevent>
						{TRANSLATION_PROVIDERS.map((option) => {
							const info = PROVIDER_INFO[option];
							const Icon = info.icon;
							const selected = option === provider;
							return (
								<SheetClose
									key={option}
									onClick={() => handleSelectProvider(option)}
									className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition hover:bg-[var(--surface-2)]"
								>
									<div className={`shrink-0 rounded-2xl p-2.5 ${PROVIDER_ICON_CLASSES[option]}`}>
										<Icon className="h-5 w-5" />
									</div>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-semibold leading-snug">
											{t(`auto_translate.provider_${option}`, { defaultValue: info.label })}
										</p>
										<p className="mt-0.5 text-xs text-[var(--text-muted)] leading-relaxed">
											{t(`auto_translate.provider_${option}_desc`, { defaultValue: info.desc })}
										</p>
									</div>
									{selected && <Check className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" />}
								</SheetClose>
							);
						})}
					</div>
				</BottomSheet>
			)}
		</section>
	);
}
