import { UserFilled } from "../icons/FilledIcons";
import { cn } from "../../utils/cn";
import { proxyMediaUrl } from "../../utils/mediaProxy";

interface ProfileImageProps {
	src?: string | null;
	alt?: string;
	className?: string;
	iconClassName?: string;
}

export function ProfileImage({ src, alt, className, iconClassName }: ProfileImageProps) {
	if (src) {
		return (
			<img
				src={proxyMediaUrl(src)}
				alt={alt}
				className={cn("h-full w-full object-cover", className)}
			/>
		);
	}

	return (
		<div
			className={cn(
				"flex h-full w-full items-center justify-center bg-[var(--surface-2)] text-[var(--text-muted)]",
				className,
			)}
		>
			<UserFilled className={cn("h-1/2 w-1/2", iconClassName)} />
		</div>
	);
}
