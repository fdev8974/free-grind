import type { PixelCrop } from "react-image-crop";

/**
 * The photo as edited in an upload/add step: the preview <img> — already
 * flipped/rotated when `transformed` (the preview URL is swapped for the
 * turned image) — cut to `crop`, given in displayed pixels, or whole.
 * Returns `file` itself when nothing was changed or the canvas fails.
 */
export async function exportEditedImage(
	img: HTMLImageElement | null,
	file: File,
	crop: PixelCrop | undefined,
	transformed: boolean,
): Promise<File> {
	if (!img || img.naturalWidth === 0) return file;
	const isFullImage =
		!crop?.width ||
		!crop.height ||
		(crop.x <= 1 &&
			crop.y <= 1 &&
			Math.abs(crop.width - img.width) <= 2 &&
			Math.abs(crop.height - img.height) <= 2);
	if (isFullImage && !transformed) return file;

	const scaleX = img.naturalWidth / img.width;
	const scaleY = img.naturalHeight / img.height;
	const [sx, sy, sw, sh] = isFullImage || !crop
		? [0, 0, img.naturalWidth, img.naturalHeight]
		: [crop.x * scaleX, crop.y * scaleY, crop.width * scaleX, crop.height * scaleY];
	const canvas = document.createElement("canvas");
	canvas.width = Math.round(sw);
	canvas.height = Math.round(sh);
	const ctx = canvas.getContext("2d");
	if (!ctx) return file;
	ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
	const type = file.type || "image/jpeg";
	return new Promise<File>((resolve) => {
		canvas.toBlob(
			// The blob's own type: a canvas that can't encode `type` (e.g. HEIC) falls back to PNG.
			(blob) => resolve(blob ? new File([blob], file.name, { type: blob.type || type }) : file),
			type,
			0.92,
		);
	});
}
