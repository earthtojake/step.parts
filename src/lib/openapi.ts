import { getCatalogMetadata } from "@/lib/catalog-metadata";
import { DEFAULT_PART_PAGE_SIZE, MAX_PART_PAGE_SIZE } from "@/lib/part-query";
import { absoluteUrl, apiConfig, apiUrl, siteConfig } from "@/lib/site";
import type { CatalogInfo } from "@/types/part-query";

const partIdExample = "din913_set_screw_m3x3";

const partParameters = [
  {
    name: "q",
    in: "query",
    schema: { type: "string" },
    description:
      "Tokenized metadata search across id, name, description, category, family, stepSource, productPage, tags, aliases, standard fields, attribute keys, and attribute values. Every token must match.",
    examples: {
      alias: { value: "SHCS" },
      attribute: { value: "lengthMm 12" },
    },
  },
  {
    name: "tag",
    in: "query",
    schema: { type: "array", items: { type: "string" } },
    style: "form",
    explode: true,
    description:
      "Repeatable supplemental tag filter for reusable type, function, material, interface, or feature labels. Values within tag are ORed; selected tag, category, family, and standard fields are ANDed together. Use category, family, and standard filters for those dedicated fields.",
  },
  {
    name: "category",
    in: "query",
    schema: { type: "array", items: { type: "string" } },
    style: "form",
    explode: true,
    description:
      "Repeatable category filter. Values within category are ORed; selected tag, category, family, and standard fields are ANDed together.",
  },
  {
    name: "family",
    in: "query",
    schema: { type: "array", items: { type: "string" } },
    style: "form",
    explode: true,
    description:
      "Repeatable family filter. Values within family are ORed; selected tag, category, family, and standard fields are ANDed together.",
  },
  {
    name: "standard",
    in: "query",
    schema: { type: "array", items: { type: "string" } },
    style: "form",
    explode: true,
    description:
      "Repeatable standard designation filter, for example ISO 4762. Values within standard are ORed; selected tag, category, family, and standard fields are ANDed together.",
  },
  {
    name: "page",
    in: "query",
    schema: { type: "integer", minimum: 1, default: 1 },
    description: "1-based page number.",
  },
  {
    name: "pageSize",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: MAX_PART_PAGE_SIZE, default: DEFAULT_PART_PAGE_SIZE },
    description: `Result page size. Defaults to ${DEFAULT_PART_PAGE_SIZE} and is capped at ${MAX_PART_PAGE_SIZE}.`,
  },
];

function listOperation(pathPrefix: string, catalogMetadata: CatalogInfo) {
  return {
    operationId: `${pathPrefix}ListParts`,
    summary: "Search, filter, facet, and paginate STEP parts",
    parameters: partParameters,
    responses: {
      "200": {
        description: "Paginated part results with facets and active filters.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/PartQueryResponse" },
            examples: {
              search: {
                value: {
                  catalog: catalogMetadata,
                  items: [],
                  page: 1,
                  pageSize: DEFAULT_PART_PAGE_SIZE,
                  total: 0,
                  totalPages: 0,
                  hasNextPage: false,
                  hasPreviousPage: false,
                  facets: { tags: [], categories: [], families: [], standards: [] },
                  filters: { q: "SHCS", tags: [], categories: [], families: [], standards: [] },
                },
              },
            },
          },
        },
      },
    },
  };
}

function detailOperation(pathPrefix: string) {
  return {
    operationId: `${pathPrefix}GetPart`,
    summary: "Get one STEP part by id",
    parameters: [
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", pattern: "^[a-z0-9_]+$" },
        example: partIdExample,
      },
    ],
    responses: {
      "200": {
        description: "One enriched part record with absolute URLs.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/AgentPart" },
          },
        },
      },
      "404": {
        description: "Part not found.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
    },
  };
}

