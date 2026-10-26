import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Check, ChevronRight, Copy, Download, Loader2, Repeat, Send, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { saveTextFile } from "../../services/saveTextFile";
import { isAndroid, isIos } from "../../services/saveMedia";
import { PageHeader } from "../../components/PageHeader";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { NATIVE_SHEET_BG, afterSheetClose } from "../../components/ui/action-sheet";
import { BottomSheet, SheetClose, SheetCloseButton, SHEET_FOOTER_CLASS, sheetButtonClass } from "../../components/ui/bottom-sheet";
import { SHEET_FIELD_CLASS, SheetChip, SheetSearchInput, SheetSection } from "../../components/ui/sheet-section";
import { useApi } from "../../hooks/useApi";
import { useApiFunctions } from "../../hooks/useApiFunctions";
import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";
import { cn } from "../../utils/cn";
import { DrawerEmptyState } from "./chat/drawerUi";
import { CodeBlock, HEADER_ICON_BUTTON_CLASS, copyText, formatTimestamp } from "./settings-dev/inspectorUi";
import {
	clearApiTraceEntries,
	exportApiTraceEntries,
	getApiTraceEntries,
	subscribeApiTraceEntries,
	type ApiTraceEntry,
} from "../../services/apiTrace";

// A developer tool, so its texts stay English (as before).

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const METHODS: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
type KindFilter = "all" | "rest" | "command" | "errors";

/** What the composer starts with: blank, or a captured request to resend. */
type ComposerDraft = { method: Method; path: string; body: string };

function isErrorEntry(entry: ApiTraceEntry): boolean {
	return !entry.success || (entry.status != null && entry.status >= 400);
}

/** Readable in light and dark: tinted fill, 500-ish text. */
function statusPillClass(entry: ApiTraceEntry): string {
	if (isErrorEntry(entry)) return "bg-red-500/15 text-red-500";
	if (entry.status != null && entry.status >= 200 && entry.status < 300) return "bg-emerald-500/15 text-emerald-500";
	return "bg-amber-500/15 text-amber-500";
}

function methodBadgeClass(method: string): string {
	switch (method.toUpperCase()) {
		case "GET": return "bg-sky-500/15 text-sky-500";
		case "POST": return "bg-emerald-500/15 text-emerald-500";
		case "PUT":
		case "PATCH": return "bg-amber-500/15 text-amber-500";
		case "DELETE": return "bg-red-500/15 text-red-500";
		default: return "bg-violet-500/15 text-violet-500";
	}
}

function prettyJson(text: string | null): string | null {
	if (text == null) return null;
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return text;
	}
}

function EntryDetailSheet({
	entry,
	onClose,
	onResend,
	isDesktop,
}: {
	entry: ApiTraceEntry;
	onClose: () => void;
	onResend: (draft: ComposerDraft) => void;
	isDesktop: boolean;
}) {
	const method = entry.method.toUpperCase();
	const canResend = entry.kind === "rest" && (METHODS as string[]).includes(method);
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
					<div className="flex items-center gap-2">
						<span className={cn("shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold", methodBadgeClass(entry.method))}>
							{entry.method}
						</span>
						<span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", statusPillClass(entry))}>
							{entry.status ?? "Error"}
						</span>
					</div>
					<p className="mt-1.5 break-all font-mono text-sm font-semibold text-[var(--text)]">{entry.path}</p>
					<p className="mt-0.5 text-xs text-[var(--text-muted)]">
						{formatTimestamp(entry.timestamp)} · {entry.durationMs} ms · {entry.kind === "rest" ? "REST" : "Invoke"}
					</p>
				</div>
				<SheetCloseButton />
			</div>
			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
				<div className="space-y-5">
					{entry.error ? <CodeBlock title="Error" text={entry.error} tone="error" /> : null}
					<CodeBlock title="Request" text={prettyJson(entry.requestBody)} />
					<CodeBlock title="Response" text={prettyJson(entry.responseBody)} />
				</div>
			</div>
			<div className={SHEET_FOOTER_CLASS}>
				<button
					type="button"
					onClick={() => copyText(JSON.stringify(entry, null, 2), "Entry")}
					className={sheetButtonClass("secondary")}
				>
					<Copy className="h-4 w-4" />
					<span className="truncate">Copy all</span>
				</button>
				{canResend && (
					// Closes this sheet (animated); the composer opens once it's gone.
					<SheetClose
						onClick={() => onResend({ method: method as Method, path: entry.path, body: prettyJson(entry.requestBody) ?? "" })}
						className={sheetButtonClass()}
					>
						<Repeat className="h-4 w-4" />
						<span className="truncate">Edit &amp; resend</span>
					</SheetClose>
				)}
			</div>
		</BottomSheet>
	);
}

