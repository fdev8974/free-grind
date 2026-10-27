import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

import type { OpenApiDoc, Parameter, ParameterOrRef } from "./generator/types";
import { HTTP_METHODS } from "./generator/types";

const doc = JSON.parse(readFileSync("lib/openapi.json", "utf8")) as OpenApiDoc;
const docsDir = "content/grindr-api";

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const e of readdirSync(dir)) {
		const full = join(dir, e);
		if (statSync(full).isDirectory()) out.push(...walk(full));
		else if (e.endsWith(".md")) out.push(full);
	}
	return out;
}

function resolveParam(p: ParameterOrRef): Parameter | undefined {
	if ("$ref" in p) {
		const name = p.$ref.replace("#/components/parameters/", "");
		return doc.components.parameters?.[name];
	}
	return p;
}

type ParsedQueryParams = {
	params: Record<string, { optional: boolean }>;
	allOptional: boolean;
};

function parseOriginalQueryParams(
	content: string,
	method: string,
	path: string,
): ParsedQueryParams | null {
	const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const fence = new RegExp(
		"```[^\\n]*\\n(?:- )?" +
			method +
			"\\s+" +
			escapedPath +
			"[^\\n]*\\n```([\\s\\S]*?)(?=^## |^# |$)",
		"m",
	);
	const m = content.match(fence);
	if (!m) return null;
	const after = m[1] ?? "";
	const queryRe =
		/Query[^:\n]*:[ \t]*\n([\s\S]*?)(?=\n\n[A-Z]|\nBody|\nResponse|\n#|$)/;
	const qm = after.match(queryRe);
	if (!qm) return null;
	const block = qm[1] ?? "";
	const optional = /Query \(optional\)/.test(
		after.slice(0, (qm.index ?? 0) + 20),
	);
	const params: Record<string, { optional: boolean }> = {};
	for (const line of block.split("\n")) {
		const lm = line.match(/^- `([^`]+)` — (.+)$/);
		if (!lm) continue;
		const name = lm[1];
		const rhs = lm[2];
		if (!name || !rhs) continue;
		const isOpt = /\boptional\b/i.test(rhs);
		params[name] = { optional: isOpt || optional };
	}
	return { params, allOptional: optional };
}

const mdFiles = walk(docsDir);
const mdByPath = new Map<string, string>();
for (const f of mdFiles) mdByPath.set(f, readFileSync(f, "utf8"));

const mismatches: Array<{
	path: string;
	param: string;
	openapi: string;
	original: string;
}> = [];

for (const [pathStr, item] of Object.entries(doc.paths)) {
	for (const m of HTTP_METHODS.filter((x) => x !== "head" && x !== "options")) {
		const op = item[m];
		if (!op) continue;
		const params = (op.parameters ?? [])
			.map(resolveParam)
			.filter((p): p is Parameter => p?.in === "query");
		if (!params.length) continue;
		let mdOrig = null;
		for (const [, content] of mdByPath) {
			const found = parseOriginalQueryParams(content, m.toUpperCase(), pathStr);
			if (found) {
				mdOrig = found;
				break;
			}
		}
		if (!mdOrig) continue;
		for (const p of params) {
			const orig = mdOrig.params[p.name];
			if (!orig) continue;
			const openapiRequired = !!p.required;
			const origRequired = !orig.optional;
			if (origRequired !== openapiRequired) {
				mismatches.push({
					path: `${m.toUpperCase()} ${pathStr}`,
					param: p.name,
					openapi: openapiRequired ? "required" : "optional",
					original: origRequired ? "required" : "optional",
				});
			}
		}
	}
}

console.log(`Query parameter required-ness mismatches: ${mismatches.length}\n`);
for (const m of mismatches) {
	console.log(
		`  ${m.path}  ${m.param}: openapi=${m.openapi}, markdown=${m.original}`,
	);
}
