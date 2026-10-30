import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { Loader2, Trash2 } from "lucide-react";
import {
	BottomSheet,
	SheetCloseButton,
	SHEET_FOOTER_CLASS,
	SHEET_FOOTER_ICON_BUTTON_CLASS,
	sheetButtonClass,
} from "../../../components/ui/bottom-sheet";
import { NATIVE_SHEET_BG } from "../../../components/ui/action-sheet";
import { ProfileImage } from "../../../components/ui/profile-image";
import { SHEET_FIELD_CLASS, SheetChip, SheetSection } from "../../../components/ui/sheet-section";
import { cn } from "../../../utils/cn";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { PersonPicker, type PickedPerson } from "./PersonPicker";
import { addEncounter, deleteEncounter, updateEncounter, type Encounter } from "../../../services/encounters";
import { loadPrepDoses } from "../../../services/prepDoses";
import { computeProtectionStatus } from "../../../services/prepTracking";
import { usePrepScheme } from "./usePrepScheme";
import { formatDateTime, toDateTimeLocalValue, fromDateTimeLocalValue } from "./sexualHealthFormat";
import { useDesktopBreakpoint } from "../../../hooks/useDesktopBreakpoint";

const PREP_TAG = "PrEP";
const PROTECTION_TAGS = [PREP_TAG, "Doxy-PEP", "Condom"];

interface EncounterLogSheetProps {
	prefill?: PickedPerson;
	editingEncounter?: Encounter;
	editingAvatarSrc?: string | null;
	onClose: () => void;
	/** After a successful save. The sheet closes itself (animated); onClose follows once it's gone. */
	onLogged?: () => void;
	/** After a successful delete; the sheet closes itself as with onLogged. */
	onDeleted?: () => void;
}

