import dns from "node:dns";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs, promisify } from "node:util";
import "./load-env.mjs";
import { list, put } from "@vercel/blob";

dns.setDefaultResultOrder("ipv4first");
process.env.VERCEL_BLOB_USE_X_CONTENT_LENGTH ??= "1";
import {
  BLOB_CACHE_CONTROL_MAX_AGE_SECONDS,
  BLOB_ASSET_PREFIX,
  BLOB_BASE_URL_ENV,
  blobAssetContentType,
  blobAssetPath,
  normalizeBlobBaseUrl,
} from "./blob-assets.mjs";
import {
  stepPathFor,
  glbPathFor,
  pngPathFor,
  readCatalogRows,
} from "./catalog-utils.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_CONCURRENCY = 4;
const MULTIPART_ASSET_BYTES = 4 * 1024 * 1024;
const DEFAULT_UPLOAD_TIMEOUT_MS = 300_000;
const DEFAULT_UPLOAD_ATTEMPTS = 3;
const LFS_PATH_CHUNK_SIZE = 100;

const { values } = parseArgs({
  allowPositionals: false,
  options: {
    "dry-run": { type: "boolean" },
    "verify-only": { type: "boolean" },
    verbose: { type: "boolean" },
    concurrency: { type: "string", short: "c" },
  },
});

function readConcurrency() {
  const raw = values.concurrency ?? String(DEFAULT_CONCURRENCY);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("--concurrency must be a positive integer");
  }
  return parsed;
}

function requireBlobToken() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required to sync Vercel Blob preview assets");
  }
}

function formatBytes(value) {
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function readPositiveIntegerEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function listBlobAssets() {
  const blobs = new Map();
  let cursor;

  do {
    const page = await list({
      prefix: `${BLOB_ASSET_PREFIX}/`,
      limit: 1000,
      cursor,
    });

    for (const blob of page.blobs) {
      blobs.set(blob.pathname, blob);
    }

    cursor = page.cursor;
    if (!page.hasMore) {
      break;
    }
  } while (cursor);

  return blobs;
}

function expectedAssets(rows) {
  return rows.flatMap((row) => [
    {
      kind: "glb",
      id: row.id,
      path: glbPathFor(row),
      blobPath: blobAssetPath("glb", row.id, row.step_sha256),
    },
    {
      kind: "png",
      id: row.id,
      path: pngPathFor(row),
      blobPath: blobAssetPath("png", row.id, row.step_sha256),
    },
  ]);
}

function runNodeScript(scriptPath, scriptArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
      cwd: process.cwd(),
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${scriptPath} exited with code ${code}`));
    });
  });
}

function uniquePartIds(assets) {
  return Array.from(new Set(assets.map((asset) => asset.id))).sort((a, b) => a.localeCompare(b));
}

function stepRepoPath(row) {
  return `catalog/step/${row.id}.step`;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function runCommand(command, args) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd: process.cwd(),
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
    throw new Error(stderr || error.message);
  }
}

function conciseCommandError(error) {
  const message = String(error?.message ?? error);
  return message.split(/\r?\n/).slice(0, 8).join("\n");
}

async function isHydratedStepFile(row) {
  try {
    const bytes = await readFile(stepPathFor(row));
    return (
      bytes.byteLength === row.step_byte_size &&
      createHash("sha256").update(bytes).digest("hex") === row.step_sha256
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function fetchAndCheckoutLfsPaths(filePaths) {
  await runCommand("git", ["lfs", "install", "--local"]);
  for (const chunk of chunkArray(filePaths, LFS_PATH_CHUNK_SIZE)) {
    const include = chunk.join(",");
    await runCommand("git", ["lfs", "fetch", "--include", include, "--exclude", "", "origin", "HEAD"]);
    await runCommand("git", ["lfs", "checkout", ...chunk]);
  }
}

function encodeGithubPath(filePath) {
  return filePath.split("/").map((part) => encodeURIComponent(part)).join("/");
}

async function downloadGithubMediaStepFiles(rows) {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("GITHUB_REPOSITORY is required for GitHub media STEP hydration fallback");
  }

  const ref = process.env.GITHUB_SHA || (await runCommand("git", ["rev-parse", "HEAD"])).trim();
  const headers = {};
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  for (const row of rows) {
    const filePath = stepRepoPath(row);
    const url = `https://media.githubusercontent.com/media/${repository}/${encodeURIComponent(ref)}/${encodeGithubPath(filePath)}`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`${filePath}: GitHub media download failed with ${response.status} ${response.statusText}`);
    }
    await writeFile(stepPathFor(row), Buffer.from(await response.arrayBuffer()));
  }
}

