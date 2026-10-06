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
 * location to come back to, and drops anything still queued when the account
 * changes.
 */
export function EntitlementBypassPrompt() {
	const { t } = useTranslation();
	const { geohash } = usePreferences();
	const { userId } = useAuth();
	const { open, reason, busy } = useSyncExternalStore(
		subscribeEntitlementBypass,
		getEntitlementBypassState,
	);

	useEffect(() => {
		configureEntitlementBypass({ homeGeohash: geohash });
	}, [geohash]);

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
			warning={t("entitlement_bypass.prompt_warning", {
				defaultValue:
					"This violates Grindr's terms of service and can get your account banned. Use at your own risk.",
			})}
			confirmLabel={t("entitlement_bypass.prompt_confirm", { defaultValue: "Bypass anyway" })}
			confirmTone="danger"
			cancelLabel={t("entitlement_bypass.prompt_cancel", { defaultValue: "Cancel" })}
			onConfirm={() => runEntitlementBypass()}
			onCancel={dismissEntitlementBypass}
			isProcessing={busy}
		/>
	);
}
