import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const catalogDbRelativePath = join("catalog", "parts.sqlite");
const moduleDir = dirname(fileURLToPath(import.meta.url));

let resolvedCatalogDbPath: string | null = null;

export function catalogDbPathCandidates() {
  const explicitPath = process.env.STEP_PARTS_CATALOG_DB_PATH;

  return Array.from(
    new Set(
      [
        explicitPath ? resolve(explicitPath) : null,
        join(process.cwd(), catalogDbRelativePath),
        join(process.cwd(), "..", catalogDbRelativePath),
        join(process.cwd(), "..", "..", catalogDbRelativePath),
        join(moduleDir, "..", "..", catalogDbRelativePath),
        join(moduleDir, "..", "..", "..", catalogDbRelativePath),
        join(moduleDir, "..", "..", "..", "..", catalogDbRelativePath),
      ].filter((candidate): candidate is string => Boolean(candidate)),
    ),
  );
}

export function resolveCatalogDbPath() {
  if (resolvedCatalogDbPath) {
    return resolvedCatalogDbPath;
  }

  for (const candidate of catalogDbPathCandidates()) {
    if (existsSync(candidate)) {
      resolvedCatalogDbPath = realpathSync(candidate);
      return resolvedCatalogDbPath;
    }
  }

  throw new Error(
    [
      "Unable to find catalog SQLite database.",
      `Set STEP_PARTS_CATALOG_DB_PATH or ensure ${catalogDbRelativePath} is present.`,
      `Checked: ${catalogDbPathCandidates().join(", ")}`,
    ].join(" "),
  );
}