async function hydrateStepFilesForMissingAssets(missingAssets, rows, options) {
  if (missingAssets.length === 0 || options.dryRun || options.verifyOnly) {
    return;
  }

  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const targetRows = uniquePartIds(missingAssets).map((id) => rowsById.get(id));
  const missingRows = [];

  for (const row of targetRows) {
    if (!(await isHydratedStepFile(row))) {
      missingRows.push(row);
    }
  }

  if (missingRows.length === 0) {
    return;
  }

  console.log(`Hydrating ${missingRows.length} STEP file${missingRows.length === 1 ? "" : "s"} for missing preview assets.`);
  const errors = [];
  try {
    await fetchAndCheckoutLfsPaths(missingRows.map((row) => stepRepoPath(row)));
  } catch (error) {
    errors.push(`git lfs: ${conciseCommandError(error)}`);
  }

  let stillMissing = [];
  for (const row of missingRows) {
    if (!(await isHydratedStepFile(row))) {
      stillMissing.push(row);
    }
  }
  if (stillMissing.length === 0) {
    return;
  }

  try {
    await downloadGithubMediaStepFiles(stillMissing);
  } catch (error) {
    errors.push(`GitHub media: ${conciseCommandError(error)}`);
  }

  stillMissing = [];
  for (const row of missingRows) {
    if (!(await isHydratedStepFile(row))) {
      stillMissing.push(row);
    }
  }
  if (stillMissing.length === 0) {
    return;
  }

  throw new Error(`Unable to hydrate ${stillMissing.length} STEP file(s) for preview asset generation:\n${errors.join("\n")}`);
}

async function buildMissingLocalAssets(missingAssets, options) {
  if (missingAssets.length === 0 || options.dryRun || options.verifyOnly) {
    return;
  }

  const ids = uniquePartIds(missingAssets);
  const targetPath = path.join(
    os.tmpdir(),
    `step-parts-missing-preview-assets-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
  );

  try {
    await writeFile(targetPath, `${ids.join("\n")}\n`);
    console.log(`Generating local preview assets for ${ids.length} part${ids.length === 1 ? "" : "s"} missing Blob objects.`);
    await runNodeScript("scripts/export-assets.mjs", ["--force-build", "--targets-file", targetPath]);
  } finally {
    await rm(targetPath, { force: true });
  }
}

function validateLocalAssetBytes(asset, body) {
  if (body.byteLength === 0) {
    throw new Error(`${asset.id}: local ${asset.kind.toUpperCase()} is empty`);
  }

  if (asset.kind === "glb") {
    if (body.byteLength < 20) {
      throw new Error(`${asset.id}: local GLB is too small`);
    }
    if (body.readUInt32LE(0) !== 0x46546c67 || body.readUInt32LE(4) !== 2 || body.readUInt32LE(8) !== body.byteLength) {
      throw new Error(`${asset.id}: local GLB is malformed`);
    }
  }
}

async function uploadAsset(asset, existingBlob, options) {
  if (existingBlob) {
    if (existingBlob.size <= 0) {
      throw new Error(`${asset.blobPath}: Blob exists but is empty`);
    }

    return { status: "skipped", url: existingBlob.url, byteSize: existingBlob.size };
  }

  if (options.verifyOnly) {
    throw new Error(`${asset.blobPath}: missing from Vercel Blob`);
  }

  if (options.dryRun) {
    return { status: "planned", url: null, byteSize: 0 };
  }

  const body = await readFile(asset.path);
  validateLocalAssetBytes(asset, body);
  if (options.verbose) {
    console.log(`Uploading ${asset.blobPath} (${formatBytes(body.byteLength)}).`);
  }
  const maxAttempts = readPositiveIntegerEnv("STEP_PARTS_BLOB_UPLOAD_ATTEMPTS", DEFAULT_UPLOAD_ATTEMPTS);
  const timeoutMs = readPositiveIntegerEnv("STEP_PARTS_BLOB_UPLOAD_TIMEOUT_MS", DEFAULT_UPLOAD_TIMEOUT_MS);
  let blob;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    let lastProgressPercent = -1;
    const timeout = setTimeout(() => {
      controller.abort(new Error(`${asset.blobPath}: upload timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      blob = await put(asset.blobPath, body, {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: false,
        abortSignal: controller.signal,
        cacheControlMaxAge: BLOB_CACHE_CONTROL_MAX_AGE_SECONDS,
        contentType: blobAssetContentType(asset.kind),
        multipart: body.byteLength >= MULTIPART_ASSET_BYTES,
        ...(options.verbose
          ? {
              onUploadProgress: ({ loaded, percentage, total }) => {
                const progressPercent = Math.floor(percentage / 10) * 10;
                if (progressPercent !== lastProgressPercent || loaded === total) {
                  lastProgressPercent = progressPercent;
                  console.log(`${asset.blobPath}: ${percentage}% uploaded (${formatBytes(loaded)} / ${formatBytes(total)}).`);
                }
              },
            }
          : {}),
      });
      break;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw new Error(`${asset.blobPath}: upload failed after ${maxAttempts} attempts: ${error.message}`);
      }

      console.warn(`${asset.blobPath}: upload attempt ${attempt}/${maxAttempts} failed: ${error.message}; retrying.`);
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 10_000));
    } finally {
      clearTimeout(timeout);
    }
  }

  if (blob.pathname !== asset.blobPath) {
    throw new Error(`${asset.id}: uploaded Blob pathname mismatch: ${blob.pathname}`);
  }

  return { status: "uploaded", url: blob.url, byteSize: body.byteLength };
}

