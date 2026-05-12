import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { readAssetBuildKeys } from "./asset-build-metadata.mjs";
import { checkStepMetadataForCatalogParts } from "./step-metadata.mjs";
import {
  CATALOG_DB_USER_VERSION,
  catalogRowFromCurrentAssets,
  exists,
  glbPathFor,
  looksLikeStep,
  materializePart,
  normalizeSourcePart,
  obsoleteAssetManifestPath,
  obsoleteCatalogNdjsonPath,
  obsoletePublicCatalogJsonPath,
  obsoletePublicCatalogSqlitePath,
  obsoleteSourceCatalogPath,
  pngPathFor,
  readCatalogRows,
  sqliteCatalogPath,
  sourceCatalogPath,
  stepPathFor,
  stepDir,
  taxonomyPath,
} from "./catalog-utils.mjs";

const SOURCE_PART_KEYS = new Set([
  "id",
  "name",
  "description",
  "category",
  "family",
  "tags",
  "aliases",
  "standard",
  "stepSource",
  "productPage",
  "attributes",
]);

const PROVENANCE_ATTRIBUTE_KEYS = new Set([
  "cadAsset",
  "cadSourceType",
  "downloadArchive",
  "downloadFile",
  "cadNote",
  "cadRepositoryPath",
  "cadModelVersion",
  "cadModelReleaseDate",
  "verificationLevel",
  "dateChecked",
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertKebabLabel(value, message) {
  assert(typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value), message);
}

function normalizeTagValue(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function compactTagValue(value) {
  return normalizeTagValue(value).replace(/-/g, "");
}

function standardTagValues(part) {
  if (!part.standard) {
    return [];
  }

  return [
    part.standard.designation,
    `${part.standard.body}${part.standard.number}`,
    `${part.standard.body}-${part.standard.number}`,
    `${part.standard.body} ${part.standard.number}`,
  ];
}

function reservedTagValues(part) {
  const values = [
    part.category,
    part.family,
    part.id,
    part.name,
    ...(part.aliases ?? []),
    ...standardTagValues(part),
    part.attributes.model,
    part.attributes.manufacturer,
    part.attributes.sku,
  ];

  return new Set(values.filter(Boolean).flatMap((value) => [normalizeTagValue(value), compactTagValue(value)]));
}

function assertTags(part) {
  assert(Array.isArray(part.tags) && part.tags.length > 0, `${part.id}: missing tags`);

  const seen = new Set();
  const reserved = reservedTagValues(part);
  const reservedMetadataTags = new Set(["official-step", "community-step"]);

  for (const tag of part.tags) {
    assertKebabLabel(tag, `${part.id}: bad tag ${tag}`);
    assert(!seen.has(tag), `${part.id}: duplicate tag ${tag}`);
    assert(!reservedMetadataTags.has(tag), `${part.id}: ${tag} belongs in dedicated metadata fields, not tags`);
    assert(!reserved.has(tag), `${part.id}: ${tag} duplicates another catalog field`);
    seen.add(tag);
  }
}

function assertStringArray(value, message) {
  assert(Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.trim()), message);
}

function assertAttributes(value, message) {
  assert(value && typeof value === "object" && !Array.isArray(value), message);
  for (const [key, entry] of Object.entries(value)) {
    assert(/^[a-z][a-zA-Z0-9]*$/.test(key), `${message}: bad key ${key}`);
    assert(!isSourceAttributeKey(key), `${message}: ${key} must be a first-class field or removed`);
    assert(
      entry === null || ["string", "number", "boolean"].includes(typeof entry),
      `${message}: ${key} must be string, number, boolean, or null`,
    );
  }
}

function assertOptionalStringArray(value, message) {
  assert(value === undefined || (Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.trim())), message);
}

function isSourceAttributeKey(key) {
  return key === "stepSource" || key === "productPage" || key.startsWith("source") || PROVENANCE_ATTRIBUTE_KEYS.has(key);
}

function isAbsoluteHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function assertOptionalUrl(value, message) {
  if (value === undefined) {
    return;
  }

  assert(typeof value === "string" && value.trim() === value && isAbsoluteHttpUrl(value), message);
}

function assertOptionalStepSource(value, message) {
  assertOptionalUrl(value, message);
  if (value === undefined) {
    return;
  }

  const pathname = new URL(value).pathname.toLowerCase();
  assert(pathname.endsWith(".step") || pathname.endsWith(".stp"), `${message}: must link directly to a STEP/STP file`);
}

async function readJsonArray(filePath) {
  const value = JSON.parse(await readFile(filePath, "utf8"));
  assert(Array.isArray(value), `${filePath} must contain a JSON array`);
  return value;
}

