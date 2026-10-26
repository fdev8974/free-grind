import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { BellRing, ChevronRight, Copy, Download, KeyRound, Loader2, RefreshCcw, Send, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { BellFilled } from "../../components/icons/FilledIcons";
import { PageHeader } from "../../components/PageHeader";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { NATIVE_SHEET_BG } from "../../components/ui/action-sheet";
import { BottomSheet, SheetCloseButton, SHEET_FOOTER_CLASS, sheetButtonClass } from "../../components/ui/bottom-sheet";
import { SHEET_FIELD_CLASS, SheetChip, SheetSearchInput, SheetSection } from "../../components/ui/sheet-section";
import { useAuth } from "../../contexts/useAuth";
import { useApi } from "../../hooks/useApi";
import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";
import { saveTextFile } from "../../services/saveTextFile";
import { isAndroid, isIos } from "../../services/saveMedia";
import { getSavedAccountProfile } from "../../services/savedAccountProfiles";
import {
	clearPushEventLog,
	expandJsonStrings,
	exportPushEventLog,
	getPushEventLog,
	subscribePushEventLog,
	type PushLogEntry,
} from "../../services/pushEventLog";
import { cn } from "../../utils/cn";
import { DrawerEmptyState } from "./chat/drawerUi";
import { CodeBlock, HEADER_ICON_BUTTON_CLASS, copyText, formatTimestamp } from "./settings-dev/inspectorUi";

// A developer tool, so its texts stay English (like the API Inspector).

// Same keys as AuthContext's push token sync.
const PUSH_TOKEN_STORAGE_KEY = "fg-fcm-token";
const PUSH_TOKEN_SYNCED_STORAGE_KEY = "fg-fcm-token-synced";
const PUSH_TOKEN_SAVED_SYNCED_STORAGE_KEY = "fg-fcm-token-synced-saved";

type EntryKind = "chat" | "tap" | "system" | "token";
type Filter = "all" | EntryKind | "opened";

function field(payload: unknown, key: string): string | null {
	if (!payload || typeof payload !== "object") return null;
	const value = (payload as Record<string, unknown>)[key];
	if (typeof value === "string") return value.trim() || null;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return null;
}

function entryKind(entry: PushLogEntry): EntryKind {
	if (entry.kind === "token") return "token";
	if (field(entry.payload, "isSystem") === "true") return "system";
	if (field(entry.payload, "isTap") === "true" || field(entry.payload, "action") === "taps") return "tap";
	return "chat";
}

/** "received" (FCM push), "opened" (notification tap), or "token". */
function entryEvent(entry: PushLogEntry): string {
	return entry.kind === "token" ? "token" : field(entry.payload, "event") ?? "?";
}

function entryTitle(entry: PushLogEntry): string {
	if (entry.kind === "token") return "Token refreshed";
	return field(entry.payload, "senderName") ?? field(entry.payload, "systemTitle") ?? field(entry.payload, "action") ?? "Push";
}

function entryBody(entry: PushLogEntry): string | null {
	if (entry.kind === "token") return field(entry.payload, "token");
	return field(entry.payload, "bodyText");
}

function accountLabel(accountId: string | null): string | null {
	if (!accountId) return null;
	const name = getSavedAccountProfile(accountId).displayName;
	return name ? `${name} (${accountId})` : accountId;
}

/** Readable in light and dark: tinted fill, 500-ish text. */
function eventBadgeClass(event: string): string {
	switch (event) {
		case "received": return "bg-emerald-500/15 text-emerald-500";
		case "opened": return "bg-sky-500/15 text-sky-500";
		case "token": return "bg-violet-500/15 text-violet-500";
		default: return "bg-amber-500/15 text-amber-500";
	}
}

const EVENT_LABEL: Record<string, string> = { received: "PUSH", opened: "OPEN", token: "TOKEN" };

function EventBadge({ event, className }: { event: string; className?: string }) {
	return (
		<span className={cn("shrink-0 rounded-md py-0.5 text-center font-mono text-[10px] font-bold", eventBadgeClass(event), className)}>
			{EVENT_LABEL[event] ?? event.toUpperCase().slice(0, 6)}
		</span>
	);
}

/** The payload without its raw FCM map, which gets its own block. */
function payloadWithoutRaw(payload: unknown): unknown {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
	const { rawData: _rawData, ...rest } = payload as Record<string, unknown>;
	return rest;
}

function EntryDetailSheet({ entry, onClose, isDesktop }: { entry: PushLogEntry; onClose: () => void; isDesktop: boolean }) {
	const event = entryEvent(entry);
	const payload = entry.payload;
	const rawData = payload && typeof payload === "object" ? (payload as Record<string, unknown>).rawData : undefined;
	const facts: [string, string | null][] = [
		["Kind", entryKind(entry)],
		["Source", field(payload, "source")],
		["Sender", field(payload, "senderName") ?? field(payload, "systemTitle")],
		["Sender ID", field(payload, "senderId")],
		["Conversation", field(payload, "conversationId")],
		["Account", accountLabel(field(payload, "accountId"))],
		["Message type", field(payload, "messageType")],
		["Growth type", field(payload, "growthType")],
		["Action", field(payload, "action")],
		["Open target", field(payload, "openTarget")],
		["Notification ID", field(rawData, "notificationId")],
		["Channel", field(rawData, "channel")],
	];
	const shownFacts = facts.filter((fact): fact is [string, string] => fact[1] != null);

	return (
		<BottomSheet onClose={onClose} expandable isDesktop={isDesktop} bg={NATIVE_SHEET_BG} panelClassName={isDesktop ? "max-h-[85dvh] px-4" : "px-4"}>
			<div className="mb-3 flex shrink-0 items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<EventBadge event={event} className="px-1.5" />
						<span className="rounded-full ink-tint-10 px-2 py-0.5 text-[11px] font-semibold text-[var(--text-muted)]">{entryKind(entry)}</span>
					</div>
					<p className="mt-1.5 break-words text-sm font-semibold text-[var(--text)]">{entryTitle(entry)}</p>
					<p className="mt-0.5 text-xs text-[var(--text-muted)]">{new Date(entry.at).toLocaleString()}</p>
				</div>
				<SheetCloseButton />
			</div>
			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
				<div className="space-y-5">
					{entryBody(entry) ? (
						<SheetSection title={entry.kind === "token" ? "Token" : "Text"}>
							<p className="whitespace-pre-wrap break-all rounded-xl bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--text)] select-text">
								{entryBody(entry)}
							</p>
						</SheetSection>
					) : null}
					{shownFacts.length > 0 && (
						<SheetSection title="Details">
							<dl className="divide-y divide-[var(--border)] overflow-hidden rounded-xl bg-[var(--surface-2)]">
								{shownFacts.map(([label, value]) => (
									<div key={label} className="flex min-w-0 gap-3 px-3 py-2 text-xs">
										<dt className="w-28 shrink-0 text-[var(--text-muted)]">{label}</dt>
										<dd className="min-w-0 flex-1 break-all font-mono text-[var(--text)] select-text">{value}</dd>
									</div>
								))}
							</dl>
						</SheetSection>
					)}
					<CodeBlock title="Payload" text={JSON.stringify(expandJsonStrings(payloadWithoutRaw(payload)), null, 2)} />
					{rawData !== undefined && <CodeBlock title="Raw FCM data" text={JSON.stringify(expandJsonStrings(rawData), null, 2)} />}
				</div>
			</div>
			<div className={SHEET_FOOTER_CLASS}>
				<button
					type="button"
					onClick={() => copyText(JSON.stringify({ at: new Date(entry.at).toISOString(), kind: entry.kind, payload: expandJsonStrings(payload) }, null, 2), "Event")}
					className={sheetButtonClass("secondary")}
				>
					<Copy className="h-4 w-4" />
					<span className="truncate">Copy all</span>
				</button>
			</div>
		</BottomSheet>
	);
}

function ManualSyncSheet({
	isSyncing,
	onSync,
	onClose,
	isDesktop,
}: {
	isSyncing: boolean;
	onSync: (token: string) => Promise<boolean>;
	onClose: () => void;
	isDesktop: boolean;
}) {
	const [token, setToken] = useState("");
	const trimmed = token.trim();

	return (
		<BottomSheet onClose={onClose} isDesktop={isDesktop} isProcessing={isSyncing} bg={NATIVE_SHEET_BG} panelClassName={isDesktop ? "max-h-[85dvh] px-4" : "px-4"}>
			<div className="mb-3 flex shrink-0 items-center justify-between gap-3">
				<h3 className="text-sm font-semibold text-[var(--text)]">Sync another token</h3>
				<SheetCloseButton disabled={isSyncing} />
			</div>
			<SheetSection title="FCM token">
				<textarea
					value={token}
					onChange={(event) => setToken(event.target.value)}
					placeholder="Paste an FCM token…"
					rows={4}
					spellCheck={false}
					autoCapitalize="off"
					autoCorrect="off"
					className={cn(SHEET_FIELD_CLASS, "resize-none px-4 py-3 font-mono text-xs leading-relaxed")}
				/>
				<p className="mt-1.5 px-1 text-xs text-[var(--text-muted)]">Registered for the active account only.</p>
			</SheetSection>
			<div className={SHEET_FOOTER_CLASS}>
				<button
					type="button"
					onClick={() => void onSync(trimmed).then((ok) => ok && onClose())}
					disabled={!trimmed || isSyncing}
					className={sheetButtonClass()}
				>
					{isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
					<span>Sync</span>
				</button>
			</div>
		</BottomSheet>
	);
}

function readCurrentToken(): string | null {
	const stored = window.localStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
	if (stored) return stored;
	const win = window as Window & { __FG_FCM_TOKEN?: unknown };
	return typeof win.__FG_FCM_TOKEN === "string" ? win.__FG_FCM_TOKEN : null;
}

/** AuthContext's last registration for the saved accounts that aren't active. */
function readSavedAccountsSync(): { count: number; at: number; ok: boolean } | null {
	try {
		const parsed = JSON.parse(window.localStorage.getItem(PUSH_TOKEN_SAVED_SYNCED_STORAGE_KEY) ?? "null") as
			| { key?: unknown; at?: unknown; ok?: unknown }
			| null;
		if (!parsed || typeof parsed.key !== "string" || typeof parsed.at !== "number") return null;
		const ids = parsed.key.split("::")[1] ?? "";
		return { count: ids ? ids.split(",").length : 0, at: parsed.at, ok: parsed.ok === true };
	} catch {
		return null;
	}
}

export function PushInspectorPage() {
	const isDesktop = useDesktopBreakpoint();
	const { userId } = useAuth();
	const { callMethod, asAppError } = useApi();
	const log = useSyncExternalStore(subscribePushEventLog, getPushEventLog);
	const [token, setToken] = useState<string | null>(readCurrentToken);
	const [syncedMarker, setSyncedMarker] = useState<string | null>(() => window.localStorage.getItem(PUSH_TOKEN_SYNCED_STORAGE_KEY));
	const [isSyncing, setIsSyncing] = useState(false);
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<Filter>("all");
	const [openEntry, setOpenEntry] = useState<PushLogEntry | null>(null);
	const [isManualSyncOpen, setIsManualSyncOpen] = useState(false);
	const [isConfirmClearOpen, setIsConfirmClearOpen] = useState(false);
	const [isExporting, setIsExporting] = useState(false);

	useEffect(() => {
		const onFcmToken = (event: Event) => {
			const next = (event as CustomEvent<{ token?: unknown }>).detail?.token;
			if (typeof next !== "string") return;
			setToken(next);
			setSyncedMarker(window.localStorage.getItem(PUSH_TOKEN_SYNCED_STORAGE_KEY));
		};
		window.addEventListener("fg:fcm-token", onFcmToken);
		return () => window.removeEventListener("fg:fcm-token", onFcmToken);
	}, []);

	// Marker is `${token}::${userId}` (see AuthContext): the token is shared
	// across saved accounts, but registration is per account.
	const isSynced = token != null && syncedMarker === `${token}::${userId}`;
	const savedSync = readSavedAccountsSync();

	const syncToken = async (tokenToSync: string): Promise<boolean> => {
		setIsSyncing(true);
		try {
			await callMethod("sync_push_token", { token: tokenToSync });
			const marker = `${tokenToSync}::${userId}`;
			window.localStorage.setItem(PUSH_TOKEN_SYNCED_STORAGE_KEY, marker);
			setSyncedMarker(marker);
			toast.success("FCM token synced to Grindr.");
			return true;
		} catch (error) {
			const appError = asAppError(error);
			toast.error(appError?.prettyMessage ?? (error instanceof Error ? error.message : "Sync failed"));
			return false;
		} finally {
			setIsSyncing(false);
		}
	};

	const handleExport = async () => {
		setIsExporting(true);
		try {
			const fileName = `free-grind-push-log-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
			await saveTextFile(fileName, exportPushEventLog(), "application/json");
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

	const counts = useMemo(() => {
		const result: Record<Filter, number> = { all: log.length, chat: 0, tap: 0, system: 0, token: 0, opened: 0 };
		for (const entry of log) {
			result[entryKind(entry)]++;
			if (entryEvent(entry) === "opened") result.opened++;
		}
		return result;
	}, [log]);

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return [...log].reverse().filter((entry) => {
			if (filter === "opened" ? entryEvent(entry) !== "opened" : filter !== "all" && entryKind(entry) !== filter) return false;
			return !needle || JSON.stringify(entry.payload).toLowerCase().includes(needle);
		});
	}, [log, filter, query]);

	const filters: { value: Filter; label: string }[] = [
		{ value: "all", label: "All" },
		{ value: "chat", label: "Chat" },
		{ value: "tap", label: "Taps" },
		{ value: "system", label: "System" },
		{ value: "opened", label: "Opened" },
		{ value: "token", label: "Token" },
	];

	const tone = !token ? "warn" : isSynced ? "ok" : "warn";

	return (
		<section className="app-screen">
			<div className="mx-auto grid w-full min-w-0 max-w-4xl gap-5">
				<PageHeader
					backTo="/settings"
					title="Push Inspector"
					subtitle="Every FCM push and notification tap, live — also while the app is open. Tap one for its full payload."
					subtitleClassName="-mt-3 mb-0"
					actions={
						<>
							<button type="button" onClick={() => void handleExport()} disabled={log.length === 0 || isExporting} className={HEADER_ICON_BUTTON_CLASS} aria-label="Export" title="Export as JSON">
								{isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
							</button>
							<button type="button" onClick={() => setIsConfirmClearOpen(true)} disabled={log.length === 0} className={cn(HEADER_ICON_BUTTON_CLASS, "hover:text-red-500")} aria-label="Clear" title="Clear all">
								<Trash2 className="h-4 w-4" />
							</button>
						</>
					}
				/>

				{/* Token */}
				<div className="native-card divide-y divide-[var(--border)] overflow-hidden">
					<div className="flex items-start gap-3 px-4 py-3.5">
						<div className={cn("shrink-0 rounded-2xl p-2.5", tone === "ok" ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500")}>
							<BellFilled className="h-5 w-5" />
						</div>
						<div className="min-w-0 flex-1">
							<p className="text-sm font-semibold leading-snug">
								{!token ? "No token received yet" : isSynced ? "Synced to Grindr" : "Not synced to Grindr"}
							</p>
							<p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">
								{token
									? "The device token pushes are delivered to, registered for the active account."
									: "Android hands it over via fg:fcm-token once Firebase has initialised."}
							</p>
							{token && (
								<div className="mt-2 flex items-start gap-1.5 rounded-xl bg-[var(--surface-2)] py-1.5 pl-3 pr-1.5">
									<p className="min-w-0 flex-1 break-all py-0.5 font-mono text-[11px] leading-relaxed select-all">{token}</p>
									<button
										type="button"
										onClick={() => copyText(token, "Token")}
										aria-label="Copy token"
										className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition hover:ink-tint-10 hover:text-[var(--text)]"
									>
										<Copy className="h-3.5 w-3.5" />
									</button>
								</div>
							)}
							{savedSync && savedSync.count > 0 && (
								<p className="mt-2 text-xs leading-snug text-[var(--text-muted)]">
									{savedSync.ok ? "Also registered" : "Registration failed"} for {savedSync.count} other saved account
									{savedSync.count === 1 ? "" : "s"} · {new Date(savedSync.at).toLocaleString()}
								</p>
							)}
						</div>
					</div>
					<button
						type="button"
						onClick={() => token && void syncToken(token)}
						disabled={!token || isSyncing}
						className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-[var(--surface-2)] disabled:opacity-50"
					>
						<div className="shrink-0 rounded-2xl accent-tint-15 p-2.5 text-[var(--accent)]">
							{isSyncing ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCcw className="h-5 w-5" />}
						</div>
						<div className="min-w-0 flex-1">
							<p className="text-sm font-semibold leading-snug">Re-sync token</p>
							<p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">Register it with Grindr for the active account again</p>
						</div>
						<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
					</button>
					<button
						type="button"
						onClick={() => setIsManualSyncOpen(true)}
						className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-[var(--surface-2)]"
					>
						<div className="shrink-0 rounded-2xl bg-slate-500/15 p-2.5 text-slate-400">
							<KeyRound className="h-5 w-5" />
						</div>
						<div className="min-w-0 flex-1">
							<p className="text-sm font-semibold leading-snug">Sync another token</p>
							<p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">Paste any FCM token to register</p>
						</div>
						<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
					</button>
				</div>

				<div className="grid min-w-0 gap-3">
					<SheetSearchInput value={query} onChange={setQuery} placeholder="Search sender, text, ids or any payload field" />
					<div className="flex flex-wrap gap-2">
						{filters.map((option) => (
							<SheetChip key={option.value} size="sm" active={filter === option.value} onClick={() => setFilter(option.value)}>
								{option.value !== "all" && counts[option.value] > 0 ? `${option.label} · ${counts[option.value]}` : option.label}
							</SheetChip>
						))}
					</div>
				</div>

				<div className="min-w-0">
					<div className="mb-2 flex items-center gap-2 px-1">
						<p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Events</p>
						<span className="rounded-full ink-tint-10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-[var(--text-muted)]">
							{filtered.length}
						</span>
					</div>
					{filtered.length === 0 ? (
						<div className="native-card overflow-hidden px-4">
							<DrawerEmptyState
								icon={<BellRing />}
								fanned={false}
								title={log.length === 0 ? "No pushes yet" : "Nothing matches"}
								hint={log.length === 0
									? "Pushes are logged from app launch on, also while the app is open. The last 50 are kept across restarts."
									: "Try another search or filter."}
							/>
						</div>
					) : (
						<div className="native-card divide-y divide-[var(--border)] overflow-hidden">
							{filtered.map((entry) => {
								const event = entryEvent(entry);
								const body = entryBody(entry);
								const account = field(entry.payload, "accountId");
								return (
									<button
										key={entry.id}
										type="button"
										onClick={() => setOpenEntry(entry)}
										className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition hover:bg-[var(--surface-2)]"
									>
										<EventBadge event={event} className="w-14" />
										<div className="min-w-0 flex-1">
											<p className="truncate text-[13px] font-semibold text-[var(--text)]">{entryTitle(entry)}</p>
											{body && (
												<p className={cn("mt-0.5 truncate text-xs text-[var(--text)]", entry.kind === "token" && "font-mono")}>{body}</p>
											)}
											<p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
												{formatTimestamp(entry.at)} · {entryKind(entry)}
												{account ? ` · account ${getSavedAccountProfile(account).displayName ?? account}` : ""}
											</p>
										</div>
										<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
									</button>
								);
							})}
						</div>
					)}
				</div>
			</div>

			{openEntry && <EntryDetailSheet key={openEntry.id} entry={openEntry} onClose={() => setOpenEntry(null)} isDesktop={isDesktop} />}
			{isManualSyncOpen && (
				<ManualSyncSheet isSyncing={isSyncing} onSync={syncToken} onClose={() => setIsManualSyncOpen(false)} isDesktop={isDesktop} />
			)}

			<ConfirmDialog
				isOpen={isConfirmClearOpen}
				title="Clear all events?"
				message="Removes the captured pushes from this list. Notifications keep working as usual."
				confirmLabel="Clear"
				cancelLabel="Cancel"
				confirmTone="danger"
				onConfirm={() => {
					clearPushEventLog();
					setIsConfirmClearOpen(false);
				}}
				onCancel={() => setIsConfirmClearOpen(false)}
			/>
		</section>
	);
}
