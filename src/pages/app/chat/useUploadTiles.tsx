import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UploadPhase } from "../../../services/stagedVideoUpload";
import { DrawerUploadTile } from "./drawerUi";

/** A file being uploaded, shown as a placeholder tile until the grid it
 * goes into has reloaded with it. `isLocal`: the preview is an object URL
 * of the picked file (revoked with the tile), else media already online
 * (e.g. drawer items going into an album). */
export type DrawerUpload = { id: number; previewUrl: string; isLocal: boolean; isVideo: boolean; progress: number; phase?: UploadPhase };

/** What a tile previews: a picked file, or media that's already online. */
export type UploadTileSource = File | { src: string; isVideo: boolean };

let nextUploadId = 1;

/**
 * Placeholder tiles for an upload round into a media grid (drawer, album),
 * with each file's progress over its local copy, like a chat bubble's.
 * `add` the round's files up front, `track` each one while it uploads,
 * `drop` them once the grid has the real items (or a file failed).
 */
export function useUploadTiles() {
	const { t } = useTranslation();
	const [uploads, setUploads] = useState<DrawerUpload[]>([]);

	const update = useCallback((id: number, change: Partial<DrawerUpload>) => {
		setUploads((previous) => previous.map((upload) => (upload.id === id ? { ...upload, ...change } : upload)));
	}, []);

	const drop = useCallback((ids: number[]) => {
		setUploads((previous) => previous.filter((upload) => {
			if (!ids.includes(upload.id)) return true;
			if (upload.isLocal) URL.revokeObjectURL(upload.previewUrl);
			return false;
		}));
	}, []);

	/** Tiles for these files, all at once; they then upload one after another. */
	const add = useCallback((sources: UploadTileSource[]) => {
		const round = sources.map((source) => ({
			id: nextUploadId++,
			...(source instanceof File
				? { previewUrl: URL.createObjectURL(source), isLocal: true, isVideo: source.type.startsWith("video/") }
				: { previewUrl: source.src, isLocal: false, isVideo: source.isVideo }),
			progress: 0,
		}));
		setUploads((previous) => [...previous, ...round]);
		return round.map(({ id }) => id);
	}, []);

	/**
	 * Runs one file's upload with its tile's progress: a video reports where
	 * it really is (staging, re-encoding, sending) through the callback it
	 * gets; a photo is one quick request, shown as steady progress like in
	 * the chat. The tile stays at 100% afterwards, until it's dropped.
	 */
	const track = useCallback(
		async <T,>(id: number, isVideo: boolean, run: (onProgress: (progress: { phase: UploadPhase; percent: number }) => void) => Promise<T>) => {
			let progress = isVideo ? 0 : 5;
			update(id, { progress });
			const timer = isVideo
				? undefined
				: window.setInterval(() => {
						progress = Math.min(92, progress + 8);
						update(id, { progress });
					}, 260);
			try {
				const result = await run(({ phase, percent }) => update(id, { progress: percent, phase }));
				update(id, { progress: 100, phase: undefined });
				return result;
			} finally {
				if (timer) window.clearInterval(timer);
			}
		},
		[update],
	);

	// Unmounted mid-round: the uploads go on, their previews don't.
	const uploadsRef = useRef(uploads);
	uploadsRef.current = uploads;
	useEffect(() => () => uploadsRef.current.forEach((upload) => {
		if (upload.isLocal) URL.revokeObjectURL(upload.previewUrl);
	}), []);

	const tiles = uploads.map((upload) => (
		<DrawerUploadTile
			key={`upload-${upload.id}`}
			upload={upload}
			label={upload.phase
				? t(`chat.upload_phase.${upload.phase}`, {
						defaultValue: { preparing: "Preparing", converting: "Converting", finishing: "Finishing", uploading: "Uploading" }[upload.phase],
					})
				: undefined}
		/>
	));

	return { tiles, isUploading: uploads.length > 0, add, track, drop };
}
