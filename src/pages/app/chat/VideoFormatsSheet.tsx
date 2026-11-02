import { AudioLines, Film, Info, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { NATIVE_SHEET_BG } from "../../../components/ui/action-sheet";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { BottomSheet, SHEET_ICON_BUTTON_CLASS, SheetCloseButton } from "../../../components/ui/bottom-sheet";
import { SHEET_GROUP_CLASS } from "../../../components/ui/sheet-section";
import { loadMediaSupport, type FormatSupport, type MediaSupport, type SendSupport } from "../../../services/mediaSupport";

const SEND_PILL: Record<SendSupport, string> = {
	direct: "bg-emerald-500/15 text-emerald-400",
	converted: "bg-emerald-500/15 text-emerald-400",
	as_is: "bg-amber-500/15 text-amber-400",
	unsupported: "bg-red-500/15 text-red-400",
};

const FORMAT_DEFAULTS: Record<FormatSupport["key"], { label: string; description: string }> = {
	h264: { label: "H.264", description: "MP4 · MOV · 3GP: the usual phone and camera videos" },
	hevc: { label: "HEVC / H.265", description: "MP4 · MOV: iPhone and newer Android videos" },
	vp9: { label: "VP8 / VP9", description: "WebM · MKV: screen recordings, downloads" },
	av1: { label: "AV1", description: "WebM · MKV · MP4" },
	matroska_h264: { label: "H.264 in MKV", description: "MKV: OBS recordings, for one" },
	sound: { label: "Sound to AAC", description: "Opus, PCM, MP3 … in any of the above" },
};

const SEND_DEFAULTS: Record<SendSupport, string> = {
	direct: "Sent directly",
	converted: "Converted",
	as_is: "Sent unconverted",
	unsupported: "Not possible",
};

const PLATFORM_NOTES: Partial<Record<MediaSupport["platform"], string>> = {
	linux:
		"On Linux the codecs come from GStreamer. Missing ones (HEVC, AAC, AV1) come with gst-plugins-bad, gst-plugins-ugly and gst-libav; restart the app after installing them.",
	macos: "On macOS the system's codecs are used; MOV videos from an iPhone or camera are read like MP4.",
};

/**
 * What this device does with each video format when sending (see
 * mediaSupport.ts), probed live: everything goes out as MP4 with H.264 and
 * AAC, converted on the device where it isn't that already.
 */
function VideoFormatsList() {
	const { t } = useTranslation();
	const [support, setSupport] = useState<MediaSupport | null>(null);

	useEffect(() => {
		let cancelled = false;
		void loadMediaSupport().then((loaded) => {
			if (!cancelled) setSupport(loaded);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const platformNote = support ? PLATFORM_NOTES[support.platform] : undefined;
	return (
		<div>
			<div className={SHEET_GROUP_CLASS}>
				{support ? (
					support.formats.map((format) => {
						const defaults = FORMAT_DEFAULTS[format.key];
						const description = t(`about_page.media.${format.key}_desc`, { defaultValue: defaults.description });
						const noPreview = t("about_page.media.no_preview", { defaultValue: "no preview in the editor" });
						const sendKey = format.key === "sound" && format.send === "converted" ? "converted_aac" : format.send;
						return (
							<div key={format.key} className="flex items-center gap-3 px-4 py-3">
								<div className="shrink-0 rounded-2xl bg-violet-500/15 p-2.5 text-violet-400">
									{format.key === "sound" ? <AudioLines className="h-5 w-5" /> : <Film className="h-5 w-5" />}
								</div>
								<div className="min-w-0 flex-1">
									<p className="text-sm font-semibold leading-snug">
										{t(`about_page.media.${format.key}`, { defaultValue: defaults.label })}
									</p>
									<p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">
										{format.preview ? description : `${description} · ${noPreview}`}
									</p>
								</div>
								<span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${SEND_PILL[format.send]}`}>
									{t(`about_page.media.send_${sendKey}`, {
										defaultValue: sendKey === "converted_aac" ? "Converted" : SEND_DEFAULTS[format.send],
									})}
								</span>
							</div>
						);
					})
				) : (
					<div className="flex items-center justify-center px-4 py-5 text-[var(--text-muted)]">
						<Loader2 className="h-4 w-4 animate-spin" />
					</div>
				)}
			</div>
			<div className="mt-2 space-y-1 px-1 text-xs leading-relaxed text-[var(--text-muted)]">
				<p>
					{t("about_page.media.output", {
						defaultValue: "Videos are always sent as MP4 with H.264 and AAC; whatever isn't is converted on this device first.",
					})}
				</p>
				{support && !support.canEncodeH264 && (
					<p>
						{t("about_page.media.no_upright", {
							defaultValue: "This device can't encode H.264, so landscape videos can't be turned upright here.",
						})}
					</p>
				)}
				{platformNote && support && (
					<p>{t(`about_page.media.platform_${support.platform}`, { defaultValue: platformNote })}</p>
				)}
			</div>
		</div>
	);
}


/**
 * The video upload sheet's header button: opens what this device does with
 * each video format (VideoFormatsList) over the sheet. Developer mode only.
 */
export function VideoFormatsButton({ isDesktop }: { isDesktop: boolean }) {
	const { t } = useTranslation();
	const { developerMode } = usePreferences();
	const [open, setOpen] = useState(false);
	const title = t("about_page.media.section", { defaultValue: "Video formats on this device" });
	if (!developerMode) return null;
	return (
		<>
			<button type="button" onClick={() => setOpen(true)} aria-label={title} title={title} className={SHEET_ICON_BUTTON_CLASS}>
				<Info className="h-4 w-4" strokeWidth={2.5} />
			</button>
			{open && (
				<BottomSheet
					onClose={() => setOpen(false)}
					expandable
					isDesktop={isDesktop}
					zIndex="z-[80]"
					bg={NATIVE_SHEET_BG}
					panelClassName="px-4"
				>
					<div className="mb-3 flex items-center justify-between gap-3">
						<h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
						<SheetCloseButton />
					</div>
					<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-4" data-lenis-prevent>
						<VideoFormatsList />
					</div>
				</BottomSheet>
			)}
		</>
	);
}