async function readJsonObject(filePath) {
  const value = JSON.parse(await readFile(filePath, "utf8"));
  assert(value && typeof value === "object" && !Array.isArray(value), `${filePath} must contain a JSON object`);
  return value;
}

async function readSourceParts() {
  const rawParts = await readJsonArray(sourceCatalogPath);
  for (const part of rawParts) {
    const unexpectedKeys = Object.keys(part).filter((key) => !SOURCE_PART_KEYS.has(key));
    assert(
      unexpectedKeys.length === 0,
      `${part.id ?? "<unknown>"}: source catalog has unsupported fields: ${unexpectedKeys.join(", ")}`,
    );
  }

  return rawParts.map(normalizeSourcePart);
}

async function readTaxonomy() {
  return readJsonObject(taxonomyPath);
}

function validatePart(part, ids) {
  assert(/^[a-z0-9_]+$/.test(part.id), `${part.id}: ID must be snake_case ASCII`);
  assert(!ids.has(part.id), `${part.id}: duplicate ID`);
  ids.add(part.id);
  assert(part.name, `${part.id}: missing name`);
  assert(typeof part.description === "string" && part.description.trim(), `${part.id}: missing description`);
  assertKebabLabel(part.category, `${part.id}: bad category`);
  if (part.family !== undefined) {
    assertKebabLabel(part.family, `${part.id}: bad family`);
  }
  assertTags(part);
  assertStringArray(part.aliases, `${part.id}: bad aliases`);
  assertAttributes(part.attributes, `${part.id}: bad attributes`);
  assertOptionalStepSource(part.stepSource, `${part.id}: bad stepSource`);
  assertOptionalUrl(part.productPage, `${part.id}: bad productPage`);

  if (part.standard) {
    assert(part.standard && typeof part.standard === "object" && !Array.isArray(part.standard), `${part.id}: bad standard`);
    assert(typeof part.standard.body === "string" && part.standard.body.trim(), `${part.id}: bad standard body`);
    assert(typeof part.standard.number === "string" && part.standard.number.trim(), `${part.id}: bad standard number`);
    assert(
      typeof part.standard.designation === "string" && part.standard.designation.trim(),
      `${part.id}: bad standard designation`,
    );
  }

  assert(part.stepUrl === `/step/${part.id}.step`, `${part.id}: bad stepUrl`);
  assert(part.glbUrl === `/glb/${part.id}.glb`, `${part.id}: bad glbUrl`);
  assert(part.pngUrl === `/png/${part.id}.png`, `${part.id}: bad pngUrl`);
  assert(typeof part.byteSize === "number", `${part.id}: byteSize must be generated`);
  assert(/^[a-f0-9]{64}$/.test(part.sha256), `${part.id}: sha256 must be generated`);
}

function assertFieldPath(value, message) {
  assert(
    typeof value === "string" &&
      (/^(id|name|category|family)$/.test(value) ||
        /^standard\.(body|number|designation)$/.test(value) ||
        /^attributes\.[a-z][a-zA-Z0-9]*$/.test(value)),
    message,
  );
}

function validateTaxonomy(taxonomy) {
  const topLevelKeys = new Set(["version", "scope", "rigidFamilies"]);
  const unexpectedTopLevelKeys = Object.keys(taxonomy).filter((key) => !topLevelKeys.has(key));
  assert(unexpectedTopLevelKeys.length === 0, `catalog/taxonomy.json has unsupported fields: ${unexpectedTopLevelKeys.join(", ")}`);
  assert(taxonomy.version === 1, "catalog/taxonomy.json version must be 1");
  assert(typeof taxonomy.scope === "string" && taxonomy.scope.trim(), "catalog/taxonomy.json must explain its scope");
  assert(
    taxonomy.rigidFamilies && typeof taxonomy.rigidFamilies === "object" && !Array.isArray(taxonomy.rigidFamilies),
    "catalog/taxonomy.json must contain rigidFamilies",
  );

  const familyKeys = new Set(["category", "description", "requiredTags", "requiredAttributes", "identityFields"]);

  for (const [family, rule] of Object.entries(taxonomy.rigidFamilies)) {
    assertKebabLabel(family, `catalog/taxonomy.json: bad family ${family}`);
    assert(rule && typeof rule === "object" && !Array.isArray(rule), `${family}: taxonomy rule must be an object`);

    const unexpectedKeys = Object.keys(rule).filter((key) => !familyKeys.has(key));
    assert(unexpectedKeys.length === 0, `${family}: taxonomy rule has unsupported fields: ${unexpectedKeys.join(", ")}`);
    assertKebabLabel(rule.category, `${family}: taxonomy category must be kebab-case`);
    assert(typeof rule.description === "string" && rule.description.trim(), `${family}: taxonomy rule needs a description`);
    assertStringArray(rule.requiredTags, `${family}: taxonomy requiredTags must be a string array`);
    assertStringArray(rule.requiredAttributes, `${family}: taxonomy requiredAttributes must be a string array`);
    assertOptionalStringArray(rule.identityFields, `${family}: taxonomy identityFields must be a string array`);

    for (const tag of rule.requiredTags) {
      assertKebabLabel(tag, `${family}: bad taxonomy required tag ${tag}`);
    }

    for (const attribute of rule.requiredAttributes) {
      assert(/^[a-z][a-zA-Z0-9]*$/.test(attribute), `${family}: bad taxonomy required attribute ${attribute}`);
    }

    for (const field of rule.identityFields ?? []) {
      assertFieldPath(field, `${family}: bad taxonomy identity field ${field}`);
    }
  }
}

