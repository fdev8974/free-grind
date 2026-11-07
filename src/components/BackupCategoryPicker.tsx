import { useTranslation } from "react-i18next";
import { ToggleRow } from "./ui/toggle-row";
import { SHEET_GROUP_CLASS } from "./ui/sheet-section";
import type { BackupCategoryId } from "../services/backupRestore";

function useBackupCategoryLabels(): Record<BackupCategoryId, string> {
	const { t } = useTranslation();
	return {
		chat_messages: t("data_backup.category_chat_messages", { defaultValue: "Chat messages" }),
		media_albums: t("data_backup.category_media_albums", { defaultValue: "Media & albums" }),
		drawer_media: t("data_backup.category_drawer_media", { defaultValue: "Drawer media" }),
		own_albums: t("data_backup.category_own_albums", { defaultValue: "My albums" }),
		profile_details: t("data_backup.category_profile_details", { defaultValue: "Profile details" }),
		profile_photos: t("data_backup.category_profile_photos", { defaultValue: "Profile photos" }),
		blocked_profiles: t("data_backup.category_blocked_profiles", { defaultValue: "Blocked profiles" }),
		saved_phrases: t("data_backup.category_saved_phrases", { defaultValue: "Saved phrases" }),
		saved_locations: t("data_backup.category_saved_locations", { defaultValue: "Saved locations" }),
		settings: t("data_backup.category_settings", { defaultValue: "Settings" }),
		sexual_health: t("data_backup.category_sexual_health", { defaultValue: "Sexual health" }),
		favorites: t("data_backup.category_favorites", { defaultValue: "Favorites & notes" }),
	};
}

export function BackupCategoryPicker({
	categories,
	selected,
	onToggle,
}: {
	/** Which category ids to render as toggle rows, in order — the full list for export, only what's present in the picked file for import. */
	categories: BackupCategoryId[];
	selected: Set<BackupCategoryId>;
	onToggle: (id: BackupCategoryId) => void;
}) {
	const { t } = useTranslation();
	const labels = useBackupCategoryLabels();

	return (
		// Sits in a sheet's unpadded scroll area, hence its own side margin.
		<div className={`mx-4 ${SHEET_GROUP_CLASS}`}>
			{categories.map((id) =>
				id in labels ? (
					<ToggleRow
						key={id}
						padding="px-4 py-3"
						label={labels[id]}
						checked={selected.has(id)}
						onChange={() => onToggle(id)}
					/>
				) : (
					// A category from an older or newer app version: nothing restores it.
					<div key={id} className="flex min-h-14 items-center justify-between gap-4 px-4 py-3">
						<span className="min-w-0 break-words text-sm font-medium text-[var(--text-muted)]">
							{t("data_backup.category_legacy", { defaultValue: "Legacy: {{id}}", id })}
						</span>
						<span className="shrink-0 text-xs font-semibold text-[var(--text-muted)]">
							{t("data_backup.category_unsupported", { defaultValue: "Unsupported" })}
						</span>
					</div>
				),
			)}
		</div>
	);
}
