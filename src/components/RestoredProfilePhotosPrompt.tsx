import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "./ui/confirm-dialog";
import { useAuth } from "../contexts/useAuth";
import { useApiFunctions } from "../hooks/useApiFunctions";
import {
	countPendingRestoredProfilePhotos,
	dismissRestoredProfilePhotos,
	uploadRestoredProfilePhotos,
} from "../services/ownProfilePhotos";
import { appLog } from "../utils/logger";

/**
 * Asks once whether to upload the profile photos a backup of another profile
 * brought along (see ownProfilePhotos.ts), warning that Grindr may recognize
 * them. The upload then runs in the background; an interrupted one asks again.
 */
export function RestoredProfilePhotosPrompt({ userId }: { userId: number }) {
	const { t } = useTranslation();
	const { settingsReady } = useAuth();
	const apiFunctions = useApiFunctions();
	const [count, setCount] = useState(0);
	const userIdRef = useRef(userId);
	userIdRef.current = userId;

	useEffect(() => {
		if (!settingsReady) return;
		let cancelled = false;
		countPendingRestoredProfilePhotos()
			.then((next) => {
				if (!cancelled) setCount(next);
			})
			.catch((error: unknown) => appLog.warn("[RestoredProfilePhotosPrompt] checking restored photos failed", error));
		return () => {
			cancelled = true;
		};
	}, [settingsReady, userId]);

	const handleUpload = () => {
		setCount(0);
		const toastId = toast.loading(t("restored_photos.uploading", { defaultValue: "Restoring profile photos…" }));
		uploadRestoredProfilePhotos(apiFunctions, () => userIdRef.current === userId)
			.then((uploaded) =>
				toast.success(t("restored_photos.success", { defaultValue: "{{count}} profile photos restored.", count: uploaded }), { id: toastId }),
			)
			.catch((error: unknown) => {
				appLog.error("[RestoredProfilePhotosPrompt] restoring profile photos failed", error);
				toast.error(
					t("restored_photos.failed", { defaultValue: "Couldn't restore all profile photos. You'll be asked again next time." }),
					{ id: toastId },
				);
			});
	};

	const handleDismiss = () => {
		setCount(0);
		void dismissRestoredProfilePhotos().catch((error: unknown) =>
			appLog.warn("[RestoredProfilePhotosPrompt] dismissing restored photos failed", error),
		);
	};

	return (
		<ConfirmDialog
			isOpen={count > 0}
			title={t("restored_photos.title", { defaultValue: "Restore profile photos?" })}
			message={t("restored_photos.message", {
				defaultValue: "Your backup contains {{count}} profile photos from your previous profile. Upload them and use them as this profile's photos?",
				count,
			})}
			warning={t("restored_photos.warning", {
				defaultValue: "Grindr may recognize photos of a banned account, which can get this profile banned too.",
			})}
			confirmLabel={t("restored_photos.confirm", { defaultValue: "Upload photos" })}
			cancelLabel={t("restored_photos.dismiss", { defaultValue: "Don't upload" })}
			onConfirm={handleUpload}
			onCancel={handleDismiss}
		/>
	);
}
