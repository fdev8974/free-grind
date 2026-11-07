import { Check, Clock, Loader2, SearchX, Send, Smile, Sticker, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheet, SheetClose, SheetCloseButton, SHEET_FOOTER_CLASS, sheetButtonClass } from "../../../components/ui/bottom-sheet";
import { SheetChip, SheetSearchInput } from "../../../components/ui/sheet-section";
import { useScrollRowFade } from "../../../hooks/useScrollRowFade";
import { SlidingTabs, useSwipeTabs } from "../../../components/ui/sliding-tabs";
import { DrawerEmptyState } from "./drawerUi";
import { GIPHY_API_KEY, GIPHY_BASE, GIPHY_RECENT_GIFS_MAX as RECENT_GIFS_MAX } from "../../../config/giphy-config";
import { fetchExternal, okHttpQueryComponent } from "../../../services/externalFetch";
import { getRecentGaymoji, getRecentGifs, setRecentGaymoji, setRecentGifs } from "../../../services/chatDb";
import { proxyMediaUrl } from "../../../utils/mediaProxy";
import { getGaymojiSections, type GaymojiItem, type GaymojiSection } from "../../../services/gaymoji";

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

const RECENT_GAYMOJI_MAX = 24;

async function loadRecentGaymoji(): Promise<GaymojiItem[]> {
	try {
		return await getRecentGaymoji<GaymojiItem>();
	} catch {
		return [];
	}
}

async function saveRecentGaymoji(item: GaymojiItem): Promise<GaymojiItem[]> {
	const existing = (await loadRecentGaymoji()).filter((g) => g.id !== item.id);
	const next = [item, ...existing].slice(0, RECENT_GAYMOJI_MAX);
	return setRecentGaymoji(next);
}

interface StickerPickerSheetProps {
	onClose: () => void;
	onSelect: (gif: GiphyItem) => void;
	onSelectGaymoji: (imageHash: string) => void;
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

// Same page size, rating and parameter order as the official app's requests.
const GIPHY_PAGE_SIZE = 50;
const GIPHY_RATING = "r";

function systemLanguage(): string {
	try {
		return new Intl.Locale(navigator.language).language || "en";
	} catch {
		return "en";
	}
}

function giphyTrendingPath(): string {
	return `/trending?limit=${GIPHY_PAGE_SIZE}&rating=${GIPHY_RATING}&api_key=${GIPHY_API_KEY}`;
}

function giphySearchPath(query: string): string {
	return `/search?limit=${GIPHY_PAGE_SIZE}&rating=${GIPHY_RATING}&q=${okHttpQueryComponent(query)}&offset=0&api_key=${GIPHY_API_KEY}&lang=${systemLanguage()}`;
}

/** Through Rust as a plain OkHttp client, like the official app — not the WebView's fetch. */
async function fetchGiphy(path: string): Promise<unknown> {
	if (!GIPHY_API_KEY) throw new Error("VITE_GIPHY_API_KEY not set");
	const { status, body } = await fetchExternal(`${GIPHY_BASE}${path}`);
	if (status < 200 || status >= 300) throw new Error(`Giphy ${status}`);
	return JSON.parse(new TextDecoder().decode(body));
}

// Mixed heights, so the placeholder reads like the masonry it stands in for.
const GIF_SKELETON_RATIOS = ["1 / 1", "4 / 3", "3 / 4", "16 / 9", "1 / 1", "4 / 5", "16 / 10", "1 / 1"];

function GifGridSkeleton() {
	return (
		<div className="flex gap-2" aria-busy="true">
			{[0, 1].map((ci) => (
				<div key={ci} className="flex flex-1 flex-col gap-2">
					{GIF_SKELETON_RATIOS.filter((_, i) => i % 2 === ci).concat(GIF_SKELETON_RATIOS.filter((_, i) => i % 2 !== ci)).map((ratio, i) => (
						<div key={i} className="w-full animate-pulse rounded-xl bg-[var(--surface-2)]" style={{ aspectRatio: ratio }} />
					))}
				</div>
			))}
		</div>
	);
}

/** Pulses like the skeleton until the GIF itself has loaded. */
function GifImage({ src }: { src: string }) {
	const [loaded, setLoaded] = useState(false);
	return (
		<>
			{!loaded && <div className="absolute inset-0 animate-pulse bg-[var(--surface-2)]" />}
			<img
				src={proxyMediaUrl(src)}
				alt=""
				loading="lazy"
				onLoad={() => setLoaded(true)}
				onError={() => setLoaded(true)}
				className={`h-full w-full object-cover transition group-hover:scale-105 ${loaded ? "opacity-100" : "opacity-0"}`}
			/>
		</>
	);
}

function SelectedOverlay() {
	return (
		<>
			<div className="pointer-events-none absolute inset-0 rounded-xl bg-[var(--accent)] opacity-25" />
			<div className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-inset ring-[var(--accent)]" />
			<span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)] shadow-md">
				<Check className="h-3.5 w-3.5" />
			</span>
		</>
	);
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
								<GifImage key={gif.id} src={gif.previewWebpUrl ?? gif.previewUrl} />
								{isSelected && <SelectedOverlay />}
							</button>
						);
					})}
				</div>
			))}
		</div>
	);
}

