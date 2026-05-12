import { createHash } from "node:crypto";
import { apiHeaders } from "@/lib/api-response";
import { getCatalogFileInfo, getCatalogSnapshot } from "@/lib/catalog-db";
import { apiUrl } from "@/lib/site";
import type { CatalogInfo } from "@/types/part-query";

export function getCatalogMetadata(): CatalogInfo {
  const { fileInfo, parts } = getCatalogSnapshot();

  return {
    partCount: parts.length,
    lastModified: fileInfo.stats.mtime.toISOString(),
    sha256: fileInfo.sha256,
    schemaUrl: apiUrl("/v1/catalog/schema"),
    openApiUrl: apiUrl("/v1/openapi.json"),
  };
}

function representationTag(key: string, catalogSha256: string) {
  const digest = createHash("sha256")
    .update(catalogSha256)
    .update(":")
    .update(key)
    .digest("hex")
    .slice(0, 24);

  return `W/"step-parts-${digest}"`;
}

export function freshnessHeaders(key: string, contentType?: string): HeadersInit {
  const fileInfo = getCatalogFileInfo();

  return apiHeaders({
    ...(contentType ? { "Content-Type": contentType } : {}),
    "Cache-Control": "public, max-age=0, must-revalidate",
    ETag: representationTag(key, fileInfo.sha256),
    "Last-Modified": fileInfo.stats.mtime.toUTCString(),
  });
}

export function jsonWithFreshness(data: unknown, key: string, init: ResponseInit = {}) {
  const headers = new Headers(freshnessHeaders(key));

  if (init.headers) {
    for (const [header, value] of new Headers(init.headers)) {
      headers.set(header, value);
    }
  }

  return Response.json(data, {
    ...init,
    headers,
  });
}
