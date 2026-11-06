import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "./ui/confirm-dialog";
import {
	cancelAgeVerificationPrompt,
	confirmAgeVerificationPrompt,
	getAgeVerificationPromptState,
	subscribeAgeVerificationPrompt,
} from "../services/ageVerificationGuard";

/** Dialog for services/ageVerificationGuard.ts — mounted once in App.tsx. */
export function AgeVerificationRegionPrompt() {
	const { t } = useTranslation();
	const { open, region } = useSyncExternalStore(subscribeAgeVerificationPrompt, getAgeVerificationPromptState);

	const regionName =
		region === "UK"
			? t("age_verification_region.region_uk", { defaultValue: "the United Kingdom" })
			: region === "BR"
				? t("age_verification_region.region_br", { defaultValue: "Brazil" })
				: region === "AU"
					? t("age_verification_region.region_au", { defaultValue: "Australia" })
					: "";

	return (
		<ConfirmDialog
			isOpen={open}
			title={t("age_verification_region.title", { defaultValue: "Age verification region" })}
			message={t("age_verification_region.message", {
				region: regionName,
				defaultValue:
					"This location is in {{region}}, where Grindr requires a legal age verification with an ID document or face scan. Free Grind can't do that verification.",
			})}
			warning={t("age_verification_region.warning", {
				defaultValue:
					"Grindr will lock your account as soon as your location is set here, and you won't be able to change it back until you verify your age in the official Grindr app.",
			})}
			confirmLabel={t("age_verification_region.confirm", { defaultValue: "Set location anyway" })}
			confirmTone="danger"
			cancelLabel={t("age_verification_region.cancel", { defaultValue: "Cancel" })}
			onConfirm={confirmAgeVerificationPrompt}
			onCancel={cancelAgeVerificationPrompt}
		/>
	);
}
