import dns from "node:dns";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import "./load-env.mjs";
import { BlobNotFoundError, copy, del, head } from "@vercel/blob";
import {
  BLOB_CACHE_CONTROL_MAX_AGE_SECONDS,
  blobAssetContentType,
  blobAssetPath,
} from "./blob-assets.mjs";
import { sqliteCatalogPath } from "./catalog-utils.mjs";

dns.setDefaultResultOrder("ipv4first");

const DEFAULT_CONCURRENCY = 4;

const { values } = parseArgs({
  allowPositionals: false,
  options: {
    "dry-run": { type: "boolean" },
    "keep-old": { type: "boolean" },
    concurrency: { type: "string", short: "c" },
    sqlite: { type: "string" },
  },
});

function requireBlobToken() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required to migrate Vercel Blob preview assets");
  }
}

function readConcurrency() {
  const raw = values.concurrency ?? String(DEFAULT_CONCURRENCY);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("--concurrency must be a positive integer");
  }
  return parsed;
}

async function headOptional(pathname) {
  try {
    return await head(pathname);
  } catch (error) {
    if (error instanceof BlobNotFoundError || error?.name === "BlobNotFoundError") {
      return null;
    }
    throw error;
  }
}

function readLegacyRows() {
  const db = new DatabaseSync(values.sqlite ?? sqliteCatalogPath, { readOnly: true });
  try {
    return db
      .prepare(
        `
        SELECT
          id,
          source_order,
          step_sha256,
          glb_byte_size,
          glb_sha256,
          png_byte_size,
          png_sha256
        FROM parts
        ORDER BY source_order
        `,
      )
      .all();
  } catch (error) {
    throw new Error(
      `Unable to read legacy GLB/PNG columns. Run this script against the v2 catalog/parts.sqlite before regenerating the v3 schema, or pass --sqlite /path/to/old-parts.sqlite. ${error.message}`,
    );
  } finally {
    db.close();
  }
}

function expectedLegacyAssets(rows) {
  return rows.flatMap((row) => [
    {
      kind: "glb",
      id: row.id,
      byteSize: row.glb_byte_size,
      oldPath: blobAssetPath("glb", row.id, row.glb_sha256),
      newPath: blobAssetPath("glb", row.id, row.step_sha256),
    },
    {
      kind: "png",
      id: row.id,
      byteSize: row.png_byte_size,
      oldPath: blobAssetPath("png", row.id, row.png_sha256),
      newPath: blobAssetPath("png", row.id, row.step_sha256),
    },
  ]);
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

function assertBlobSize(asset, blob, label) {
  if (!blob) {
    throw new Error(`${asset.id}: missing ${label} Blob ${label === "old" ? asset.oldPath : asset.newPath}`);
  }
  if (blob.size !== asset.byteSize) {
    throw new Error(
      `${asset.id}: ${label} Blob ${label === "old" ? asset.oldPath : asset.newPath} has ${blob.size} bytes; expected ${asset.byteSize}`,
    );
  }
}

async function planOrCopyAsset(asset, options, stats, failures) {
  try {
    const oldBlob = await headOptional(asset.oldPath);
    assertBlobSize(asset, oldBlob, "old");

    if (asset.oldPath === asset.newPath) {
      stats.skipped += 1;
      return;
    }

    const newBlob = await headOptional(asset.newPath);
    if (newBlob) {
      assertBlobSize(asset, newBlob, "new");
      stats.skipped += 1;
      return;
    }

    if (options.dryRun) {
      stats.planned += 1;
      return;
    }

    await copy(asset.oldPath, asset.newPath, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: BLOB_CACHE_CONTROL_MAX_AGE_SECONDS,
      contentType: blobAssetContentType(asset.kind),
    });
    stats.copied += 1;
  } catch (error) {
    stats.failed += 1;
    failures.push(`${asset.id} ${asset.kind}: ${error.message}`);
  }
}

async function verifyAndDeleteAsset(asset, options, stats, failures) {
  if (options.dryRun || options.keepOld || asset.oldPath === asset.newPath) {
    return;
  }

  try {
    const newBlob = await headOptional(asset.newPath);
    assertBlobSize(asset, newBlob, "new");
    await del(asset.oldPath);
    stats.deleted += 1;
  } catch (error) {
    stats.failed += 1;
    failures.push(`${asset.id} ${asset.kind}: ${error.message}`);
  }
}

async function main() {
  requireBlobToken();

  const rows = readLegacyRows();
  const assets = expectedLegacyAssets(rows);
  const concurrency = readConcurrency();
  const dryRun = Boolean(values["dry-run"]);
  const keepOld = Boolean(values["keep-old"]);
  const failures = [];
  const stats = {
    copied: 0,
    skipped: 0,
    planned: 0,
    deleted: 0,
    failed: 0,
  };

  console.log(
    `${dryRun ? "Planning" : "Migrating"} ${assets.length} preview Blob paths for ${rows.length} catalog parts ` +
      `with ${concurrency} lane${concurrency === 1 ? "" : "s"}.`,
  );

  await runConcurrent(assets, concurrency, (asset) =>
    planOrCopyAsset(asset, { dryRun }, stats, failures),
  );

  if (failures.length === 0) {
    await runConcurrent(assets, concurrency, (asset) =>
      verifyAndDeleteAsset(asset, { dryRun, keepOld }, stats, failures),
    );
  }

  console.log(
    `Blob path migration complete: ${stats.copied} copied, ${stats.skipped} already present, ` +
      `${stats.planned} planned, ${stats.deleted} old paths deleted, ${stats.failed} failed.`,
  );

  if (failures.length > 0) {
    throw new Error(failures.slice(0, 40).join("\n"));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