export function EncounterLogSheet({
	prefill,
	editingEncounter,
	editingAvatarSrc,
	onClose,
	onLogged,
	onDeleted,
}: EncounterLogSheetProps) {
	const { t } = useTranslation();
	const isDesktop = useDesktopBreakpoint();
	const [scheme] = usePrepScheme();
	const isEditing = editingEncounter != null;
	const sheetCloseRef = useRef<(() => void) | null>(null);
	const [person, setPerson] = useState<PickedPerson | null>(
		editingEncounter
			? {
					profileId: editingEncounter.profileId,
					conversationId: editingEncounter.conversationId,
					displayName: editingEncounter.displayName,
					avatarSrc: editingAvatarSrc ?? null,
				}
			: (prefill ?? null),
	);
	const [changingPerson, setChangingPerson] = useState(false);
	const [occurredAt, setOccurredAt] = useState(() =>
		toDateTimeLocalValue(editingEncounter?.occurredAt ?? Date.now()),
	);
	const [tags, setTags] = useState<string[]>(editingEncounter?.tags ?? []);
	const [note, setNote] = useState(editingEncounter?.note ?? "");
	const [isSaving, setIsSaving] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

	// The app already knows whether the user is currently PrEP-protected from
	// their own dose tracking — no need to make them tag that by hand. Only
	// relevant when logging a new encounter, not when editing one's tags.
	useEffect(() => {
		if (isEditing) return;
		let cancelled = false;
		void loadPrepDoses().then((doses) => {
			if (cancelled) return;
			const status = computeProtectionStatus(doses, scheme);
			if (status.state === "protected") {
				setTags((current) => (current.includes(PREP_TAG) ? current : [...current, PREP_TAG]));
			}
		});
		return () => {
			cancelled = true;
		};
	}, [scheme, isEditing]);

	const showPicker = !isEditing && (!person || changingPerson);

	const toggleTag = (tag: string) => {
		setTags((current) => (current.includes(tag) ? current.filter((existing) => existing !== tag) : [...current, tag]));
	};

	const handleSubmit = async () => {
		if (!person) return;
		setIsSaving(true);
		try {
			if (editingEncounter) {
				await updateEncounter(editingEncounter, { tags, note: note.trim() || null });
				toast.success(t("sexualHealth.encounter.updated", { defaultValue: "Encounter updated" }));
			} else {
				await addEncounter({
					occurredAt: fromDateTimeLocalValue(occurredAt),
					profileId: person.profileId,
					displayName: person.displayName,
					tags,
					note: note.trim() || null,
					conversationId: person.conversationId,
				});
				toast.success(t("sexualHealth.encounter.saved", { defaultValue: "Encounter logged" }));
			}
			onLogged?.();
			sheetCloseRef.current?.();
		} catch {
			toast.error(t("sexualHealth.encounter.save_failed", { defaultValue: "Could not log this encounter." }));
		} finally {
			setIsSaving(false);
		}
	};

	const handleDelete = async () => {
		if (!editingEncounter) return;
		setIsDeleting(true);
		try {
			await deleteEncounter(editingEncounter.id);
			onDeleted?.();
			sheetCloseRef.current?.();
		} finally {
			setIsDeleting(false);
			setIsConfirmingDelete(false);
		}
	};

	// Portalled to document.body: this sheet can be opened from within the
	// scroll area's masked container (FeedScrollContainer sets an inline
	// mask-image, which — like transform/filter — creates a new containing
	// block for position:fixed descendants), which would otherwise confine
	// this "fixed inset-0" overlay to that container's box instead of the
	// real viewport, leaving it stuck behind the app's fixed bottom nav bar.
	return createPortal(
		<BottomSheet
			onClose={onClose}
			closeRef={sheetCloseRef}
			expandable
			isDesktop={isDesktop}
			isProcessing={isSaving}
			bg={NATIVE_SHEET_BG}
			panelClassName={isDesktop ? "max-h-[82dvh] px-4" : "px-4"}
		>
			<div className="mb-3 flex shrink-0 items-center justify-between gap-3">
				<h3 className="text-sm font-semibold text-[var(--text)]">
					{isEditing
						? t("sexualHealth.encounter.edit_title", { defaultValue: "Edit encounter" })
						: t("sexualHealth.encounter.sheet_title", { defaultValue: "Log an encounter" })}
				</h3>
				<SheetCloseButton disabled={isSaving} />
			</div>

			{showPicker ? (
				<PersonPicker
					onPick={(picked) => {
						setPerson(picked);
						setChangingPerson(false);
					}}
				/>
			) : (
				<>
					<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
						<div className="space-y-5">
							<SheetSection title={t("sexualHealth.encounter.person", { defaultValue: "Who" })}>
								{/* Editing keeps the person; a new log can still swap them. */}
								<button
									type="button"
									disabled={isEditing}
									onClick={() => setChangingPerson(true)}
									className="flex w-full items-center gap-3 rounded-2xl bg-[var(--surface-2)] px-3 py-2.5 text-left transition hover:ink-tint-8 disabled:hover-fill"
								>
									<div className="h-10 w-10 shrink-0 rounded-full overflow-hidden bg-[var(--surface)] drop-shadow-sm">
										<ProfileImage src={person!.avatarSrc} alt={person!.displayName} />
									</div>
									<span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text)]">{person!.displayName}</span>
									{!isEditing && (
										<span className="shrink-0 text-xs font-semibold text-[var(--accent)]">
											{t("sexualHealth.encounter.change_person", { defaultValue: "Change" })}
										</span>
									)}
								</button>
							</SheetSection>

							<SheetSection
								title={t("sexualHealth.encounter.when", { defaultValue: "When" })}
								value={isEditing ? formatDateTime(editingEncounter.occurredAt) : undefined}
							>
								{!isEditing && (
									<input
										type="datetime-local"
										value={occurredAt}
										onChange={(event) => setOccurredAt(event.target.value)}
										className={cn(SHEET_FIELD_CLASS, "h-11 px-3")}
									/>
								)}
							</SheetSection>

							<SheetSection title={t("sexualHealth.encounter.protection", { defaultValue: "Protection" })}>
								<div className="flex flex-wrap gap-2">
									{PROTECTION_TAGS.map((tag) => (
										<SheetChip key={tag} active={tags.includes(tag)} onClick={() => toggleTag(tag)}>
											{tag}
										</SheetChip>
									))}
								</div>
							</SheetSection>

							<SheetSection title={t("sexualHealth.encounter.note", { defaultValue: "Note (optional)" })}>
								<textarea
									value={note}
									onChange={(event) => setNote(event.target.value)}
									rows={3}
									className={cn(SHEET_FIELD_CLASS, "resize-none px-4 py-3")}
								/>
							</SheetSection>
						</div>
					</div>

					<div className={SHEET_FOOTER_CLASS}>
						{isEditing && (
							<button
								type="button"
								onClick={() => setIsConfirmingDelete(true)}
								disabled={isSaving || isDeleting}
								aria-label={t("sexualHealth.encounter.delete", { defaultValue: "Delete encounter" })}
								className={cn(SHEET_FOOTER_ICON_BUTTON_CLASS, "bg-red-500/12 text-red-500 hover:bg-red-500/20 hover:text-red-500")}
							>
								<Trash2 className="h-4 w-4" />
							</button>
						)}
						<button
							type="button"
							onClick={() => void handleSubmit()}
							disabled={isSaving}
							className={sheetButtonClass()}
						>
							{isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("sexualHealth.encounter.save", { defaultValue: "Save" })}
						</button>
					</div>
				</>
			)}

			<ConfirmDialog
				isOpen={isConfirmingDelete}
				title={t("sexualHealth.encounter.delete_confirm_title", { defaultValue: "Delete this encounter?" })}
				message={t("sexualHealth.encounter.delete_confirm_message", { defaultValue: "This can't be undone." })}
				confirmLabel={t("sexualHealth.encounter.delete_confirm_action", { defaultValue: "Delete" })}
				cancelLabel={t("sexualHealth.encounter.cancel", { defaultValue: "Cancel" })}
				confirmTone="danger"
				isProcessing={isDeleting}
				onCancel={() => setIsConfirmingDelete(false)}
				onConfirm={() => void handleDelete()}
			/>
		</BottomSheet>,
		document.body,
	);
}
