import { openUrl } from "@tauri-apps/plugin-opener";
import { REPO_URL as GITHUB_REPO_URL } from "../config/links-config";

export const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues`;
export const GITHUB_NEW_ISSUE_URL = `${GITHUB_REPO_URL}/issues/new`;
/** How OTA updates are signed and checked. */
export const GITHUB_OTA_SIGNING_URL = `${GITHUB_REPO_URL}/blob/development/KEYS.md#checking-an-ota-update`;

/** GitHub diff between two commits (short or full SHAs, or branch names); null when either is unknown or both are the same. */
export function githubCompareUrl(from: string | null | undefined, to: string | null | undefined): string | null {
	if (!from || !to || from.startsWith(to) || to.startsWith(from)) return null;
	return `${GITHUB_REPO_URL}/compare/${from}...${to}`;
}

export async function openExternalUrl(url: string): Promise<void> {
	try {
		await openUrl(url);
	} catch {
		// Web fallback when not running under Tauri
		window.open(url, "_blank", "noopener,noreferrer");
	}
}
