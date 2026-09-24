// Local CLI for the same enrichment runner. Business text stays in the private store.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACET_KEYS, toRetrievalEnrichment } from './enrichment-contract.mjs';
import { enrichmentSettings } from './enrichment-dgx.mjs';
import { runEnrichmentBatch } from './enrichment-runner.mjs';
import { readEnrichmentStore } from './enrichment-store.mjs';
import { percentile } from './evaluate.mjs';

export function evenIndexes(length, count) {
  const total = Math.max(0, length | 0);
  const wanted = Math.max(0, count | 0);
  const size = Math.min(wanted, total);
  const indexes = [];
  for (let offset = 0; offset < size; offset += 1) {
    indexes.push(Math.floor((offset * total) / size));
  }
  return indexes;
}

export function structuralSample(row) {
  const attached = toRetrievalEnrichment(row);
  return {
    summaryChars: Array.from(attached.summary).length,
    queryCount: attached.queries.length,
    queryChars: attached.queries.map((query) => Array.from(query).length),
    facetCounts: Object.fromEntries(FACET_KEYS.map((key) => [key, (row?.facets?.[key] ?? []).length])),
    tagCount: attached.tags.length,
  };
}

function originFromBaseUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new Error('base URL must be http://127.0.0.1:<port>/v1');
  }
  const pathName = url.pathname.replace(/\/$/u, '');
  if (pathName !== '/v1') throw new Error('base URL must end in /v1');
  return url.origin;
}

export function parseEnrichmentArgs(argv) {
  const parsed = {
    snapshot: null,
    baseUrl: null,
    model: null,
    maxRecords: 100,
    concurrency: 1,
    out: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--snapshot') parsed.snapshot = argv[++index];
    else if (arg === '--base-url') parsed.baseUrl = argv[++index];
    else if (arg === '--model') parsed.model = argv[++index];
    else if (arg === '--max-records') parsed.maxRecords = Number(argv[++index]);
    else if (arg === '--concurrency') parsed.concurrency = Number(argv[++index]);
    else if (arg === '--out') parsed.out = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!parsed.snapshot || !parsed.baseUrl || !parsed.model || !parsed.out) {
    throw new Error('Usage: node retrieval/enrichment-cli.mjs --snapshot <file> --base-url http://127.0.0.1:<port>/v1 --model <id> --max-records N --concurrency 1 --out <jsonl>');
  }
  if (!Number.isInteger(parsed.maxRecords) || parsed.maxRecords < 1) throw new Error('max-records must be a positive integer');
  if (parsed.concurrency !== 1 && parsed.concurrency !== 2) throw new Error('concurrency must be 1 or 2');
  if (!path.isAbsolute(parsed.out)) throw new Error('output path must be absolute');
  return parsed;
}

export function localSettings({ baseUrl, model, maxRecords, concurrency }) {
  return enrichmentSettings({
    HERMES_RETRIEVAL_ENRICHMENT_ENABLED: 'true',
    HERMES_RETRIEVAL_ENRICHMENT_MAX_RECORDS: String(maxRecords),
    HERMES_RETRIEVAL_ENRICHMENT_CONCURRENCY: String(concurrency),
    HERMES_RETRIEVAL_ENRICHMENT_TIMEOUT_MS: '55000',
    HERMES_INFERENCE_ORIGIN: originFromBaseUrl(baseUrl),
    HERMES_INFERENCE_TOKEN: 'local',
    HERMES_RETRIEVAL_ENRICHMENT_MODEL: model,
    HERMES_RETRIEVAL_ENRICHMENT_PROFILE: model,
  });
}

export function pilotSummary(status, rows, corpusCount) {
  const kept = rows.reduce((sum, row) => sum + (row.metrics?.evidenceKept ?? 0), 0);
  const dropped = rows.reduce((sum, row) => sum + (row.metrics?.evidenceDropped ?? 0), 0);
  const queries = rows.reduce((sum, row) => sum + (row.queries?.length ?? 0), 0);
  return {
    corpusCount,
    selected: status.examined + status.skipped,
    succeeded: status.succeeded,
    failed: status.failed,
    parseFailures: status.parseFailures,
    evidenceKept: kept,
    evidenceDropped: dropped,
    evidenceDropRate: kept + dropped ? dropped / (kept + dropped) : 0,
    avgQueries: rows.length ? queries / rows.length : 0,
    latencyMs: {
      p50: percentile(status.latenciesMs, 0.5),
      p95: percentile(status.latenciesMs, 0.95),
    },
    estimatedFullCorpusMs: status.succeeded
      ? Math.round((status.latencyMsTotal / status.examined) * corpusCount / status.concurrency)
      : null,
    model: rows[0]?.model ?? null,
    profile: rows[0]?.profile ?? null,
    samples: rows.slice(0, 3).map(structuralSample),
  };
}

export async function runLocalEnrichment(args) {
  const payload = JSON.parse(await readFile(args.snapshot, 'utf8'));
  if (!Array.isArray(payload?.records)) throw new Error('snapshot records must be an array');
  const indexes = evenIndexes(payload.records.length, args.maxRecords);
  const records = indexes.map((index) => payload.records[index]);
  const statusPath = `${args.out}.status.json`;
  const status = await runEnrichmentBatch({
    records,
    storePath: args.out,
    statusPath,
    settings: localSettings(args),
  });
  const stored = await readEnrichmentStore(args.out);
  const rows = [...stored.values()];
  return pilotSummary(status, rows, payload.records.length);
}

async function main() {
  const args = parseEnrichmentArgs(process.argv.slice(2));
  const summary = await runLocalEnrichment(args);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error?.message ?? error).slice(0, 300));
    process.exitCode = 1;
  });
}
