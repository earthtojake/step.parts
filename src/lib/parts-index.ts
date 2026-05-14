import { partPagePath } from "@/lib/agent-parts";
import { getCatalogMetadata } from "@/lib/catalog-metadata";
import { getParts } from "@/lib/parts";
import { absoluteUrl, apiUrl } from "@/lib/site";
import type { Part } from "@/types/part";

function compactPart(part: Part) {
  return {
    id: part.id,
    name: part.name,
    category: part.category,
    family: part.family,
    standard: part.standard?.designation ?? null,
    tags: part.tags,
    aliases: part.aliases,
    pngUrl: absoluteUrl(part.pngUrl),
    pageUrl: absoluteUrl(partPagePath(part)),
    apiUrl: apiUrl(`/v1/parts/${part.id}`),
    downloadUrl: apiUrl(`/v1/parts/${part.id}/download`),
  };
}

export function buildPartsIndex() {
  const parts = getParts();

  return {
    catalog: getCatalogMetadata(),
    fields: [
      "id",
      "name",
      "category",
      "family",
      "standard",
      "tags",
      "aliases",
      "pngUrl",
      "pageUrl",
      "apiUrl",
      "downloadUrl",
    ],
    items: parts.map(compactPart),
  };
}
