import {
  catalogRowFromPart,
  ensureAssetDirs,
  materializePart,
  readSourceParts,
  writeCatalogDatabase,
} from "./catalog-utils.mjs";

const sourceParts = await readSourceParts();
const rows = [];

await ensureAssetDirs();

for (const [sourceOrder, sourcePart] of sourceParts.entries()) {
  const part = await materializePart(sourcePart);
  rows.push(catalogRowFromPart(part, { sourceOrder }));
}

await writeCatalogDatabase(rows);
console.log(`Generated SQLite catalog for ${rows.length} parts.`);
