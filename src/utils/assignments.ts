export type Assignment = {
	key: string;
	value: string;
	type: string | null;
	payload: unknown;
};

export function parseAssignments(raw: unknown): Assignment[] {
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
export function parseJwtAssignments(token: string): Assignment[] {
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

export function isAssignmentValueOn(value: string): boolean {
	const v = value.toLowerCase();
	return v === "on" || v === "true" || v === "enabled";
}
