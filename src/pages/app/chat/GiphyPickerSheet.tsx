import { Check, Clock, Loader2, Search, Send, Sticker, TrendingUp, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheet, SheetClose, SheetCloseButton } from "../../../components/ui/bottom-sheet";
import { SlidingTabs, useSwipeTabs } from "../../../components/ui/sliding-tabs";
import { DrawerEmptyState } from "./drawerUi";
import { GIPHY_API_KEY, GIPHY_BASE, GIPHY_RECENT_GIFS_MAX as RECENT_GIFS_MAX } from "../../../config/giphy-config";
import { getRecentGifs, setRecentGifs } from "../../../services/chatDb";

interface GiphyItem {
	id: string;
	previewUrl: string;
	previewWebpUrl: string | null;
	urlPath: string;
	stillPath: string;
	previewPath: string;
	width: number;
	height: number;
}

async function loadRecentGifs(): Promise<GiphyItem[]> {
	try {
		return await getRecentGifs<GiphyItem>();
	} catch {
		return [];
	}
}

async function saveRecentGif(gif: GiphyItem): Promise<GiphyItem[]> {
	const existing = (await loadRecentGifs()).filter((g) => g.id !== gif.id);
	const next = [gif, ...existing].slice(0, RECENT_GIFS_MAX);
	return setRecentGifs(next);
}

interface GiphyPickerSheetProps {
	onClose: () => void;
	onSelect: (gif: GiphyItem) => void;
	isDesktop: boolean;
	isSending?: boolean;
}

function imgUrl(images: Record<string, unknown>, key: string): string | null {
	const v = images[key];
	if (!v || typeof v !== "object") return null;
	const u = (v as Record<string, unknown>).url;
	return typeof u === "string" ? u : null;
}

function imgWebp(images: Record<string, unknown>, key: string): string | null {
	const v = images[key];
	if (!v || typeof v !== "object") return null;
	const u = (v as Record<string, unknown>).webp;
	return typeof u === "string" ? u : null;
}

function imgDim(images: Record<string, unknown>, key: string): { width: number; height: number } {
	const v = images[key];
	if (!v || typeof v !== "object") return { width: 0, height: 0 };
	const img = v as Record<string, unknown>;
	return { width: Number(img.width) || 0, height: Number(img.height) || 0 };
}

function parseGiphyResponse(raw: unknown): GiphyItem[] {
	if (!raw || typeof raw !== "object") return [];
	const r = raw as Record<string, unknown>;
	const data = Array.isArray(r.data) ? r.data : [];
	return data.flatMap((item: unknown) => {
		if (!item || typeof item !== "object") return [];
		const it = item as Record<string, unknown>;
		const id = typeof it.id === "string" ? it.id : null;
		const images = it.images && typeof it.images === "object" ? it.images as Record<string, unknown> : null;
		if (!id || !images) return [];

		const urlPath = imgUrl(images, "original") ?? imgUrl(images, "downsized_large") ?? imgUrl(images, "fixed_height");
		if (!urlPath) return [];

		const stillPath = imgUrl(images, "original_still") ?? imgUrl(images, "fixed_height_still") ?? urlPath;
		const previewPath = imgUrl(images, "fixed_height_small") ?? imgUrl(images, "fixed_height") ?? urlPath;
		const previewUrl = imgUrl(images, "fixed_height") ?? urlPath;
		const previewWebpUrl = imgWebp(images, "fixed_height") ?? null;
		const { width, height } = imgDim(images, "original");

		return [{ id, previewUrl, previewWebpUrl, urlPath, stillPath, previewPath, width, height }];
	});
}

async function fetchGiphy(path: string): Promise<unknown> {
	if (!GIPHY_API_KEY) throw new Error("VITE_GIPHY_API_KEY not set");
	const sep = path.includes("?") ? "&" : "?";
	const res = await fetch(`${GIPHY_BASE}${path}${sep}api_key=${GIPHY_API_KEY}`);
	if (!res.ok) throw new Error(`Giphy ${res.status}`);
	return res.json();
}

function GifGrid({ gifs, selectedId, onToggle }: { gifs: GiphyItem[]; selectedId: string | null; onToggle: (gif: GiphyItem) => void }) {
	const col1: GiphyItem[] = [];
	const col2: GiphyItem[] = [];
	gifs.forEach((g, i) => (i % 2 === 0 ? col1 : col2).push(g));

	return (
		<div className="flex gap-2">
			{[col1, col2].map((col, ci) => (
				<div key={ci} className="flex flex-1 flex-col gap-2">
					{col.map((gif, i) => {
						const isSelected = selectedId === gif.id;
						return (
							<button
								key={`${ci}-${i}`}
								type="button"
								onClick={() => onToggle(gif)}
								className="group relative w-full overflow-hidden rounded-xl bg-[var(--surface-2)] transition active:scale-[0.98]"
								style={{
									aspectRatio: gif.width > 0 && gif.height > 0 ? `${gif.width} / ${gif.height}` : "1 / 1",
								}}
							>
								<img
									src={gif.previewWebpUrl ?? gif.previewUrl}
									alt=""
									loading="lazy"
									className="h-full w-full object-cover transition group-hover:scale-105"
								/>
								{isSelected && (
									<>
										<div className="pointer-events-none absolute inset-0 rounded-xl bg-[color-mix(in_srgb,var(--accent)_25%,transparent)] ring-2 ring-inset ring-[var(--accent)]" />
										<span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)] shadow-md">
											<Check className="h-3.5 w-3.5" />
										</span>
									</>
								)}
							</button>
						);
					})}
				</div>
			))}
		</div>
	);
}

type Tab = "trending" | "recent";
const GIPHY_TABS: readonly Tab[] = ["trending", "recent"];

