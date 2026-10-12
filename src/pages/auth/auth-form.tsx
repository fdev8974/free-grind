import type { InputHTMLAttributes, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
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

/** "— or —" divider with a secondary button below: a route to open, or an action. */
export function AuthAltAction({
	icon,
	label,
	...target
}: { icon?: ReactNode; label: string } & ({ to: string } | { onClick: () => void })) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	return (
		<div className="mt-5 flex flex-col items-center gap-5">
			<div className="flex w-full items-center gap-3 text-xs uppercase tracking-wider text-[var(--text-muted)]">
				<span className="h-px flex-1 bg-[var(--border)]" />
				{t("auth.sign_in.or_divider", { defaultValue: "or" })}
				<span className="h-px flex-1 bg-[var(--border)]" />
			</div>
			<Button
				type="button"
				variant="secondary"
				onClick={"to" in target ? () => navigate(target.to) : target.onClick}
				leftIcon={icon}
				className="w-full"
			>
				{label}
			</Button>
		</div>
	);
}
