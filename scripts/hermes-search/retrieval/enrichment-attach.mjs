// Attach an offline enrichment store at evaluation time. Query time does not call DGX.
import { readFileSync } from 'node:fs';

export const STORE_SCHEMA = 'hermes-retrieval-enrichment/v1';
const FACET_KEYS = Object.freeze(['phenomenon', 'cause', 'process', 'part', 'treatment']);

export function toRetrievalEnrichment(stored) {
  const tags = [];
  for (const key of FACET_KEYS) {
    for (const item of stored?.facets?.[key] ?? []) {
      if (typeof item?.value === 'string' && item.value) tags.push(item.value);
    }
  }
  for (const alias of stored?.aliases ?? []) {
    if (typeof alias?.term === 'string' && alias.term) tags.push(alias.term);
    for (const alt of alias?.alts ?? []) {
      if (typeof alt === 'string' && alt) tags.push(alt);
    }
  }
  return {
    summary: typeof stored?.summary === 'string' ? stored.summary : '',
    queries: Array.isArray(stored?.queries) ? stored.queries.filter((query) => typeof query === 'string') : [],
    tags,
  };
}

export function attachEnrichment(records, byId) {
  if (!byId || byId.size === 0) return records;
  return records.map((record) => {
    const stored = byId.get(record?.id);
    if (!stored) return record;
    return { ...record, enrichment: toRetrievalEnrichment(stored) };
  });
}

export function readEnrichmentStore(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const byId = new Map();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row?.schema !== STORE_SCHEMA || typeof row.recordId !== 'string' || !row.recordId) continue;
    byId.set(row.recordId, row);
  }
  return byId;
}

export function readEnrichmentStores(filePaths) {
  const byId = new Map();
  for (const filePath of filePaths ?? []) {
    for (const [recordId, row] of readEnrichmentStore(filePath)) byId.set(recordId, row);
  }
  return byId;
}

export function splitEnrichmentArg(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('enrichment path is required');
  const paths = value.split(',').map((item) => item.trim()).filter(Boolean);
  if (!paths.length) throw new Error('enrichment path is required');
  return paths;
}
