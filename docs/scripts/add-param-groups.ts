import { readFileSync, writeFileSync } from "fs";

interface Schema {
	type?: string;
	format?: string;
	$ref?: string;
}

interface InlineParam {
	name: string;
	in: string;
	required?: boolean;
	schema?: Schema;
}

interface RefParam {
	$ref: string;
}

type AnyParam = InlineParam | RefParam;

interface Operation {
	parameters?: AnyParam[];
	[key: string]: unknown;
}

interface Doc {
	paths: Record<string, Record<string, Operation>>;
	components: {
		parameters?: Record<string, InlineParam>;
		schemas?: Record<string, Schema>;
	};
	[key: string]: unknown;
}

const filePath = "docs/lib/openapi.json";
const doc = JSON.parse(readFileSync(filePath, "utf8")) as Doc;

const floatParams = [
	"CascadeHeightCmMinQuery",
	"CascadeHeightCmMaxQuery",
	"CascadeWeightGramsMinQuery",
	"CascadeWeightGramsMaxQuery",
];
for (const name of floatParams) {
	const p = doc.components.parameters?.[name];
	if (p?.schema) p.schema.format = "float";
}

const nearbyParam = doc.components.parameters?.["NearbyGeoHashQuery"];
if (nearbyParam) nearbyParam.required = true;

const searchGet = doc.paths["/v7/search"]?.["get"];
if (searchGet?.parameters) {
	const floatNames = new Set([
		"heightMinimum",
		"heightMaximum",
		"weightMinimum",
		"weightMaximum",
	]);
	for (const p of searchGet.parameters) {
		if ("name" in p && floatNames.has(p.name) && p.schema) {
			p.schema.format = "float";
		}
	}
}

for (const cascadePath of ["/v4/cascade", "/v3/cascade"]) {
	const get = doc.paths[cascadePath]?.["get"];
	if (get?.parameters) {
		get.parameters = get.parameters.map((p) => {
			if ("name" in p && p.name === "nearbyGeoHash") {
				return { $ref: "#/components/parameters/NearbyGeoHashQuery" };
			}
			return p;
		});
	}
}

const xParameterGroups = {
	GridQuery: {
		"x-render-on-tag": "browse/grid",
		parameters: [
			{ $ref: "#/components/parameters/NearbyGeoHashQuery" },
			{ $ref: "#/components/parameters/ExploreGeoHashQuery" },
			{ $ref: "#/components/parameters/GridPhotoOnlyQuery" },
			{ $ref: "#/components/parameters/GridFaceOnlyQuery" },
			{ $ref: "#/components/parameters/GridNotRecentlyChattedQuery" },
			{ $ref: "#/components/parameters/GridHasAlbumQuery" },
			{ $ref: "#/components/parameters/GridFreshQuery" },
			{ $ref: "#/components/parameters/GridGendersQuery" },
			{ $ref: "#/components/parameters/GridPageNumberQuery" },
		],
	},
	CascadeQuery: {
		"x-render-on-tag": "browse/grid",
		"x-inherits": "GridQuery",
		parameters: [
			{ $ref: "#/components/parameters/CascadeOnlineOnlyQuery" },
			{ $ref: "#/components/parameters/CascadeAgeMinQuery" },
			{ $ref: "#/components/parameters/CascadeAgeMaxQuery" },
			{ $ref: "#/components/parameters/CascadeHeightCmMinQuery" },
			{ $ref: "#/components/parameters/CascadeHeightCmMaxQuery" },
			{ $ref: "#/components/parameters/CascadeWeightGramsMinQuery" },
			{ $ref: "#/components/parameters/CascadeWeightGramsMaxQuery" },
			{ $ref: "#/components/parameters/CascadeTribesQuery" },
			{ $ref: "#/components/parameters/CascadeLookingForQuery" },
			{ $ref: "#/components/parameters/CascadeRelationshipStatusesQuery" },
			{ $ref: "#/components/parameters/CascadeBodyTypesQuery" },
			{ $ref: "#/components/parameters/CascadeSexualPositionsQuery" },
			{ $ref: "#/components/parameters/CascadeMeetAtQuery" },
			{ $ref: "#/components/parameters/CascadeNsfwPicsQuery" },
			{ $ref: "#/components/parameters/CascadeTagsQuery" },
			{ $ref: "#/components/parameters/CascadeRightNowQuery" },
			{ $ref: "#/components/parameters/CascadeFavoritesQuery" },
			{ $ref: "#/components/parameters/CascadeShowSponsoredProfilesQuery" },
			{ $ref: "#/components/parameters/CascadeShuffleQuery" },
			{ $ref: "#/components/parameters/CascadeHotQuery" },
		],
	},
};

doc["x-parameter-groups"] = xParameterGroups;

const cascadeV4Get = doc.paths["/v4/cascade"]?.["get"];
if (cascadeV4Get) cascadeV4Get["x-query-groups"] = ["CascadeQuery"];

const cascadeV3Get = doc.paths["/v3/cascade"]?.["get"];
if (cascadeV3Get) cascadeV3Get["x-query-groups"] = ["CascadeQuery"];

const searchV7Get = doc.paths["/v7/search"]?.["get"];
if (searchV7Get) searchV7Get["x-query-groups"] = ["GridQuery"];

writeFileSync(filePath, JSON.stringify(doc, null, "\t") + "\n");
console.log("Done.");