export function GiphyPickerSheet({ onClose, onSelect, isDesktop, isSending = false }: GiphyPickerSheetProps) {
	const { t } = useTranslation();
	const [tab, setTab] = useState<Tab>("trending");
	const [query, setQuery] = useState("");
	const [gifs, setGifs] = useState<GiphyItem[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [selectedGif, setSelectedGif] = useState<GiphyItem | null>(null);
	const [recentGifs, setRecentGifsState] = useState<GiphyItem[]>([]);

	useEffect(() => {
		void loadRecentGifs().then(setRecentGifsState);
	}, []);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const loadTrending = useCallback(async () => {
		setIsLoading(true);
		setError(null);
		try {
			const raw = await fetchGiphy("/trending?limit=30");
			setGifs(parseGiphyResponse(raw));
		} catch {
			setError(t("chat.giphy.error_load"));
		} finally {
			setIsLoading(false);
		}
	}, [t]);

	const searchGifs = useCallback(async (q: string) => {
		setIsLoading(true);
		setError(null);
		try {
			const raw = await fetchGiphy(`/search?q=${encodeURIComponent(q)}&limit=30`);
			setGifs(parseGiphyResponse(raw));
		} catch {
			setError(t("chat.giphy.error_search"));
		} finally {
			setIsLoading(false);
		}
	}, [t]);

	useEffect(() => {
		void loadTrending();
	}, [loadTrending]);

	useEffect(() => {
		return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
	}, []);

	const handleQueryChange = (value: string) => {
		setQuery(value);
		if (debounceRef.current) clearTimeout(debounceRef.current);
		if (!value.trim()) {
			void loadTrending();
			return;
		}
		debounceRef.current = setTimeout(() => { void searchGifs(value.trim()); }, 400);
	};

	const handleTabChange = (next: Tab) => {
		setTab(next);
		setSelectedGif(null);
		if (next === "trending") {
			setQuery("");
			void loadTrending();
		}
	};
	const tabSwipe = useSwipeTabs<Tab>(GIPHY_TABS, tab, handleTabChange);

	const handleToggle = (gif: GiphyItem) => {
		setSelectedGif((prev) => (prev?.id === gif.id ? null : gif));
	};

	return (
		<BottomSheet
			onClose={onClose}
			expandable
			isDesktop={isDesktop}
			bg="bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]"
			panelClassName={isDesktop ? "max-h-[70dvh] px-4" : "px-4"}
		>
			<div className="mb-3 flex items-center justify-between gap-3">
				<h3 className="text-sm font-semibold text-[var(--text)]">{t("chat.giphy.title")}</h3>
				<SheetCloseButton />
			</div>

			<SlidingTabs<Tab>
				className="mb-3 shrink-0"
				value={tab}
				onChange={handleTabChange}
				tabs={[
					{ value: "trending", label: t("chat.giphy.tab_trending"), icon: <TrendingUp className="h-3.5 w-3.5" /> },
					{ value: "recent", label: t("chat.giphy.tab_recent"), icon: <Clock className="h-3.5 w-3.5" /> },
				]}
			/>

			{/* Search (Trending tab only) */}
			{tab === "trending" && (
				<div className="relative mb-3 shrink-0">
					<Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
					<input
						type="text"
						value={query}
						onChange={(e) => handleQueryChange(e.target.value)}
						placeholder={t("chat.giphy.search_placeholder")}
						className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] pl-10 pr-10 text-sm text-[var(--text)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
					/>
					{isLoading && query.trim() ? (
						<Loader2 className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[var(--text-muted)]" />
					) : query.length > 0 ? (
						<button
							type="button"
							onClick={() => handleQueryChange("")}
							className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-[var(--text-muted)] transition hover:text-[var(--text)]"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					) : null}
				</div>
			)}

			{/* Content */}
			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-1" data-lenis-prevent {...tabSwipe}>
				{tab === "trending" ? (
					isLoading ? (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="h-6 w-6 animate-spin text-[var(--accent)]" />
						</div>
					) : error ? (
						<div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
							<p className="text-sm text-[var(--text-muted)]">{error}</p>
							<button
								type="button"
								onClick={() => (query.trim() ? void searchGifs(query.trim()) : void loadTrending())}
								className="inline-flex h-9 items-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 text-sm font-semibold text-[var(--text)] transition hover:brightness-110"
							>
								{t("chat.giphy.retry")}
							</button>
						</div>
					) : gifs.length === 0 ? (
						<div className="flex items-center justify-center py-12">
							<p className="text-sm text-[var(--text-muted)]">{t("chat.giphy.no_results")}</p>
						</div>
					) : (
						<GifGrid gifs={gifs} selectedId={selectedGif?.id ?? null} onToggle={handleToggle} />
					)
				) : recentGifs.length === 0 ? (
					<DrawerEmptyState
						icon={<Sticker className="h-5 w-5" />}
						title={t("chat.giphy.recent_empty")}
						hint={t("chat.giphy.recent_empty_hint")}
					/>
				) : (
					<GifGrid gifs={recentGifs} selectedId={selectedGif?.id ?? null} onToggle={handleToggle} />
				)}
			</div>

			{/* Send footer */}
			{selectedGif && (
				<div className="-mx-4 mt-3 flex shrink-0 border-t border-[var(--border)] px-4 pt-3">
					{/* SheetClose so the sheet animates out and pops its history entry. */}
					<SheetClose
						onClick={() => {
							void saveRecentGif(selectedGif).then(setRecentGifsState);
							onSelect(selectedGif);
						}}
						disabled={isSending}
						className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)] transition hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
					>
						{isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
						<span>{isSending ? t("chat_drawer.sending") : t("chat.send")}</span>
					</SheetClose>
				</div>
			)}
		</BottomSheet>
	);
}

export type { GiphyItem };
