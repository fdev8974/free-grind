import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, Check, Loader2, MapPin, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
	BottomSheet,
	SheetCloseButton,
	SHEET_FOOTER_CLASS,
	SHEET_FOOTER_ICON_BUTTON_CLASS,
	sheetButtonClass,
} from "../../../components/ui/bottom-sheet";
import { NATIVE_SHEET_BG } from "../../../components/ui/action-sheet";
import { SHEET_FIELD_CLASS, SheetChip, SheetSection, SheetTextInput } from "../../../components/ui/sheet-section";
import { LoadingState } from "../../../components/ui/states";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { useRevealOnScroll } from "../../../hooks/useRevealOnScroll";
import { useDesktopBreakpoint } from "../../../hooks/useDesktopBreakpoint";
import { cn } from "../../../utils/cn";
import {
	addAppointment,
	completeAppointment,
	deleteAppointment,
	loadAppointments,
	updateAppointment,
	type Appointment,
} from "../../../services/appointments";
import { formatDateTime, fromDateTimeLocalValue, toDateTimeLocalValue } from "./sexualHealthFormat";
import { SexualHealthFab } from "./SexualHealthFab";
import { SexualHealthEmptyState } from "./SexualHealthEmptyState";

const KIND_LABEL_KEYS: Record<Appointment["kind"], string> = {
	prep_followup: "sexualHealth.appointments.kind_prep_followup",
	sti_screening: "sexualHealth.appointments.kind_sti_screening",
	other: "sexualHealth.appointments.kind_other",
};

function AppointmentFormSheet({
	editingAppointment,
	onClose,
	onSaved,
	onDelete,
}: {
	editingAppointment?: Appointment;
	onClose: () => void;
	onSaved: () => void;
	onDelete?: () => void;
}) {
	const { t } = useTranslation();
	const isDesktop = useDesktopBreakpoint();
	const [title, setTitle] = useState(editingAppointment?.title ?? "");
	const [scheduledAt, setScheduledAt] = useState(() =>
		toDateTimeLocalValue(editingAppointment?.scheduledAt ?? Date.now() + 24 * 60 * 60 * 1000),
	);
	const [kind, setKind] = useState<Appointment["kind"]>(editingAppointment?.kind ?? "prep_followup");
	const [location, setLocation] = useState(editingAppointment?.location ?? "");
	const [note, setNote] = useState(editingAppointment?.note ?? "");
	const [isSaving, setIsSaving] = useState(false);
	const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	// Saving and deleting close the sheet animated; onClose then unmounts it.
	const sheetCloseRef = useRef<(() => void) | null>(null);

	const handleSubmit = async () => {
		if (!title.trim()) return;
		setIsSaving(true);
		try {
			if (editingAppointment) {
				await updateAppointment({
					id: editingAppointment.id,
					title: title.trim(),
					scheduledAt: fromDateTimeLocalValue(scheduledAt),
					kind,
					location: location.trim() || null,
					note: note.trim() || null,
					completedAt: editingAppointment.completedAt,
				});
			} else {
				await addAppointment({
					title: title.trim(),
					scheduledAt: fromDateTimeLocalValue(scheduledAt),
					kind,
					location: location.trim() || null,
					note: note.trim() || null,
				});
			}
			onSaved();
			sheetCloseRef.current?.();
		} finally {
			setIsSaving(false);
		}
	};

	const handleDelete = async () => {
		if (!editingAppointment) return;
		setIsDeleting(true);
		try {
			await deleteAppointment(editingAppointment.id);
			onDelete?.();
			sheetCloseRef.current?.();
		} finally {
			setIsDeleting(false);
			setIsConfirmingDelete(false);
		}
	};

	// Portalled to document.body — see EncounterLogSheet.tsx for why
	// (avoids the FeedScrollContainer mask-image containing-block issue).
	const editing = editingAppointment != null;
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
					{editingAppointment
						? t("sexualHealth.appointments.edit_title", { defaultValue: "Edit appointment" })
						: t("sexualHealth.appointments.add_title", { defaultValue: "Add appointment" })}
				</h3>
				<SheetCloseButton disabled={isSaving} />
			</div>

			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
				<div className="space-y-5">
					<SheetSection title={t("sexualHealth.appointments.field_title", { defaultValue: "Title" })}>
						<SheetTextInput
							value={title}
							onChange={setTitle}
							placeholder={t("sexualHealth.appointments.field_title_placeholder", { defaultValue: "Follow-up appointment" })}
							autoFocus={!editing}
						/>
					</SheetSection>
					<SheetSection title={t("sexualHealth.appointments.field_when", { defaultValue: "When" })}>
						<input
							type="datetime-local"
							value={scheduledAt}
							onChange={(event) => setScheduledAt(event.target.value)}
							className={cn(SHEET_FIELD_CLASS, "h-11 px-3")}
						/>
					</SheetSection>
					<SheetSection title={t("sexualHealth.appointments.field_kind", { defaultValue: "Type" })}>
						<div className="flex flex-wrap gap-2">
							{(Object.keys(KIND_LABEL_KEYS) as Appointment["kind"][]).map((value) => (
								<SheetChip key={value} active={kind === value} onClick={() => setKind(value)}>
									{t(KIND_LABEL_KEYS[value])}
								</SheetChip>
							))}
						</div>
					</SheetSection>
					<SheetSection title={t("sexualHealth.appointments.field_location", { defaultValue: "Location (optional)" })}>
						<SheetTextInput value={location} onChange={setLocation} />
					</SheetSection>
					<SheetSection title={t("sexualHealth.appointments.field_note", { defaultValue: "Note (optional)" })}>
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
				{editing && (
					<button
						type="button"
						onClick={() => setIsConfirmingDelete(true)}
						disabled={isSaving || isDeleting}
						aria-label={t("sexualHealth.appointments.delete", { defaultValue: "Delete" })}
						className={cn(SHEET_FOOTER_ICON_BUTTON_CLASS, "bg-red-500/12 text-red-500 hover:bg-red-500/20 hover:text-red-500")}
					>
						<Trash2 className="h-4 w-4" />
					</button>
				)}
				<button
					type="button"
					onClick={() => void handleSubmit()}
					disabled={isSaving || !title.trim()}
					className={sheetButtonClass()}
				>
					{isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("sexualHealth.appointments.save", { defaultValue: "Save" })}
				</button>
			</div>

			<ConfirmDialog
				isOpen={isConfirmingDelete}
				title={t("sexualHealth.appointments.delete_confirm_title", { defaultValue: "Delete this appointment?" })}
				message={t("sexualHealth.appointments.delete_confirm_message", { defaultValue: "This can't be undone." })}
				confirmLabel={t("sexualHealth.appointments.delete_confirm_action", { defaultValue: "Delete" })}
				cancelLabel={t("sexualHealth.appointments.cancel", { defaultValue: "Cancel" })}
				confirmTone="danger"
				isProcessing={isDeleting}
				onCancel={() => setIsConfirmingDelete(false)}
				onConfirm={() => void handleDelete()}
			/>
		</BottomSheet>,
		document.body,
	);
}

