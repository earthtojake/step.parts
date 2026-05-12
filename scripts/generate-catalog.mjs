import { readAssetBuildKeys } from "./asset-build-metadata.mjs";
import {
  catalogRowFromPart,
  ensureAssetDirs,
  glbPathFor,
  hashFile,
  isGlbCurrent,
  isPngCurrent,
  materializePart,
  pngPathFor,
  readCatalogRowMap,
  readSourceParts,
  writeCatalogDatabase,
} from "./catalog-utils.mjs";

const sourceParts = await readSourceParts();
const buildKeys = await readAssetBuildKeys();
const existingRows = readCatalogRowMap();
const rows = [];
const omitted = [];

await ensureAssetDirs();

for (const [sourceOrder, sourcePart] of sourceParts.entries()) {
  const part = await materializePart(sourcePart);
  const existingRow = existingRows.get(part.id);
  const glbCurrent = await isGlbCurrent(existingRow, part, buildKeys.glb);
  const pngCurrent = glbCurrent && (await isPngCurrent(existingRow, part, buildKeys.png));

  if (!glbCurrent || !pngCurrent) {
    omitted.push(part.id);
    continue;
  }

  rows.push(
    catalogRowFromPart(part, {
      sourceOrder,
      glbBuildKey: buildKeys.glb,
      glb: await hashFile(glbPathFor(part)),
      pngBuildKey: buildKeys.png,
      png: await hashFile(pngPathFor(part)),
    }),
  );
}

if (omitted.length > 0) {
  throw new Error(
    `Cannot refresh SQLite metadata because ${omitted.length} part${omitted.length === 1 ? "" : "s"} lack current generated assets: ${omitted.join(", ")}`,
  );
}

await writeCatalogDatabase(rows);
console.log(`Generated SQLite catalog for ${rows.length} parts.`);
