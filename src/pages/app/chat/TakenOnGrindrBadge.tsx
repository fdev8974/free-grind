import { useTranslation } from "react-i18next";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { useEffectiveColorScheme } from "../../../hooks/useEffectiveColorScheme";
import freegrindLogo from "../../../images/freegrind-logo.webp";

type TakenOnGrindrBadgeProps = {
	/** Time label next to the logo; the pill is left out when null. */
	label: string | null;
	/** Glow animation class; the chat and the upload previews each define their own keyframes. */
	shineClassName?: string;
};

/** "Taken on Grindr" marker: free-standing logo plus a time pill. Shared by the
 * chat bubble and the upload previews so they always look the same. */
export function TakenOnGrindrBadge({ label, shineClassName = "logo-shine" }: TakenOnGrindrBadgeProps) {
	const { t } = useTranslation();
	const { amoledMode } = usePreferences();
	const colorScheme = useEffectiveColorScheme();
	const isAmoled = amoledMode && colorScheme === "dark";

	return (
		<div className="pointer-events-none inline-flex items-center gap-1.5">
			<img src={freegrindLogo} alt={t("chat.thread.taken_on_grindr")} className={`h-5 w-5 rounded-full ${shineClassName}`} />
			{label != null ? (
				<span
					className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
						isAmoled
							? "bg-black/65 text-white"
							: "bg-[color-mix(in_srgb,var(--surface)_86%,transparent)] text-[var(--text)] shadow-sm backdrop-blur-md"
					}`}
				>
					{label}
				</span>
			) : null}
		</div>
	);
}
