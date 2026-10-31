import type { HTMLAttributes, ImgHTMLAttributes } from "react";
import { ProfilePlaceholderIcon } from "../icons/ProfilePlaceholderIcon";
import { cn } from "../../utils/cn";
import { proxyMediaUrl } from "../../utils/mediaProxy";
import { PRIVACY_BLUR_CLASS, PRIVACY_BLUR_TRANSITION_CLASS, PRIVACY_HOVER_REVEAL_CLASS, useProfilePhotoPrivacy, type ProfilePhotoPrivacyScope } from "../../hooks/useProfilePhotoPrivacy";

interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
	src?: string | null;
	alt?: string;
	fallback?: string;
	imageProps?: ImgHTMLAttributes<HTMLImageElement>;
	/** Which NSFW settings apply (blur / safe-for-work placeholder); see useProfilePhotoPrivacy. */
	privacyScope?: ProfilePhotoPrivacyScope;
}

export function Avatar({
	src,
	alt = "Avatar",
	fallback,
	className,
	imageProps,
	privacyScope = "app",
	...props
}: AvatarProps) {
	const initials = fallback?.trim().slice(0, 2).toUpperCase();
	const privacy = useProfilePhotoPrivacy(privacyScope);

	return (
		<div
			className={cn(
				"inline-flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-xs font-semibold text-[var(--text-muted)]",
				className,
			)}
			{...props}
		>
			{src && privacy !== "hide" ? (
				<img
					src={proxyMediaUrl(src)}
					alt={alt}
					{...imageProps}
					className={cn("h-full w-full object-cover", PRIVACY_BLUR_TRANSITION_CLASS, privacy === "blur" && `${PRIVACY_BLUR_CLASS} ${PRIVACY_HOVER_REVEAL_CLASS}`, imageProps?.className)}
				/>
			) : initials ? (
				<span>{initials}</span>
			) : (
				<ProfilePlaceholderIcon className="h-5 w-5" />
			)}
		</div>
	);
}
