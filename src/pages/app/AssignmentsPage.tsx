import { useMemo, useState } from "react";
import { ChevronRight, Copy, Database, FlagTriangleRight } from "lucide-react";
import toast from "react-hot-toast";
import { PageHeader } from "../../components/PageHeader";
import { PullToRefreshContainer } from "./components/PullToRefreshContainer";
import { ErrorState } from "../../components/ui/states";
import { NATIVE_SHEET_BG } from "../../components/ui/action-sheet";
import { BottomSheet, SheetCloseButton } from "../../components/ui/bottom-sheet";
import { SelectSheet } from "../../components/ui/select-sheet";
import { SheetChip, SheetSearchInput, SheetSection } from "../../components/ui/sheet-section";
import { useRefreshAssignments } from "../../components/AssignmentsBridge";
import { usePreferences } from "../../contexts/PreferencesContext";
import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";
import { type AssignmentSourceId as SourceId, useAssignmentsSnapshot } from "../../services/assignmentsStore";
import type { Assignment } from "../../utils/assignments";
import { cn } from "../../utils/cn";
import { DrawerEmptyState } from "./chat/drawerUi";

// A developer tool, so its texts stay English (as before).

// See docs/content/grindr-api/analytics/assignments.md. `anonymous` is the
// endpoint the Rust client reads for the reCAPTCHA switches at sign-in.
const SOURCES: { id: SourceId; label: string; description: string }[] = [
	{ id: "jwt", label: "Session JWT", description: "Claims of the session token (features, flags, experiments, roles)" },
	{ id: "account", label: "Account", description: "GET /v3/assignment, for this account and location" },
	{ id: "public", label: "Public features", description: "GET /public/v1/public-features" },
	{ id: "anonymous", label: "Anonymous", description: "GET /public/v1/assignments, used at sign-in" },
];

type TypeFilter = "all" | "FEATURE_FLAG" | "EXPERIMENT" | "FEATURE" | "other";

const TYPE_FILTERS: { id: TypeFilter; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "FEATURE_FLAG", label: "Flags" },
	{ id: "EXPERIMENT", label: "Experiments" },
	{ id: "FEATURE", label: "Features" },
	{ id: "other", label: "Other" },
];

const HEADER_ICON_BUTTON_CLASS =
	"header-icon-btn inline-flex shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-2 text-[var(--text-muted)] transition-colors hover:text-[var(--text)] disabled:opacity-40";

function matchesType(assignment: Assignment, filter: TypeFilter): boolean {
	if (filter === "all") return true;
	if (filter === "other") return assignment.type !== "FEATURE_FLAG" && assignment.type !== "EXPERIMENT" && assignment.type !== "FEATURE";
	return assignment.type === filter;
}

function hasPayload(payload: unknown): boolean {
	if (payload == null) return false;
	if (typeof payload === "object") return Object.keys(payload as object).length > 0;
	return true;
}

/** Readable in light and dark: on green, off/control grey, anything else accent. */
function valueClass(value: string): string {
	const v = value.toLowerCase();
	if (v === "on" || v === "true" || v === "enabled") return "bg-emerald-500/15 text-emerald-500";
	if (v === "off" || v === "false" || v === "disabled" || v === "control") return "ink-tint-10 text-[var(--text-muted)]";
	return "accent-tint-15 text-[var(--accent)]";
}

function typeLabel(type: string | null): string {
	if (type === "FEATURE_FLAG") return "Flag";
	if (type === "EXPERIMENT") return "Experiment";
	if (type === "FEATURE") return "Feature";
	if (type === "ROLE") return "Role";
	return type ?? "Unknown";
}

function copyText(text: string, message: string) {
	void navigator.clipboard.writeText(text).then(
		() => toast.success(message, { id: "assignments-copy" }),
		() => toast.error("Couldn't copy", { id: "assignments-copy" }),
	);
}

