/**
 * HotswapUpdatedToastBridge — after an OTA hotswap update was applied and the
 * app reloaded, shows a one-time toast with the new bundle version.
 */

import { useEffect } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { consumeHotswapJustUpdatedVersion } from "../services/hotswap";

export function HotswapUpdatedToastBridge() {
	const { t } = useTranslation();

	useEffect(() => {
		const version = consumeHotswapJustUpdatedVersion();
		if (!version) return;
		toast.success(t("settings.updated_to_version", { version }), {
			id: "hotswap-updated",
			duration: 5000,
		});
	}, [t]);

	return null;
}
