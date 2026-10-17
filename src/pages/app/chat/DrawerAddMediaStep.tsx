import { Loader2, Plus, RotateCw, SquareCenterlineDashedHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactCrop, { type Crop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { ToggleRow } from "../../../components/ui/toggle-row";
import { TakenOnGrindrBadge } from "./TakenOnGrindrBadge";

/**
 * The "add to drawer" step every media drawer runs a picked file through
 * before uploading: crop/flip/rotate for photos, "taken on Grindr" for
 * photos, looping for videos. `onConfirm` gets the edited file.
 */
export function DrawerAddMediaStep({
	file,
	isAdding,
	onCancel,
	onConfirm,
}: {
	file: File;
	isAdding: boolean;
	onCancel: () => void;
	onConfirm: (file: File, takenOnGrindr: boolean, looping: boolean) => void | Promise<void>;
}) {
	const { t } = useTranslation();
	const isVideo = file.type.startsWith("video/");
	const [takenOnGrindr, setTakenOnGrindr] = useState(false);
	const [looping, setLooping] = useState(false);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [crop, setCrop] = useState<Crop | undefined>(undefined);
	const [isDraggingCrop, setIsDraggingCrop] = useState(false);
	const [completedCrop, setCompletedCrop] = useState<PixelCrop | undefined>(undefined);
	const imgRef = useRef<HTMLImageElement | null>(null);

	// A new file starts over: fresh preview, full-image crop, toggles off.
	useEffect(() => {
		const url = URL.createObjectURL(file);
		setPreviewUrl(url);
		setCrop(undefined);
		setCompletedCrop(undefined);
		setTakenOnGrindr(false);
		setLooping(false);
		return () => URL.revokeObjectURL(url);
	}, [file]);

	useEffect(() => {
		if (!previewUrl) return;
		setCrop({ unit: "%", x: 0, y: 0, width: 100, height: 100 });
	}, [previewUrl]);

	const applyTransform = useCallback(async (type: "flipH" | "rotateCw") => {
		const img = imgRef.current;
		if (!img || !img.complete || img.naturalWidth === 0) return;
		const sw = img.naturalWidth;
		const sh = img.naturalHeight;
		const canvas = document.createElement("canvas");
		canvas.width = type === "rotateCw" ? sh : sw;
		canvas.height = type === "rotateCw" ? sw : sh;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.translate(canvas.width / 2, canvas.height / 2);
		if (type === "flipH") ctx.scale(-1, 1);
		if (type === "rotateCw") ctx.rotate(Math.PI / 2);
		ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, "image/jpeg", 0.95),
		);
		if (!blob) return;
		setPreviewUrl((prev) => {
			if (prev) URL.revokeObjectURL(prev);
			return URL.createObjectURL(blob);
		});
	}, []);

	const confirm = useCallback(async () => {
		let fileToUpload = file;
		const isFullImage =
			!completedCrop ||
			!imgRef.current ||
			(completedCrop.x <= 1 &&
				completedCrop.y <= 1 &&
				Math.abs(completedCrop.width - imgRef.current.width) <= 2 &&
				Math.abs(completedCrop.height - imgRef.current.height) <= 2);
		if (!isFullImage && completedCrop?.width && completedCrop.height && imgRef.current) {
			const img = imgRef.current;
			const scaleX = img.naturalWidth / img.width;
			const scaleY = img.naturalHeight / img.height;
			const canvas = document.createElement("canvas");
			canvas.width = Math.round(completedCrop.width * scaleX);
			canvas.height = Math.round(completedCrop.height * scaleY);
			const ctx = canvas.getContext("2d");
			if (ctx) {
				ctx.drawImage(
					img,
					completedCrop.x * scaleX, completedCrop.y * scaleY,
					completedCrop.width * scaleX, completedCrop.height * scaleY,
					0, 0, canvas.width, canvas.height,
				);
				fileToUpload = await new Promise<File>((resolve) => {
					canvas.toBlob((blob) => {
						if (!blob) { resolve(file); return; }
						resolve(new File([blob], file.name, { type: file.type || "image/jpeg" }));
					}, file.type || "image/jpeg", 0.92);
				});
			}
		}
		await onConfirm(fileToUpload, isVideo ? false : takenOnGrindr, isVideo ? looping : false);
	}, [file, completedCrop, onConfirm, isVideo, takenOnGrindr, looping]);

	return (
		<>
			{previewUrl && isVideo && (
				<div className="mb-4 flex justify-center">
					<div className="overflow-hidden rounded-xl border border-[var(--border)]" style={{ clipPath: "inset(0 round 0.75rem)" }}>
						<video src={previewUrl} controls className="block max-h-[50dvh] w-full" style={{ maxWidth: "100%" }} />
					</div>
				</div>
			)}
			{previewUrl && !isVideo && (
				<>
				<div className="mb-4 flex justify-center">
					<style>{`
						.drawer-crop .ReactCrop__crop-mask { display: none !important; }
						.drawer-crop .ReactCrop__crop-selection {
							background-image: none !important;
							animation: none !important;
							outline: none !important;
							border: 3px solid rgba(255,255,255,0.6) !important;
							border-radius: 11px !important;
							box-shadow: 0 0 0 9999px rgba(0,0,0,0.5) !important;
						}
						.drawer-crop .ord-n,
						.drawer-crop .ord-s,
						.drawer-crop .ord-e,
						.drawer-crop .ord-w { display: none !important; }

						.drawer-crop .ReactCrop__drag-handle {
							background: transparent !important;
							border: none !important;
							width: 15px !important;
							height: 15px !important;
						}
						.drawer-crop .ord-nw { transform: translate(4px, 4px) !important; border-top: 2px solid white !important; border-left: 2px solid white !important; border-top-left-radius: 4px !important; }
						.drawer-crop .ord-ne { transform: translate(-4px, 4px) !important; border-top: 2px solid white !important; border-right: 2px solid white !important; border-top-right-radius: 4px !important; }
						.drawer-crop .ord-sw { transform: translate(4px, -4px) !important; border-bottom: 2px solid white !important; border-left: 2px solid white !important; border-bottom-left-radius: 4px !important; }
						.drawer-crop .ord-se { transform: translate(-4px, -4px) !important; border-bottom: 2px solid white !important; border-right: 2px solid white !important; border-bottom-right-radius: 4px !important; }

						@keyframes logo-shine {
							0%, 100% { filter: drop-shadow(0 0 2px rgba(255,140,0,0.3)) brightness(1); }
							50% { filter: drop-shadow(0 0 7px rgba(255,140,0,0.95)) brightness(1.25); }
						}
						.logo-shine { animation: logo-shine 2.8s ease-in-out infinite; }
					`}</style>
					<div data-sheet-no-drag className="relative rounded-xl border border-[var(--border)] overflow-hidden">
					<ReactCrop
						crop={crop}
						onChange={(c) => {
							setIsDraggingCrop(true);
							setCrop(c);
						}}
						onComplete={(c) => {
							setIsDraggingCrop(false);
							setCompletedCrop(c);
						}}
						ruleOfThirds={isDraggingCrop}
						minWidth={150}
						minHeight={150}
						className="drawer-crop ReactCrop--no-animate"
						style={{ maxHeight: "50dvh", display: "block" }}
					>
						<img
							ref={imgRef}
							src={previewUrl}
							alt="Preview"
							className="block"
							style={{ maxHeight: "50dvh" }}
						/>
					</ReactCrop>
					{takenOnGrindr && crop && (
						<div
							className="absolute inline-flex items-center gap-1.5 pointer-events-none"
							style={{
								left: `calc(${crop.unit === "%" ? crop.x + "%" : crop.x + "px"} + 10px)`,
								top: `calc(${crop.unit === "%" ? (crop.y + crop.height) + "%" : (crop.y + crop.height) + "px"} - 10px)`,
								transform: "translateY(-100%)",
							}}
						>
							<TakenOnGrindrBadge label={t("chat.time.just_now", { defaultValue: "just now" })} />
						</div>
					)}
				</div>
				</div>
				<div className="mb-4 flex items-center justify-center gap-8">
					<button
						type="button"
						onClick={() => void applyTransform("flipH")}
						className="flex flex-col items-center gap-1 text-[var(--text-muted)] transition hover:text-[var(--text)]"
						aria-label="Flip horizontal"
					>
						<SquareCenterlineDashedHorizontal className="h-6 w-6" />
					</button>
					<button
						type="button"
						onClick={() => void applyTransform("rotateCw")}
						className="flex flex-col items-center gap-1 text-[var(--text-muted)] transition hover:text-[var(--text)]"
						aria-label="Rotate clockwise"
					>
						<RotateCw className="h-6 w-6" />
					</button>
				</div>
				</>
			)}
			{isVideo ? (
				<div className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]">
					<ToggleRow
						checked={looping}
						onChange={setLooping}
						label={t("chat.attachments.looping")}
						description={t("chat.attachments.looping_description")}
					/>
				</div>
			) : (
				<div className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]">
					<ToggleRow
						checked={takenOnGrindr}
						onChange={setTakenOnGrindr}
						label={t("chat.attachments.taken_on_grindr")}
						description={t("chat.attachments.taken_on_grindr_description")}
					/>
				</div>
			)}
			<div className="flex gap-2">
				<button
					type="button"
					onClick={onCancel}
					disabled={isAdding}
					className="flex-1 inline-flex h-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)] disabled:opacity-60"
				>
					{t("chat.actions.cancel")}
				</button>
				<button
					type="button"
					onClick={() => void confirm()}
					disabled={isAdding}
					className="flex-1 inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)] transition hover:brightness-110 disabled:opacity-60"
				>
					{isAdding ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<Plus className="h-4 w-4" />
					)}
					<span>{isAdding ? t("chat_drawer.sending") : t("chat_drawer.add_to_drawer")}</span>
				</button>
			</div>
		</>
	);
}
