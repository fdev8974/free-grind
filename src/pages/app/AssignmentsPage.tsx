import { useMemo, useState } from "react";
import { ChevronDown, Copy, Search } from "lucide-react";
import toast from "react-hot-toast";
import { PageHeader } from "../../components/PageHeader";
import { PullToRefreshContainer } from "./components/PullToRefreshContainer";
import { EmptyState, ErrorState } from "../../components/ui/states";
import { useRefreshAssignments } from "../../components/AssignmentsBridge";
import { usePreferences } from "../../contexts/PreferencesContext";
import { type AssignmentSourceId as SourceId, useAssignmentsSnapshot } from "../../services/assignmentsStore";

// See docs/content/grindr-api/analytics/assignments.md. `anonymous` is the
// endpoint the Rust client reads for the reCAPTCHA switches at sign-in.
const SOURCES: { id: SourceId; label: string; description: string }[] = [
	{ id: "jwt", label: "Session JWT", description: "features / featureFlags / experiments / roles claims of the session token" },
	{ id: "account", label: "Account", description: "GET /v3/assignment (authorized, per geohash)" },
	{ id: "public", label: "Public features", description: "GET /public/v1/public-features" },
	{ id: "anonymous", label: "Anonymous", description: "GET /public/v1/assignments" },
];

type TypeFilter = "all" | "FEATURE_FLAG" | "EXPERIMENT" | "FEATURE" | "other";

const TYPE_FILTERS: { id: TypeFilter; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "FEATURE_FLAG", label: "Feature flags" },
	{ id: "EXPERIMENT", label: "Experiments" },
	{ id: "FEATURE", label: "Features" },
	{ id: "other", label: "Other" },
];

function hasPayload(payload: unknown): boolean {
	if (payload == null) return false;
	if (typeof payload === "object") return Object.keys(payload as object).length > 0;
	return true;
}

function valueClass(value: string): string {
	const v = value.toLowerCase();
	if (v === "on" || v === "true" || v === "enabled") {
		return "bg-green-500/20 text-green-400";
	}
	if (v === "off" || v === "false" || v === "disabled" || v === "control") {
		return "bg-[var(--surface-2)] text-[var(--text-muted)]";
	}
	return "bg-[var(--accent)] text-[var(--accent-contrast)]";
}

function typeLabel(type: string | null): string {
	if (type === "FEATURE_FLAG") return "Flag";
	if (type === "EXPERIMENT") return "Experiment";
	if (type === "FEATURE") return "Feature";
	if (type === "ROLE") return "Role";
	return type ?? "Unknown";
}