/** One assignment with its payload, opened from the list. */
function AssignmentDetailSheet({ assignment, onClose, isDesktop }: { assignment: Assignment; onClose: () => void; isDesktop: boolean }) {
	const payloadText = JSON.stringify(assignment.payload, null, 2);
	return (
		<BottomSheet
			onClose={onClose}
			expandable
			isDesktop={isDesktop}
			bg={NATIVE_SHEET_BG}
			panelClassName={isDesktop ? "max-h-[85dvh] px-4" : "px-4"}
		>
			<div className="mb-3 flex shrink-0 items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="break-all font-mono text-sm font-semibold text-[var(--text)]">{assignment.key}</p>
					<div className="mt-1.5 flex items-center gap-2">
						<span className="text-xs text-[var(--text-muted)]">{typeLabel(assignment.type)}</span>
						<span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", valueClass(assignment.value))}>
							{assignment.value || "—"}
						</span>
					</div>
				</div>
				<SheetCloseButton />
			</div>
			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
				<SheetSection
					title="Payload"
					badge={
						<button
							type="button"
							onClick={() => copyText(payloadText, "Payload copied")}
							className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold text-[var(--accent)] transition hover:accent-tint-14"
						>
							<Copy className="h-3 w-3" />
							Copy
						</button>
					}
				>
					<pre className="min-w-0 whitespace-pre-wrap break-all rounded-xl bg-[var(--surface-2)] px-3 py-2.5 font-mono text-xs leading-relaxed text-[var(--text)]">
						{payloadText}
					</pre>
				</SheetSection>
			</div>
		</BottomSheet>
	);
}

