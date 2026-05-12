import { apiHeaders } from "@/lib/api-response";
import { getCatalogMetadata } from "@/lib/catalog-metadata";
import { DEFAULT_PART_PAGE_SIZE, MAX_PART_PAGE_SIZE } from "@/lib/part-query";
import { getParts } from "@/lib/parts";
import { absoluteUrl, apiUrl, siteConfig } from "@/lib/site";

export function GET() {
  const exampleId = "din913_set_screw_m3x3";
  const catalogMetadata = getCatalogMetadata();
  const parts = getParts();
  const body = `# ${siteConfig.name}

${siteConfig.description}

## Preferred machine endpoints

- Paginated parts API: ${apiUrl("/v1/parts")}
- Single part API: ${apiUrl(`/v1/parts/${exampleId}`)}
- Counted STEP download API: ${apiUrl(`/v1/parts/${exampleId}/download`)}
- OpenAPI contract: ${apiUrl("/v1/openapi.json")}
- Catalog schema and field semantics: ${apiUrl("/v1/catalog/schema")}
- Compact discovery index: ${apiUrl("/v1/catalog/parts.index.json")}

## Catalog fields

API catalog records contain:

- id: stable snake_case ASCII identifier
- name: human-readable part name
- description: source-authored summary text
- category: broad open-string aisle, such as fastener, bearing, stock, profile, spacer, pin, or motion
- family: optional but strongly encouraged product/part family for faceting and related grouping when a natural grouping exists; use commodity families such as socket-head-cap-screw or t-slot-extrusion, and product/platform families such as damiao, feetech, raspberry-pi, or arduino for actuators/electronics
- tags: supplemental reusable type, function, material, interface, or feature labels; category, family, standard, model/SKU, dimension, manufacturer, alias, and provenance values live in dedicated fields
- aliases: alternate names and compact lookup strings
- standard: optional standard object with body, number, and designation
- stepSource: optional direct URL to a live STEP/STP source file
- productPage: optional product page URL for the STEP file
- attributes: part-specific scalar facts such as thread, lengthMm, bore1Mm, material, profileSeries, or slotSizeMm
- stepUrl: URL for the canonical STEP file; local/dev resolves through /step/{id}.step and production uses a commit-pinned GitHub LFS media URL
- glbUrl: absolute URL for the GLB preview
- pngUrl: absolute URL for the PNG thumbnail
- byteSize: STEP file size in bytes
- sha256: STEP file SHA-256 checksum

The paginated API returns matching records with absolute pageUrl, apiUrl, downloadUrl, glbUrl, and pngUrl values; stepUrl resolves locally in dev/test and to GitHub LFS media in production.

## Catalog freshness

- Catalog part count: ${catalogMetadata.partCount}
- Catalog last modified: ${catalogMetadata.lastModified}
- Catalog SHA-256: ${catalogMetadata.sha256}
- API and machine-readable catalog endpoints include ETag and Last-Modified headers.

## API query parameters

- q: metadata search across id, name, description, category, family, stepSource, productPage, tags, aliases, standard fields, attribute keys, and attribute values
- tag: repeated supplemental tag filter; values within tag are ORed
- category, family, standard: repeated filters for dedicated metadata fields; values within one field are ORed, and selected facet fields are ANDed together
- page: 1-based result page
- pageSize: result page size; defaults to ${DEFAULT_PART_PAGE_SIZE} and is capped at ${MAX_PART_PAGE_SIZE}

Results are ordered by deduplicated internal download popularity, then stable source catalog order. Download counts are not exposed in API responses.

Examples:

- ${apiUrl("/v1/parts?q=M3&tag=screw&page=2")}
- ${apiUrl("/v1/parts?pageSize=100")}
- ${apiUrl("/v1/parts?category=fastener&family=socket-head-cap-screw&standard=ISO%204762")}
- ${apiUrl("/v1/parts?q=lengthMm%2012")}
- ${apiUrl(`/v1/parts/${exampleId}`)}

## Common agent tasks

- Find ISO 4762 socket head cap screws: ${apiUrl("/v1/parts?category=fastener&family=socket-head-cap-screw&standard=ISO%204762")}
- Find M3 screw-like parts: ${apiUrl("/v1/parts?q=M3&tag=screw")}
- Resolve an alias such as SHCS: ${apiUrl("/v1/parts?q=SHCS")}
- Search attribute names and values: ${apiUrl("/v1/parts?q=lengthMm%2012")}
- Get a cheap id/name index before fetching details: ${apiUrl("/v1/catalog/parts.index.json")}
- Fetch one part and use its downloadUrl/stepUrl/glbUrl/pngUrl/pageUrl: ${apiUrl(`/v1/parts/${exampleId}`)}
- Discover field meanings and family-specific attributes: ${apiUrl("/v1/catalog/schema")}
- Generate tools from the API contract: ${apiUrl("/v1/openapi.json")}

## Asset URL patterns

- Part page: ${absoluteUrl("/parts/{id}")}
- Local/dev STEP file route: ${absoluteUrl("/step/{id}.step")}
- Production STEP files: commit-pinned GitHub LFS media URLs exposed as stepUrl
- Counted STEP download: ${apiUrl("/v1/parts/{id}/download")}
- GLB preview: ${absoluteUrl("/glb/{id}.glb")}
- PNG thumbnail: ${absoluteUrl("/png/{id}.png")}

## Usage notes

- Use /v1/parts when you need filtered results, pagination metadata, facet counts, or absolute URLs.
- Use /v1/openapi.json to generate API clients or agent tools.
- Use /v1/catalog/schema to understand field meanings, result ordering, and family-specific attribute meanings.
- Use /v1/catalog/parts.index.json for compact discovery before fetching one record or a paginated result page.
- Download through downloadUrl when you want the internal download count updated; production downloads redirect to GitHub LFS media, and downloaded STEP files can be verified with the sha256 field.
- Individual STEP, GLB, and PNG assets are discoverable from catalog records, not listed individually in the sitemap.

Current catalog size: ${parts.length} parts.
Example id: ${exampleId}
`;

  return new Response(body, {
    headers: apiHeaders({
      "Content-Type": "text/plain; charset=utf-8",
    }),
  });
}
