import { useTranslation } from "react-i18next";

/**
 * "Set/Edit nickname" menu label with the profile's own display name as a
 * subtitle — the only place it's visible once a nickname replaces it.
 */
export function NicknameMenuItemLabel({
	label,
	realName,
	previousName,
}: {
	label: string;
	realName: string | null;
	previousName: string | null;
}) {
	const { t } = useTranslation();
	if (!realName) return <>{label}</>;
	return (
		<span className="flex min-w-0 flex-col">
			<span>{label}</span>
			{previousName ? (
				<span className="truncate text-xs text-[var(--accent)]">
					{t("chat.nicknames.real_name_changed", { previous: previousName, name: realName })}
				</span>
			) : (
				<span className="truncate text-xs text-[var(--text-muted)]">
					{t("chat.nicknames.real_name", { name: realName })}
				</span>
			)}
		</span>
	);
}

/** Dot on the actions button when a nicknamed profile was renamed. Absolute, so it never shifts the header. Parent must be `relative`. */
export function NicknameNameChangeBadge() {
	return (
		<span
			aria-hidden="true"
			className="pointer-events-none absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[var(--accent)] ring-2 ring-[var(--surface)]"
		/>
	);
}
