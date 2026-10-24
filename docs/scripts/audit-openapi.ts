import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

import type { HttpMethod, OpenApiDoc } from "./generator/types";
import { HTTP_METHODS } from "./generator/types";

const openapiPath = "lib/openapi.json";
const contentDir = "content/grindr-api";

type Endpoint = { method: HttpMethod; path: string; file: string };

function walkDir(dir: string): string[] {
	const results: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) results.push(...walkDir(full));
		else if (entry.endsWith(".md")) results.push(full);
	}
	return results;
}

function extractEndpoints(content: string, filePath: string): Endpoint[] {
	const endpoints: Endpoint[] = [];
	const blockRe = /^```\n([\s\S]*?)^```/gm;
	let m;
	while ((m = blockRe.exec(content)) !== null) {
		const inner = (m[1] ?? "").trim();
		const methodMatch = inner.match(
			/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[^\s]*)/,
		);
		if (methodMatch) {
			endpoints.push({
				method: (methodMatch[1] ?? "").toLowerCase() as HttpMethod,
				path: methodMatch[2] ?? "",
				file: filePath,
			});
		}
	}
	return endpoints;
}

const openapi = JSON.parse(readFileSync(openapiPath, "utf8")) as OpenApiDoc;
const openapiPaths = openapi.paths;

const mdFiles = walkDir(contentDir);
const allMdEndpoints: Endpoint[] = [];
for (const f of mdFiles) {
	const content = readFileSync(f, "utf8");
	allMdEndpoints.push(...extractEndpoints(content, f));
}

console.log(`\nMarkdown endpoints found: ${allMdEndpoints.length}`);
console.log(`OpenAPI paths: ${Object.keys(openapiPaths).length}\n`);

const missing: Endpoint[] = [];
const wrongMethod: Endpoint[] = [];
const found: Endpoint[] = [];

for (const ep of allMdEndpoints) {
	const pathItem = openapiPaths[ep.path];
	if (!pathItem) {
		missing.push(ep);
	} else if (!pathItem[ep.method]) {
		wrongMethod.push(ep);
	} else {
		found.push(ep);
	}
}

if (missing.length) {
	console.log("═══ MISSING PATHS (in markdown, not in openapi.json) ═══");
	for (const ep of missing) {
		console.log(
			`  ${ep.method.toUpperCase()} ${ep.path}  [${ep.file.replace("content/grindr-api/", "")}]`,
		);
	}
}

if (wrongMethod.length) {
	console.log("\n═══ WRONG METHOD (path exists but method missing) ═══");
	for (const ep of wrongMethod) {
		const existing = Object.keys(openapiPaths[ep.path]!)
			.filter((k) => !k.startsWith("$"))
			.join(", ");
		console.log(
			`  ${ep.method.toUpperCase()} ${ep.path}  (has: ${existing})  [${ep.file.replace("content/grindr-api/", "")}]`,
		);
	}
}

console.log(
	`\n✓ Matched: ${found.length}  ✗ Missing paths: ${missing.length}  ✗ Wrong method: ${wrongMethod.length}`,
);

const mdPaths = new Set(allMdEndpoints.map((e) => `${e.method}:${e.path}`));
const unmentioned: string[] = [];
for (const [path, item] of Object.entries(openapiPaths)) {
	for (const method of HTTP_METHODS) {
		if (item[method] && !mdPaths.has(`${method}:${path}`)) {
			unmentioned.push(`${method.toUpperCase()} ${path}`);
		}
	}
}
if (unmentioned.length) {
	console.log(
		`\n═══ OPENAPI PATHS NOT IN ANY MARKDOWN (${unmentioned.length}) ═══`,
	);
	for (const u of unmentioned) console.log(`  ${u}`);
}
