import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { sheetButtonClass } from "../../../components/ui/bottom-sheet";
import { cn } from "../../../utils/cn";
import { ProfileEditorFormSections } from "./ProfileEditorFormSections";
import { ProfilePhotoFlows } from "./ProfilePhotoFlows";
import { ProfileEditorHeaderActions } from "./ProfileEditorSaveActions";
import { useProfileEditor } from "./useProfileEditor";

/** Edit mode of your own profile view: the editor's sections in place of the
 * profile details, with reset/save (or done) pinned to the bottom of the
 * scroll area. A successful save ends edit mode like "Done" does. */
export function OwnProfileEditPanel({
	onDone,
	onDirtyChange,
	onPhotoHashesChange,
}: {
	onDone: () => void;
	/** Reports unsaved changes, so the host can confirm before leaving edit mode. */
	onDirtyChange?: (dirty: boolean) => void;
	/** Photo changes are saved right away — reports the saved order, so the host's carousel can follow. */
	onPhotoHashesChange?: (hashes: string[]) => void;
}) {
	const { t } = useTranslation();
	const editor = useProfileEditor();
	const isProfileLoaded = editor.profile != null;
	const photoHashes = editor.photos.hashes;

	useEffect(() => {
		if (isProfileLoaded) onPhotoHashesChange?.(photoHashes);
	}, [isProfileLoaded, photoHashes, onPhotoHashesChange]);

	useEffect(() => {
		onDirtyChange?.(editor.hasChanges);
	}, [editor.hasChanges, onDirtyChange]);
	useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

	const handleSave = async () => {
		const saved = await editor.handleSaveProfile();
		if (saved) onDone();
		return saved;
	};

	if (editor.isLoadingProfile && !editor.profile) {
		return <p className="px-1 text-sm font-medium text-[var(--text-muted)]">{t("profile_editor.loading")}</p>;
	}
	if (editor.profileError && !editor.profile) {
		return (
			<div className="px-1">
				<p className="text-sm font-semibold">{t("profile_editor.error_load")}</p>
				<p className="mt-2 text-sm text-[var(--text-muted)]">{editor.profileError}</p>
			</div>
		);
	}

	return (
		<>
			<ProfileEditorFormSections editor={editor} layout="panel" />
			{/* Pinned to the bottom of the profile's scroll area, edge to edge (out of
			    the host's p-4 / sm:p-5), over a fade of whatever it sits on: the modal
			    card (--card-bg) or the page. */}
			<div
				className="pointer-events-none sticky bottom-0 z-10 -mx-4 mt-6 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-10 sm:-mx-5 sm:px-5 [&>*]:pointer-events-auto"
				style={{ background: "linear-gradient(to top, color-mix(in srgb, var(--card-bg, var(--bg)) 92%, transparent) 0%, color-mix(in srgb, var(--card-bg, var(--bg)) 70%, transparent) 55%, transparent)" }}
			>
				{editor.hasChanges ? (
					<ProfileEditorHeaderActions {...editor} handleSaveProfile={handleSave} className="animate-badge-in" />
				) : (
					<button
						type="button"
						onClick={onDone}
						className={cn(sheetButtonClass(), "h-10 flex-none px-6 text-sm")}
					>
						<Check className="h-4 w-4" />
						{t("common.done")}
					</button>
				)}
			</div>
			<ProfilePhotoFlows photos={editor.photos} />
		</>
	);
}
