import { getCatalogMetadata } from "@/lib/catalog-metadata";
import { DEFAULT_PART_PAGE_SIZE, MAX_PART_PAGE_SIZE } from "@/lib/part-query";
import { getParts } from "@/lib/parts";
import { apiUrl } from "@/lib/site";
import type { Part } from "@/types/part";

type JsonScalarType = "string" | "number" | "boolean" | "null";

type AttributeDefinition = {
  types: JsonScalarType[];
  description: string;
  units?: string;
  examples: string[];
};

const FIELD_DEFINITIONS = {
  id: "Stable snake_case ASCII identifier. Use this for URLs, API lookups, and asset filename derivation.",
  name: "Human-readable display name.",
  description: "Short source-authored summary. Useful for search snippets, not a substitute for individual fields.",
  category: "Broad open-string aisle, such as fastener, bearing, stock, profile, spacer, pin, or motion.",
  family:
    "Optional but strongly encouraged kebab-case product/part family used for faceting and related-part grouping when a natural grouping exists. Use commodity families such as socket-head-cap-screw, set-screw, deep-groove-ball-bearing, or t-slot-extrusion; for actuators/electronics use product/platform families such as damiao, feetech, robstride, cubemars, raspberry-pi, arduino, adafruit, or sparkfun. Keep supplemental type, function, material, interface, and feature labels in tags.",
  tags:
    "Supplemental lowercase kebab-case discovery labels for reusable type, function, material, interface, or feature concepts. Do not duplicate category, family, standard, aliases, model/SKU values, dimensions, manufacturer names, or provenance.",
  aliases: "Alternate lookup strings, abbreviations, and compact names agents may encounter.",
  standard: "Optional standards body, number, and joined designation.",
  stepSource: "Optional direct URL to a live STEP/STP source file.",
  productPage: "Optional URL to the product page for the STEP file.",
  attributes: "Part-specific scalar facts. Keys are searchable through q and documented by family when available.",
  stepUrl:
    "URL for the canonical STEP asset in API records. Local/dev records resolve through /step/{id}.step backed by catalog/step; production records use commit-pinned GitHub LFS media URLs.",
  glbUrl: "Absolute URL for the GLB preview asset in API records.",
  pngUrl: "Absolute URL for the PNG thumbnail asset in API records.",
  byteSize: "STEP file size in bytes.",
  sha256: "STEP file SHA-256 checksum.",
  pageUrl: "Absolute canonical HTML part page URL, present in API records.",
  apiUrl: "Absolute single-part API URL, present in API records.",
  downloadUrl: "Absolute counted STEP download API URL, present in API records.",
} as const;