function ComposerSheet({
	initial,
	onClose,
	isDesktop,
}: {
	initial: ComposerDraft;
	onClose: () => void;
	isDesktop: boolean;
}) {
	const { asAppError } = useApi();
	const apiFunctions = useApiFunctions();
	const [method, setMethod] = useState<Method>(initial.method);
	const [path, setPath] = useState(initial.path);
	const [body, setBody] = useState(initial.body);
	const [isSending, setIsSending] = useState(false);
	const [result, setResult] = useState<{ ok: boolean; status: number | null; text: string } | null>(null);
	const hasBodyField = method !== "GET" && method !== "DELETE";

	const trimmedPath = path.trim();
	const pathError = trimmedPath && !trimmedPath.startsWith("/") ? "Starts with /, e.g. /v3/me/profile" : null;
	const bodyError = useMemo(() => {
		if (!hasBodyField || !body.trim()) return null;
		try {
			JSON.parse(body);
			return null;
		} catch {
			return "Not valid JSON (check quotes, commas and braces)";
		}
	}, [body, hasBodyField]);

	const send = async () => {
		if (!trimmedPath || pathError || bodyError || isSending) return;
		setIsSending(true);
		setResult(null);
		try {
			const response = await apiFunctions.request(trimmedPath, {
				method,
				...(hasBodyField && body.trim() ? { body: JSON.parse(body) } : {}),
			});
			let text = "";
			try {
				text = JSON.stringify(response.json(), null, 2);
			} catch {
				text = response.text();
			}
			setResult({ ok: true, status: response.status, text: text || "(empty response body)" });
		} catch (error) {
			const appError = asAppError(error);
			setResult({
				ok: false,
				status: null,
				text: appError?.prettyMessage ?? (error instanceof Error ? error.message : String(error)),
			});
		} finally {
			setIsSending(false);
		}
	};

	return (
		<BottomSheet
			onClose={onClose}
			expandable
			isDesktop={isDesktop}
			isProcessing={isSending}
			bg={NATIVE_SHEET_BG}
			panelClassName={isDesktop ? "max-h-[85dvh] px-4" : "px-4"}
		>
			<div className="mb-3 flex shrink-0 items-center justify-between gap-3">
				<h3 className="text-sm font-semibold text-[var(--text)]">New request</h3>
				<SheetCloseButton disabled={isSending} />
			</div>
			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
				<div className="space-y-5">
					<SheetSection title="Method">
						<div className="flex flex-wrap gap-2">
							{METHODS.map((value) => (
								<SheetChip key={value} size="sm" active={method === value} onClick={() => setMethod(value)}>
									<span className="font-mono">{value}</span>
								</SheetChip>
							))}
						</div>
					</SheetSection>
					<SheetSection title="Path">
						<input
							type="text"
							value={path}
							onChange={(event) => setPath(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") void send();
							}}
							placeholder="/v3/me/profile"
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
							className={cn(SHEET_FIELD_CLASS, "h-11 px-4 font-mono", pathError && "border-red-500 focus:border-red-500")}
						/>
						{pathError && <p className="mt-1.5 px-1 text-xs text-red-500">{pathError}</p>}
					</SheetSection>
					{hasBodyField && (
						<SheetSection title="JSON body (optional)">
							<textarea
								value={body}
								onChange={(event) => setBody(event.target.value)}
								placeholder={'{\n  "key": "value"\n}'}
								rows={7}
								spellCheck={false}
								className={cn(SHEET_FIELD_CLASS, "resize-y px-4 py-3 font-mono text-xs leading-relaxed", bodyError && "border-red-500 focus:border-red-500")}
							/>
							{bodyError && <p className="mt-1.5 px-1 text-xs text-red-500">{bodyError}</p>}
						</SheetSection>
					)}
					{result && (
						<SheetSection
							title="Response"
							badge={
								<span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", result.ok ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-500")}>
									{result.ok ? result.status : "Error"}
								</span>
							}
						>
							<div className="relative">
								<pre
									className={cn(
										"min-w-0 whitespace-pre-wrap break-all rounded-xl px-3 py-2.5 pr-10 font-mono text-xs leading-relaxed",
										result.ok ? "bg-[var(--surface-2)] text-[var(--text)]" : "bg-red-500/10 text-red-500",
									)}
								>
									{result.text}
								</pre>
								<button
									type="button"
									onClick={() => copyText(result.text, "Response")}
									aria-label="Copy response"
									className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] transition hover:ink-tint-10 hover:text-[var(--text)]"
								>
									<Copy className="h-3.5 w-3.5" />
								</button>
							</div>
						</SheetSection>
					)}
				</div>
			</div>
			<div className={SHEET_FOOTER_CLASS}>
				<button
					type="button"
					onClick={() => void send()}
					disabled={isSending || !trimmedPath || !!pathError || !!bodyError}
					className={sheetButtonClass()}
				>
					{isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
					<span>Send</span>
				</button>
			</div>
		</BottomSheet>
	);
}

