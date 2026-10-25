import { BaseDirectory, mkdir, writeFile } from "@tauri-apps/plugin-fs";
import { AndroidFs, AndroidPublicGeneralPurposeDir } from "tauri-plugin-android-fs-api";
import { isAndroid, isIos } from "./saveMedia";

/**
 * Saves a small text export into the FreeGrind folder the user can reach:
 * public Downloads/FreeGrind on Android (via MediaStore), the app's Documents
 * dir on iOS (Files app → On My iPhone/iPad → Free Grind) and
 * Downloads/FreeGrind on desktop.
 *
 * A Blob URL + `<a download>` doesn't trigger a save in the app's WebViews
 * (Android, WebView2 on Windows, WKWebView), which is why this goes through
 * the native file APIs instead.
 */
export async function saveTextFile(fileName: string, content: string, mimeType: string): Promise<void> {
	const bytes = new TextEncoder().encode(content);

	if (isAndroid()) {
		// Open-stream + writer: a direct AndroidFs.writeFile(uri, bytes) on a
		// freshly-created pending MediaStore entry was unreliable on-device.
		const uri = await AndroidFs.createNewPublicFile(AndroidPublicGeneralPurposeDir.Download, `FreeGrind/${fileName}`, mimeType, {
			isPending: true,
		});
		try {
			const writable = await AndroidFs.openWriteFileStream(uri);
			const writer = writable.getWriter();
			try {
				await writer.write(bytes);
				await writer.close();
			} catch (error) {
				await writer.abort(error).catch(() => {});
				throw error;
			}
			await AndroidFs.setPublicFilePending(uri, false);
			await AndroidFs.scanPublicFile(uri);
		} catch (error) {
			await AndroidFs.removeFile(uri).catch(() => {});
			throw error;
		}
		return;
	}

	const baseDir = isIos() ? BaseDirectory.Document : BaseDirectory.Download;
	await mkdir("FreeGrind", { baseDir, recursive: true });
	await writeFile(`FreeGrind/${fileName}`, bytes, { baseDir });
}
