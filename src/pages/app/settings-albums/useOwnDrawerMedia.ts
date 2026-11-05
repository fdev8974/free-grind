import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { useApiFunctions } from "../../../hooks/useApiFunctions";
import { usePreferences } from "../../../contexts/PreferencesContext";
import * as chatDb from "../../../services/chatDb";
import type { DrawerMedia } from "../chat/ChatDrawerPanel";
import { sortDrawerMediaByUsage } from "../chat/chatUtils";
import { cacheDrawerMedia, getCachedMediaUri, getDrawerMediaKey } from "../../../services/mediaStore";
import { appLog } from "../../../utils/logger";

/** Drawer item as a File, to upload it elsewhere (an album, the profile).
 * A locally cached copy is a base64 data: URI, decoded here without a
 * fetch; the CDN URL goes through plugin-http, the webview's own fetch is
 * blocked by CORS. Null when it couldn't be loaded. */
export async function downloadDrawerMedia(item: DrawerMedia): Promise<File | null> {
	const extension = item.contentType.split("/")[1]?.split(";")[0] || "mp4";
	const fileName = `drawer-${item.id}.${extension}`;
	try {
		const cachedUri = getCachedMediaUri(getDrawerMediaKey(item.id));
		const base64 = cachedUri?.startsWith("data:") ? cachedUri.slice(cachedUri.indexOf(",") + 1) : null;
		if (base64) {
			const binary = atob(base64);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
			return new File([bytes], fileName, { type: item.contentType });
		}
		const response = await tauriFetch(item.url);
		if (!response.ok) throw new Error(`Download failed (${response.status})`);
		return new File([await response.arrayBuffer()], fileName, { type: item.contentType });
	} catch (downloadError) {
		appLog.warn(`[downloadDrawerMedia] failed to download drawer media ${item.id}`, downloadError);
		return null;
	}
}

/** The own chat drawer's media, for the album and collection editors and the profile's pictures. */
export function useOwnDrawerMedia() {
	const { t } = useTranslation();
	const { sortDrawerMediaByFrequency } = usePreferences();
	const apiFunctions = useApiFunctions();
	const [drawerMedia, setDrawerMedia] = useState<DrawerMedia[]>([]);
	const [isLoadingDrawerMedia, setIsLoadingDrawerMedia] = useState(false);
	const [drawerMediaError, setDrawerMediaError] = useState<string | null>(null);

	const loadDrawerMedia = useCallback(async (forceRefresh = false) => {
		if (!forceRefresh && drawerMedia.length > 0) return;
		setIsLoadingDrawerMedia(true);
		setDrawerMediaError(null);
		try {
			const [items, sendCounts] = await Promise.all([
				apiFunctions.getGlobalDrawerMedia(),
				chatDb.getDrawerMediaSendCounts(),
			]);
			const withCounts = items.map((item) => ({ ...item, sendCount: sendCounts.get(item.id) ?? 0 }));
			cacheDrawerMedia(items);
			// Same as the chat drawer: what the server no longer serves shouldn't
			// linger in the local cache (or end up re-uploaded from a backup).
			void chatDb.deleteStaleDrawerMediaFiles(items.map((item) => getDrawerMediaKey(item.id)));
			setDrawerMedia(
				sortDrawerMediaByFrequency ? sortDrawerMediaByUsage(withCounts) : withCounts,
			);
		} catch (loadError) {
			setDrawerMediaError(
				loadError instanceof Error ? loadError.message : t("settings_albums.error_load_details_fallback"),
			);
		} finally {
			setIsLoadingDrawerMedia(false);
		}
	}, [apiFunctions, drawerMedia.length, sortDrawerMediaByFrequency, t]);

	return { drawerMedia, isLoadingDrawerMedia, drawerMediaError, loadDrawerMedia };
}
