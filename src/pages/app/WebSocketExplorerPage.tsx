import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowDownLeft, ArrowUpRight, Cable, ChevronRight, Copy, Download, Loader2, Plug, Repeat, Send, Trash2, Unplug } from "lucide-react";
import toast from "react-hot-toast";
import { saveTextFile } from "../../services/saveTextFile";
import { isAndroid, isIos } from "../../services/saveMedia";
import { sendViaRealtime } from "../../services/chatRealtime";
import { PageHeader } from "../../components/PageHeader";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { NATIVE_SHEET_BG, afterSheetClose } from "../../components/ui/action-sheet";
import { BottomSheet, SheetClose, SheetCloseButton, SHEET_FOOTER_CLASS, sheetButtonClass } from "../../components/ui/bottom-sheet";
import { SHEET_FIELD_CLASS, SheetChip, SheetSection } from "../../components/ui/sheet-section";
import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";
import { cn } from "../../utils/cn";
import { DrawerEmptyState } from "./chat/drawerUi";
import { CodeBlock, HEADER_ICON_BUTTON_CLASS, PageSearchBar, copyText, formatTimestamp } from "./settings-dev/inspectorUi";
import {
	clearWsTraceEntries,
	exportWsTraceEntries,
	getWsConnectionState,
	getWsTraceEntries,
	subscribeWsTrace,
	type WsTraceEntry,
} from "../../services/wsTrace";

// A developer tool, so its texts stay English (like the API Inspector).

type DirectionFilter = "all" | "in" | "out" | "errors";

/** What the composer starts with: blank, or a captured command to resend. */
type ComposerDraft = { type: string; payload: string };

function isErrorEntry(entry: WsTraceEntry): boolean {
	return (entry.status != null && entry.status >= 400) || (entry.direction === "status" && entry.type !== "open");
}

function prettyJson(text: string): string {
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return text;
	}
}

/** The envelope's payload as editable JSON, for "Edit & resend". */
function payloadOf(raw: string): string {
	try {
		const payload = (JSON.parse(raw) as { payload?: unknown }).payload;
		return payload === undefined ? "" : JSON.stringify(payload, null, 2);
	} catch {
		return "";
	}
}

const STATUS_LABEL: Record<string, string> = {
	open: "Connected",
	close: "Disconnected",
	lagged: "Events dropped",
	error: "Socket error",
};

function entryTitle(entry: WsTraceEntry): string {
	return entry.direction === "status" ? STATUS_LABEL[entry.type] ?? entry.type : entry.type;
}

/** Arrow for frames, plug for connection changes; tinted by direction or outcome. */
function DirectionIcon({ entry }: { entry: WsTraceEntry }) {
	const Icon = entry.direction === "in" ? ArrowDownLeft : entry.direction === "out" ? ArrowUpRight : entry.type === "open" ? Plug : Unplug;
	const tone = isErrorEntry(entry)
		? "bg-red-500/15 text-red-500"
		: entry.direction === "in"
			? "bg-sky-500/15 text-sky-500"
			: entry.direction === "out"
				? "bg-emerald-500/15 text-emerald-500"
				: "bg-slate-500/15 text-slate-400";
	return (
		<span className={cn("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", tone)}>
			<Icon className="h-4 w-4" />
		</span>
	);
}

function StatusPill({ status }: { status: number }) {
	return (
		<span
			className={cn(
				"shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums",
				status >= 400 ? "bg-red-500/15 text-red-500" : "bg-emerald-500/15 text-emerald-500",
			)}
		>
			{status}
		</span>
	);
}

function entryMeta(entry: WsTraceEntry): string {
	const direction = entry.direction === "in" ? "Received" : entry.direction === "out" ? "Sent" : "Connection";
	return [formatTimestamp(entry.timestamp), direction, entry.ref ? `ref ${entry.ref}` : null].filter(Boolean).join(" · ");
}

