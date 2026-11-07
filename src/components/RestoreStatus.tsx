import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, CircleDashed, CirclePause, ChevronRight, History, Loader2, UserRoundCheck } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { BottomSheet, SheetCloseButton } from "./ui/bottom-sheet";
import { ConfirmDialog } from "./ui/confirm-dialog";
import { useAuth } from "../contexts/useAuth";
import { useApiFunctions } from "../hooks/useApiFunctions";
import { useDesktopBreakpoint } from "../hooks/useDesktopBreakpoint";
import { runRestoredBlocklist } from "../services/ownBlocklist";
import { runRestoredFavorites } from "../services/restoredFavorites";
import { runRestoredDrawerUpload } from "../services/restoredDrawerMedia";
import { runRestoredOwnAlbums } from "../services/ownAlbums";
import { stopRestoreTask } from "../services/stopRestoreTask";
import {
	SHOW_RESTORED_PROFILE_PROMPT_EVENT,
	useRestoreTasks,
	type RestoreTask,
	type RestoreTaskId,
} from "../services/restoreStatus";

function useTaskLabels(): Record<RestoreTaskId, string> {
	const { t } = useTranslation();
	return {
		profile_details: t("restore_status.task_profile_details", { defaultValue: "Profile details" }),
		profile_photos: t("restore_status.task_profile_photos", { defaultValue: "Profile photos" }),
		blocked_profiles: t("restore_status.task_blocked_profiles", { defaultValue: "Blocked profiles" }),
		favorites: t("restore_status.task_favorites", { defaultValue: "Favorites" }),
		drawer_media: t("restore_status.task_drawer_media", { defaultValue: "Drawer media" }),
		own_albums: t("restore_status.task_own_albums", { defaultValue: "My albums" }),
	};
}

function useTaskStatusText(): (task: RestoreTask) => string {
	const { t, i18n } = useTranslation();
	const numberFormat = new Intl.NumberFormat(i18n.language);
	return (task) => {
		const left = numberFormat.format(task.total);
		switch (task.state) {
			case "running":
				return task.total > 1
					? t("restore_status.state_running_count", {
							defaultValue: "{{done}} of {{total}}",
							done: numberFormat.format(task.done),
							total: numberFormat.format(task.total),
						})
					: t("restore_status.state_running", { defaultValue: "In progress…" });
			case "queued":
				return t("restore_status.state_queued", { defaultValue: "{{left}} left · starts automatically", left });
			case "waiting_decision":
				return t("restore_status.state_waiting_decision", { defaultValue: "Waiting for your decision" });
			case "paused":
				return t("restore_status.state_paused", {
					defaultValue: "Paused after repeated errors · {{left}} left, resumes on the next app start",
					left,
				});
			case "failed":
				return t("restore_status.state_failed", { defaultValue: "Failed · you'll be asked again on the next app start" });
			case "done":
				return t("restore_status.state_done", { defaultValue: "Done" });
		}
	};
}

function TaskIcon({ task }: { task: RestoreTask }) {
	const base = "h-5 w-5 shrink-0";
	switch (task.state) {
		case "running":
			return <Loader2 className={`${base} animate-spin text-[var(--accent)]`} />;
		case "queued":
			return <CircleDashed className={`${base} text-[var(--text-muted)]`} />;
		case "waiting_decision":
			return <UserRoundCheck className={`${base} text-amber-500`} />;
		case "paused":
			return <CirclePause className={`${base} text-amber-500`} />;
		case "failed":
			return <CircleAlert className={`${base} text-red-500`} />;
		case "done":
			return <CircleCheck className={`${base} text-emerald-500`} />;
	}
}

/** One line summing up what's still going on, for the entry points. */
function useSummary(tasks: RestoreTask[]): string {
	const { t } = useTranslation();
	const labels = useTaskLabels();
	const statusText = useTaskStatusText();
	const open = tasks.filter((task) => task.state !== "done");
	const first = open.find((task) => task.state === "running") ?? open[0];
	if (!first) return t("restore_status.all_done", { defaultValue: "Everything restored." });
	const head = `${labels[first.id]}: ${statusText(first)}`;
	return open.length > 1
		? t("restore_status.summary_more", { defaultValue: "{{head}} · {{count}} more steps", head, count: open.length - 1 })
		: head;
}

