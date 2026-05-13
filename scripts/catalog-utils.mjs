import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { stepDataSectionSha256 } from "./step-metadata.mjs";

export const publicDir = path.join(process.cwd(), "public");
export const catalogDir = path.join(process.cwd(), "catalog");
export const sourceCatalogPath = path.join(catalogDir, "parts.json");
export const sqliteCatalogPath = path.join(catalogDir, "parts.sqlite");
export const taxonomyPath = path.join(catalogDir, "taxonomy.json");
export const obsoletePublicCatalogJsonPath = path.join(publicDir, "catalog", "parts.json");
export const obsoletePublicCatalogSqlitePath = path.join(publicDir, "catalog", "parts.sqlite");
export const obsoleteSourceCatalogPath = path.join(publicDir, "catalog", "parts.source.json");
export const obsoleteCatalogNdjsonPath = path.join(publicDir, "catalog", "parts.ndjson");
export const obsoleteAssetManifestPath = path.join(publicDir, "catalog", "manifest.json");
export const stepDir = path.join(catalogDir, "step");
export const glbDir = path.join(publicDir, "glb");
export const pngDir = path.join(publicDir, "png");

export const CATALOG_DB_USER_VERSION = 3;
export const CATALOG_DB_BUSY_TIMEOUT_MS = 30_000;

const PART_COLUMNS = [
  "id",
  "source_order",
  "name",
  "description",
  "category",
  "family",
  "tags_json",
  "aliases_json",
  "standard_body",
  "standard_number",
  "standard_designation",
  "step_source",
  "product_page",
  "attributes_json",
  "search_text",
  "step_byte_size",
  "step_sha256",
  "step_geometry_sha256",
];

const CREATE_PARTS_SQL = `
CREATE TABLE IF NOT EXISTS parts (
  id TEXT PRIMARY KEY,
  source_order INTEGER NOT NULL UNIQUE,

  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  family TEXT,

  tags_json TEXT NOT NULL
    CHECK (json_valid(tags_json) AND json_type(tags_json) = 'array'),
  aliases_json TEXT NOT NULL
    CHECK (json_valid(aliases_json) AND json_type(aliases_json) = 'array'),

  standard_body TEXT,
  standard_number TEXT,
  standard_designation TEXT,

  step_source TEXT,
  product_page TEXT,
  attributes_json TEXT NOT NULL
    CHECK (json_valid(attributes_json) AND json_type(attributes_json) = 'object'),

  search_text TEXT NOT NULL,

  step_byte_size INTEGER NOT NULL CHECK (step_byte_size >= 0),
  step_sha256 TEXT NOT NULL CHECK (length(step_sha256) = 64),
  step_geometry_sha256 TEXT NOT NULL CHECK (length(step_geometry_sha256) = 64),

  CHECK (
    (standard_body IS NULL) = (standard_number IS NULL)
    AND (standard_body IS NULL) = (standard_designation IS NULL)
  )
);
`;

const CREATE_INDEX_SQL = [
  "CREATE INDEX IF NOT EXISTS parts_source_order_idx ON parts(source_order)",
  "CREATE INDEX IF NOT EXISTS parts_category_idx ON parts(category, source_order)",
  "CREATE INDEX IF NOT EXISTS parts_family_idx ON parts(family, source_order) WHERE family IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS parts_standard_idx ON parts(standard_designation, source_order) WHERE standard_designation IS NOT NULL",
];

export function stepPathFor(part) {
  return path.join(stepDir, `${part.id}.step`);
}

export function glbPathFor(part) {
  return path.join(glbDir, `${part.id}.glb`);
}

export function pngPathFor(part) {
  return path.join(pngDir, `${part.id}.png`);
}

export function stepUrlForId(id) {
  return `/step/${id}.step`;
}

export function glbUrlForId(id) {
  return `/glb/${id}.glb`;
}

export function pngUrlForId(id) {
  return `/png/${id}.png`;
}

export function looksLikeStep(buffer) {
  const text = buffer.subarray(0, Math.min(buffer.byteLength, 512)).toString("utf8");
  return text.includes("ISO-10303") || text.includes("HEADER;");
}