const ATTRIBUTE_DESCRIPTIONS: Record<string, { description: string; units?: string }> = {
  bearingCode: {
    description: "Bearing designation printed as the catalog lookup code.",
  },
  bore1Mm: {
    description: "Nominal first bore diameter.",
    units: "mm",
  },
  bore2Mm: {
    description: "Nominal second bore diameter.",
    units: "mm",
  },
  diameterMm: {
    description: "Nominal round diameter.",
    units: "mm",
  },
  driveStyle: {
    description: "Drive interface style such as hex-socket or external-hex.",
  },
  flexible: {
    description: "Whether the part is represented as a flexible coupling.",
  },
  flanged: {
    description: "Whether the bearing record is flanged.",
  },
  gender: {
    description: "Connector/standoff gender such as male-female.",
  },
  headStyle: {
    description: "Fastener head style such as socket-head, countersunk, button-head, or hex-head.",
  },
  heightMm: {
    description: "Nominal profile, tube, or bar height.",
    units: "mm",
  },
  lengthMm: {
    description: "Nominal part length for screws, pins, standoffs, and similar records.",
    units: "mm",
  },
  locking: {
    description: "Whether the fastener has a locking feature.",
  },
  material: {
    description: "Catalog material label when present.",
  },
  nominalSize: {
    description: "Human-readable nominal size string from the source catalog entry.",
  },
  nutStyle: {
    description: "Nut style label such as hex or nyloc.",
  },
  profileSeries: {
    description: "Profile family/series label, such as extrusion series or beam series.",
  },
  profileType: {
    description: "Extrusion profile type label when present.",
  },
  ringStyle: {
    description: "Retaining ring style label.",
  },
  sealType: {
    description: "Bearing seal or shield designation.",
  },
  setScrewThread: {
    description: "Thread designation used by the set screw in coupling-style records.",
  },
  shape: {
    description: "Cross-section or body shape label.",
  },
  shielded: {
    description: "Whether the bearing record is shielded.",
  },
  slotSizeMm: {
    description: "Nominal T-slot opening size.",
    units: "mm",
  },
  standardClass: {
    description: "Standard class or variant label when the standard defines one.",
  },
  thicknessMm: {
    description: "Nominal flat stock or washer thickness.",
    units: "mm",
  },
  thread: {
    description: "Metric thread designation such as M3 or M6.",
  },
  variant: {
    description: "Catalog variant label when a family has named variants.",
  },
  wallThicknessMm: {
    description: "Nominal tube wall thickness.",
    units: "mm",
  },
  washerStyle: {
    description: "Washer style label such as flat, spring, large, or tab.",
  },
  widthMm: {
    description: "Nominal profile, tube, or bar width.",
    units: "mm",
  },
};

