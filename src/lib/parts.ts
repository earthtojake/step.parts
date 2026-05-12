import { readAllCatalogParts, readCatalogPart } from "@/lib/catalog-db";

export function getParts() {
  return readAllCatalogParts();
}

export function getPart(id: string) {
  return readCatalogPart(id);
}

export function getTagCounts() {
  const counts = new Map<string, number>();
  for (const part of getParts()) {
    for (const tag of part.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function formatBytes(bytes: number | null) {
  if (bytes === null) {
    return "pending";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(1)} KiB`;
  }

  return `${(kib / 1024).toFixed(2)} MiB`;
}