export async function exists(filePath) {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function normalizeSourcePart(part) {
  const {
    id,
    name,
    description,
    category,
    family,
    tags,
    aliases = [],
    standard,
    stepSource,
    productPage,
    attributes = {},
  } = part;
  const normalizedFamily = typeof family === "string" ? family.trim() : "";

  return {
    id,
    name,
    description,
    category,
    ...(normalizedFamily ? { family: normalizedFamily } : {}),
    tags,
    aliases,
    ...(standard ? { standard } : {}),
    ...(typeof stepSource === "string" && stepSource.trim() ? { stepSource: stepSource.trim() } : {}),
    ...(typeof productPage === "string" && productPage.trim() ? { productPage: productPage.trim() } : {}),
    attributes,
  };
}

export function normalizePart(part) {
  const sourcePart = normalizeSourcePart(part);
  const byteSize = typeof part.byteSize === "number" ? part.byteSize : null;
  const sha256 = typeof part.sha256 === "string" ? part.sha256 : null;
  const stepGeometrySha256 = typeof part.stepGeometrySha256 === "string" ? part.stepGeometrySha256 : null;

  return {
    ...sourcePart,
    stepUrl: stepUrlForId(sourcePart.id),
    glbUrl: glbUrlForId(sourcePart.id),
    pngUrl: pngUrlForId(sourcePart.id),
    byteSize,
    sha256,
    stepGeometrySha256,
  };
}

export async function ensureAssetDirs() {
  await mkdir(stepDir, { recursive: true });
  await mkdir(glbDir, { recursive: true });
  await mkdir(pngDir, { recursive: true });
  await mkdir(catalogDir, { recursive: true });
}

async function readJsonArray(filePath) {
  const value = JSON.parse(await readFile(filePath, "utf8"));
  if (!Array.isArray(value)) {
    throw new Error(`${filePath} must contain a JSON array`);
  }

  return value;
}

export async function readSourceParts() {
  return (await readJsonArray(sourceCatalogPath)).map(normalizeSourcePart);
}

export async function writeSourceCatalogFile(parts) {
  const normalized = parts.map(normalizeSourcePart);
  await mkdir(path.dirname(sourceCatalogPath), { recursive: true });
  await writeFile(sourceCatalogPath, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

export async function materializePart(part) {
  const sourcePart = normalizeSourcePart(part);
  const step = await hashStepFile(stepPathFor(sourcePart));

  return normalizePart({
    ...sourcePart,
    byteSize: step.byteSize,
    sha256: step.sha256,
    stepGeometrySha256: step.geometrySha256,
  });
}

export async function hashStepFile(filePath) {
  const bytes = await readFile(filePath);
  return {
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    geometrySha256: stepDataSectionSha256(bytes),
  };
}

export async function hashFile(filePath) {
  const bytes = await readFile(filePath);
  return {
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function tryHashFile(filePath) {
  try {
    return await hashFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function canonicalJson(value) {
  return JSON.stringify(value ?? null);
}

export function searchTextForPart(part) {
  return [
    part.id,
    part.name,
    part.description,
    part.category,
    part.family,
    part.stepSource,
    part.productPage,
    part.standard?.designation,
    part.standard?.body,
    part.standard?.number,
    ...part.tags,
    ...part.aliases,
    ...Object.entries(part.attributes).flatMap(([key, value]) => [key, String(value)]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function partFromCatalogRow(row) {
  return normalizePart({
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    ...(row.family ? { family: row.family } : {}),
    tags: JSON.parse(row.tags_json),
    aliases: JSON.parse(row.aliases_json),
    ...(row.standard_designation
      ? {
          standard: {
            body: row.standard_body,
            number: row.standard_number,
            designation: row.standard_designation,
          },
        }
      : {}),
    ...(row.step_source ? { stepSource: row.step_source } : {}),
    ...(row.product_page ? { productPage: row.product_page } : {}),
    attributes: JSON.parse(row.attributes_json),
    byteSize: row.step_byte_size,
    sha256: row.step_sha256,
    stepGeometrySha256: row.step_geometry_sha256 ?? null,
  });
}

export function catalogRowFromPart(part, { sourceOrder }) {
  const normalized = normalizePart(part);

  if (normalized.byteSize === null || normalized.sha256 === null || normalized.stepGeometrySha256 === null) {
    throw new Error(`${normalized.id}: STEP metadata is missing`);
  }

  return {
    id: normalized.id,
    source_order: sourceOrder,
    name: normalized.name,
    description: normalized.description,
    category: normalized.category,
    family: normalized.family ?? null,
    tags_json: canonicalJson(normalized.tags),
    aliases_json: canonicalJson(normalized.aliases),
    standard_body: normalized.standard?.body ?? null,
    standard_number: normalized.standard?.number ?? null,
    standard_designation: normalized.standard?.designation ?? null,
    step_source: normalized.stepSource ?? null,
    product_page: normalized.productPage ?? null,
    attributes_json: canonicalJson(normalized.attributes),
    search_text: searchTextForPart(normalized),
    step_byte_size: normalized.byteSize,
    step_sha256: normalized.sha256,
    step_geometry_sha256: normalized.stepGeometrySha256,
  };
}

export function initializeCatalogDatabase(db) {
  db.exec(`PRAGMA user_version = ${CATALOG_DB_USER_VERSION}`);
  db.exec(CREATE_PARTS_SQL);
  for (const sql of CREATE_INDEX_SQL) {
    db.exec(sql);
  }
}

function configureCatalogWriteConnection(db) {
  db.exec(`PRAGMA busy_timeout = ${CATALOG_DB_BUSY_TIMEOUT_MS}`);
}

function hasPartsTable(db) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'parts'").get());
}

export function ensureCatalogDatabaseSchema(db) {
  if (!hasPartsTable(db)) {
    initializeCatalogDatabase(db);
    return;
  }

  const row = db.prepare("PRAGMA user_version").get();
  if (row.user_version !== CATALOG_DB_USER_VERSION) {
    throw new Error(`SQLite user_version must be ${CATALOG_DB_USER_VERSION}; found ${row.user_version}`);
  }

  for (const sql of CREATE_INDEX_SQL) {
    db.exec(sql);
  }
}

function insertCatalogRows(db, rows) {
  const placeholders = PART_COLUMNS.map(() => "?").join(", ");
  const statement = db.prepare(`INSERT INTO parts (${PART_COLUMNS.join(", ")}) VALUES (${placeholders})`);
  db.exec("BEGIN");
  try {
    for (const row of rows) {
      statement.run(...PART_COLUMNS.map((column) => row[column]));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function createUpsertCatalogRowStatement(db) {
  const placeholders = PART_COLUMNS.map(() => "?").join(", ");
  const updates = PART_COLUMNS.filter((column) => column !== "id")
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");

  return db.prepare(
    `INSERT INTO parts (${PART_COLUMNS.join(", ")}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates}`,
  );
}

function runTransaction(db, task) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = task();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function upsertRows(db, statement, rows) {
  if (rows.length === 0) {
    return;
  }

  runTransaction(db, () => {
    for (const row of rows) {
      statement.run(...PART_COLUMNS.map((column) => row[column]));
    }
  });
}

function deleteRowsOutsideSet(db, ids) {
  const keepIds = new Set(ids);
  const staleIds = db
    .prepare("SELECT id FROM parts")
    .all()
    .map((row) => row.id)
    .filter((id) => !keepIds.has(id));

  if (staleIds.length === 0) {
    return 0;
  }

  const statement = db.prepare("DELETE FROM parts WHERE id = ?");
  runTransaction(db, () => {
    for (const id of staleIds) {
      statement.run(id);
    }
  });

  return staleIds.length;
}

export async function writeCatalogDatabase(rows, { filePath = sqliteCatalogPath } = {}) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${suffix}.tmp`);

  await rm(tmpPath, { force: true });
  const db = new DatabaseSync(tmpPath);
  try {
    initializeCatalogDatabase(db);
    insertCatalogRows(db, rows);
  } finally {
    db.close();
  }

  await rename(tmpPath, filePath);
}

export function openCatalogRowWriter({ filePath = sqliteCatalogPath } = {}) {
  const db = new DatabaseSync(filePath);
  configureCatalogWriteConnection(db);
  ensureCatalogDatabaseSchema(db);
  const upsertStatement = createUpsertCatalogRowStatement(db);

  return {
    upsert(row) {
      upsertRows(db, upsertStatement, [row]);
    },
    deleteRowsNotIn(ids) {
      return deleteRowsOutsideSet(db, ids);
    },
    close() {
      db.close();
    },
  };
}

export function readCatalogRows({ filePath = sqliteCatalogPath } = {}) {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    return db.prepare("SELECT * FROM parts ORDER BY source_order").all();
  } finally {
    db.close();
  }
}

export function readCatalogRowMap({ filePath = sqliteCatalogPath } = {}) {
  return new Map(readCatalogRows({ filePath }).map((row) => [row.id, row]));
}

export async function readCatalogRowMapIfExists({ filePath = sqliteCatalogPath } = {}) {
  if (!(await exists(filePath))) {
    return new Map();
  }

  return readCatalogRowMap({ filePath });
}

export function readCatalogParts() {
  return readCatalogRows().map(partFromCatalogRow);
}
