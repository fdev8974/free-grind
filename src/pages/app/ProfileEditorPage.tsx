import { useTranslation } from "react-i18next";
import { PageHeader } from "../../components/PageHeader";
import { ProfileEditorFormSections } from "./profile-editor/ProfileEditorFormSections";
import { ProfilePhotoFlows } from "./profile-editor/ProfilePhotoFlows";
import { ProfileEditorFloatingActions, ProfileEditorHeaderActions } from "./profile-editor/ProfileEditorSaveActions";
import { useProfileEditor } from "./profile-editor/useProfileEditor";

export function ProfileEditorPage() {
	const { t } = useTranslation();
	const editor = useProfileEditor();
	const showSaveActions = editor.hasChanges && editor.isLoaded;

	return (
		<section className="app-screen">
			<div className="mx-auto grid w-full max-w-[1180px] gap-6 rail:max-w-none">
				<PageHeader
					backTo="/settings"
					title={t("profile_editor.title")}
					subtitle={t("profile_editor.subtitle")}
					subtitleClassName="-mt-4 mb-0"
					// Desktop rail: save/reset live in the sticky header instead of the
					// floating bottom bar below, which is a mobile pattern.
					actions={showSaveActions ? <ProfileEditorHeaderActions {...editor} className="hidden rail:flex" /> : undefined}
				/>

				{editor.isLoadingProfile && !editor.profile ? (
					<div className="native-card p-5 sm:p-6">
						<p className="text-sm font-medium text-[var(--text-muted)]">
							{t("profile_editor.loading")}
						</p>
					</div>
				) : editor.profileError && !editor.profile ? (
					<div className="native-card p-5 sm:p-6">
						<p className="text-sm font-semibold">
							{t("profile_editor.error_load")}
						</p>
						<p className="mt-2 text-sm text-[var(--text-muted)]">
							{editor.profileError}
						</p>
					</div>
				) : (
					<ProfileEditorFormSections editor={editor} />
				)}

				{showSaveActions && <ProfileEditorFloatingActions {...editor} className="rail:hidden" />}
			</div>
			<ProfilePhotoFlows photos={editor.photos} />
		</section>
	);
}