function downloadOperation(pathPrefix: string) {
  return {
    operationId: `${pathPrefix}DownloadPart`,
    summary: "Download one canonical STEP file and increment its download count",
    description:
      "Local/dev deployments return the STEP bytes directly. Production deployments increment the internal download count and redirect to the commit-pinned GitHub LFS media URL for the canonical STEP file.",
    parameters: [
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", pattern: "^[a-z0-9_]+$" },
        example: partIdExample,
      },
    ],
    responses: {
      "200": {
        description: "Canonical STEP file, returned directly by local/dev deployments.",
        headers: {
          "Content-Disposition": {
            schema: { type: "string" },
            description: "Attachment filename for the STEP file.",
          },
        },
        content: {
          "model/step": {
            schema: { type: "string", format: "binary" },
          },
        },
      },
      "302": {
        description: "Production redirect to the GitHub LFS media URL for the canonical STEP file.",
        headers: {
          Location: {
            schema: { type: "string", format: "uri" },
            description: "Commit-pinned GitHub media URL for the STEP file.",
          },
        },
      },
      "404": {
        description: "Part not found.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
    },
  };
}

export function buildOpenApiSpec() {
  const catalogMetadata = getCatalogMetadata();

  return {
    openapi: "3.1.0",
    info: {
      title: `${siteConfig.name} API`,
      version: "unreleased",
      description: "Machine API for searching, filtering, and downloading standard mechanical STEP parts.",
    },
    servers: [{ url: apiConfig.origin }],
    externalDocs: {
      description: "Agent guide",
      url: absoluteUrl("/llms.txt"),
    },
    paths: {
      "/v1/parts": {
        get: listOperation("parts", catalogMetadata),
      },
      "/v1/parts/{id}": {
        get: detailOperation("part"),
      },
      "/v1/parts/{id}/download": {
        get: downloadOperation("part"),
      },
      "/v1/catalog/schema": {
        get: {
          operationId: "getCatalogSchema",
          summary: "Get catalog JSON Schema and field semantics",
          responses: {
            "200": {
              description: "Catalog schema document.",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
      },
      "/v1/catalog/parts.index.json": {
        get: {
          operationId: "getPartsIndex",
          summary: "Get compact discovery index",
          responses: {
            "200": {
              description: "Compact id/name/facet index for cheap discovery before fetching details.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PartIndexResponse" },
                },
              },
            },
          },
        },
      },
      "/v1/openapi.json": {
        get: {
          operationId: "getOpenApiSpec",
          summary: "Get the OpenAPI 3.1 contract",
          responses: {
            "200": {
              description: "OpenAPI contract for the public step.parts API.",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        CatalogInfo: {
          type: "object",
          required: ["partCount", "lastModified", "sha256", "schemaUrl", "openApiUrl"],
          properties: {
            partCount: { type: "integer" },
            lastModified: { type: "string", format: "date-time" },
            sha256: { type: "string" },
            schemaUrl: { type: "string", format: "uri" },
            openApiUrl: { type: "string", format: "uri" },
          },
        },
        PartStandard: {
          type: "object",
          required: ["body", "number", "designation"],
          properties: {
            body: { type: "string" },
            number: { type: "string" },
            designation: { type: "string" },
          },
        },
        AgentPart: {
          type: "object",
          required: [
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
            "pageUrl",
            "apiUrl",
            "downloadUrl",
          ],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            category: { type: "string" },
            family: {
              type: "string",
              description:
                "Optional but strongly encouraged product/part family used for faceting and related-part grouping when a natural grouping exists; use brand/platform families for actuators and electronics.",
            },
            tags: {
              type: "array",
              items: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
              description:
                "Supplemental reusable type, function, material, interface, or feature labels. Category, family, standard, model/SKU, dimension, manufacturer, and provenance values belong in dedicated fields instead.",
            },
            aliases: { type: "array", items: { type: "string" } },
            standard: { $ref: "#/components/schemas/PartStandard" },
            stepSource: { type: "string", format: "uri" },
            productPage: { type: "string", format: "uri" },
            attributes: {
              type: "object",
              additionalProperties: { type: ["string", "number", "boolean", "null"] },
            },
            stepUrl: {
              type: "string",
              format: "uri-reference",
              description:
                "Canonical STEP asset URL. Local/dev resolves through /step/{id}.step; production uses a commit-pinned GitHub LFS media URL.",
            },
            glbUrl: {
              type: "string",
              format: "uri",
              description: "Public Vercel Blob URL for the GLB preview asset.",
            },
            pngUrl: {
              type: "string",
              format: "uri",
              description: "Public Vercel Blob URL for the PNG thumbnail asset.",
            },
            byteSize: { type: ["number", "null"] },
            sha256: { type: ["string", "null"] },
            pageUrl: { type: "string", format: "uri" },
            apiUrl: { type: "string", format: "uri" },
            downloadUrl: { type: "string", format: "uri" },
          },
        },
        FacetValue: {
          type: "object",
          required: ["value", "count"],
          properties: {
            value: { type: "string" },
            count: { type: "integer" },
          },
        },
        PartQueryResponse: {
          type: "object",
          required: [
            "catalog",
            "items",
            "page",
            "pageSize",
            "total",
            "totalPages",
            "hasNextPage",
            "hasPreviousPage",
            "facets",
            "filters",
          ],
          properties: {
            catalog: { $ref: "#/components/schemas/CatalogInfo" },
            items: { type: "array", items: { $ref: "#/components/schemas/AgentPart" } },
            page: { type: "integer" },
            pageSize: { type: "integer" },
            total: { type: "integer" },
            totalPages: { type: "integer" },
            hasNextPage: { type: "boolean" },
            hasPreviousPage: { type: "boolean" },
            facets: {
              type: "object",
              description:
                "Facet counts for filter UIs. When category filters are active, tags, families, and standards are scoped to the selected categories while category options remain global. Other facet filters do not scope facet options.",
              properties: {
                tags: { type: "array", items: { $ref: "#/components/schemas/FacetValue" } },
                categories: { type: "array", items: { $ref: "#/components/schemas/FacetValue" } },
                families: { type: "array", items: { $ref: "#/components/schemas/FacetValue" } },
                standards: { type: "array", items: { $ref: "#/components/schemas/FacetValue" } },
              },
            },
            filters: {
              type: "object",
              properties: {
                q: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
                categories: { type: "array", items: { type: "string" } },
                families: { type: "array", items: { type: "string" } },
                standards: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
        PartIndexResponse: {
          type: "object",
          required: ["catalog", "fields", "items"],
          properties: {
            catalog: { $ref: "#/components/schemas/CatalogInfo" },
            fields: { type: "array", items: { type: "string" } },
            items: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "id",
                  "name",
                  "category",
                  "standard",
                  "tags",
                  "aliases",
                  "pngUrl",
                  "pageUrl",
                  "apiUrl",
                  "downloadUrl",
                ],
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  category: { type: "string" },
                  family: { type: "string" },
                  standard: { type: ["string", "null"] },
                  tags: { type: "array", items: { type: "string" } },
                  aliases: { type: "array", items: { type: "string" } },
                  pngUrl: {
                    type: "string",
                    format: "uri",
                    description: "Public Vercel Blob URL for the PNG thumbnail asset.",
                  },
                  pageUrl: { type: "string", format: "uri" },
                  apiUrl: { type: "string", format: "uri" },
                  downloadUrl: { type: "string", format: "uri" },
                },
              },
            },
          },
        },
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
    "x-stepParts": {
      catalog: catalogMetadata,
      examples: [
        apiUrl("/v1/parts?q=M3&tag=screw&page=2"),
        apiUrl("/v1/parts?pageSize=100"),
        apiUrl("/v1/parts?category=fastener&family=socket-head-cap-screw&standard=ISO%204762"),
        apiUrl("/v1/parts?q=lengthMm%2012"),
      ],
    },
  };
}
