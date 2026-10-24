export const SHOW_ACCOUNT_WARNINGS_EVENT = "fg:show-account-warnings";

/** Opens the account warnings prompt with sample warnings (dev tool). */
export function showAccountWarningsPrompt(): void {
	if (typeof window === "undefined") {
		return;
	}

	window.dispatchEvent(new Event(SHOW_ACCOUNT_WARNINGS_EVENT));
}
