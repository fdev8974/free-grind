import { useState } from "react";
import { Clapperboard, HeartPulse } from "lucide-react";
import { LocateFixedFilled } from "../../components/icons/FilledIcons";
import { PageHeader } from "../../components/PageHeader";
import { ToggleRow } from "../../components/ui/toggle-row";
import { useTranslation } from "react-i18next";
import { useSettingsHighlight } from "../../hooks/useSettingsHighlight";
import {
	SHOW_LOCATE_KEY,
	SHOW_SEXUAL_HEALTH_KEY,
	SHOW_VIDEO_GALLERY_KEY,
	isLocateEnabled,
	isSexualHealthEnabled,
	isVideoGalleryEnabled,
	setOptionalFeatureEnabled,
} from "../../utils/optionalFeatures";

export function OptionalFeaturesPage() {
	const { t } = useTranslation();
	const highlightId = useSettingsHighlight();
	const [showVideoGallery, setShowVideoGallery] = useState(isVideoGalleryEnabled);
	const [showSexualHealth, setShowSexualHealth] = useState(isSexualHealthEnabled);
	const [showLocate, setShowLocate] = useState(isLocateEnabled);

	return (
		<section className="app-screen">
			<PageHeader
				backTo="/settings"
				title={t("customizability.optional_features", { defaultValue: "Optional Features" })}
				subtitle={t("customizability.optional_features_desc", {
					defaultValue: "Turn extra features on or off to keep the app as simple as you like.",
				})}
			/>

			<div className="grid gap-6">
				<div className="surface-card overflow-hidden divide-y divide-[var(--border)]">
					<ToggleRow
						id="cust-show-video-gallery"
						highlighted={highlightId === "cust-show-video-gallery"}
						icon={<Clapperboard className="h-5 w-5" />}
						iconClass="bg-sky-500/15 text-sky-400"
						label={t("customizability.show_video_gallery", { defaultValue: "Video Gallery" })}
						description={t("customizability.show_video_gallery_desc", {
							defaultValue: "Show a button in the inbox header that opens a gallery of all locally stored videos from chats and albums.",
						})}
						checked={showVideoGallery}
						onChange={(checked) => {
							setShowVideoGallery(checked);
							setOptionalFeatureEnabled(SHOW_VIDEO_GALLERY_KEY, checked);
							window.location.reload();
						}}
					/>
					<ToggleRow
						id="cust-show-sexual-health"
						highlighted={highlightId === "cust-show-sexual-health"}
						icon={<HeartPulse className="h-5 w-5" />}
						iconClass="bg-rose-500/15 text-rose-400"
						label={t("customizability.show_sexual_health", { defaultValue: "Sexual Health" })}
						description={t("customizability.show_sexual_health_desc", {
							defaultValue: "Show the Sexual Health section, its inbox header button and \"We just hooked up\" in the chat menu.",
						})}
						checked={showSexualHealth}
						onChange={(checked) => {
							setShowSexualHealth(checked);
							setOptionalFeatureEnabled(SHOW_SEXUAL_HEALTH_KEY, checked);
							window.location.reload();
						}}
					/>
					<ToggleRow
						id="cust-show-locate"
						highlighted={highlightId === "cust-show-locate"}
						icon={<LocateFixedFilled className="h-5 w-5" />}
						iconClass="bg-emerald-500/15 text-emerald-400"
						label={t("customizability.show_locate", { defaultValue: "Locate" })}
						description={t("customizability.show_locate_desc", {
							defaultValue: "Show \"Locate\" in the profile menu to estimate a profile's position by triangulation.",
						})}
						checked={showLocate}
						onChange={(checked) => {
							setShowLocate(checked);
							setOptionalFeatureEnabled(SHOW_LOCATE_KEY, checked);
							window.location.reload();
						}}
					/>
				</div>
			</div>
		</section>
	);
}
