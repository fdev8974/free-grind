import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import { Card } from "./card";
import { Button } from "./button";

export function LoadingState({
	title = "Loading",
	description,
	compact = false,
}: {
	title?: string;
	description?: string;
	compact?: boolean;
}) {
	return (
		<Card variant="native" className={compact ? "p-4" : "p-5 sm:p-6"}>
			<div className="flex items-center gap-3">
				<Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" />
				<div>
					<p className="text-sm font-semibold">{title}</p>
					{description ? (
						<p className="text-sm text-[var(--text-muted)]">{description}</p>
					) : null}
				</div>
			</div>
		</Card>
	);
}

export function EmptyState({
	title,
	description,
	action,
}: {
	title: string;
	description?: string;
	action?: React.ReactNode;
}) {
	return (
		<Card variant="native" className="p-5 sm:p-6">
			<div className="flex items-start gap-3">
				<div className="rounded-xl ink-tint-8 p-2.5">
					<Inbox className="h-4 w-4 text-[var(--text-muted)]" />
				</div>
				<div className="grid gap-2">
					<p className="text-sm font-semibold">{title}</p>
					{description ? (
						<p className="text-sm text-[var(--text-muted)]">{description}</p>
					) : null}
					{action}
				</div>
			</div>
		</Card>
	);
}

export function ErrorState({
	title = "Something went wrong",
	description,
	onRetry,
	retryLabel = "Retry",
}: {
	title?: string;
	description?: string;
	onRetry?: () => void;
	retryLabel?: string;
}) {
	return (
		<Card variant="native" className="p-5 sm:p-6">
			<div className="flex items-start gap-3">
				<div className="rounded-xl bg-red-500/12 p-2.5 text-red-500">
					<AlertCircle className="h-4 w-4" />
				</div>
				<div className="grid gap-2">
					<p className="text-sm font-semibold">{title}</p>
					{description ? (
						<p className="text-sm text-[var(--text-muted)]">{description}</p>
					) : null}
					{onRetry ? (
						<Button onClick={onRetry} size="sm" className="w-fit">
							{retryLabel}
						</Button>
					) : null}
				</div>
			</div>
		</Card>
	);
}
