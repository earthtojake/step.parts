import { neon } from "@neondatabase/serverless";

const DOWNLOAD_COUNT_CHUNK_SIZE = 500;
const DOWNLOAD_COUNTS_CACHE_TTL_MS = 60_000;

type NeonSql = ReturnType<typeof neon>;

type DownloadCountRow = {
  part_id: string;
  download_count: bigint | number | string | null;
};

let sql: NeonSql | null | undefined;
let initPromise: Promise<void> | null = null;
let downloadCountsCache:
  | {
      createdAt: number;
      counts: Map<string, number>;
    }
  | null = null;
let downloadCountsPromise: Promise<Map<string, number>> | null = null;

function getSql(): NeonSql | null {
  if (sql !== undefined) {
    return sql;
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  sql = databaseUrl ? neon(databaseUrl) : null;
  return sql;
}

async function ensureDownloadsTable(database: NeonSql): Promise<void> {
  initPromise ??= (async () => {
    await database`
      CREATE TABLE IF NOT EXISTS part_downloads (
        part_id text PRIMARY KEY,
        download_count bigint NOT NULL DEFAULT 0 CHECK (download_count >= 0),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    await database`
      CREATE INDEX IF NOT EXISTS part_downloads_rank_idx
        ON part_downloads (download_count DESC, part_id ASC)
    `;

    await database`
      CREATE TABLE IF NOT EXISTS part_download_rank_dedupe (
        part_id text NOT NULL,
        dedupe_key text NOT NULL,
        bucket date NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (part_id, dedupe_key, bucket)
      )
    `;
  })().catch((error) => {
    initPromise = null;
    throw error;
  });

  await initPromise;
}

function uniquePartIds(partIds: string[]): string[] {
  return Array.from(new Set(partIds.filter(Boolean)));
}

function toCount(value: DownloadCountRow["download_count"]): number {
  const count = Number(value ?? 0);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function chunkPartIds(partIds: string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < partIds.length; index += DOWNLOAD_COUNT_CHUNK_SIZE) {
    chunks.push(partIds.slice(index, index + DOWNLOAD_COUNT_CHUNK_SIZE));
  }
  return chunks;
}

function cloneCounts(counts: Map<string, number>) {
  return new Map(counts);
}

function invalidateDownloadCountsCache() {
  downloadCountsCache = null;
}

async function readAllPartDownloadCounts(database: NeonSql): Promise<Map<string, number>> {
  await ensureDownloadsTable(database);

  const rows = (await database.query(`
    SELECT part_id, download_count
    FROM part_downloads
    WHERE download_count > 0
    ORDER BY download_count DESC, part_id ASC
  `)) as DownloadCountRow[];

  return new Map(rows.map((row) => [row.part_id, toCount(row.download_count)]));
}

export async function getAllPartDownloadCounts(): Promise<Map<string, number>> {
  const database = getSql();

  if (!database) {
    return new Map();
  }

  const now = Date.now();
  if (downloadCountsCache && now - downloadCountsCache.createdAt < DOWNLOAD_COUNTS_CACHE_TTL_MS) {
    return cloneCounts(downloadCountsCache.counts);
  }

  downloadCountsPromise ??= readAllPartDownloadCounts(database)
    .then((counts) => {
      downloadCountsCache = {
        createdAt: Date.now(),
        counts,
      };
      return counts;
    })
    .finally(() => {
      downloadCountsPromise = null;
    });

  try {
    return cloneCounts(await downloadCountsPromise);
  } catch {
    return new Map();
  }
}

export async function getPartDownloadCounts(partIds: string[]): Promise<Map<string, number>> {
  const uniqueIds = uniquePartIds(partIds);

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const allCounts = await getAllPartDownloadCounts();
  const counts = new Map<string, number>();
  for (const id of uniqueIds) {
    const count = allCounts.get(id);
    if (count) {
      counts.set(id, count);
    }
  }

  return counts;
}

async function incrementDeduplicatedDownloadCounts(
  database: NeonSql,
  partIds: string[],
  dedupeKey: string,
): Promise<boolean> {
  let changed = false;

  for (const chunk of chunkPartIds(partIds)) {
    const rows = (await database.query(
      `
      WITH inserted AS (
        INSERT INTO part_download_rank_dedupe (part_id, dedupe_key, bucket)
        SELECT unnest($1::text[]), $2::text, CURRENT_DATE
        ON CONFLICT DO NOTHING
        RETURNING part_id
      )
      INSERT INTO part_downloads (part_id, download_count)
      SELECT part_id, 1 FROM inserted
      ON CONFLICT (part_id) DO UPDATE
      SET download_count = part_downloads.download_count + 1,
          updated_at = now()
      RETURNING part_id
    `,
      [chunk, dedupeKey],
    )) as Array<{ part_id: string }>;
    changed = changed || rows.length > 0;
  }

  return changed;
}

async function incrementRawDownloadCounts(database: NeonSql, partIds: string[]): Promise<boolean> {
  let changed = false;

  for (const chunk of chunkPartIds(partIds)) {
    await database.query(
      `
      INSERT INTO part_downloads (part_id, download_count)
      SELECT unnest($1::text[]), 1
      ON CONFLICT (part_id) DO UPDATE
      SET download_count = part_downloads.download_count + 1,
          updated_at = now()
    `,
      [chunk],
    );
    changed = true;
  }

  return changed;
}

async function incrementDownloadCounts(partIds: string[], dedupeKey?: string): Promise<void> {
  const uniqueIds = uniquePartIds(partIds);
  const database = getSql();
  let changed = false;

  if (!database || uniqueIds.length === 0) {
    return;
  }

  try {
    await ensureDownloadsTable(database);
    changed = dedupeKey
      ? await incrementDeduplicatedDownloadCounts(database, uniqueIds, dedupeKey)
      : await incrementRawDownloadCounts(database, uniqueIds);
  } catch {
    return;
  } finally {
    if (changed) {
      invalidateDownloadCountsCache();
    }
  }
}

export async function incrementPartDownload(partId: string, dedupeKey?: string): Promise<void> {
  await incrementDownloadCounts([partId], dedupeKey);
}

export async function incrementPartDownloads(partIds: string[], dedupeKey?: string): Promise<void> {
  await incrementDownloadCounts(partIds, dedupeKey);
}
