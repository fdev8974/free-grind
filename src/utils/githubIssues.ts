import { openUrl } from "@tauri-apps/plugin-opener";

const GITHUB_REPO_URL = "https://github.com/fdev8974/free-grind";

export const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues`;
export const GITHUB_NEW_ISSUE_URL = `${GITHUB_REPO_URL}/issues/new`;
/** How OTA updates are signed and checked. */
export const GITHUB_OTA_SIGNING_URL = `${GITHUB_REPO_URL}/blob/development/KEYS.md#checking-an-ota-update`;

export async function openExternalUrl(url: string): Promise<void> {
	try {
		await openUrl(url);
	} catch {
		// Web fallback when not running under Tauri
		window.open(url, "_blank", "noopener,noreferrer");
	}
}