export function AssignmentsPage() {
	const isDesktop = useDesktopBreakpoint();
	const { geohash } = usePreferences();
	const { sources, isLoading } = useAssignmentsSnapshot();
	const refresh = useRefreshAssignments();
	const [activeSource, setActiveSource] = useState<SourceId>("jwt");
	const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
	const [query, setQuery] = useState("");
	const [isSourceSheetOpen, setIsSourceSheetOpen] = useState(false);
	const [openAssignment, setOpenAssignment] = useState<Assignment | null>(null);

	const current = sources?.[activeSource] ?? null;
	const source = SOURCES.find((s) => s.id === activeSource)!;

	const searched = useMemo(() => {
		if (!current) return [];
		const needle = query.trim().toLowerCase();
		if (!needle) return current.assignments;
		return current.assignments.filter((a) => a.key.toLowerCase().includes(needle) || a.value.toLowerCase().includes(needle));
	}, [current, query]);
	const filtered = useMemo(() => searched.filter((a) => matchesType(a, typeFilter)), [searched, typeFilter]);

	return (
		<>
			<PullToRefreshContainer
				className="app-screen"
				onRefresh={() => refresh()}
				isDisabled={isLoading}
				refreshingLabel="Refreshing…"
			>
				<PageHeader
					backTo="/settings"
					title="Assignments & Feature Flags"
					subtitle="What the server currently assigns to this account and device. Pull down to refresh."
					actions={
						<button
							type="button"
							onClick={() => copyText(JSON.stringify(filtered, null, 2), `Copied ${filtered.length} assignments`)}
							disabled={filtered.length === 0}
							className={HEADER_ICON_BUTTON_CLASS}
							aria-label="Copy as JSON"
							title="Copy shown assignments as JSON"
						>
							<Copy className="h-4 w-4" />
						</button>
					}
				/>

				<div className="grid min-w-0 gap-5">
					{/* Where the list comes from */}
					<div className="native-card overflow-hidden">
						<button
							type="button"
							onClick={() => setIsSourceSheetOpen(true)}
							className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-[var(--surface-2)]"
						>
							<div className="shrink-0 rounded-2xl bg-sky-500/15 p-2.5 text-sky-400">
								<Database className="h-5 w-5" />
							</div>
							<div className="min-w-0 flex-1">
								<p className="text-sm font-semibold leading-snug">Source</p>
								<p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">
									{source.description}
									{activeSource === "account" && !geohash ? " (no location set, sent without one)" : ""}
								</p>
							</div>
							<span className="max-w-[40%] shrink-0 truncate text-sm font-medium text-[var(--text-muted)]">{source.label}</span>
							<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
						</button>
					</div>

					<div className="grid min-w-0 gap-3">
						<SheetSearchInput value={query} onChange={setQuery} placeholder="Search key or value" />
						<div className="flex flex-wrap gap-2">
							{TYPE_FILTERS.map((filter) => {
								const count = searched.filter((a) => matchesType(a, filter.id)).length;
								return (
									<SheetChip key={filter.id} size="sm" active={typeFilter === filter.id} onClick={() => setTypeFilter(filter.id)}>
										{filter.label} · {count}
									</SheetChip>
								);
							})}
						</div>
					</div>

					{isLoading && !sources ? (
						<div className="native-card divide-y divide-[var(--border)] overflow-hidden">
							{Array.from({ length: 6 }).map((_, i) => (
								<div key={i} className="flex items-center gap-3 px-4 py-3">
									<div className="min-w-0 flex-1 space-y-1.5">
										<div className="h-3.5 w-2/3 animate-pulse rounded-full ink-tint-10" />
										<div className="h-3 w-16 animate-pulse rounded-full ink-tint-10" />
									</div>
									<div className="h-5 w-12 animate-pulse rounded-full ink-tint-10" />
								</div>
							))}
						</div>
					) : current?.error && current.assignments.length === 0 ? (
						<ErrorState title="Couldn't load assignments" description={current.error} onRetry={() => void refresh()} />
					) : filtered.length === 0 ? (
						<div className="native-card overflow-hidden px-4">
							<DrawerEmptyState
								icon={<FlagTriangleRight />}
								fanned={false}
								title="No assignments"
								hint={current && current.assignments.length > 0
									? "Nothing matches this search or filter."
									: "The server returned none for this source."}
							/>
						</div>
					) : (
						<div className="min-w-0">
							<div className="mb-2 flex items-center gap-2 px-1">
								<p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">{source.label}</p>
								<span className="rounded-full ink-tint-10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-[var(--text-muted)]">
									{filtered.length}
								</span>
							</div>
							<div className="native-card divide-y divide-[var(--border)] overflow-hidden">
								{filtered.map((a) => {
									const withPayload = hasPayload(a.payload);
									return (
										<button
											key={a.key}
											type="button"
											disabled={!withPayload}
											onClick={() => setOpenAssignment(a)}
											className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition enabled:hover:bg-[var(--surface-2)]"
										>
											<div className="min-w-0 flex-1">
												<p className="break-all font-mono text-[13px] font-semibold text-[var(--text)]">{a.key}</p>
												<p className="mt-0.5 text-xs text-[var(--text-muted)]">
													{typeLabel(a.type)}
													{withPayload ? " · payload" : ""}
												</p>
											</div>
											<span className={cn("max-w-[40%] shrink-0 truncate rounded-full px-2 py-0.5 text-[11px] font-semibold", valueClass(a.value))}>
												{a.value || "—"}
											</span>
											{withPayload && <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />}
										</button>
									);
								})}
							</div>
							{current?.error ? (
								<p className="mt-2 px-4 text-xs leading-relaxed text-[var(--text-muted)]">
									Couldn't refresh, showing the last loaded list ({current.error}).
								</p>
							) : null}
						</div>
					)}
				</div>
			</PullToRefreshContainer>

			{isSourceSheetOpen && (
				<SelectSheet<SourceId>
					title="Source"
					value={activeSource}
					options={SOURCES.map((s) => {
						const count = sources?.[s.id].assignments.length;
						return {
							value: s.id,
							label: count != null ? `${s.label} · ${count}` : s.label,
							description: s.description,
						};
					})}
					onSelect={setActiveSource}
					onClose={() => setIsSourceSheetOpen(false)}
					isDesktop={isDesktop}
				/>
			)}
			{openAssignment && (
				<AssignmentDetailSheet
					key={openAssignment.key}
					assignment={openAssignment}
					onClose={() => setOpenAssignment(null)}
					isDesktop={isDesktop}
				/>
			)}
		</>
	);
}
