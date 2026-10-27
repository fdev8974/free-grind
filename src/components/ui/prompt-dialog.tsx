import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";
import { cn } from "../../utils/cn";
import { NATIVE_SHEET_BG } from "./action-sheet";
import { SheetClose, SheetCloseButton, SHEET_FOOTER_CLASS, sheetButtonClass } from "./bottom-sheet";
import { ControlledBottomSheet } from "./controlled-sheet";
import { SHEET_FIELD_CLASS } from "./sheet-section";

type PromptDialogProps = {
	isOpen: boolean;
	title: string;
	message: string;
	defaultValue?: string;
	placeholder?: string;
	confirmLabel: string;
	cancelLabel: string;
	onConfirm: (value: string) => void | Promise<void>;
	onCancel: () => void;
	isProcessing?: boolean;
	/** Lets the user confirm an empty value (e.g. to clear something) instead of disabling the confirm button. */
	allowEmpty?: boolean;
	/** Textarea height; 1 makes it a single-line field where Enter confirms. */
	rows?: number;
};

/** Asks for a short text (a nickname, a keyword, …) in a bottom sheet. */
export function PromptDialog({
	isOpen,
	title,
	message,
	defaultValue = "",
	placeholder,
	confirmLabel,
	cancelLabel,
	onConfirm,
	onCancel,
	isProcessing = false,
	allowEmpty = false,
	rows = 3,
}: PromptDialogProps) {
	const isDesktop = useDesktopBreakpoint();
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const [value, setValue] = useState(defaultValue);

	useEffect(() => {
		if (!isOpen) return;
		setValue(defaultValue);
		// Once the sheet (mounted on the next render) is in the DOM.
		const timer = setTimeout(() => {
			textareaRef.current?.focus();
			textareaRef.current?.select();
		}, 50);
		return () => clearTimeout(timer);
	}, [isOpen, defaultValue]);

	const trimmed = value.trim();

	const handleSubmit = () => {
		if ((!trimmed && !allowEmpty) || isProcessing) {
			return;
		}
		void onConfirm(trimmed);
	};

	return (
		<ControlledBottomSheet
			isOpen={isOpen}
			onDismiss={onCancel}
			isDesktop={isDesktop}
			isProcessing={isProcessing}
			bg={NATIVE_SHEET_BG}
			panelClassName="max-h-[92dvh] px-4"
		>
			<div className="mb-3 flex shrink-0 items-center justify-between gap-3">
				<h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
				<SheetCloseButton disabled={isProcessing} />
			</div>
			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
				{message ? <p className="mb-3 px-1 text-sm leading-relaxed text-[var(--text-muted)]">{message}</p> : null}
				<textarea
					ref={textareaRef}
					value={value}
					onChange={(event) => setValue(event.target.value)}
					placeholder={placeholder}
					onKeyDown={(event) => {
						if (rows === 1 && event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							handleSubmit();
						}
					}}
					disabled={isProcessing}
					rows={rows}
					enterKeyHint={rows === 1 ? "done" : undefined}
					className={cn(SHEET_FIELD_CLASS, "resize-none px-4 py-3 disabled:opacity-60")}
				/>
			</div>
			<div className={SHEET_FOOTER_CLASS}>
				<SheetClose disabled={isProcessing} className={sheetButtonClass("secondary")}>
					{cancelLabel}
				</SheetClose>
				<button
					type="button"
					onClick={handleSubmit}
					disabled={isProcessing || (!trimmed && !allowEmpty)}
					className={sheetButtonClass()}
				>
					{isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
					<span className="truncate">{confirmLabel}</span>
				</button>
			</div>
		</ControlledBottomSheet>
	);
}