export function ApiInspectorPage() {
	const isDesktop = useDesktopBreakpoint();
	const [entries, setEntries] = useState<ApiTraceEntry[]>(() => getApiTraceEntries());
	const [query, setQuery] = useState("");
	const [kind, setKind] = useState<KindFilter>("all");
	const [openEntry, setOpenEntry] = useState<ApiTraceEntry | null>(null);
	const [composerDraft, setComposerDraft] = useState<ComposerDraft | null>(null);
	const [isConfirmClearOpen, setIsConfirmClearOpen] = useState(false);
	// "Edit & resend" picked in the detail sheet: opened once that sheet has closed.
	const pendingResendRef = useRef<ComposerDraft | null>(null);

	useEffect(() => subscribeApiTraceEntries(setEntries), []);

	const errorCount = useMemo(() => entries.filter(isErrorEntry).length, [entries]);

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return entries.filter((entry) => {
			if (kind === "errors" ? !isErrorEntry(entry) : kind !== "all" && entry.kind !== kind) return false;
			if (!needle) return true;
			return `${entry.method} ${entry.path} ${entry.status ?? ""} ${entry.error ?? ""}`.toLowerCase().includes(needle);
		});
	}, [entries, kind, query]);

	const [isExporting, setIsExporting] = useState(false);

	const handleExport = async () => {
		setIsExporting(true);
		try {
			const fileName = `free-grind-api-trace-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
			await saveTextFile(fileName, exportApiTraceEntries(), "application/json");
			toast.success(
				isAndroid() || !isIos()
					? `Saved to Downloads/FreeGrind/${fileName}`
					: `Saved to Files → On My iPhone/iPad → Free Grind/${fileName}`,
			);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Export failed");
		} finally {
			setIsExporting(false);
		}
	};

	const filters: { value: KindFilter; label: string }[] = [
		{ value: "all", label: "All" },
		{ value: "rest", label: "REST" },
		{ value: "command", label: "Invoke" },
		{ value: "errors", label: errorCount > 0 ? `Errors · ${errorCount}` : "Errors" },
	];

	return (
		<section className="app-screen">
			<div className="mx-auto grid w-full min-w-0 max-w-4xl gap-5">
				<PageHeader
					backTo="/settings"
					title="API Inspector"
					subtitle="Every request the app makes, live. Tap one for details, or send your own."
					subtitleClassName="-mt-3 mb-0"
					actions={
						<>
							<button type="button" onClick={() => void handleExport()} disabled={entries.length === 0 || isExporting} className={HEADER_ICON_BUTTON_CLASS} aria-label="Export" title="Export as JSON">
								{isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
							</button>
							<button type="button" onClick={() => setIsConfirmClearOpen(true)} disabled={entries.length === 0} className={cn(HEADER_ICON_BUTTON_CLASS, "hover:text-red-500")} aria-label="Clear" title="Clear all">
								<Trash2 className="h-4 w-4" />
							</button>
						</>
					}
				/>

				{/* New request */}
				<div className="native-card overflow-hidden">
					<button
						type="button"
						onClick={() => setComposerDraft({ method: "GET", path: "", body: "" })}
						className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-[var(--surface-2)]"
					>
						<div className="shrink-0 rounded-2xl accent-tint-15 p-2.5 text-[var(--accent)]">
							<Send className="h-5 w-5" />
						</div>
						<div className="min-w-0 flex-1">
							<p className="text-sm font-semibold leading-snug">New request</p>
							<p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">Send any REST call with your session</p>
						</div>
						<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
					</button>
				</div>

				<div className="grid min-w-0 gap-3">
					<SheetSearchInput value={query} onChange={setQuery} placeholder="Search path, method, status or error" />
					<div className="flex flex-wrap gap-2">
						{filters.map((filter) => (
							<SheetChip key={filter.value} size="sm" active={kind === filter.value} onClick={() => setKind(filter.value)}>
								{filter.label}
							</SheetChip>
						))}
					</div>
				</div>

				<div className="min-w-0">
					<div className="mb-2 flex items-center gap-2 px-1">
						<p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Requests</p>
						<span className="rounded-full ink-tint-10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-[var(--text-muted)]">
							{filtered.length}
						</span>
					</div>
					{filtered.length === 0 ? (
						<div className="native-card overflow-hidden px-4">
							<DrawerEmptyState
								icon={<Activity />}
								fanned={false}
								title={entries.length === 0 ? "No requests yet" : "Nothing matches"}
								hint={entries.length === 0
									? "Use the app as usual; its API calls show up here as they happen."
									: "Try another search or filter."}
							/>
						</div>
					) : (
						<div className="native-card divide-y divide-[var(--border)] overflow-hidden">
							{filtered.map((entry) => (
								<button
									key={entry.id}
									type="button"
									onClick={() => setOpenEntry(entry)}
									className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition hover:bg-[var(--surface-2)]"
								>
									<span className={cn("w-14 shrink-0 rounded-md py-0.5 text-center font-mono text-[10px] font-bold", methodBadgeClass(entry.method))}>
										{entry.method.length > 6 ? entry.method.slice(0, 6) : entry.method}
									</span>
									<div className="min-w-0 flex-1">
										<p className="truncate font-mono text-[13px] font-semibold text-[var(--text)]">{entry.path}</p>
										<p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
											{formatTimestamp(entry.timestamp)} · {entry.durationMs} ms{entry.kind === "command" ? " · Invoke" : ""}
										</p>
									</div>
									<span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", statusPillClass(entry))}>
										{entry.status ?? (entry.success ? <Check className="h-3 w-3" /> : "Error")}
									</span>
								</button>
							))}
						</div>
					)}
				</div>
			</div>

			{openEntry && (
				<EntryDetailSheet
					key={openEntry.id}
					entry={openEntry}
					onClose={() => {
						setOpenEntry(null);
						const draft = pendingResendRef.current;
						pendingResendRef.current = null;
						if (draft) afterSheetClose(() => setComposerDraft(draft));
					}}
					onResend={(draft) => { pendingResendRef.current = draft; }}
					isDesktop={isDesktop}
				/>
			)}
			{composerDraft && (
				<ComposerSheet initial={composerDraft} onClose={() => setComposerDraft(null)} isDesktop={isDesktop} />
			)}

			<ConfirmDialog
				isOpen={isConfirmClearOpen}
				title="Clear all requests?"
				message="Removes the captured history from this list. The app keeps working as usual."
				confirmLabel="Clear"
				cancelLabel="Cancel"
				confirmTone="danger"
				onConfirm={() => {
					clearApiTraceEntries();
					setIsConfirmClearOpen(false);
				}}
				onCancel={() => setIsConfirmClearOpen(false)}
			/>
		</section>
	);
}
