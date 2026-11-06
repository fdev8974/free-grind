import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RightNowIcon } from "../../../components/icons/RightNowIcon";
import { PRIVACY_BLUR_CLASS, PRIVACY_HOVER_REVEAL_CLASS, useMediaBlur } from "../../../hooks/useProfilePhotoPrivacy";
import { getThumbImageUrl, validateMediaHash } from "../../../utils/media";
import { cn } from "../../../utils/cn";

type RightNowRequestBody = {
	postStatus: string | null;
	photo: { mediaHash: string; isNsfw: boolean } | null;
};

/**
 * Reads a RightNowRequestBody: {requestId, requestCreatedAt,
 * requestUpdatedAt, postStatus, postId, medias: [{mediaHash, isNsfw}]}.
 */
export function parseRightNowRequestBody(body: unknown): RightNowRequestBody {
	const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
	const medias = Array.isArray(b.medias) ? b.medias : [];
	let photo: RightNowRequestBody["photo"] = null;
	for (const media of medias) {
		const m = (media && typeof media === "object" ? media : {}) as Record<string, unknown>;
		if (typeof m.mediaHash === "string" && validateMediaHash(m.mediaHash)) {
			photo = { mediaHash: m.mediaHash, isNsfw: m.isNsfw === true };
			break;
		}
	}
	return {
		postStatus: typeof b.postStatus === "string" ? b.postStatus : null,
		photo,
	};
}

/**
 * A "RightNowRequest" message. Receive-only on the API side: the post's
 * author sends it by accepting a Right Now request, which also opens this
 * chat. So "mine" means we accepted their request to our discreet post.
 */
export function RightNowRequestBubble({ body, mine }: { body: unknown; mine: boolean }) {
	const { t } = useTranslation();
	const { rightNow: blurRightNowMedia } = useMediaBlur();
	const { postStatus, photo } = parseRightNowRequestBody(body);
	const [photoFailed, setPhotoFailed] = useState(false);
	// postStatus is opaque per the API docs; only the two obvious values are shown.
	const statusLabel =
		postStatus === "ACTIVE"
			? t("chat.thread.right_now_post_active", { defaultValue: "Post is live" })
			: postStatus === "EXPIRED"
				? t("chat.thread.right_now_post_ended", { defaultValue: "Post has ended" })
				: null;
	const shouldBlurPhoto = photo != null && (photo.isNsfw || blurRightNowMedia);

	return (
		<div
			className={cn(
				"group/reveal relative mt-1 flex overflow-hidden rounded-[6px] text-xs",
				mine ? "bg-black/20" : "bg-[color-mix(in_srgb,var(--right-now)_14%,transparent)]",
			)}
		>
			<div className={cn("absolute left-0 top-0 h-full w-[3px] shrink-0", mine ? "bg-white/60" : "bg-[var(--right-now)]")} />
			<div className="flex min-w-0 flex-1 items-start gap-2.5 py-[13px] pl-[13px] pr-2.5">
				<span
					className={cn(
						"flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
						mine ? "bg-white/20 text-white" : "bg-[var(--right-now)] text-white",
					)}
				>
					<RightNowIcon className="h-3.5 w-3.5" />
				</span>
				<div className="min-w-0 flex-1">
					<p className="mb-0.5 truncate font-semibold">
						{t("chat.thread.right_now_request", { defaultValue: "Right Now request" })}
					</p>
					<p className="opacity-80">
						{mine
							? t("chat.thread.right_now_request_mine", { defaultValue: "You accepted their request to your discreet post." })
							: t("chat.thread.right_now_request_theirs", { defaultValue: "Accepted your Right Now request." })}
					</p>
					{statusLabel ? (
						<p className="mt-1 flex items-center gap-1.5 text-[11px] opacity-70">
							<span className={cn("h-1.5 w-1.5 rounded-full", postStatus === "ACTIVE" ? "bg-green-500" : "bg-current opacity-50")} />
							{statusLabel}
						</p>
					) : null}
				</div>
			</div>
			{photo && !photoFailed ? (
				<div className="relative w-14 shrink-0 self-stretch overflow-hidden">
					<img
						src={getThumbImageUrl(photo.mediaHash, "320x320")}
						alt=""
						onError={() => setPhotoFailed(true)}
						className={cn("absolute inset-0 h-full w-full object-cover", shouldBlurPhoto && `${PRIVACY_BLUR_CLASS} ${PRIVACY_HOVER_REVEAL_CLASS}`)}
					/>
				</div>
			) : null}
		</div>
	);
}