export function AssignmentsPage() {
	const { geohash } = usePreferences();
	const { sources, isLoading } = useAssignmentsSnapshot();
	const refresh = useRefreshAssignments();
	const [activeSource, setActiveSource] = useState<SourceId>("jwt");
	const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
	const [query, setQuery] = useState("");
	const [expandedKey, setExpandedKey] = useState<string | null>(null);

	const current = sources?.[activeSource] ?? null;

	const filtered = useMemo(() => {
		if (!current) return [];
		const needle = query.trim().toLowerCase();
		return current.assignments.filter((a) => {
			if (typeFilter === "other") {
				if (a.type === "FEATURE_FLAG" || a.type === "EXPERIMENT" || a.type === "FEATURE") return false;
			} else if (typeFilter !== "all" && a.type !== typeFilter) {
				return false;
			}
			if (!needle) return true;
			return a.key.toLowerCase().includes(needle) || a.value.toLowerCase().includes(needle);
		});
	}, [current, query, typeFilter]);

	const copyJson = async () => {
		const text = JSON.stringify(filtered, null, 2);
		await navigator.clipboard.writeText(text).catch(() => {});
		toast.success(`Copied ${filtered.length} assignments`, { id: "assignments-copy" });
	};

	const chipClass = (active: boolean) =>
		`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${active ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)]"}`;

	return (
		<PullToRefreshContainer
			className="app-screen"
			onRefresh={() => refresh()}
			isDisabled={isLoading}
			refreshingLabel="Refreshing…"
		>
			<PageHeader
				backTo="/settings"
				title={"Assignments & Feature Flags"}
				subtitle={"What the server currently assigns to this account and device."}
			/>

			<div className="grid gap-4">
				<div className="flex flex-wrap gap-2">
					{SOURCES.map((source) => {
						const count = sources?.[source.id].assignments.length;
						return (
							<button
								key={source.id}
								type="button"
								onClick={() => {
									setActiveSource(source.id);
									setExpandedKey(null);
								}}
								className={chipClass(activeSource === source.id)}
							>
								{source.label}
								{count != null ? ` (${count})` : ""}
							</button>
						);
					})}
				</div>
				<p className="px-1 font-mono text-xs text-[var(--text-muted)]">
					{SOURCES.find((s) => s.id === activeSource)?.description}
					{activeSource === "account" && !geohash ? " — no location set, sent without geohash" : ""}
				</p>

				<div className="flex flex-wrap gap-2">
					{TYPE_FILTERS.map((filter) => (
						<button
							key={filter.id}
							type="button"
							onClick={() => setTypeFilter(filter.id)}
							className={chipClass(typeFilter === filter.id)}
						>
							{filter.label}
						</button>
					))}
				</div>

				<div className="flex items-center gap-2">
					<div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-[var(--surface-2)] px-3 py-2">
						<Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
						<input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Search key or value"
							className="min-w-0 flex-1 bg-transparent text-sm outline-none"
						/>
					</div>
					<button
						type="button"
						onClick={() => void copyJson()}
						disabled={filtered.length === 0}
						className="rounded-xl bg-[var(--surface-2)] p-2.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text)] disabled:opacity-40"
						aria-label="Copy as JSON"
					>
						<Copy className="h-4 w-4" />
					</button>
				</div>

				{isLoading && !sources ? (
					<div className="native-card divide-y divide-[var(--border)] overflow-hidden">
						{Array.from({ length: 6 }).map((_, i) => (
							<div key={i} className="flex items-center gap-3 px-4 py-3">
								<div className="h-3.5 flex-1 animate-pulse rounded-full bg-[var(--surface-2)]" />
								<div className="h-5 w-12 animate-pulse rounded-full bg-[var(--surface-2)]" />
							</div>
						))}
					</div>
				) : current?.error ? (
					<ErrorState
						title="Couldn't load assignments"
						description={current.error}
						onRetry={() => void refresh()}
					/>
				) : filtered.length === 0 ? (
					<EmptyState
						title="No assignments"
						description={
							current && current.assignments.length > 0
								? "Nothing matches the current filter."
								: "The server returned no assignments for this source."
						}
					/>
				) : (
					<div className="native-card divide-y divide-[var(--border)] overflow-hidden">
						{filtered.map((a) => {
							const expandable = hasPayload(a.payload);
							const expanded = expandable && expandedKey === a.key;
							return (
								<div key={a.key}>
									<button
										type="button"
										disabled={!expandable}
										onClick={() => setExpandedKey(expanded ? null : a.key)}
										className="flex w-full items-center gap-3 px-4 py-3 text-left"
									>
										<div className="min-w-0 flex-1">
											<p className="break-all font-mono text-sm">{a.key}</p>
											<p className="mt-0.5 text-xs text-[var(--text-muted)]">
												{typeLabel(a.type)}
												{expandable ? " · has payload" : ""}
											</p>
										</div>
										<span
											className={`max-w-[40%] shrink-0 truncate rounded-full px-2 py-0.5 text-xs font-medium ${valueClass(a.value)}`}
										>
											{a.value || "—"}
										</span>
										{expandable && (
											<ChevronDown
												className={`h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform ${expanded ? "rotate-180" : ""}`}
											/>
										)}
									</button>
									{expanded && (
										<pre className="mx-4 mb-3 overflow-x-auto rounded-lg bg-[var(--surface-2)] px-3 py-2 font-mono text-xs select-all">
											{JSON.stringify(a.payload, null, 2)}
										</pre>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>
		</PullToRefreshContainer>
	);
}
