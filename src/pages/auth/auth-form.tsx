import type { InputHTMLAttributes, ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "../../utils/cn";

export function IconInput({
	icon,
	className,
	rightSlot,
	...inputProps
}: { icon: ReactNode; rightSlot?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
	return (
		<div className="group relative">
			<span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] transition-colors duration-150 group-focus-within:text-[var(--accent)]">
				{icon}
			</span>
			<input {...inputProps} className={cn("input-field pl-9", rightSlot && "pr-10", className)} />
			{rightSlot ? (
				<span className="absolute right-3 top-1/2 -translate-y-1/2">{rightSlot}</span>
			) : null}
		</div>
	);
}

export function AuthErrorBox({ message }: { message: string }) {
	return (
		<div className="animate-fade-in flex items-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--border)_60%,#f87171_40%)] bg-[color-mix(in_srgb,var(--surface)_88%,#f87171_12%)] px-3 py-2.5 text-sm text-[var(--text)]">
			<AlertCircle className="h-4 w-4 shrink-0 text-[#f87171]" />
			<span>{message}</span>
		</div>
	);
}

export function AuthSubmitSection({
	error,
	loading,
	disabled,
	loadingLabel,
	label,
}: {
	error: string | null;
	loading: boolean;
	disabled: boolean;
	loadingLabel: string;
	label: string;
}) {
	return (
		<>
			{error ? (
				<AuthErrorBox message={error} />
			) : null}
			<div className="pt-1">
				<Button
					type="submit"
					variant="primary"
					loading={loading}
					disabled={disabled}
					className="w-full"
				>
					{loading ? loadingLabel : label}
				</Button>
			</div>
		</>
	);
}
