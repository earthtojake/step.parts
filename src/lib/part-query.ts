import type { DatabaseSync } from "node:sqlite";
import { serializePartsForAgent } from "@/lib/agent-parts";
import { getCatalogDb, partFromCatalogRow, type CatalogDbRow } from "@/lib/catalog-db";
import { getCatalogMetadata } from "@/lib/catalog-metadata";
import {
  DEFAULT_PART_PAGE,
  DEFAULT_PART_PAGE_SIZE,
  MAX_PART_PAGE_SIZE,
} from "@/lib/part-query-constants";
import { getAllPartDownloadCounts } from "@/lib/part-stats";
import type { PartFacet, PartQueryFilters, PartQueryResult } from "@/types/part-query";

export {
  DEFAULT_PART_PAGE,
  DEFAULT_PART_PAGE_SIZE,
  MAX_PART_PAGE_SIZE,
} from "@/lib/part-query-constants";

type SearchParamsRecord = Record<string, string | string[] | undefined>;
type PartQueryInput = URLSearchParams | SearchParamsRecord;

function valuesFor(input: PartQueryInput, key: string) {
  if (input instanceof URLSearchParams) {
    return input.getAll(key).flatMap(splitParamValue);
  }

  return splitParamValue(input[key]);
}

function splitParamValue(value: string | string[] | undefined) {
  const values = Array.isArray(value) ? value : value ? [value] : [];

  return values
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function firstValue(input: PartQueryInput, key: string) {
  return valuesFor(input, key)[0];
}

function normalize(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function uniqueValues(values: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const normalized = normalize(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    unique.push(value);
  }

  return unique;
}

function parseFilters(input: PartQueryInput): PartQueryFilters {
  return {
    q: firstValue(input, "q") ?? "",
    tags: uniqueValues(valuesFor(input, "tag")),
    categories: uniqueValues(valuesFor(input, "category")),
    families: uniqueValues(valuesFor(input, "family")),
    standards: uniqueValues(valuesFor(input, "standard")),
  };
}

function parsePage(input: PartQueryInput) {
  return parsePositiveInteger(firstValue(input, "page"), DEFAULT_PART_PAGE);
}

function parsePageSize(input: PartQueryInput) {
  return Math.min(
    parsePositiveInteger(firstValue(input, "pageSize"), DEFAULT_PART_PAGE_SIZE),
    MAX_PART_PAGE_SIZE,
  );
}

function placeholders(values: unknown[]) {
  return values.map(() => "?").join(", ");
}

function normalizedValues(values: string[]) {
  return values.map(normalize).filter(Boolean);
}

function addInClause(clauses: string[], params: unknown[], column: string, values: string[]) {
  const normalized = normalizedValues(values);
  if (normalized.length === 0) {
    return;
  }

  clauses.push(`${column} IN (${placeholders(normalized)})`);
  params.push(...normalized);
}

function buildWhere(filters: PartQueryFilters) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const tokens = filters.q.toLowerCase().trim().split(/\s+/).filter(Boolean);

  for (const token of tokens) {
    clauses.push("instr(search_text, ?) > 0");
    params.push(token);
  }

  addInClause(clauses, params, "category", filters.categories);
  addInClause(clauses, params, "family", filters.families);

  const standards = normalizedValues(filters.standards);
  if (standards.length > 0) {
    clauses.push(
      `(${standards
        .map(
          () =>
            "(lower(coalesce(standard_designation, '')) = ? OR lower(coalesce(standard_body, '') || coalesce(standard_number, '')) = ? OR lower(coalesce(standard_body, '') || ' ' || coalesce(standard_number, '')) = ?)",
        )
        .join(" OR ")})`,
    );
    for (const standard of standards) {
      params.push(standard, standard, standard);
    }
  }

  const tags = normalizedValues(filters.tags);
  if (tags.length > 0) {
    clauses.push(
      `EXISTS (SELECT 1 FROM json_each(parts.tags_json) AS tag WHERE lower(tag.value) IN (${placeholders(tags)}))`,
    );
    params.push(...tags);
  }

  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

function buildCategoryOnlyWhere(filters: PartQueryFilters) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  addInClause(clauses, params, "category", filters.categories);

  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

function sortFacets(a: PartFacet, b: PartFacet) {
  return b.count - a.count || a.value.localeCompare(b.value);
}

function plainFacet(row: PartFacet): PartFacet {
  return {
    value: row.value,
    count: row.count,
  };
}

function countScalarFacet(db: DatabaseSync, column: string, whereSql: string, params: unknown[]) {
  const rows = db
    .prepare(
      `SELECT ${column} AS value, COUNT(*) AS count
       FROM parts
       ${whereSql}
       ${whereSql ? "AND" : "WHERE"} ${column} IS NOT NULL
       GROUP BY ${column}`,
    )
    .all(...params) as PartFacet[];

  return rows.map(plainFacet).sort(sortFacets);
}

function countTagFacet(db: DatabaseSync, whereSql: string, params: unknown[]) {
  const rows = db
    .prepare(
      `SELECT tag.value AS value, COUNT(*) AS count
       FROM parts, json_each(parts.tags_json) AS tag
       ${whereSql}
       GROUP BY tag.value`,
    )
    .all(...params) as PartFacet[];

  return rows.map(plainFacet).sort(sortFacets);
}

function buildFacets(db: DatabaseSync, whereSql: string, params: unknown[]) {
  return {
    tags: countTagFacet(db, whereSql, params),
    categories: countScalarFacet(db, "category", whereSql, params),
    families: countScalarFacet(db, "family", whereSql, params),
    standards: countScalarFacet(db, "standard_designation", whereSql, params),
  };
}

function buildFilterFacets(db: DatabaseSync, filters: PartQueryFilters) {
  const globalFacets = buildFacets(db, "", []);

  if (filters.categories.length === 0) {
    return globalFacets;
  }

  const categoryWhere = buildCategoryOnlyWhere(filters);
  const categoryFacets = buildFacets(db, categoryWhere.sql, categoryWhere.params);

  return {
    ...categoryFacets,
    categories: globalFacets.categories,
  };
}

function selectRowsBySourceOrder(
  db: DatabaseSync,
  where: { sql: string; params: unknown[] },
  limit: number,
  offset: number,
) {
  return db
    .prepare(`SELECT * FROM parts ${where.sql} ORDER BY source_order LIMIT ? OFFSET ?`)
    .all(...where.params, limit, offset) as CatalogDbRow[];
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function selectRowsByDownloadRank(
  db: DatabaseSync,
  where: { sql: string; params: unknown[] },
  downloadCounts: Map<string, number>,
  limit: number,
  offset: number,
) {
  const values = Array.from(downloadCounts)
    .filter(([, count]) => count > 0)
    .map(([id, count]) => `(${sqlString(id)}, ${count})`)
    .join(", ");

  if (!values) {
    return selectRowsBySourceOrder(db, where, limit, offset);
  }

  return db
    .prepare(
      `WITH download_counts(id, download_count) AS (VALUES ${values})
       SELECT parts.*
       FROM parts
       LEFT JOIN download_counts ON download_counts.id = parts.id
       ${where.sql}
       ORDER BY COALESCE(download_counts.download_count, 0) DESC, parts.source_order
       LIMIT ? OFFSET ?`,
    )
    .all(...where.params, limit, offset) as CatalogDbRow[];
}

export async function queryParts(input: PartQueryInput): Promise<PartQueryResult> {
  const filters = parseFilters(input);
  const pageSize = parsePageSize(input);
  const requestedPage = parsePage(input);
  const where = buildWhere(filters);
  const catalog = getCatalogMetadata();
  const db = getCatalogDb();
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS total FROM parts ${where.sql}`)
    .get(...where.params) as { total: number };
  const total = totalRow.total;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const page = totalPages === 0 ? DEFAULT_PART_PAGE : Math.min(requestedPage, totalPages);
  const start = (page - 1) * pageSize;
  const downloadCounts = await getAllPartDownloadCounts();
  const rows =
    downloadCounts.size === 0
      ? selectRowsBySourceOrder(db, where, pageSize, start)
      : selectRowsByDownloadRank(db, where, downloadCounts, pageSize, start);
  const pagedParts = rows.map(partFromCatalogRow);
  const facets = buildFilterFacets(db, filters);

  return {
    catalog,
    items: serializePartsForAgent(pagedParts),
    page,
    pageSize,
    total,
    totalPages,
    hasNextPage: totalPages > 0 && page < totalPages,
    hasPreviousPage: page > 1,
    facets,
    filters,
  };
}
