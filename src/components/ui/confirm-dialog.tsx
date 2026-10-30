import { Loader2, ShieldAlert, TriangleAlert } from "lucide-react";
import { useEffect, useRef } from "react";
import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";
import { SheetClose, SHEET_FOOTER_CLASS, sheetButtonClass } from "./bottom-sheet";
import { NATIVE_SHEET_BG } from "./action-sheet";
import { ControlledBottomSheet } from "./controlled-sheet";

type ConfirmDialogProps = {
	isOpen: boolean;
	title: string;
	message: string;
	/** Shown as a prominent red callout below the message. */
	warning?: string;
	confirmLabel: string;
	cancelLabel: string;
	onConfirm: () => void | Promise<void>;
	onCancel: () => void;
	isProcessing?: boolean;
	confirmTone?: "default" | "danger";
	dontAskAgainLabel?: string;
	dontAskAgainChecked?: boolean;
	onDontAskAgainChange?: (checked: boolean) => void;
};

/** A confirm with a `warning` (a risky action, e.g. spoofing the location):
 * shown as a bottom sheet with a warning icon instead of a small alert, so
 * the risk gets the room it needs. Slides out when `isOpen` turns false. */
function RiskConfirmSheet({
	isOpen,
	title,
	message,
	warning,
	confirmLabel,
	cancelLabel,
	onConfirm,
	onCancel,
	isProcessing,
}: Required<Pick<ConfirmDialogProps, "isOpen" | "title" | "message" | "warning" | "confirmLabel" | "cancelLabel" | "onConfirm" | "onCancel" | "isProcessing">>) {
	const isDesktop = useDesktopBreakpoint();
	return (
		<ControlledBottomSheet
			isOpen={isOpen}
			onDismiss={onCancel}
			isDesktop={isDesktop}
			isProcessing={isProcessing}
			bg={NATIVE_SHEET_BG}
			panelClassName="max-h-[92dvh] px-4"
		>
			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
				<div className="flex flex-col items-center px-2 pt-2 text-center">
					<span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 text-red-500">
						<ShieldAlert className="h-7 w-7" />
					</span>
					<h3 className="mt-4 text-base font-semibold text-[var(--text)]">{title}</h3>
					<p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{message}</p>
				</div>
				<div role="alert" className="mt-5 flex items-start gap-3 rounded-2xl bg-red-500/10 px-4 py-3">
					<TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
					<p className="text-sm font-medium leading-relaxed text-red-500">{warning}</p>
				</div>
			</div>
			<div className={SHEET_FOOTER_CLASS}>
				<SheetClose disabled={isProcessing} className={sheetButtonClass("secondary")}>
					{cancelLabel}
				</SheetClose>
				<button
					type="button"
					onClick={() => void onConfirm()}
					disabled={isProcessing}
					className={sheetButtonClass("destructive")}
				>
					{isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
					<span className="truncate">{confirmLabel}</span>
				</button>
			</div>
		</ControlledBottomSheet>
	);
}

export function ConfirmDialog(props: ConfirmDialogProps) {
	if (props.warning) {
		return (
			<RiskConfirmSheet
				isOpen={props.isOpen}
				title={props.title}
				message={props.message}
				warning={props.warning}
				confirmLabel={props.confirmLabel}
				cancelLabel={props.cancelLabel}
				onConfirm={props.onConfirm}
				onCancel={props.onCancel}
				isProcessing={props.isProcessing ?? false}
			/>
		);
	}
	return <AlertConfirmDialog {...props} />;
}

function AlertConfirmDialog({
	isOpen,
	title,
	message,
	confirmLabel,
	cancelLabel,
	onConfirm,
	onCancel,
	isProcessing = false,
	confirmTone = "default",
	dontAskAgainLabel,
	dontAskAgainChecked = false,
	onDontAskAgainChange,
}: ConfirmDialogProps) {
	const dialogRef = useRef<HTMLDialogElement | null>(null);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) {
			return;
		}

		if (isOpen) {
			if (!dialog.open) {
				try {
					dialog.showModal();
				} catch {
					// Fallback avoids leaving the UI inert if showModal cannot transition state.
					dialog.show();
				}
			}
		} else if (dialog.open) {
			dialog.close();
		}
	}, [isOpen]);

	useEffect(() => {
		return () => {
			const dialog = dialogRef.current;
			if (dialog?.open) {
				dialog.close();
			}
		};
	}, []);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) {
			return;
		}

		const handleCancel = (event: Event) => {
			event.preventDefault();
			if (!isProcessing) {
				onCancel();
			}
		};

		dialog.addEventListener("cancel", handleCancel);
		return () => {
			dialog.removeEventListener("cancel", handleCancel);
		};
	}, [isProcessing, onCancel]);

	const confirmButtonClassName = sheetButtonClass(confirmTone === "danger" ? "destructive" : "primary");

	return (
		<dialog
			ref={dialogRef}
			// Borderless, so a soft shadow lifts it off the dimmed page.
			className="fixed inset-0 m-auto h-fit w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)] p-0 text-[var(--text)] shadow-[0_2px_8px_rgba(0,0,0,0.25),0_12px_48px_rgba(0,0,0,0.5)] backdrop:bg-black/45"
			onClick={(event) => {
				if (event.target === dialogRef.current && !isProcessing) {
					onCancel();
				}
			}}
		>
			{/* Light accent tint over the fill, like the cards. As an overlay
			    (accent-tint) rather than a color-mix fill: the build's fallback for
			    a color-mix with the accent first would paint the dialog solid accent. */}
			<div className="accent-tint-6 rounded-[inherit] p-4">
				<p className="text-sm font-semibold text-[var(--text)]">{title}</p>
				<p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{message}</p>

				{dontAskAgainLabel && onDontAskAgainChange ? (
					<label className="mt-4 flex cursor-pointer items-center justify-between gap-3 text-sm text-[var(--text-muted)]">
						<span>{dontAskAgainLabel}</span>
						<span className="relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer items-center">
							<input
								type="checkbox"
								checked={dontAskAgainChecked}
								onChange={(event) => onDontAskAgainChange(event.target.checked)}
								disabled={isProcessing}
								className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
							/>
							<span className="absolute inset-0 rounded-full bg-[color-mix(in_srgb,var(--sheet-bg,var(--surface))_82%,var(--accent))] transition-colors peer-checked:bg-[var(--accent)] peer-disabled:opacity-60" />
							<span className="absolute left-1 h-5 w-5 rounded-full bg-[var(--text)] transition-transform peer-checked:translate-x-5 peer-checked:bg-[var(--accent-contrast)]" />
						</span>
					</label>
				) : null}

				<div className="mt-6 flex gap-2">
					<button
						type="button"
						onClick={onCancel}
						disabled={isProcessing}
						className={sheetButtonClass("accent")}
					>
						{cancelLabel}
					</button>
					<button
						type="button"
						onClick={() => void onConfirm()}
						disabled={isProcessing}
						className={confirmButtonClassName}
					>
						{isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
						<span>{confirmLabel}</span>
					</button>
				</div>
			</div>
		</dialog>
	);
}
