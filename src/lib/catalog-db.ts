import { createHash } from "node:crypto";
import { readFileSync, statSync, type Stats } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { blobAssetUrl } from "@/lib/blob-assets";
import { catalogDbPathCandidates, resolveCatalogDbPath } from "@/lib/catalog-path";
import { stepUrlForId } from "@/lib/part-download";
import type { Part } from "@/types/part";

export type CatalogDbRow = {
  id: string;
  source_order: number;
  name: string;
  description: string;
  category: string;
  family: string | null;
  tags_json: string;
  aliases_json: string;
  standard_body: string | null;
  standard_number: string | null;
  standard_designation: string | null;
  step_source: string | null;
  product_page: string | null;
  attributes_json: string;
  search_text: string;
  step_byte_size: number;
  step_sha256: string;
  step_geometry_sha256: string;
};

export type CatalogFileInfo = {
  path: string;
  stats: Stats;
  sha256: string;
};

type CatalogDbSignature = {
  path: string;
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
};

type CatalogDbState = {
  db: DatabaseSync;
  fileInfo?: CatalogFileInfo;
  parts?: Part[];
  signature: CatalogDbSignature;
  stats: Stats;
};

const globalCatalogDb = globalThis as typeof globalThis & {
  __stepPartsCatalogDb?: DatabaseSync;
  __stepPartsCatalogState?: CatalogDbState;
};

function catalogSignature(path: string) {
  const stats = statSync(path);

  return {
    signature: {
      path,
      dev: stats.dev,
      ino: stats.ino,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    },
    stats,
  };
}

function sameCatalogSignature(a: CatalogDbSignature, b: CatalogDbSignature) {
  return (
    a.path === b.path &&
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs
  );
}

function closeCatalogDb(db: DatabaseSync | undefined) {
  try {
    db?.close();
  } catch {
    // A stale dev-server handle may already be closed by a hot reload path.
  }
}

function openCatalogDb(catalogDbPath: string) {
  try {
    return new DatabaseSync(catalogDbPath, { readOnly: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to open catalog SQLite database at ${catalogDbPath}: ${message}. Checked: ${catalogDbPathCandidates().join(", ")}`,
    );
  }
}

function getCatalogState() {
  const catalogDbPath = resolveCatalogDbPath();
  const { signature, stats } = catalogSignature(catalogDbPath);
  const cached = globalCatalogDb.__stepPartsCatalogState;

  if (cached && sameCatalogSignature(cached.signature, signature)) {
    return cached;
  }

  const db = openCatalogDb(catalogDbPath);
  closeCatalogDb(cached?.db);
  closeCatalogDb(globalCatalogDb.__stepPartsCatalogDb);
  delete globalCatalogDb.__stepPartsCatalogDb;

  const nextState: CatalogDbState = {
    db,
    signature,
    stats,
  };

  globalCatalogDb.__stepPartsCatalogState = nextState;
  return nextState;
}

export function glbUrlForRow(row: Pick<CatalogDbRow, "id" | "step_sha256">) {
  return blobAssetUrl("glb", row.id, row.step_sha256);
}

export function pngUrlForRow(row: Pick<CatalogDbRow, "id" | "step_sha256">) {
  return blobAssetUrl("png", row.id, row.step_sha256);
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function readCatalogRowsFromState(state: CatalogDbState) {
  return state.db.prepare("SELECT * FROM parts ORDER BY source_order").all() as CatalogDbRow[];
}

function readCatalogPartsFromState(state: CatalogDbState) {
  state.parts ??= readCatalogRowsFromState(state).map(partFromCatalogRow);
  return state.parts;
}

function catalogFileInfoFromState(state: CatalogDbState) {
  if (!state.fileInfo) {
    const catalogBytes = readFileSync(state.signature.path);

    state.fileInfo = {
      path: state.signature.path,
      stats: state.stats,
      sha256: createHash("sha256").update(catalogBytes).digest("hex"),
    };
  }

  return state.fileInfo;
}

export function partFromCatalogRow(row: CatalogDbRow): Part {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    ...(row.family ? { family: row.family } : {}),
    tags: parseJson<string[]>(row.tags_json),
    aliases: parseJson<string[]>(row.aliases_json),
    ...(row.standard_designation
      ? {
          standard: {
            body: row.standard_body ?? "",
            number: row.standard_number ?? "",
            designation: row.standard_designation,
          },
        }
      : {}),
    ...(row.step_source ? { stepSource: row.step_source } : {}),
    ...(row.product_page ? { productPage: row.product_page } : {}),
    attributes: parseJson<Part["attributes"]>(row.attributes_json),
    stepUrl: stepUrlForId(row.id),
    glbUrl: glbUrlForRow(row),
    pngUrl: pngUrlForRow(row),
    byteSize: row.step_byte_size,
    sha256: row.step_sha256,
  };
}

export function getCatalogDb() {
  return getCatalogState().db;
}

export function getCatalogFileInfo() {
  return catalogFileInfoFromState(getCatalogState());
}

export function getCatalogSnapshot() {
  const state = getCatalogState();

  return {
    fileInfo: catalogFileInfoFromState(state),
    parts: readCatalogPartsFromState(state),
  };
}

export function readAllCatalogRows() {
  return readCatalogRowsFromState(getCatalogState());
}

export function readAllCatalogParts() {
  return readCatalogPartsFromState(getCatalogState());
}

export function readCatalogPart(id: string) {
  const row = getCatalogState().db
    .prepare("SELECT * FROM parts WHERE id = ?")
    .get(id) as CatalogDbRow | undefined;
  return row ? partFromCatalogRow(row) : null;
}
