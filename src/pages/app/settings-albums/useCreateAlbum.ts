import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { useApiFunctions } from "../../../hooks/useApiFunctions";
import { ApiFunctionError } from "../../../services/apiFunctions";
import type { Album } from "../../../types/albums";

/** Creates an album named "Album" right away, for the caller to open it in
 * the editor (renamed there). Resolves to null when it failed (toasted). */
export function useCreateAlbum() {
	const { t } = useTranslation();
	const apiFunctions = useApiFunctions();
	const [isCreating, setIsCreating] = useState(false);

	const createAlbum = useCallback(async (): Promise<Album | null> => {
		setIsCreating(true);
		const albumName = "Album";
		try {
			const { albumId } = await apiFunctions.createOwnAlbum({ albumName });
			return { albumId: String(albumId), albumName };
		} catch (createError) {
			if (createError instanceof ApiFunctionError && createError.status === 402) {
				toast.error(t("settings_albums.limit_reached_toast"));
			} else {
				toast.error(createError instanceof Error ? createError.message : t("settings_albums.error_create_fallback"));
			}
			return null;
		} finally {
			setIsCreating(false);
		}
	}, [apiFunctions, t]);

	return { createAlbum, isCreating };
}
