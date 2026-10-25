import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApiFunctions } from "../../../hooks/useApiFunctions";
import { usePreferences } from "../../../contexts/PreferencesContext";
import * as chatDb from "../../../services/chatDb";
import type { DrawerMedia } from "../chat/ChatDrawerPanel";
import { sortDrawerMediaByUsage } from "../chat/chatUtils";

/** The own chat drawer's media, for the album and collection editors. */
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
