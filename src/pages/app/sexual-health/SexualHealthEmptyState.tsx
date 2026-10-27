import type { ReactNode } from "react";
import { DrawerEmptyState } from "../chat/drawerUi";

interface SexualHealthEmptyStateProps {
	icon: ReactNode;
	title: string;
	description?: string;
}

// The app's usual empty state (accent circle with a soft glow), centered in
// the tab's scroll area rather than just padded at the top.
export function SexualHealthEmptyState({ icon, title, description }: SexualHealthEmptyStateProps) {
	return (
		<div className="flex min-h-[60dvh] flex-col justify-center px-[var(--app-px)]">
			<DrawerEmptyState icon={icon} fanned={false} title={title} hint={description ?? ""} />
		</div>
	);
}
