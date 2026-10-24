import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

import type { OpenApiDoc } from "./generator/types";
import { HTTP_METHODS } from "./generator/types";

const openapi = JSON.parse(
	readFileSync("lib/openapi.json", "utf8"),
) as OpenApiDoc;
const openapiOps = new Set<string>();
for (const [p, item] of Object.entries(openapi.paths)) {
	for (const m of HTTP_METHODS) {
		if (item[m]) openapiOps.add(`${m.toUpperCase()} ${p}`);
	}
}

const METHODS = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";
const codeFenceRe = new RegExp(
	"^```\\n(?:- )?(" + METHODS + ")\\s+(/[^\\s]+)",
	"gm",
);
const bulletRe = new RegExp("^\\s*-?\\s*(" + METHODS + ")\\s+(/[^\\s]+)", "gm");

function walk(dir: string): string[] {
	const results: string[] = [];
	for (const e of readdirSync(dir)) {
		const full = join(dir, e);
		if (statSync(full).isDirectory()) results.push(...walk(full));
		else if (e.endsWith(".md")) results.push(full);
	}
	return results;
}

const files = walk("content/grindr-api").filter(
	(f) => !f.includes("/websocket/"),
);

const found = new Map<string, string[]>();
for (const f of files) {
	const content = readFileSync(f, "utf8");
	const all = new Set<string>();
	for (const re of [codeFenceRe, bulletRe]) {
		let m;
		re.lastIndex = 0;
		while ((m = re.exec(content)) !== null) {
			all.add(`${m[1]!.toUpperCase()} ${m[2]!.replace(/[.,;]$/, "")}`);
		}
	}
	for (const key of all) {
		if (!found.has(key)) found.set(key, []);
		found.get(key)!.push(f.replace("content/grindr-api/", ""));
	}
}

const missing: Array<{ key: string; files: string[] }> = [];
for (const [key, files] of found) {
	const spaceIdx = key.indexOf(" ");
	const method = key.slice(0, spaceIdx);
	const rawPath = key.slice(spaceIdx + 1);
	const cleanPath = rawPath.split("?")[0]!.replace(/[.,;]+$/, "");
	const cleanKey = `${method} ${cleanPath}`;
	if (!openapiOps.has(cleanKey)) {
		missing.push({ key: cleanKey, files });
	}
}

console.log(`Markdown endpoints found (incl. bullets): ${found.size}`);
console.log(`OpenAPI operations: ${openapiOps.size}`);
console.log(`Missing from openapi: ${missing.length}\n`);

for (const m of missing) {
	console.log(`  ${m.key}  [${m.files.join(", ")}]`);
}
