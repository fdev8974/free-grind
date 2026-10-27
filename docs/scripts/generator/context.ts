import { readFileSync } from "fs";

import type { OpenApiDoc, Operation, ParameterGroup } from "./types";
import { HTTP_METHODS } from "./types";

export const SKIP_TAGS = new Set<string>(["websocket"]);
export const SHARED_PAGE = "shared-types";

export interface Op {
	path: string;
	method: string;
	op: Operation;
}

export interface Context {
	doc: OpenApiDoc;
	operationsByTag: Map<string, Op[]>;
	schemasByPage: Map<string, string[]>;
	renderedSchemas: Set<string>;
	paramGroups: Map<string, ParameterGroup>;
	paramGroupsByPage: Map<string, string[]>;
	pageForSchema(name: string): string;
}

function isRefNode(node: unknown): node is { $ref: string } {
	return (
		typeof node === "object" &&
		node !== null &&
		typeof (node as { $ref?: unknown }).$ref === "string"
	);
}

function collectRefs(doc: OpenApiDoc, node: unknown, out: Set<string>): void {
	if (Array.isArray(node)) {
		for (const n of node) collectRefs(doc, n, out);
		return;
	}
	if (node && typeof node === "object") {
		if (isRefNode(node)) {
			if (node.$ref.startsWith("#/components/schemas/")) {
				out.add(node.$ref.replace("#/components/schemas/", ""));
			} else if (node.$ref.startsWith("#/components/parameters/")) {
				const name = node.$ref.replace("#/components/parameters/", "");
				const resolved = doc.components.parameters?.[name];
				if (resolved) collectRefs(doc, resolved, out);
			}
		}
		for (const v of Object.values(node)) collectRefs(doc, v, out);
	}
}

function buildSchemaUsage(doc: OpenApiDoc): Map<string, string[]> {
	const usage = new Map<string, string[]>();
	for (const item of Object.values(doc.paths)) {
		for (const m of HTTP_METHODS) {
			const op = item[m];
			if (!op) continue;
			const refs = new Set<string>();
			collectRefs(doc, op, refs);
			const queue = [...refs];
			while (queue.length) {
				const name = queue.shift();
				if (name === undefined) break;
				const schema = doc.components.schemas[name];
				if (!schema) continue;
				const more = new Set<string>();
				collectRefs(doc, schema, more);
				for (const r of more) {
					if (!refs.has(r)) {
						refs.add(r);
						queue.push(r);
					}
				}
			}
			for (const ref of refs) {
				const list = usage.get(ref) ?? [];
				for (const t of op.tags ?? []) list.push(t);
				usage.set(ref, list);
			}
		}
	}
	return usage;
}

function countRefOccurrences(doc: OpenApiDoc): Map<string, number> {
	const counts = new Map<string, number>();
	function walk(node: unknown): void {
		if (Array.isArray(node)) {
			for (const n of node) walk(n);
			return;
		}
		if (node && typeof node === "object") {
			if (isRefNode(node) && node.$ref.startsWith("#/components/schemas/")) {
				const name = node.$ref.replace("#/components/schemas/", "");
				counts.set(name, (counts.get(name) ?? 0) + 1);
			}
			for (const v of Object.values(node)) walk(v);
		}
	}
	walk(doc);
	return counts;
}

function sectionOf(tagName: string): string {
	const slash = tagName.indexOf("/");
	return slash >= 0 ? tagName.slice(0, slash) : "";
}

function buildPageForSchema(doc: OpenApiDoc, usage: Map<string, string[]>) {
	return (name: string): string => {
		const override = doc.components.schemas[name]?.["x-render-on-tag"];
		if (override) return override;
		const votes = (usage.get(name) ?? []).filter((t) => !SKIP_TAGS.has(t));
		if (votes.length === 0) return SHARED_PAGE;
		const unique = new Set(votes);
		if (unique.size === 1) {
			const only = [...unique][0];
			return only ?? SHARED_PAGE;
		}
		const sections = new Set<string>();
		for (const t of unique) {
			const s = sectionOf(t);
			if (!s) return SHARED_PAGE;
			sections.add(s);
		}
		if (sections.size === 1) {
			const only = [...sections][0];
			return only ? `${only}/${SHARED_PAGE}` : SHARED_PAGE;
		}
		return SHARED_PAGE;
	};
}

function isReusableSchema(
	doc: OpenApiDoc,
	name: string,
	refOccurrences: Map<string, number>,
): boolean {
	const schema = doc.components.schemas[name];
	if (!schema) return false;
	if (schema["x-render-on-tag"]) return true;
	if (schema["x-enum-labels"]) return true;
	const hasBody = !!(schema.properties || schema.allOf || schema.oneOf);
	if (!hasBody) return false;
	if (schema.description) return true;
	return (refOccurrences.get(name) ?? 0) >= 2;
}

export function loadContext(openapiPath: string): Context {
	const doc = JSON.parse(readFileSync(openapiPath, "utf8")) as OpenApiDoc;
	const operationsByTag = new Map<string, Op[]>();
	for (const [path, item] of Object.entries(doc.paths)) {
		for (const m of HTTP_METHODS) {
			const op = item[m];
			if (!op) continue;
			for (const t of op.tags ?? []) {
				const list = operationsByTag.get(t) ?? [];
				list.push({ path, method: m, op });
				operationsByTag.set(t, list);
			}
		}
	}
	const usage = buildSchemaUsage(doc);
	const refOccurrences = countRefOccurrences(doc);
	const pageForSchema = buildPageForSchema(doc, usage);
	const schemasByPage = new Map<string, string[]>();
	for (const name of Object.keys(doc.components.schemas)) {
		if (!isReusableSchema(doc, name, refOccurrences)) continue;
		const page = pageForSchema(name);
		const list = schemasByPage.get(page) ?? [];
		list.push(name);
		schemasByPage.set(page, list);
	}
	const renderedSchemas = new Set<string>();
	for (const names of schemasByPage.values())
		for (const n of names) renderedSchemas.add(n);
	const paramGroups = new Map<string, ParameterGroup>();
	const paramGroupsByPage = new Map<string, string[]>();
	for (const [name, group] of Object.entries(doc["x-parameter-groups"] ?? {})) {
		paramGroups.set(name, group);
		const page = group["x-render-on-tag"];
		const list = paramGroupsByPage.get(page) ?? [];
		list.push(name);
		paramGroupsByPage.set(page, list);
	}
	return {
		doc,
		operationsByTag,
		schemasByPage,
		renderedSchemas,
		paramGroups,
		paramGroupsByPage,
		pageForSchema,
	};
}
