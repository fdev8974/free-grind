import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { useApiFunctions } from "../../../hooks/useApiFunctions";
import * as chatDb from "../../../services/chatDb";
import { getDrawerMediaKey } from "../../../services/mediaStore";
import { appLog } from "../../../utils/logger";

/**
 * Deleting media from the drawer, the same in every drawer sheet: the tile's
 * X calls `requestDelete`, `dialog` (render it once) asks for confirmation,
 * then the media is deleted on the server and from the local cache, and
 * `onDeleted` updates the sheet's list.
 */
export function useDrawerMediaDelete({
	onDeleted,
}: {
	onDeleted: (mediaId: number) => void | Promise<void>;
}) {
	const { t } = useTranslation();
	const service = useApiFunctions();
	const [confirmId, setConfirmId] = useState<number | null>(null);
	const [deletingId, setDeletingId] = useState<number | null>(null);

	const confirmDelete = useCallback(async () => {
		if (confirmId == null) return;
		const mediaId = confirmId;
		setDeletingId(mediaId);
		try {
			await service.deleteDrawerMedia(mediaId);
			void chatDb.deleteMediaFile(getDrawerMediaKey(mediaId));
			await onDeleted(mediaId);
		} catch (deleteError) {
			appLog.error("[useDrawerMediaDelete] failed to delete drawer media", deleteError);
			toast.error(deleteError instanceof Error ? deleteError.message : t("chat.errors.delete_failed"));
		} finally {
			setDeletingId(null);
			setConfirmId(null);
		}
	}, [confirmId, service, onDeleted, t]);

	// The drawer is shared by every chat, album and collection, so deleting
	// from any sheet removes it everywhere — the dialog says so.
	const dialog = (
		<ConfirmDialog
			isOpen={confirmId != null}
			title={t("chat_drawer.delete_confirm_title")}
			message={t("chat_drawer.delete_confirm_message_everywhere", {
				defaultValue: "This removes it from your drawer and from every collection that uses it.",
			})}
			confirmLabel={t("chat_drawer.delete_confirm_label")}
			cancelLabel={t("chat.actions.cancel")}
			onConfirm={() => void confirmDelete()}
			onCancel={() => { if (deletingId == null) setConfirmId(null); }}
			isProcessing={deletingId != null}
			confirmTone="danger"
		/>
	);

	return {
		requestDelete: setConfirmId as (mediaId: number) => void,
		deletingId,
		dialog,
	};
}