function AppointmentRow({
	appointment,
	onToggleDone,
	onEdit,
	onDelete,
}: {
	appointment: Appointment;
	onToggleDone: () => void;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const { t } = useTranslation();
	const { ref, revealClass } = useRevealOnScroll();

	return (
		<div
			ref={ref}
			onClick={onEdit}
			className={cn(
				"flex cursor-pointer items-center gap-4 border-b border-[var(--surface-2)] py-3 pl-4 pr-4 transition-colors hover:bg-[var(--surface-2)]/50",
				revealClass,
			)}
		>
			<button
				type="button"
				onClick={(event) => {
					event.stopPropagation();
					onToggleDone();
				}}
				className={`h-15 w-15 shrink-0 squircle drop-shadow-sm flex items-center justify-center transition-colors active:scale-95 ${
					appointment.completedAt != null
						? "bg-emerald-500 text-white"
						: "bg-[var(--surface-2)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]/70"
				}`}
				aria-label={
					appointment.completedAt != null
						? t("sexualHealth.appointments.mark_undone", { defaultValue: "Mark as not done" })
						: t("sexualHealth.appointments.mark_done", { defaultValue: "Mark done" })
				}
			>
				{appointment.completedAt != null ? <Check className="h-6 w-6" /> : <Calendar className="h-6 w-6" />}
			</button>
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-bold text-[var(--text)]">{appointment.title}</p>
				<p className="mt-0.5 truncate text-xs font-medium text-[var(--text-muted)]">
					{formatDateTime(appointment.scheduledAt)}
					{appointment.location ? (
						<span className="inline-flex items-center gap-1">
							{" · "}
							<MapPin className="h-3 w-3" />
							{appointment.location}
						</span>
					) : null}
				</p>
			</div>
			<button
				type="button"
				onClick={(event) => {
					event.stopPropagation();
					onDelete();
				}}
				className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-red-500/35 text-red-400 transition-all active:scale-95 hover:border-red-500/45"
				style={{
					backgroundColor: "color-mix(in srgb, #ef4444, transparent 92%)",
					boxShadow: "0 2px 8px color-mix(in srgb, #ef4444, transparent 94%)",
				}}
				aria-label={t("sexualHealth.appointments.delete", { defaultValue: "Delete" })}
			>
				<Trash2 className="h-4 w-4" />
			</button>
		</div>
	);
}

export function SexualHealthAppointmentsTab({
	headerSlotEl,
	fabSlotEl,
}: {
	headerSlotEl: HTMLDivElement | null;
	fabSlotEl: HTMLDivElement | null;
}) {
	const { t } = useTranslation();
	const [appointments, setAppointments] = useState<Appointment[] | null>(null);
	const [isAddOpen, setIsAddOpen] = useState(false);
	const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
	const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);

	const reload = () => {
		void loadAppointments().then(setAppointments);
	};

	useEffect(() => {
		reload();
	}, []);

	const upcoming = (appointments ?? []).filter((appointment) => appointment.completedAt == null);
	const past = (appointments ?? []).filter((appointment) => appointment.completedAt != null);

	const renderRow = (appointment: Appointment) => (
		<AppointmentRow
			key={appointment.id}
			appointment={appointment}
			onToggleDone={() => void completeAppointment(appointment.id, appointment.completedAt == null).then(() => reload())}
			onEdit={() => setEditingAppointment(appointment)}
			onDelete={() => setPendingDeleteId(appointment.id)}
		/>
	);

	return (
		<>
			{headerSlotEl && appointments !== null &&
				createPortal(
					upcoming.length > 0
						? t("sexualHealth.appointments.subtitle_upcoming", { count: upcoming.length })
						: t("sexualHealth.appointments.subtitle_none_upcoming"),
					headerSlotEl,
				)}
			<div className="grid gap-4">
				{appointments === null ? (
					<div className="px-[var(--app-px)]">
						<LoadingState title={t("sexualHealth.appointments.loading", { defaultValue: "Loading appointments…" })} />
					</div>
				) : upcoming.length === 0 && past.length === 0 ? (
					<SexualHealthEmptyState
						icon={<Calendar className="h-5 w-5" />}
						title={t("sexualHealth.appointments.empty", { defaultValue: "No appointments yet" })}
						description={t("sexualHealth.appointments.empty_desc", { defaultValue: "Add a follow-up or screening appointment." })}
					/>
				) : (
					<>
						{upcoming.length > 0 && <div>{upcoming.map(renderRow)}</div>}
						{past.length > 0 && (
							<details className="px-[var(--app-px)]">
								<summary className="cursor-pointer px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
									{t("sexualHealth.appointments.past", { defaultValue: "Past" })} ({past.length})
								</summary>
								<div className="-mx-[var(--app-px)] mt-2 opacity-70">{past.map(renderRow)}</div>
							</details>
						)}
					</>
				)}
			</div>

			{!isAddOpen && !editingAppointment && (
				<SexualHealthFab
					slotEl={fabSlotEl}
					onClick={() => setIsAddOpen(true)}
					icon={<Plus className="h-8 w-8 stroke-[3]" />}
					label={t("sexualHealth.appointments.add", { defaultValue: "Add appointment" })}
				/>
			)}

			{isAddOpen && (
				<AppointmentFormSheet
					onClose={() => setIsAddOpen(false)}
					onSaved={reload}
				/>
			)}

			{editingAppointment && (
				<AppointmentFormSheet
					editingAppointment={editingAppointment}
					onClose={() => setEditingAppointment(null)}
					onSaved={reload}
					onDelete={reload}
				/>
			)}

			<ConfirmDialog
				isOpen={pendingDeleteId != null}
				title={t("sexualHealth.appointments.delete_confirm_title", { defaultValue: "Delete this appointment?" })}
				message={t("sexualHealth.appointments.delete_confirm_message", { defaultValue: "This can't be undone." })}
				confirmLabel={t("sexualHealth.appointments.delete_confirm_action", { defaultValue: "Delete" })}
				cancelLabel={t("sexualHealth.appointments.cancel", { defaultValue: "Cancel" })}
				confirmTone="danger"
				isProcessing={isDeleting}
				onCancel={() => setPendingDeleteId(null)}
				onConfirm={async () => {
					if (!pendingDeleteId) return;
					setIsDeleting(true);
					try {
						await deleteAppointment(pendingDeleteId);
						reload();
					} finally {
						setIsDeleting(false);
						setPendingDeleteId(null);
					}
				}}
			/>
		</>
	);
}