function RestoreStatusSheet({ tasks, onClose }: { tasks: RestoreTask[]; onClose: () => void }) {
	const { t } = useTranslation();
	const isDesktop = useDesktopBreakpoint();
	const { userId } = useAuth();
	const apiFunctions = useApiFunctions();
	const labels = useTaskLabels();
	const statusText = useTaskStatusText();
	const userIdRef = useRef(userId);
	userIdRef.current = userId;

	const retry = (id: RestoreTaskId) => {
		if (userId == null) return;
		const isCurrent = () => userIdRef.current === userId;
		if (id === "drawer_media") void runRestoredDrawerUpload(apiFunctions, isCurrent);
		if (id === "own_albums") void runRestoredOwnAlbums(apiFunctions, isCurrent);
		if (id === "blocked_profiles") void runRestoredBlocklist(apiFunctions, userId, isCurrent);
		if (id === "favorites") void runRestoredFavorites(apiFunctions, userId, isCurrent);
	};

	const review = () => {
		onClose();
		window.dispatchEvent(new Event(SHOW_RESTORED_PROFILE_PROMPT_EVENT));
	};

	const [stopping, setStopping] = useState<RestoreTaskId | null>(null);
	const [isStopping, setIsStopping] = useState(false);
	const confirmStop = async () => {
		if (!stopping) return;
		setIsStopping(true);
		try {
			await stopRestoreTask(stopping);
			setStopping(null);
		} catch {
			toast.error(t("restore_status.stop_failed", { defaultValue: "Couldn't stop this step." }));
		} finally {
			setIsStopping(false);
		}
	};

	return (
		<BottomSheet onClose={onClose} isDesktop={isDesktop} panelClassName="max-h-[82dvh]">
			<div className="flex items-center justify-between gap-3 px-4 pb-3">
				<div className="min-w-0">
					<p className="text-sm font-semibold text-[var(--text)]">
						{t("restore_status.sheet_title", { defaultValue: "Restore status" })}
					</p>
					<p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">
						{t("restore_status.sheet_desc", {
							defaultValue:
								"Data that lives on Grindr's servers is restored bit by bit in the background, so it doesn't hit Grindr all at once. Keep the app open to speed it up.",
						})}
					</p>
				</div>
				<SheetCloseButton />
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4" data-lenis-prevent>
				<ol className="native-group">
					{tasks.map((task) => {
						const fraction = task.state === "running" && task.total > 1 ? task.done / task.total : null;
						const canReview = task.state === "waiting_decision" || (task.state === "failed" && (task.id === "profile_details" || task.id === "profile_photos"));
						const canRetry = task.state === "paused" || task.state === "queued";
						return (
							<li key={task.id} className="flex items-center gap-3 px-4 py-3">
								<TaskIcon task={task} />
								<div className="min-w-0 flex-1">
									<p className="text-sm font-semibold leading-snug text-[var(--text)]">{labels[task.id]}</p>
									<p className="mt-0.5 text-xs leading-snug tabular-nums text-[var(--text-muted)]">{statusText(task)}</p>
									{fraction != null ? (
										<div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
											<div
												className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
												style={{ width: `${Math.round(fraction * 100)}%` }}
											/>
										</div>
									) : null}
								</div>
								{canReview ? (
									<button
										type="button"
										onClick={review}
										className="shrink-0 rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-contrast)]"
									>
										{t("restore_status.review", { defaultValue: "Review" })}
									</button>
								) : canRetry ? (
									<button
										type="button"
										onClick={() => retry(task.id)}
										className="shrink-0 rounded-full bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--text)]"
									>
										{t("restore_status.start_now", { defaultValue: "Start now" })}
									</button>
								) : null}
								{task.state !== "done" ? (
									<button
										type="button"
										onClick={() => setStopping(task.id)}
										className="shrink-0 rounded-full bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-500"
									>
										{t("restore_status.stop", { defaultValue: "Stop" })}
									</button>
								) : null}
							</li>
						);
					})}
				</ol>
			</div>
			<ConfirmDialog
				isOpen={stopping != null}
				title={t("restore_status.stop_title", { defaultValue: "Stop restoring {{label}}?", label: stopping ? labels[stopping] : "" })}
				message={t("restore_status.stop_message", {
					defaultValue: "What isn't restored yet is dropped and won't resume. What's already restored stays. To get the rest back, import the backup again.",
				})}
				confirmLabel={t("restore_status.stop_confirm", { defaultValue: "Stop" })}
				cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
				confirmTone="danger"
				isProcessing={isStopping}
				onConfirm={confirmStop}
				onCancel={() => setStopping(null)}
			/>
		</BottomSheet>
	);
}

/**
 * Entry point to the restore status: shown only while some restore work is
 * left, opening a sheet that lists every step. "banner" is the accent card at
 * the top of Settings, "row" a plain row for the Backup & Restore page.
 */
export function RestoreStatusEntry({ variant, className = "" }: { variant: "banner" | "row"; className?: string }) {
	const { t } = useTranslation();
	const { tasks } = useRestoreTasks();
	const [open, setOpen] = useState(false);
	const summary = useSummary(tasks ?? []);
	const active = (tasks ?? []).some((task) => task.state !== "done");
	const running = (tasks ?? []).some((task) => task.state === "running");

	if (!tasks || (!active && !open)) return null;

	const title = t("restore_status.entry_title", { defaultValue: "Restore still running" });
	const icon = running ? <Loader2 className="h-5 w-5 animate-spin" /> : <History className="h-5 w-5" />;

	return (
		<>
			{active ? (
				<button
					type="button"
					onClick={() => setOpen(true)}
					className={
						variant === "banner"
							? `flex w-full min-w-0 items-center gap-3 rounded-2xl border border-[var(--accent)]/30 accent-tint-15 px-4 py-3 text-left transition hover:brightness-110 ${className}`
							: `flex w-full min-w-0 items-center gap-3 px-4 py-3.5 text-left transition-colors hover-fill ${className}`
					}
				>
					<div className={`shrink-0 rounded-2xl p-2.5 ${variant === "banner" ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "bg-sky-500/15 text-sky-400"}`}>
						{icon}
					</div>
					<div className="min-w-0 flex-1">
						<p className="text-sm font-semibold leading-snug text-[var(--text)]">{title}</p>
						<p className="mt-0.5 break-words text-xs leading-snug tabular-nums text-[var(--text-muted)]">{summary}</p>
					</div>
					<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)] opacity-50" />
				</button>
			) : null}
			{/* Portaled: the "row" variant sits inside a .native-group, whose
			    `> *` rule would give the sheet's full-screen overlay the card fill
			    and hide the page behind it. The text color wrapper stands in for
			    the .app-shell it no longer inherits from. */}
			{open
				? createPortal(
						<div className="text-[var(--text)]">
							<RestoreStatusSheet tasks={tasks} onClose={() => setOpen(false)} />
						</div>,
						document.body,
					)
				: null}
		</>
	);
}
