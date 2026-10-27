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
}

export function ProfileImage({ src, alt, className, iconClassName, privacyScope = "app", revealed = false }: ProfileImageProps) {
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
