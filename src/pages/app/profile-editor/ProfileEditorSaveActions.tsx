import { useTranslation } from "react-i18next";
import { RefreshCw, Save } from "lucide-react";
import { sheetButtonClass } from "../../../components/ui/bottom-sheet";
import { cn } from "../../../utils/cn";
import type { ProfileEditorState } from "./useProfileEditor";

type SaveActionsProps = Pick<ProfileEditorState, "canSave" | "isSaving" | "handleSaveProfile" | "handleResetDraft">;

/** Reset + save as compact labelled buttons, for a sticky header. */
export function ProfileEditorHeaderActions({ canSave, isSaving, handleSaveProfile, handleResetDraft, className }: SaveActionsProps & { className?: string }) {
	const { t } = useTranslation();
	return (
		<div className={cn("flex items-center gap-2", className)}>
			<button
				type="button"
				onClick={handleResetDraft}
				disabled={isSaving}
				className={cn(sheetButtonClass("secondary"), "h-10 flex-none px-4 text-sm")}
			>
				<RefreshCw className="h-4 w-4" />
				{t("profile_editor.actions.reset")}
			</button>
			<button
				type="button"
				onClick={() => void handleSaveProfile()}
				disabled={!canSave}
				className={cn(sheetButtonClass(), "h-10 flex-none px-5 text-sm")}
			>
				<Save className="h-4 w-4" />
				{isSaving ? t("profile_editor.actions.saving") : t("profile_editor.actions.save")}
			</button>
		</div>
	);
}

/** Reset + save floating above the bottom nav bar (mobile). `className` adds
 * e.g. `rail:hidden` where the header carries the buttons on desktop. */
export function ProfileEditorFloatingActions({ canSave, isSaving, handleSaveProfile, handleResetDraft, className }: SaveActionsProps & { className?: string }) {
	const { t } = useTranslation();
	return (
		<div
			className={cn(
				"pointer-events-none fixed left-[var(--nav-rail-width,0px)] right-0 z-40 flex justify-center px-4 pb-3 pt-10 [&>*]:pointer-events-auto",
				className,
			)}
			style={{
				// Flush on the nav bar's measured height (published by NavBar).
				bottom: "var(--nav-height, calc(env(safe-area-inset-bottom, 0px) + 80px))",
				// Same idea as the sheets' floating footer: the page darkens towards
				// the buttons, so they stand out from the cards scrolling behind.
				background: "linear-gradient(to top, color-mix(in srgb, var(--bg) 92%, transparent) 0%, color-mix(in srgb, var(--bg) 70%, transparent) 55%, transparent)",
			}}
		>
			{/* Two floating buttons like the sheets' footer, no shared pill around them. */}
			<div className="animate-badge-in flex items-center gap-2.5">
				<button
					type="button"
					onClick={handleResetDraft}
					disabled={isSaving}
					aria-label={t("profile_editor.actions.reset")}
					title={t("profile_editor.actions.reset")}
					className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[var(--text)] transition-transform duration-150 active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-50"
					style={{
						background: "color-mix(in srgb, color-mix(in srgb, var(--text) 16%, var(--bg)) 90%, transparent)",
						// Inset hairline + drop shadow, so the glass edge reads on dark cards.
						boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--text) 10%, transparent), 0 8px 24px rgba(0,0,0,0.35)",
						backdropFilter: "blur(16px)",
						WebkitBackdropFilter: "blur(16px)",
					}}
				>
					<RefreshCw className="h-[18px] w-[18px]" />
				</button>
				<button
					type="button"
					onClick={() => void handleSaveProfile()}
					disabled={!canSave}
					className={`${sheetButtonClass()} flex-none px-6`}
					style={{
						boxShadow: canSave
							? "0 8px 24px -6px color-mix(in srgb, var(--accent), transparent 40%)"
							: undefined,
					}}
				>
					<Save className="h-4 w-4" />
					{isSaving ? t("profile_editor.actions.saving") : t("profile_editor.actions.save")}
				</button>
			</div>
		</div>
	);
}
