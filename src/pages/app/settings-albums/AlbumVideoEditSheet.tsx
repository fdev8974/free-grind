import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { NATIVE_SHEET_BG } from "../../../components/ui/action-sheet";
import { BottomDrawer } from "../../../components/ui/bottom-drawer";
import { VideoFormatsButton } from "../chat/VideoFormatsSheet";
import { VideoTrimmer } from "../chat/VideoTrimmer";

/**
 * The step a video picked for an album goes through before it's uploaded:
 * the trimmer, with the album plan's `maxVideoLength` as its limit, and the
 * upright choice for a landscape video (see VideoTrimmer). `onDone(true)`
 * adds it as edited, `onDone(false)` leaves it out.
 */
export function AlbumVideoEditSheet({
	file,
	maxMs,
	isDesktop,
	onDone,
}: {
	file: File;
	maxMs: number;
	isDesktop: boolean;
	onDone: (keep: boolean) => void;
}) {
	const { t } = useTranslation();
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);

	useEffect(() => {
		const url = URL.createObjectURL(file);
		setPreviewUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [file]);

	return (
		<BottomDrawer
			title={t("settings_albums.edit_video", { defaultValue: "Edit video" })}
			onClose={() => onDone(false)}
			onConfirm={() => onDone(true)}
			confirmLabel={t("settings_albums.add_video", { defaultValue: "Add to album" })}
			isDesktop={isDesktop}
			headerActions={<VideoFormatsButton isDesktop={isDesktop} />}
			bg={NATIVE_SHEET_BG}
			zIndex="z-[70]"
		>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3" data-lenis-prevent>
				{previewUrl && <VideoTrimmer file={file} src={previewUrl} maxMs={maxMs} previewHeight="45dvh" />}
			</div>
		</BottomDrawer>
	);
}
