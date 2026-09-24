// Offline record vectors and a query-time cosine ranker. Fusion stays in executor RRF.
import { cosine } from './entity-link.mjs';

export function rankByCosine(queryVector, rows, limit = 20) {
  const scored = rows.map((row) => ({ id: row.id, cosine: cosine(queryVector, row.vector) }));
  scored.sort((left, right) => right.cosine - left.cosine || String(left.id).localeCompare(String(right.id)));
  return scored.slice(0, limit);
}

export function createDenseRanker(rows, embedQuery) {
  return async function rank(query) {
    const started = Date.now();
    const [vector] = await embedQuery([query]);
    const top = rankByCosine(vector, rows, 20);
    return {
      ok: true,
      orderedIds: top.map((item) => item.id),
      cosines: new Map(top.map((item) => [item.id, item.cosine])),
      searchMs: Date.now() - started,
    };
  };
}

export function createScopedDenseRanker(rows, embedQuery, limit = 50) {
  const byId = new Map(rows.map((row) => [row.id, row.vector]));
  return async function rank(query, filtered) {
    const started = Date.now();
    const embedStarted = Date.now();
    const [vector] = await embedQuery([query]);
    const embedMs = Date.now() - embedStarted;
    const pool = Array.isArray(filtered)
      ? filtered.map((record) => ({ id: record.id, vector: byId.get(record.id) })).filter((row) => row.vector)
      : rows;
    const top = rankByCosine(vector, pool, limit);
    return {
      ok: true,
      orderedIds: top.map((item) => item.id),
      cosines: new Map(top.map((item) => [item.id, item.cosine])),
      searchMs: Date.now() - started,
      embedMs,
    };
  };
}
