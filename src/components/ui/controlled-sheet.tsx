import { useEffect, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { BottomSheet } from "./bottom-sheet";

type ControlledBottomSheetProps = Omit<ComponentProps<typeof BottomSheet>, "onClose" | "closeRef"> & {
	isOpen: boolean;
	/** The user dismissed it (swipe, back, backdrop, a SheetClose) while still open. */
	onDismiss: () => void;
};

/**
 * A BottomSheet driven by an `isOpen` flag, for dialog-style components
 * (ConfirmDialog, PromptDialog, …) whose callers only toggle a boolean: it
 * slides in when `isOpen` turns true and slides out (popping its history
 * entry) when it turns false, instead of vanishing on unmount. Portaled to
 * the body, so it works from inside masked or transformed containers.
 */
export function ControlledBottomSheet({ isOpen, onDismiss, ...sheetProps }: ControlledBottomSheetProps) {
	const [isMounted, setIsMounted] = useState(isOpen);
	const closeRef = useRef<(() => void) | null>(null);
	const isOpenRef = useRef(isOpen);
	isOpenRef.current = isOpen;

	useEffect(() => {
		if (isOpen) setIsMounted(true);
		// Closed by the caller (confirmed, cancelled): slide out, then unmount.
		else closeRef.current?.();
	}, [isOpen]);

	if (!isMounted) return null;
	return createPortal(
		<BottomSheet
			{...sheetProps}
			closeRef={closeRef}
			onClose={() => {
				setIsMounted(false);
				if (isOpenRef.current) onDismiss();
			}}
		/>,
		document.body,
	);
}
