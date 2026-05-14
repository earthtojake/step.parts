import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { rankedCandidatePageIds } from "../src/lib/part-ranking.ts";

function idsFor(candidates, counts, start = 0, pageSize = candidates.length) {
  return rankedCandidatePageIds(candidates, new Map(Object.entries(counts)), start, pageSize);
}

const catalogOrder = [
  { id: "a", sourceOrder: 0 },
  { id: "b", sourceOrder: 1 },
  { id: "c", sourceOrder: 2 },
  { id: "d", sourceOrder: 3 },
];

assert.deepEqual(idsFor(catalogOrder, { b: 10, c: 5 }), ["b", "c", "a", "d"]);
assert.deepEqual(idsFor(catalogOrder, { b: 3, c: 3 }), ["b", "c", "a", "d"]);
assert.deepEqual(idsFor(catalogOrder, { d: 1, a: 0 }), ["d", "a", "b", "c"]);
assert.deepEqual(idsFor(catalogOrder.slice(0, 2), { d: 99, b: 1 }), ["b", "a"]);
assert.deepEqual(idsFor(catalogOrder, { d: 100, c: 50 }, 2, 2), ["a", "b"]);
assert.deepEqual(idsFor(catalogOrder, {}), ["a", "b", "c", "d"]);

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function selectRowsByIds(db, ids) {
  const idOrder = new Map(ids.map((id, index) => [id, index]));
  const rows = db.prepare(`SELECT * FROM parts WHERE id IN (${placeholders(ids)})`).all(...ids);
  return rows.sort((a, b) => idOrder.get(a.id) - idOrder.get(b.id));
}

const db = new DatabaseSync("catalog/parts.sqlite", { readOnly: true });
try {
  const countRows = db.prepare("SELECT id FROM parts ORDER BY source_order").all();
  const counts = new Map(countRows.map((candidate, index) => [candidate.id, countRows.length - index]));
  const candidateStatement = db.prepare(
    "SELECT id, source_order AS sourceOrder FROM parts ORDER BY source_order",
  );
  const startedAt = performance.now();
  const candidates = candidateStatement.all();
  const pageIds = rankedCandidatePageIds(candidates, counts, 0, 60);
  const rows = selectRowsByIds(db, pageIds);
  const elapsedMs = performance.now() - startedAt;

  assert.equal(pageIds.length, Math.min(60, candidates.length));
  assert.equal(rows.length, pageIds.length);
  assert.deepEqual(
    rows.map((row) => row.id),
    pageIds,
  );
  assert.ok(
    elapsedMs < 250,
    `Expected in-memory ranking to finish under 250ms for ${candidates.length} candidates; got ${elapsedMs.toFixed(
      1,
    )}ms`,
  );

  console.log(
    `Part query ranking checks passed: ranked ${candidates.length} candidates and loaded ${rows.length} rows in ${elapsedMs.toFixed(
      1,
    )}ms.`,
  );
} finally {
  db.close();
}
