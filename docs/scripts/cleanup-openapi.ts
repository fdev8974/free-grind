import { readFileSync, writeFileSync } from "fs";

const path = "lib/openapi.json";
const doc: unknown = JSON.parse(readFileSync(path, "utf8"));

function stripEmptyDescriptions(node: unknown): void {
	if (Array.isArray(node)) {
		node.forEach(stripEmptyDescriptions);
		return;
	}
	if (node && typeof node === "object") {
		const obj = node as Record<string, unknown>;
		if (obj["description"] === "") delete obj["description"];
		for (const v of Object.values(obj)) stripEmptyDescriptions(v);
	}
}

stripEmptyDescriptions(doc);
writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
console.log("Done.");
