import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { BottomSheet, SheetClose, SheetCloseButton, sheetButtonClass, SHEET_FOOTER_FADE_CLASS } from "./bottom-sheet";

interface BottomDrawerProps {
	title: string;
	onClose: () => void;
	onConfirm: () => void;
	confirmLabel: string;
	cancelLabel?: string;
	isProcessing?: boolean;
	zIndex?: string;
	isDesktop?: boolean;
	footerLeft?: ReactNode;
	/** Sheet background class, see BottomSheet's `bg`. */
	bg?: string;
	children: ReactNode;
}

export function BottomDrawer({
	title,
	onClose,
	onConfirm,
	confirmLabel,
	cancelLabel,
	isProcessing = false,
	zIndex = "z-[60]",
	isDesktop = false,
	footerLeft,
	bg,
	children,
}: BottomDrawerProps) {
	return (
		<BottomSheet
			onClose={onClose}
			isDesktop={isDesktop}
			isProcessing={isProcessing}
			zIndex={zIndex}
			bg={bg}
		>
			<div className="flex items-center justify-between px-4 pb-3">
				<p className="text-sm font-semibold text-[var(--text)]">{title}</p>
				<SheetCloseButton disabled={isProcessing} />
			</div>
			{children}
			<div className={`flex shrink-0 gap-2.5 px-4 ${SHEET_FOOTER_FADE_CLASS}`}>
				{footerLeft}
				{cancelLabel && (
					<SheetClose
						disabled={isProcessing}
						className={sheetButtonClass("secondary")}
					>
						{cancelLabel}
					</SheetClose>
				)}
				<button
					type="button"
					onClick={onConfirm}
					disabled={isProcessing}
					className={sheetButtonClass()}
				>
					{isProcessing ? (
						<Loader2 className="mx-auto h-4 w-4 animate-spin" />
					) : (
						confirmLabel
					)}
				</button>
			</div>
		</BottomSheet>
	);
}
