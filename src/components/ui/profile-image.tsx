import { UserFilled } from "../icons/FilledIcons";
import { cn } from "../../utils/cn";
import { proxyMediaUrl } from "../../utils/mediaProxy";
import { PRIVACY_BLUR_CLASS, PRIVACY_BLUR_TRANSITION_CLASS, PRIVACY_HOVER_REVEAL_CLASS, useProfilePhotoPrivacy, type ProfilePhotoPrivacyScope } from "../../hooks/useProfilePhotoPrivacy";

interface ProfileImageProps {
	src?: string | null;
	alt?: string;
	className?: string;
	iconClassName?: string;
	/** Which NSFW settings apply (blur / safe-for-work placeholder); see useProfilePhotoPrivacy. */
	privacyScope?: ProfilePhotoPrivacyScope;
	/** Unblurred by the viewer (see useBlurReveal); has no effect on a hidden photo. */
	revealed?: boolean;
	/** Fallback without a photo: the plain icon (avatars), or for large tiles the
	 * same icon smaller and muted on a soft gradient, so photo-less tiles sit
	 * among photo tiles instead of standing out as flat grey boxes. */
	placeholder?: "icon" | "silhouette";
}

export function ProfileImage({ src, alt, className, iconClassName, privacyScope = "app", revealed = false, placeholder = "icon" }: ProfileImageProps) {
	const privacy = useProfilePhotoPrivacy(privacyScope);

	if (src && privacy !== "hide") {
		return (
			<img
				src={proxyMediaUrl(src)}
				alt={alt}
				className={cn("h-full w-full object-cover", PRIVACY_BLUR_TRANSITION_CLASS, privacy === "blur" && !revealed && `${PRIVACY_BLUR_CLASS} ${PRIVACY_HOVER_REVEAL_CLASS}`, className)}
			/>
		);
	}

	if (placeholder === "silhouette") {
		return (
			<div
				className={cn("flex h-full w-full items-center justify-center text-[var(--placeholder-tile-icon)]", className)}
				style={{ background: "linear-gradient(to bottom, var(--placeholder-tile-top), var(--placeholder-tile-bottom))" }}
			>
				<UserFilled className={cn("h-[42%] w-[42%] opacity-35", iconClassName)} />
			</div>
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
