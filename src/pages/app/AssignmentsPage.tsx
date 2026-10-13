import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Copy, Search } from "lucide-react";
import toast from "react-hot-toast";
import { BackToSettings } from "../../components/BackToSettings";
import { PullToRefreshContainer } from "./components/PullToRefreshContainer";
import { EmptyState, ErrorState } from "../../components/ui/states";
import { useApi } from "../../hooks/useApi";
import { useApiFunctions } from "../../hooks/useApiFunctions";
import { usePreferences } from "../../contexts/PreferencesContext";
import { assertSuccess, parseJsonSafe } from "../../services/apiHelpers";

type Assignment = {
	key: string;
	value: string;
	type: string | null;
	payload: unknown;
};

type SourceId = "jwt" | "account" | "public" | "anonymous";

type SourceState = {
	assignments: Assignment[];
	error: string | null;
};

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

function parseAssignments(raw: unknown): Assignment[] {
	const list =
		raw && typeof raw === "object" && Array.isArray((raw as { assignments?: unknown }).assignments)
			? (raw as { assignments: unknown[] }).assignments
			: [];
	const result: Assignment[] = [];
	for (const item of list) {
		if (!item || typeof item !== "object") continue;
		const a = item as Record<string, unknown>;
		if (typeof a.key !== "string") continue;
		result.push({
			key: a.key,
			value: a.value == null ? "" : String(a.value),
			type: typeof a.type === "string" ? a.type : null,
			payload: a.payload ?? null,
		});
	}
	return result.sort((x, y) => x.key.localeCompare(y.key));
}

// Claims are not verified — the token is only read for display. Layout per
// docs/content/grindr-api/authentication.md#session-id.
function parseJwtAssignments(token: string): Assignment[] {
	const part = token.split(".")[1];
	if (!part) throw new Error("Session token is not a JWT");
	const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
	const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
	const claims = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;

	const result: Assignment[] = [];
	const pushList = (raw: unknown, type: string) => {
		if (!Array.isArray(raw)) return;
		for (const item of raw) {
			if (typeof item === "string") {
				result.push({ key: item, value: "on", type, payload: null });
			} else if (item != null) {
				result.push({ key: JSON.stringify(item), value: "on", type, payload: item });
			}
		}
	};
	pushList(claims.featureFlags, "FEATURE_FLAG");
	pushList(claims.features, "FEATURE");
	pushList(claims.roles, "ROLE");
	if (claims.experiments && typeof claims.experiments === "object") {
		for (const [key, value] of Object.entries(claims.experiments as Record<string, unknown>)) {
			const isScalar = value == null || typeof value !== "object";
			result.push({
				key,
				value: isScalar ? String(value ?? "") : "…",
				type: "EXPERIMENT",
				payload: isScalar ? null : value,
			});
		}
	}
	return result.sort((x, y) => x.key.localeCompare(y.key));
}

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
	const { callMethod } = useApi();
	const apiFunctions = useApiFunctions();
	const { geohash } = usePreferences();

	const [sources, setSources] = useState<Record<SourceId, SourceState> | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [activeSource, setActiveSource] = useState<SourceId>("jwt");
	const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
	const [query, setQuery] = useState("");
	const [expandedKey, setExpandedKey] = useState<string | null>(null);

	const load = useCallback(async () => {
		setIsLoading(true);

		const fetchSource = async (path: string): Promise<SourceState> => {
			try {
				const response = await apiFunctions.request(path, { method: "GET" });
				await assertSuccess(response, "Failed to load assignments");
				return { assignments: parseAssignments(await parseJsonSafe(response)), error: null };
			} catch (error) {
				return { assignments: [], error: error instanceof Error ? error.message : String(error) };
			}
		};

		const fetchJwt = async (): Promise<SourceState> => {
			try {
				const token = await callMethod("websocket_token");
				if (!token) return { assignments: [], error: "No active session token" };
				return { assignments: parseJwtAssignments(token), error: null };
			} catch (error) {
				return { assignments: [], error: error instanceof Error ? error.message : String(error) };
			}
		};

		const accountPath = geohash
			? `/v3/assignment?geohash=${encodeURIComponent(geohash)}`
			: "/v3/assignment";
		const [jwt, account, publicFeatures, anonymous] = await Promise.all([
			fetchJwt(),
			fetchSource(accountPath),
			fetchSource("/public/v1/public-features"),
			fetchSource("/public/v1/assignments"),
		]);
		setSources({ jwt, account, public: publicFeatures, anonymous });
		setIsLoading(false);
	}, [apiFunctions, callMethod, geohash]);

	useEffect(() => {
		void load();
	}, [load]);

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
			onRefresh={() => load()}
			isDisabled={isLoading}
			refreshingLabel="Refreshing…"
		>
			<header className="mb-7">
				<div className="mb-1 flex items-center gap-2">
					<BackToSettings />
					<h1 className="app-title min-w-0">Assignments &amp; Feature Flags</h1>
				</div>
				<p className="app-subtitle">What the server currently assigns to this account and device.</p>
			</header>

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
					<div className="surface-card divide-y divide-[var(--border)] overflow-hidden">
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
						onRetry={() => void load()}
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
					<div className="surface-card divide-y divide-[var(--border)] overflow-hidden">
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