function EntryDetailSheet({
	entry,
	related,
	onClose,
	onOpen,
	onResend,
	isDesktop,
}: {
	entry: WsTraceEntry;
	/** The command and its response, matched by ref. */
	related: WsTraceEntry | null;
	onClose: () => void;
	onOpen: (entry: WsTraceEntry) => void;
	onResend: (draft: ComposerDraft) => void;
	isDesktop: boolean;
}) {
	return (
		<BottomSheet
			onClose={onClose}
			expandable
			isDesktop={isDesktop}
			bg={NATIVE_SHEET_BG}
			panelClassName={isDesktop ? "max-h-[85dvh] px-4" : "px-4"}
		>
			<div className="mb-3 flex shrink-0 items-center justify-between gap-3">
				<div className="min-w-0">
					<p className="break-all font-mono text-sm font-semibold text-[var(--text)]">{entryTitle(entry)}</p>
					<div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-snug text-[var(--text-muted)]">
						{entry.status != null && <StatusPill status={entry.status} />}
						<span className="break-all tabular-nums">{entryMeta(entry)}</span>
					</div>
				</div>
				<SheetCloseButton />
			</div>
			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
				<div className="space-y-5">
					{related && (
						<SheetSection title={entry.direction === "out" ? "Response" : "Command"}>
							<div className="native-group">
								<button type="button" onClick={() => onOpen(related)} className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition hover-fill">
									<DirectionIcon entry={related} />
									<div className="min-w-0 flex-1">
										<p className="truncate font-mono text-[13px] font-semibold text-[var(--text)]">{related.type}</p>
										<p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
											{formatTimestamp(related.timestamp)} · {Math.abs(related.timestamp - entry.timestamp)} ms {related.timestamp >= entry.timestamp ? "later" : "earlier"}
										</p>
									</div>
									{related.status != null && <StatusPill status={related.status} />}
									<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
								</button>
							</div>
						</SheetSection>
					)}
					<CodeBlock title={entry.direction === "status" ? "Details" : "Frame"} text={prettyJson(entry.data)} tone={isErrorEntry(entry) ? "error" : "default"} />
				</div>
			</div>
			<div className={SHEET_FOOTER_CLASS}>
				<button type="button" onClick={() => copyText(JSON.stringify(entry, null, 2), "Entry")} className={sheetButtonClass("secondary")}>
					<Copy className="h-4 w-4" />
					<span className="truncate">Copy all</span>
				</button>
				{entry.direction === "out" && (
					// Closes this sheet (animated); the composer opens once it's gone.
					<SheetClose onClick={() => onResend({ type: entry.type, payload: payloadOf(entry.data) })} className={sheetButtonClass()}>
						<Repeat className="h-4 w-4" />
						<span className="truncate">Edit &amp; resend</span>
					</SheetClose>
				)}
			</div>
		</BottomSheet>
	);
}