const GAYMOJI_GRID_CLASS = "grid grid-cols-4 gap-1 min-[480px]:grid-cols-5 min-[640px]:grid-cols-6";

function gaymojiCategoryTitle(key: string): string {
	const words = key.replace(/\+/g, " & ").replace(/_/g, " ").replace(/\s+/g, " ").trim();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

function GaymojiImage({ item, className }: { item: GaymojiItem; className: string }) {
	const [loaded, setLoaded] = useState(false);
	return (
		<>
			{!loaded && <div className="absolute inset-1 animate-pulse rounded-lg bg-[var(--surface-2)]" />}
			<img
				src={proxyMediaUrl(item.imageUrl)}
				alt={item.label}
				loading="lazy"
				draggable={false}
				onLoad={() => setLoaded(true)}
				onError={() => setLoaded(true)}
				className={`${className} object-contain transition ${loaded ? "opacity-100" : "opacity-0"}`}
			/>
		</>
	);
}

type GaymojiState =
	| { status: "idle" | "loading" | "failed" }
	| { status: "ready"; sections: GaymojiSection[] };

/** Loads the manifest the first time the Gaymoji tab is opened. */
function useGaymojiSections(active: boolean) {
	const [state, setState] = useState<GaymojiState>({ status: "idle" });

	const load = useCallback(() => {
		setState({ status: "loading" });
		getGaymojiSections().then(
			(sections) => setState({ status: "ready", sections }),
			(error: unknown) => {
				console.error(error);
				setState({ status: "failed" });
			},
		);
	}, []);

	useEffect(() => {
		if (active && state.status === "idle") load();
	}, [active, state.status, load]);

	return { state, retry: load };
}

function useGaymojiCategoryTitle() {
	const { t } = useTranslation();
	return (key: string) =>
		t(`chat.stickers.gaymoji_categories.${key.replace(/\W+/g, "_")}`, { defaultValue: gaymojiCategoryTitle(key) });
}

/** Filter chips in place of the search field; `null` is "all". */
function GaymojiCategoryChips({
	sections,
	category,
	onChange,
}: {
	sections: GaymojiSection[];
	category: string | null;
	onChange: (category: string | null) => void;
}) {
	const { t } = useTranslation();
	const title = useGaymojiCategoryTitle();
	// Wheel and mouse drag scroll it sideways on desktop; touch scrolls it natively.
	const rowFade = useScrollRowFade();
	return (
		<div
			ref={rowFade.ref}
			onScroll={rowFade.onScroll}
			role="toolbar"
			aria-label={t("chat.stickers.tab_gaymoji")}
			data-no-tab-swipe
			className="-mx-4 mb-3 shrink-0 overflow-x-auto overscroll-x-contain px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
		>
			<div className="flex min-w-max items-center gap-2">
				<SheetChip size="sm" active={category === null} onClick={() => onChange(null)}>
					{t("chat.stickers.gaymoji_all")}
				</SheetChip>
				{sections.map(({ key }) => (
					<SheetChip key={key} size="sm" active={category === key} onClick={() => onChange(key)}>
						{title(key)}
					</SheetChip>
				))}
			</div>
		</div>
	);
}

function GaymojiGrid({
	items,
	selectedId,
	onToggle,
}: {
	items: GaymojiItem[];
	selectedId: string | null;
	onToggle: (item: GaymojiItem) => void;
}) {
	return (
		<div className={GAYMOJI_GRID_CLASS}>
			{items.map((item) => (
				<button
					key={item.id}
					type="button"
					aria-label={item.label}
					aria-pressed={selectedId === item.id}
					onClick={() => onToggle(item)}
					className="relative aspect-square rounded-xl p-1 transition active:scale-[0.96]"
				>
					<GaymojiImage item={item} className="h-full w-full" />
					{selectedId === item.id && <SelectedOverlay />}
				</button>
			))}
		</div>
	);
}

/** Every category as a titled grid, or just the one picked in the chips. */
function GaymojiPanel({
	state,
	onRetry,
	category,
	selectedId,
	onToggle,
}: {
	state: GaymojiState;
	onRetry: () => void;
	category: string | null;
	selectedId: string | null;
	onToggle: (item: GaymojiItem) => void;
}) {
	const { t } = useTranslation();
	const title = useGaymojiCategoryTitle();

	if (state.status === "failed") {
		return (
			<div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
				<p className="text-sm text-[var(--text-muted)]">{t("chat.stickers.gaymoji_error_load")}</p>
				<button
					type="button"
					onClick={onRetry}
					className="inline-flex h-9 items-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 text-sm font-semibold text-[var(--text)] transition hover:brightness-110"
				>
					{t("chat.stickers.retry")}
				</button>
			</div>
		);
	}

	if (state.status !== "ready") {
		return (
			<div className={GAYMOJI_GRID_CLASS} aria-busy="true">
				{Array.from({ length: 18 }, (_, i) => (
					<div key={i} className="aspect-square animate-pulse rounded-lg bg-[var(--surface-2)]" />
				))}
			</div>
		);
	}

	const picked = category === null ? undefined : state.sections.find(({ key }) => key === category);
	if (picked) return <GaymojiGrid items={picked.items} selectedId={selectedId} onToggle={onToggle} />;

	return state.sections.map((section, i) => (
		<section key={section.key} aria-label={title(section.key)}>
			<h4 className={`px-1 pb-2 text-sm font-medium text-[var(--text-muted)] ${i === 0 ? "" : "pt-4"}`}>
				{title(section.key)}
			</h4>
			<GaymojiGrid items={section.items} selectedId={selectedId} onToggle={onToggle} />
		</section>
	));
}

function RecentSectionTitle({ first, children }: { first: boolean; children: ReactNode }) {
	return (
		<h4 className={`px-1 pb-2 text-sm font-medium text-[var(--text-muted)] ${first ? "" : "pt-4"}`}>{children}</h4>
	);
}

type Tab = "trending" | "gaymoji" | "recent";
const GIPHY_TABS: readonly Tab[] = ["trending", "gaymoji", "recent"];

type Selection = { kind: "gif"; gif: GiphyItem } | { kind: "gaymoji"; item: GaymojiItem };

function selectionId(selection: Selection | null, kind: Selection["kind"]): string | null {
	if (selection?.kind !== kind) return null;
	return selection.kind === "gif" ? selection.gif.id : selection.item.id;
}

export function StickerPickerSheet({ onClose, onSelect, onSelectGaymoji, isDesktop, isSending = false }: StickerPickerSheetProps) {
	const { t } = useTranslation();
	const [tab, setTab] = useState<Tab>("trending");
	const [query, setQuery] = useState("");
	const [gifs, setGifs] = useState<GiphyItem[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [selection, setSelection] = useState<Selection | null>(null);
	const [gaymojiCategory, setGaymojiCategory] = useState<string | null>(null);
	const gaymoji = useGaymojiSections(tab === "gaymoji");
	const [recentGifs, setRecentGifsState] = useState<GiphyItem[]>([]);
	const [recentGaymoji, setRecentGaymojiState] = useState<GaymojiItem[]>([]);

	useEffect(() => {
		void loadRecentGifs().then(setRecentGifsState);
		void loadRecentGaymoji().then(setRecentGaymojiState);
	}, []);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const contentRef = useRef<HTMLDivElement>(null);

	// New results (a search, trending again, another tab) start at the top.
	useEffect(() => {
		contentRef.current?.scrollTo({ top: 0 });
	}, [gifs, tab, gaymojiCategory]);

	const loadTrending = useCallback(async () => {
		setIsLoading(true);
		setError(null);
		try {
			const raw = await fetchGiphy(giphyTrendingPath());
			setGifs(parseGiphyResponse(raw));
		} catch {
			setError(t("chat.stickers.error_load"));
		} finally {
			setIsLoading(false);
		}
	}, [t]);

	const searchGifs = useCallback(async (q: string) => {
		setIsLoading(true);
		setError(null);
		try {
			const raw = await fetchGiphy(giphySearchPath(q));
			setGifs(parseGiphyResponse(raw));
		} catch {
			setError(t("chat.stickers.error_search"));
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
		setSelection(null);
		if (next === "trending") {
			setQuery("");
			void loadTrending();
		}
	};
	const tabSwipe = useSwipeTabs<Tab>(GIPHY_TABS, tab, handleTabChange);

	const handleToggle = (gif: GiphyItem) => {
		setSelection((prev) => (prev?.kind === "gif" && prev.gif.id === gif.id ? null : { kind: "gif", gif }));
	};

	const handleToggleGaymoji = (item: GaymojiItem) => {
		setSelection((prev) => (prev?.kind === "gaymoji" && prev.item.id === item.id ? null : { kind: "gaymoji", item }));
	};

	const sendSelection = () => {
		if (selection?.kind === "gif") {
			void saveRecentGif(selection.gif).then(setRecentGifsState);
			onSelect(selection.gif);
		} else if (selection?.kind === "gaymoji") {
			void saveRecentGaymoji(selection.item).then(setRecentGaymojiState);
			onSelectGaymoji(selection.item.imageHash);
		}
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
				<h3 className="text-sm font-semibold text-[var(--text)]">{t("chat.stickers.title")}</h3>
				<SheetCloseButton />
			</div>

			<SlidingTabs<Tab>
				className="mb-3 shrink-0"
				value={tab}
				onChange={handleTabChange}
				tabs={[
					{ value: "trending", label: t("chat.stickers.tab_trending"), icon: <TrendingUp className="h-3.5 w-3.5" /> },
					{ value: "gaymoji", label: t("chat.stickers.tab_gaymoji"), icon: <Smile className="h-3.5 w-3.5" /> },
					{ value: "recent", label: t("chat.stickers.tab_recent"), icon: <Clock className="h-3.5 w-3.5" /> },
				]}
			/>

			{/* Search (Trending tab only) */}
			{tab === "trending" && (
				<SheetSearchInput
					floating
					value={query}
					onChange={handleQueryChange}
					isLoading={isLoading && query.trim().length > 0}
					placeholder={t("chat.stickers.search_placeholder")}
				/>
			)}

			{tab === "gaymoji" && gaymoji.state.status === "ready" && (
				<GaymojiCategoryChips sections={gaymoji.state.sections} category={gaymojiCategory} onChange={setGaymojiCategory} />
			)}

			{/* Content — on mouse devices the 10px scrollbar gutter comes out of the
			    right padding, so the grid ends at the same edge as the search pill. */}
			<div
				ref={contentRef}
				className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-1 [scrollbar-gutter:stable] [@media(hover:hover)_and_(pointer:fine)]:pr-[calc(1rem-10px)]"
				data-lenis-prevent
				{...tabSwipe}
			>
				{tab === "gaymoji" ? (
					<GaymojiPanel
						state={gaymoji.state}
						onRetry={gaymoji.retry}
						category={gaymojiCategory}
						selectedId={selectionId(selection, "gaymoji")}
						onToggle={handleToggleGaymoji}
					/>
				) : tab === "trending" ? (
					isLoading ? (
						<GifGridSkeleton />
					) : error ? (
						<div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
							<p className="text-sm text-[var(--text-muted)]">{error}</p>
							<button
								type="button"
								onClick={() => (query.trim() ? void searchGifs(query.trim()) : void loadTrending())}
								className="inline-flex h-9 items-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 text-sm font-semibold text-[var(--text)] transition hover:brightness-110"
							>
								{t("chat.stickers.retry")}
							</button>
						</div>
					) : gifs.length === 0 ? (
						<DrawerEmptyState
							icon={<SearchX className="h-5 w-5" />}
							title={t("chat.stickers.no_results")}
							hint={t("chat.stickers.no_results_hint", { defaultValue: "Try a different search term." })}
						/>
					) : (
						<GifGrid gifs={gifs} selectedId={selectionId(selection, "gif")} onToggle={handleToggle} />
					)
				) : recentGifs.length === 0 && recentGaymoji.length === 0 ? (
					<DrawerEmptyState
						icon={<Sticker className="h-5 w-5" />}
						title={t("chat.stickers.recent_empty")}
						hint={t("chat.stickers.recent_empty_hint")}
					/>
				) : (
					<>
						{recentGaymoji.length > 0 && (
							<section aria-label={t("chat.stickers.tab_gaymoji")}>
								<RecentSectionTitle first>{t("chat.stickers.tab_gaymoji")}</RecentSectionTitle>
								<GaymojiGrid items={recentGaymoji} selectedId={selectionId(selection, "gaymoji")} onToggle={handleToggleGaymoji} />
							</section>
						)}
						{recentGifs.length > 0 && (
							<section aria-label={t("chat.stickers.section_gifs")}>
								{recentGaymoji.length > 0 && (
									<RecentSectionTitle first={false}>{t("chat.stickers.section_gifs")}</RecentSectionTitle>
								)}
								<GifGrid gifs={recentGifs} selectedId={selectionId(selection, "gif")} onToggle={handleToggle} />
							</section>
						)}
					</>
				)}
			</div>

			{/* Send footer */}
			{selection && (
				<div className={SHEET_FOOTER_CLASS}>
					{/* SheetClose so the sheet animates out and pops its history entry. */}
					<SheetClose
						onClick={sendSelection}
						disabled={isSending}
						className={sheetButtonClass()}
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
