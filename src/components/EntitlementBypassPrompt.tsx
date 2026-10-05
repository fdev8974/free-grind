import { useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../contexts/useAuth";
import { usePreferences } from "../contexts/PreferencesContext";
import { ConfirmDialog } from "./ui/confirm-dialog";
import {
	configureEntitlementBypass,
	dismissEntitlementBypass,
	getEntitlementBypassState,
	runEntitlementBypass,
	subscribeEntitlementBypass,
} from "../services/entitlementBypass";

/**
 * "Paid feature" prompt for the Honduras entitlement bypass (see
 * services/entitlementBypass.ts). Also keeps the service in sync with the
 * Behavior toggle and the location to come back to, and drops anything still
 * queued when the account changes.
 */
export function EntitlementBypassPrompt() {
	const { t } = useTranslation();
	const { entitlementBypassEnabled, geohash } = usePreferences();
	const { userId } = useAuth();
	const { open, reason, busy } = useSyncExternalStore(
		subscribeEntitlementBypass,
		getEntitlementBypassState,
	);

	useEffect(() => {
		configureEntitlementBypass({ enabled: entitlementBypassEnabled, homeGeohash: geohash });
	}, [entitlementBypassEnabled, geohash]);

	useEffect(() => {
		dismissEntitlementBypass();
	}, [userId]);

	const explanation = t("entitlement_bypass.prompt_message", {
		defaultValue:
			"Free Grind can attempt to bypass this by momentarily spoofing your location to Honduras.",
	});

	return (
		<ConfirmDialog
			isOpen={open}
			title={t("entitlement_bypass.prompt_title", { defaultValue: "Paid feature" })}
			message={reason ? `${reason} ${explanation}` : explanation}
			confirmLabel={t("entitlement_bypass.prompt_confirm", { defaultValue: "Bypass" })}
			cancelLabel={t("entitlement_bypass.prompt_cancel", { defaultValue: "Cancel" })}
			onConfirm={() => runEntitlementBypass()}
			onCancel={dismissEntitlementBypass}
			isProcessing={busy}
		/>
	);
}