function fieldValue(part, field) {
  if (field === "id" || field === "name" || field === "category" || field === "family") {
    return part[field];
  }

  if (field.startsWith("standard.")) {
    return part.standard?.[field.slice("standard.".length)];
  }

  if (field.startsWith("attributes.")) {
    return part.attributes?.[field.slice("attributes.".length)];
  }

  return undefined;
}

function hasCatalogValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function validateTaxonomyPart(part, taxonomy) {
  const rule = taxonomy.rigidFamilies[part.family];
  if (!rule) {
    return;
  }

  assert(part.category === rule.category, `${part.id}: family ${part.family} must use category ${rule.category}`);

  for (const tag of rule.requiredTags) {
    assert(part.tags.includes(tag), `${part.id}: family ${part.family} requires tag ${tag}`);
  }

  for (const attribute of rule.requiredAttributes) {
    assert(hasCatalogValue(part.attributes[attribute]), `${part.id}: family ${part.family} requires attribute ${attribute}`);
  }

  for (const field of rule.identityFields ?? []) {
    assert(hasCatalogValue(fieldValue(part, field)), `${part.id}: family ${part.family} requires identity field ${field}`);
  }
}

function validateTaxonomyIdentities(parts, taxonomy) {
  for (const [family, rule] of Object.entries(taxonomy.rigidFamilies)) {
    const identityFields = rule.identityFields ?? [];
    if (identityFields.length === 0) {
      continue;
    }

    const identities = new Map();
    for (const part of parts.filter((entry) => entry.family === family)) {
      const identity = JSON.stringify(identityFields.map((field) => fieldValue(part, field)));
      const existing = identities.get(identity);
      assert(!existing, `${part.id}: duplicates ${existing} for rigid family identity ${identityFields.join(", ")}`);
      identities.set(identity, part.id);
    }
  }
}

async function validateAssets(part) {
  assert(await exists(stepPathFor(part)), `${part.id}: missing STEP file`);
  assert(await exists(glbPathFor(part)), `${part.id}: missing GLB file`);
  assert(await exists(pngPathFor(part)), `${part.id}: missing PNG file`);

  const step = await readFile(stepPathFor(part));
  assert(looksLikeStep(step), `${part.id}: STEP file does not look like a STEP file`);

  const glb = await readFile(glbPathFor(part));
  assert(glb.byteLength >= 20, `${part.id}: GLB file is too small`);
  assert(glb.readUInt32LE(0) === 0x46546c67, `${part.id}: GLB has bad magic`);
  assert(glb.readUInt32LE(4) === 2, `${part.id}: GLB must be version 2`);
  assert(glb.readUInt32LE(8) === glb.byteLength, `${part.id}: GLB length header mismatch`);

  const pngMetadata = await sharp(pngPathFor(part)).metadata();
  assert(
    pngMetadata.format === "png" && pngMetadata.width === 512 && pngMetadata.height === 512,
    `${part.id}: PNG file must be 512x512`,
  );
}

async function assertPathMissing(filePath, message) {
  assert(!(await exists(filePath)), message);
}

function assertRowsEqual(partId, expected, actual) {
  const keys = Object.keys(expected).sort((a, b) => a.localeCompare(b));
  const actualKeys = Object.keys(actual).sort((a, b) => a.localeCompare(b));
  assert(
    JSON.stringify(actualKeys) === JSON.stringify(keys),
    `${partId}: SQLite row columns do not match expected schema`,
  );

  for (const key of keys) {
    assert(actual[key] === expected[key], `${partId}: SQLite ${key} is stale`);
  }
}

function assertCatalogDbVersion() {
  const db = new DatabaseSync(sqliteCatalogPath, { readOnly: true });
  try {
    const row = db.prepare("PRAGMA user_version").get();
    assert(row.user_version === CATALOG_DB_USER_VERSION, `SQLite user_version must be ${CATALOG_DB_USER_VERSION}`);
  } finally {
    db.close();
  }
}