function scalarType(value: string | number | boolean | null): JsonScalarType {
  if (value === null) {
    return "null";
  }

  if (typeof value === "number") {
    return "number";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  return "string";
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function attributeDefinition(key: string, values: Array<string | number | boolean | null>): AttributeDefinition {
  const description = ATTRIBUTE_DESCRIPTIONS[key] ?? {
    description: "Family-specific scalar attribute.",
  };
  const examples = uniqueSorted(values.map(String)).slice(0, 6);

  return {
    types: uniqueSorted(values.map(scalarType)) as JsonScalarType[],
    description: description.description,
    ...(description.units ? { units: description.units } : {}),
    examples,
  };
}

function familyDescription(family: string) {
  return family
    .split("-")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function standardDesignation(part: Part) {
  return part.standard?.designation ?? null;
}

function buildFamilyAttributeDefinitions(parts: Part[]) {
  return uniqueSorted(parts.flatMap((part) => (part.family ? [part.family] : []))).map((family) => {
    const familyParts = parts.filter((part) => part.family === family);
    const attributeKeys = uniqueSorted(familyParts.flatMap((part) => Object.keys(part.attributes)));

    return {
      family,
      label: familyDescription(family),
      category: familyParts[0]?.category ?? "",
      partCount: familyParts.length,
      standardDesignations: uniqueSorted(
        familyParts.flatMap((part) => (standardDesignation(part) ? [standardDesignation(part) as string] : [])),
      ),
      attributes: Object.fromEntries(
        attributeKeys.map((key) => [
          key,
          attributeDefinition(
            key,
            familyParts.flatMap((part) =>
              Object.prototype.hasOwnProperty.call(part.attributes, key) ? [part.attributes[key]] : [],
            ),
          ),
        ]),
      ),
    };
  });
}

function buildCategoryDefinitions(parts: Part[]) {
  return uniqueSorted(parts.map((part) => part.category)).map((category) => ({
    category,
    partCount: parts.filter((part) => part.category === category).length,
    families: uniqueSorted(parts.filter((part) => part.category === category).flatMap((part) => (part.family ? [part.family] : []))),
  }));
}

export function buildCatalogSchema() {
  const parts = getParts();
  const partRequired = [
    "id",
    "name",
    "description",
    "category",
    "tags",
    "aliases",
    "attributes",
    "stepUrl",
    "glbUrl",
    "pngUrl",
    "byteSize",
    "sha256",
  ];
  const partProperties = {
    id: { type: "string", pattern: "^[a-z0-9_]+$" },
    name: { type: "string" },
    description: { type: "string" },
    category: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
    family: {
      type: "string",
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
      description:
        "Optional but strongly encouraged product/part family used for faceting and related-part grouping when a natural grouping exists; use brand/platform families for actuators and electronics.",
    },
    tags: {
      type: "array",
      items: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
      minItems: 1,
      description:
        "Supplemental reusable type, function, material, interface, or feature labels. Category, family, standard, model/SKU, dimension, manufacturer, and provenance values belong in their dedicated fields instead.",
    },
    aliases: { type: "array", items: { type: "string" } },
    standard: { $ref: "#/$defs/PartStandard" },
    stepSource: { type: "string", format: "uri" },
    productPage: { type: "string", format: "uri" },
    attributes: { $ref: "#/$defs/PartAttributes" },
    stepUrl: { type: "string" },
    glbUrl: { type: "string" },
    pngUrl: { type: "string" },
    byteSize: { type: ["number", "null"] },
    sha256: { type: ["string", "null"] },
  };

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: apiUrl("/v1/catalog/schema"),
    title: "STEP Parts Catalog Schema",
    description: "Machine-readable schema, field semantics, query contract, and family attribute definitions for step.parts.",
    type: "array",
    items: {
      $ref: "#/$defs/Part",
    },
    $defs: {
      PartStandard: {
        type: "object",
        required: ["body", "number", "designation"],
        additionalProperties: false,
        properties: {
          body: { type: "string" },
          number: { type: "string" },
          designation: { type: "string" },
        },
      },
      PartAttributes: {
        type: "object",
        additionalProperties: {
          type: ["string", "number", "boolean", "null"],
        },
      },
      Part: {
        type: "object",
        required: partRequired,
        additionalProperties: false,
        properties: partProperties,
      },
      AgentPart: {
        type: "object",
        required: [...partRequired, "pageUrl", "apiUrl", "downloadUrl"],
        additionalProperties: false,
        properties: {
          ...partProperties,
          pageUrl: { type: "string", format: "uri" },
          apiUrl: { type: "string", format: "uri" },
          downloadUrl: { type: "string", format: "uri" },
          stepUrl: {
            type: "string",
            format: "uri-reference",
            description:
              "Canonical STEP asset URL. Local/dev resolves through /step/{id}.step; production uses a commit-pinned GitHub LFS media URL.",
          },
          glbUrl: { type: "string", format: "uri" },
          pngUrl: { type: "string", format: "uri" },
        },
      },
    },
    "x-stepParts": {
      catalog: getCatalogMetadata(),
      fieldDefinitions: FIELD_DEFINITIONS,
      queryParameters: {
        q: "Tokenized metadata search. Every token must match id, name, description, category, family, stepSource, productPage, tags, aliases, standard fields, attribute keys, or attribute values.",
        tag: "Repeatable supplemental tag filter. Values within tag are ORed; selected tag, category, family, and standard fields are ANDed together. Use category, family, and standard filters for those dedicated fields.",
        category:
          "Repeatable. Values within category are ORed; selected tag, category, family, and standard fields are ANDed together.",
        family: "Repeatable. Values within family are ORed; selected tag, category, family, and standard fields are ANDed together.",
        standard:
          "Repeatable. Values within standard are ORed; selected tag, category, family, and standard fields are ANDed together.",
        page: "1-based page number.",
        pageSize: `Defaults to ${DEFAULT_PART_PAGE_SIZE}; capped at ${MAX_PART_PAGE_SIZE}.`,
      },
      filterSemantics:
        "q tokens AND together; repeated values within each facet field OR together; selected tag/category/family/standard fields AND together.",
      facetSemantics:
        "Facet counts are global unless one or more categories are selected; then tag, family, and standard facets are scoped to the selected categories. Other facet filters do not scope facet counts.",
      ordering:
        "API results are ordered by deduplicated internal download popularity, then stable source catalog order. Download counts are not exposed in API responses.",
      categories: buildCategoryDefinitions(parts),
      families: buildFamilyAttributeDefinitions(parts),
    },
  };
}
