import { setPendingSharedImages } from "../services/sharedImages";

const SAMPLE_COLORS = ["#e94e77", "#4e9de9", "#f2b134"];

function sampleImage(color: string, index: number): Promise<File> {
	const canvas = document.createElement("canvas");
	canvas.width = 480;
	canvas.height = 480;
	const context = canvas.getContext("2d");
	if (context) {
		context.fillStyle = color;
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.fillStyle = "#ffffff";
		context.font = "bold 160px sans-serif";
		context.textAlign = "center";
		context.textBaseline = "middle";
		context.fillText(String(index + 1), canvas.width / 2, canvas.height / 2);
	}
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) resolve(new File([blob], `debug-share-${index + 1}.png`, { type: "image/png" }));
			else reject(new Error("canvas.toBlob failed"));
		}, "image/png");
	});
}

/**
 * Opens the share sheet's "Send to…" picker with a few generated sample
 * images, as if they had been shared in without a Direct Share target
 * (dev tool). Picking a chat opens its attachment dialog for real — cancel
 * there to send nothing.
 */
export async function showSharePickerDebug(): Promise<void> {
	const files = await Promise.all(SAMPLE_COLORS.map(sampleImage));
	setPendingSharedImages({ files, conversationId: null });
}