const errors = [];

async function collect(label, task) {
  try {
    await task();
  } catch (error) {
    errors.push(`${label}: ${error.message}`);
  }
}

const sourceParts = await readSourceParts();
const taxonomy = await readTaxonomy();
const buildKeys = await readAssetBuildKeys();
const expectedParts = [];
const sourceMetadataParts = [];

await collect("catalog/taxonomy.json", () => {
  validateTaxonomy(taxonomy);
});

await collect("STEP metadata", async () => {
  const result = await checkStepMetadataForCatalogParts(sourceParts, { stepDir });
  assert(result.errors.length === 0, result.errors.slice(0, 80).join("\n"));
});

for (const sourcePart of sourceParts) {
  await collect(sourcePart.id ?? "<unknown>", async () => {
    sourceMetadataParts.push(await materializePart(sourcePart));
  });
}

const sourceMetadataById = new Map(sourceMetadataParts.map((part) => [part.id, part]));
const ids = new Set();
for (const part of sourceMetadataParts) {
  await collect(part.id, async () => {
    validatePart(part, ids);
    validateTaxonomyPart(part, taxonomy);
  });
}

for (const sourcePart of sourceParts) {
  const part = sourceMetadataById.get(sourcePart.id);
  assert(part, `${sourcePart.id}: missing materialized source metadata`);
  expectedParts.push(part);
}

await collect("catalog/taxonomy.json identities", () => {
  validateTaxonomyIdentities(expectedParts, taxonomy);
});

for (const part of expectedParts) {
  await collect(part.id, async () => {
    await validateAssets(part);
  });
}

await collect("catalog/parts.sqlite", () => {
  assertCatalogDbVersion();
});

const actualRows = new Map();
await collect("catalog/parts.sqlite rows", () => {
  for (const row of readCatalogRows()) {
    assert(!actualRows.has(row.id), `${row.id}: duplicate SQLite row`);
    actualRows.set(row.id, row);
  }
  assert(actualRows.size === expectedParts.length, `SQLite catalog has ${actualRows.size} rows; expected ${expectedParts.length}`);
});

for (const [sourceOrder, part] of expectedParts.entries()) {
  await collect(`catalog/parts.sqlite:${part.id}`, async () => {
    const actual = actualRows.get(part.id);
    assert(actual, `${part.id}: missing SQLite row`);
    const expected = await catalogRowFromCurrentAssets(part, sourceOrder, buildKeys);
    assertRowsEqual(part.id, expected, actual);
  });
}

await collect("public/catalog/parts.json", () =>
  assertPathMissing(obsoletePublicCatalogJsonPath, "public/catalog/parts.json is obsolete; source catalog belongs in catalog/parts.json"),
);
await collect("public/catalog/parts.sqlite", () =>
  assertPathMissing(obsoletePublicCatalogSqlitePath, "public/catalog/parts.sqlite is obsolete; generated catalog database belongs in catalog/parts.sqlite"),
);
await collect("public/catalog/parts.source.json", () =>
  assertPathMissing(obsoleteSourceCatalogPath, "public/catalog/parts.source.json is obsolete; source catalog belongs in catalog/parts.json"),
);
await collect("public/catalog/parts.ndjson", () =>
  assertPathMissing(obsoleteCatalogNdjsonPath, "public/catalog/parts.ndjson is obsolete; generated catalog metadata belongs in catalog/parts.sqlite"),
);
await collect("public/catalog/manifest.json", () =>
  assertPathMissing(obsoleteAssetManifestPath, "public/catalog/manifest.json is obsolete; asset build state belongs in catalog/parts.sqlite"),
);
await collect("catalog/manifest.json", () =>
  assertPathMissing(path.join(process.cwd(), "catalog", "manifest.json"), "catalog/manifest.json is obsolete; asset build state belongs in catalog/parts.sqlite"),
);
await collect("catalog/parts.source.json", () =>
  assertPathMissing(path.join(process.cwd(), "catalog", "parts.source.json"), "catalog/parts.source.json is obsolete; source catalog belongs in catalog/parts.json"),
);
await collect("public/parts", () =>
  assertPathMissing(path.join(process.cwd(), "public", "parts"), "public/parts is obsolete; assets belong in catalog/step, public/glb, and public/png"),
);
await collect("public/step", () =>
  assertPathMissing(path.join(process.cwd(), "public", "step"), "public/step is obsolete; canonical STEP assets belong in catalog/step"),
);

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Checked ${expectedParts.length} catalog parts and generated assets.`);
