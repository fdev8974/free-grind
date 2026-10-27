export const SHOW_LEGAL_AGREEMENTS_EVENT = "fg:show-legal-agreements";

/** Opens the legal agreements dialog even when everything is accepted (dev tool). */
export function showLegalAgreementsPrompt(): void {
	if (typeof window === "undefined") {
		return;
	}

	window.dispatchEvent(new Event(SHOW_LEGAL_AGREEMENTS_EVENT));
}