async function runConcurrent(items, concurrency, worker) {
  let index = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await worker(item);
    }
  });

  await Promise.all(workers);
}

async function main() {
  requireBlobToken();

  const rows = readCatalogRows();
  const assets = expectedAssets(rows);
  const existing = await listBlobAssets();
  const missingAssets = assets.filter((asset) => !existing.has(asset.blobPath));
  const stats = {
    uploaded: 0,
    skipped: 0,
    planned: 0,
    bytes: 0,
  };
  const baseUrls = new Set();
  const concurrency = readConcurrency();

  console.log(`Syncing ${assets.length} preview assets for ${rows.length} catalog parts.`);
  console.log(`Found ${existing.size} existing Blob objects under ${BLOB_ASSET_PREFIX}/.`);
  await hydrateStepFilesForMissingAssets(missingAssets, rows, {
    dryRun: Boolean(values["dry-run"]),
    verifyOnly: Boolean(values["verify-only"]),
  });
  await buildMissingLocalAssets(missingAssets, {
    dryRun: Boolean(values["dry-run"]),
    verifyOnly: Boolean(values["verify-only"]),
  });

  await runConcurrent(assets, concurrency, async (asset) => {
    const result = await uploadAsset(asset, existing.get(asset.blobPath), {
      dryRun: Boolean(values["dry-run"]),
      verifyOnly: Boolean(values["verify-only"]),
      verbose: Boolean(values.verbose),
    });

    stats[result.status] += 1;
    stats.bytes += result.byteSize;

    if (result.url) {
      baseUrls.add(new URL(result.url).origin);
    }

    const completed = stats.uploaded + stats.skipped + stats.planned;
    if (completed % 250 === 0 || completed === assets.length) {
      console.log(
        `Processed ${completed}/${assets.length}: ` +
          `${stats.uploaded} uploaded, ${stats.skipped} skipped, ${stats.planned} planned.`,
      );
    }
  });

  const configuredBaseUrl = normalizeBlobBaseUrl(process.env[BLOB_BASE_URL_ENV]);
  console.log(
    `Blob asset sync complete: ${stats.uploaded} uploaded, ${stats.skipped} already present, ` +
      `${stats.planned} planned; ${formatBytes(stats.bytes)} processed.`,
  );

  if (!configuredBaseUrl && baseUrls.size === 1) {
    console.log(`Set ${BLOB_BASE_URL_ENV}=${Array.from(baseUrls)[0]}`);
  } else if (configuredBaseUrl) {
    console.log(`${BLOB_BASE_URL_ENV}=${configuredBaseUrl}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
