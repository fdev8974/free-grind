import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import z from "zod";
import { geocodeResultSchema, type GeocodeResult } from "../../../../types/grid";
import { appLog } from "../../../../utils/logger";

/**
 * Debounced Nominatim place search behind the map sheets' search pill
 * (browse location picker, chat's share location). Searches 500ms after the
 * last keystroke once the query has 2+ characters; a newer query aborts the
 * one still in flight.
 */
export function useLocationSearch() {
	const { t } = useTranslation();
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<GeocodeResult[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const lastSearchedQueryRef = useRef("");
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const trimmed = query.trim();
		if (trimmed.length < 2) {
			setResults([]);
			setIsLoading(false);
			setError(null);
			lastSearchedQueryRef.current = "";
			return;
		}
		if (trimmed === lastSearchedQueryRef.current) return;
		const ctrl = new AbortController();
		const timer = setTimeout(() => {
			lastSearchedQueryRef.current = trimmed;
			setIsLoading(true);
			void (async () => {
				try {
					const res = await fetch(
						`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&q=${encodeURIComponent(trimmed)}`,
						{ signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible)" } },
					);
					if (!res.ok) throw new Error("search failed");
					setResults(z.array(geocodeResultSchema).parse(await res.json()));
					setError(null);
				} catch (e) {
					// Superseded: let the same query run again if it comes back.
					if (e instanceof Error && e.name === "AbortError") {
						lastSearchedQueryRef.current = "";
						return;
					}
					appLog.error("Location search failed", e);
					setError(t("browse_location.error_search_failed"));
				} finally {
					if (!ctrl.signal.aborted) setIsLoading(false);
				}
			})();
		}, 500);
		return () => {
			clearTimeout(timer);
			ctrl.abort();
		};
	}, [query, t]);

	/** Empties the search; `refocus` keeps the keyboard up for a new query. */
	const clear = (refocus: boolean) => {
		setQuery("");
		setResults([]);
		setError(null);
		lastSearchedQueryRef.current = "";
		if (refocus) inputRef.current?.focus();
		else inputRef.current?.blur();
	};

	return {
		query,
		setQuery,
		results,
		isLoading,
		error,
		/** True while there's a query, i.e. the results dropdown is open. */
		isActive: query.trim().length > 0,
		clear,
		inputRef,
	};
}