function ComposerSheet({ initial, connected, onClose, isDesktop }: { initial: ComposerDraft; connected: boolean; onClose: () => void; isDesktop: boolean }) {
	const [type, setType] = useState(initial.type);
	const [payload, setPayload] = useState(initial.payload);
	const [isSending, setIsSending] = useState(false);
	const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

	const trimmedType = type.trim();
	const payloadError = useMemo(() => {
		if (!payload.trim()) return null;
		try {
			JSON.parse(payload);
			return null;
		} catch {
			return "Not valid JSON (check quotes, commas and braces)";
		}
	}, [payload]);

	const send = async () => {
		if (!trimmedType || payloadError || isSending || !connected) return;
		setIsSending(true);
		setResult(null);
		try {
			const response = await sendViaRealtime(trimmedType, payload.trim() ? JSON.parse(payload) : {});
			setResult({ ok: true, text: response === undefined ? "(no payload)" : JSON.stringify(response, null, 2) });
		} catch (error) {
			setResult({ ok: false, text: error instanceof Error ? error.message : String(error) });
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
				<div className="min-w-0">
					<h3 className="text-sm font-semibold text-[var(--text)]">Send command</h3>
					<p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">
						{connected ? "Goes out on the app's socket; the session token is added for you." : "The socket isn't connected right now."}
					</p>
				</div>
				<SheetCloseButton disabled={isSending} />
			</div>
			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
				<div className="space-y-5">
					<SheetSection title="Type">
						<input
							type="text"
							value={type}
							onChange={(event) => setType(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") void send();
							}}
							placeholder="chat.v1.conversation.list"
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
							className={cn(SHEET_FIELD_CLASS, "h-11 px-4 font-mono")}
						/>
					</SheetSection>
					<SheetSection title="JSON payload (optional)">
						<textarea
							value={payload}
							onChange={(event) => setPayload(event.target.value)}
							placeholder={'{\n  "key": "value"\n}'}
							rows={7}
							spellCheck={false}
							className={cn(SHEET_FIELD_CLASS, "resize-y px-4 py-3 font-mono text-xs leading-relaxed", payloadError && "border-red-500 focus:border-red-500")}
						/>
						{payloadError && <p className="mt-1.5 px-1 text-xs text-red-500">{payloadError}</p>}
					</SheetSection>
					{result && <CodeBlock title={result.ok ? "Response payload" : "Error"} text={result.text} tone={result.ok ? "default" : "error"} />}
				</div>
			</div>
			<div className={SHEET_FOOTER_CLASS}>
				<button
					type="button"
					onClick={() => void send()}
					disabled={isSending || !connected || !trimmedType || !!payloadError}
					className={sheetButtonClass()}
				>
					{isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
					<span>Send</span>
				</button>
			</div>
		</BottomSheet>
	);
}

export function WebSocketExplorerPage() {
	const isDesktop = useDesktopBreakpoint();
	const entries = useSyncExternalStore(subscribeWsTrace, getWsTraceEntries);
	const connection = useSyncExternalStore(subscribeWsTrace, getWsConnectionState);
	const [query, setQuery] = useState("");
	const [direction, setDirection] = useState<DirectionFilter>("all");
	const [openEntry, setOpenEntry] = useState<WsTraceEntry | null>(null);
	const [composerDraft, setComposerDraft] = useState<ComposerDraft | null>(null);
	const [isConfirmClearOpen, setIsConfirmClearOpen] = useState(false);
	const [isExporting, setIsExporting] = useState(false);
	// "Edit & resend" picked in the detail sheet: opened once that sheet has closed.
	const pendingResendRef = useRef<ComposerDraft | null>(null);

	const counts = useMemo(
		() => ({
			in: entries.filter((entry) => entry.direction === "in").length,
			out: entries.filter((entry) => entry.direction === "out").length,
			errors: entries.filter(isErrorEntry).length,
		}),
		[entries],
	);

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return entries.filter((entry) => {
			if (direction === "errors" ? !isErrorEntry(entry) : direction !== "all" && entry.direction !== direction) return false;
			if (!needle) return true;
			return `${entry.type} ${entry.ref ?? ""} ${entry.status ?? ""} ${entry.data}`.toLowerCase().includes(needle);
		});
	}, [entries, direction, query]);

	// A command and its response share a ref.
	const relatedOf = (entry: WsTraceEntry): WsTraceEntry | null =>
		entry.ref && entry.direction !== "status"
			? entries.find((other) => other.ref === entry.ref && other.direction !== entry.direction) ?? null
			: null;

	const handleExport = async () => {
		setIsExporting(true);
		try {
			const fileName = `free-grind-ws-trace-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
			await saveTextFile(fileName, exportWsTraceEntries(), "application/json");
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

	const filters: { value: DirectionFilter; label: string }[] = [
		{ value: "all", label: "All" },
		{ value: "in", label: counts.in > 0 ? `In · ${counts.in}` : "In" },
		{ value: "out", label: counts.out > 0 ? `Out · ${counts.out}` : "Out" },
		{ value: "errors", label: counts.errors > 0 ? `Errors · ${counts.errors}` : "Errors" },
	];

	const connectionLabel = connection === "connected" ? "Connected" : connection === "reconnecting" ? "Reconnecting…" : "Not connected";
	const connectionDot = connection === "connected" ? "bg-emerald-500" : connection === "reconnecting" ? "bg-amber-500 animate-pulse" : "bg-slate-400";

	return (
		<section className="app-screen">
			<PageHeader
				backTo="/settings"
				title="WebSocket Explorer"
				subtitle="Every realtime frame the app sends and receives, live. Tap one for details, or send your own."
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

			<div className="grid min-w-0 gap-5">
				<div className="native-group">
					<div className="flex items-center gap-3 px-4 py-3.5">
						<div className="shrink-0 rounded-2xl bg-slate-500/15 p-2.5 text-slate-400">
							<Cable className="h-5 w-5" />
						</div>
						<div className="min-w-0 flex-1">
							<p className="text-sm font-semibold leading-snug">Realtime socket</p>
							<p className="mt-0.5 flex items-center gap-1.5 text-xs leading-snug text-[var(--text-muted)]">
								<span className={cn("h-2 w-2 shrink-0 rounded-full", connectionDot)} />
								{connectionLabel}
							</p>
						</div>
					</div>
					<button
						type="button"
						onClick={() => setComposerDraft({ type: "", payload: "" })}
						className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover-fill"
					>
						<div className="shrink-0 rounded-2xl accent-tint-15 p-2.5 text-[var(--accent)]">
							<Send className="h-5 w-5" />
						</div>
						<div className="min-w-0 flex-1">
							<p className="text-sm font-semibold leading-snug">Send command</p>
							<p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">Send any command on the app's socket</p>
						</div>
						<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
					</button>
				</div>

				<PageSearchBar value={query} onChange={setQuery} placeholder="Search type, ref, status or payload" />

				<div className="min-w-0">
					<div className="mb-2 flex flex-wrap items-center gap-2 px-1">
						<p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Frames</p>
						<span className="rounded-full ink-tint-10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-[var(--text-muted)]">
							{filtered.length}
						</span>
						<div className="ml-auto flex flex-wrap justify-end gap-1.5">
							{filters.map((filter) => (
								<SheetChip key={filter.value} size="sm" active={direction === filter.value} onClick={() => setDirection(filter.value)}>
									{filter.label}
								</SheetChip>
							))}
						</div>
					</div>
					{filtered.length === 0 ? (
						<div className="native-card overflow-hidden px-4">
							<DrawerEmptyState
								icon={<Cable />}
								fanned={false}
								title={entries.length === 0 ? "No frames yet" : "Nothing matches"}
								hint={entries.length === 0
									? "Use the app as usual; realtime events and commands show up here as they happen."
									: "Try another search or filter."}
							/>
						</div>
					) : (
						<div className="native-group">
							{filtered.map((entry) => (
								<button
									key={entry.id}
									type="button"
									onClick={() => setOpenEntry(entry)}
									className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition hover-fill"
								>
									<DirectionIcon entry={entry} />
									<div className="min-w-0 flex-1">
										<p className={cn("truncate text-[13px] font-semibold text-[var(--text)]", entry.direction !== "status" && "font-mono")}>{entryTitle(entry)}</p>
										<p className="mt-0.5 truncate text-xs tabular-nums text-[var(--text-muted)]">
											{formatTimestamp(entry.timestamp)}
											{entry.ref ? ` · ref ${entry.ref}` : ""}
										</p>
									</div>
									{entry.status != null && <StatusPill status={entry.status} />}
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
					related={relatedOf(openEntry)}
					onClose={() => {
						setOpenEntry(null);
						const draft = pendingResendRef.current;
						pendingResendRef.current = null;
						if (draft) afterSheetClose(() => setComposerDraft(draft));
					}}
					onOpen={setOpenEntry}
					onResend={(draft) => {
						pendingResendRef.current = draft;
					}}
					isDesktop={isDesktop}
				/>
			)}
			{composerDraft && (
				<ComposerSheet initial={composerDraft} connected={connection === "connected"} onClose={() => setComposerDraft(null)} isDesktop={isDesktop} />
			)}

			<ConfirmDialog
				isOpen={isConfirmClearOpen}
				title="Clear all frames?"
				message="Removes the captured history from this list. The socket keeps running as usual."
				confirmLabel="Clear"
				cancelLabel="Cancel"
				confirmTone="danger"
				onConfirm={() => {
					clearWsTraceEntries();
					setIsConfirmClearOpen(false);
				}}
				onCancel={() => setIsConfirmClearOpen(false)}
			/>
		</section>
	);
}
