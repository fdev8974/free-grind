import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Check, Inbox, Loader2, X } from "lucide-react";
import { BottomSheet, SheetCloseButton } from "../../../components/ui/bottom-sheet";
import { SHEET_GROUP_CLASS } from "../../../components/ui/sheet-section";
import { ProfileImage } from "../../../components/ui/profile-image";
import { useDesktopBreakpoint } from "../../../hooks/useDesktopBreakpoint";
import { useApiFunctions } from "../../../hooks/useApiFunctions";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { formatDistance } from "../gridpage/utils";
import { formatRelativeTime } from "../../../utils/relativeTime";
import { getThumbImageUrl, validateMediaHash } from "../../../utils/media";
import { appLog } from "../../../utils/logger";
import { DrawerEmptyState } from "../chat/drawerUi";
import type { RightNowReceivedRequest } from "../../../types/right-now";

/** Requests still waiting for an answer. */
export function pendingRightNowRequests(requests: RightNowReceivedRequest[] | undefined): RightNowReceivedRequest[] {
	return (requests ?? []).filter((request) => request.status === "PENDING");
}

/**
 * Right Now requests to our (discreet) post. Accepting one makes the server
 * open a chat with the requester.
 */
export function RightNowRequestsSheet({
	requests,
	onClose,
}: {
	requests: RightNowReceivedRequest[];
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const isDesktop = useDesktopBreakpoint();

	return (
		<BottomSheet
			onClose={onClose}
			isDesktop={isDesktop}
			bg="bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]"
			panelClassName="max-h-[92dvh] px-4"
			accentColor="var(--right-now)"
		>
			<div className="mb-3 flex items-center justify-between gap-3">
				<h3 className="text-sm font-semibold text-[var(--text)]">
					{t("right_now.requests_title", { defaultValue: "Requests" })}
				</h3>
				<SheetCloseButton />
			</div>

			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-4" data-lenis-prevent>
				{requests.length === 0 ? (
					<div style={{ "--accent": "var(--right-now)", "--accent-contrast": "#fff" } as React.CSSProperties}>
						<DrawerEmptyState
							icon={<Inbox className="h-5 w-5" />}
							fanned={false}
							title={t("right_now.requests_empty_title", { defaultValue: "No requests" })}
							hint={t("right_now.requests_empty_hint", {
								defaultValue: "When someone asks to connect about your discreet post, it shows up here.",
							})}
						/>
					</div>
				) : (
					<div className={SHEET_GROUP_CLASS}>
						{requests.map((request) => (
							<RequestRow key={request.id} request={request} />
						))}
					</div>
				)}
			</div>
		</BottomSheet>
	);
}

function RequestRow({ request }: { request: RightNowReceivedRequest }) {
	const { t } = useTranslation();
	const { unitsPreset } = usePreferences();
	const apiFunctions = useApiFunctions();
	const queryClient = useQueryClient();
	const [answering, setAnswering] = useState<"ACCEPTED" | "REJECTED" | null>(null);

	const avatarUrl =
		request.primaryMediaHash && validateMediaHash(request.primaryMediaHash)
			? getThumbImageUrl(request.primaryMediaHash)
			: null;
	const name = request.displayName?.trim() || t("common.unknown_display_name");
	const distance = request.distance != null ? formatDistance(request.distance, t, unitsPreset) : null;
	const timeAgo = formatRelativeTime(request.createdAt ?? null);
	const isOnline = typeof request.onlineUntil === "number" && request.onlineUntil > Date.now();

	const answer = async (status: "ACCEPTED" | "REJECTED") => {
		setAnswering(status);
		try {
			await apiFunctions.respondToRightNowRequest(request.id, status);
			if (status === "ACCEPTED") {
				toast.success(t("right_now.request_accepted_toast", { defaultValue: "Request accepted, a chat has been opened" }));
			}
			await queryClient.invalidateQueries({ queryKey: ["rightnow", "requests", "inbox"] });
		} catch (error) {
			appLog.error("Failed to answer Right Now request:", error);
			toast.error(
				error instanceof Error ? error.message : t("right_now.request_answer_error", { defaultValue: "Could not answer the request" }),
			);
		} finally {
			setAnswering(null);
		}
	};

	return (
		<div className="flex items-center gap-3 px-4 py-3">
			<div className="relative shrink-0">
				<div className="h-11 w-11 overflow-hidden rounded-full bg-[var(--surface-2)]">
					<ProfileImage src={avatarUrl} alt={name} />
				</div>
				{isOnline ? (
					<span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--surface)] bg-green-500" />
				) : null}
			</div>
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-semibold text-[var(--text)]">{name}</p>
				<p className="truncate text-xs text-[var(--text-muted)]">
					{[timeAgo, distance && distance !== "hidden" ? distance : null].filter(Boolean).join(" · ")}
				</p>
			</div>
			<button
				type="button"
				disabled={answering !== null}
				onClick={() => void answer("REJECTED")}
				aria-label={t("right_now.request_decline", { defaultValue: "Decline" })}
				title={t("right_now.request_decline", { defaultValue: "Decline" })}
				className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full ink-tint-8 text-[var(--text-muted)] transition active:scale-90 disabled:opacity-50"
			>
				{answering === "REJECTED" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
			</button>
			<button
				type="button"
				disabled={answering !== null}
				onClick={() => void answer("ACCEPTED")}
				aria-label={t("right_now.request_accept", { defaultValue: "Accept" })}
				title={t("right_now.request_accept", { defaultValue: "Accept" })}
				className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--right-now)] text-white transition active:scale-90 disabled:opacity-50"
			>
				{answering === "ACCEPTED" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
			</button>
		</div>
	);
}
