import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ChevronDown } from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "../../utils/cn";
import type { AuthError } from "../../contexts/auth-context";

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

/** `detail` is raw technical text, folded away so it can still be copied into a bug report. */
export function AuthErrorBox({ message, detail }: { message: string; detail?: string }) {
	const { t } = useTranslation();
	const [showDetail, setShowDetail] = useState(false);
	const hasDetail = !!detail && detail !== message;
	return (
		<div
			role="alert"
			className="animate-fade-in rounded-2xl bg-red-500/12 px-3 py-2.5 text-sm text-[var(--text)]"
		>
			<div className="flex items-start gap-2">
				<AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
				<span className="min-w-0 flex-1 leading-snug">{message}</span>
				{hasDetail ? (
					<button
						type="button"
						onClick={() => setShowDetail((prev) => !prev)}
						aria-expanded={showDetail}
						className="flex shrink-0 items-center gap-0.5 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
					>
						{t("auth.common.error_details", { defaultValue: "Details" })}
						<ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", showDetail && "rotate-180")} />
					</button>
				) : null}
			</div>
			{hasDetail && showDetail ? (
				<p className="animate-fade-in mt-2 select-text break-words font-mono text-xs text-[var(--text-muted)]">{detail}</p>
			) : null}
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
	error: string | AuthError | null;
	loading: boolean;
	disabled: boolean;
	loadingLabel: string;
	label: string;
}) {
	return (
		<>
			{typeof error === "string" ? (
				<AuthErrorBox message={error} />
			) : error ? (
				<AuthErrorBox message={error.message} detail={error.detail} />
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
