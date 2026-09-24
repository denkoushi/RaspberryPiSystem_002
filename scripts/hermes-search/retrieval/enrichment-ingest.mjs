// Validate offline enrichment JSON and append it to the private store. Counts only.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNonconformityCatalog } from './catalog.mjs';
import {
  STORE_SCHEMA,
  parseEnrichmentPayload,
  recordText,
  sha256Text,
  sourceRecordHash,
  verifyEvidence,
} from './enrichment-contract.mjs';
import { readEnrichmentStore, writeEnrichmentStore } from './enrichment-store.mjs';

export const OFFLINE_MODEL = 'grok-4.7-high-fast (offline experiment)';

export function parseIngestArgs(argv) {
  const parsed = { input: null, snapshot: null, store: null, out: null, instructions: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--in') parsed.input = argv[++index];
    else if (arg === '--snapshot') parsed.snapshot = argv[++index];
    else if (arg === '--store') parsed.store = argv[++index];
    else if (arg === '--out') parsed.out = argv[++index];
    else if (arg === '--instructions') parsed.instructions = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  parsed.store = parsed.out || parsed.store;
  if (!parsed.input || !parsed.snapshot || !parsed.store || !parsed.instructions) {
    throw new Error('Usage: node retrieval/enrichment-ingest.mjs --in <batch.json> --snapshot <snap> --out <jsonl> --instructions <md>');
  }
  for (const file of [parsed.store, parsed.instructions]) {
    if (!path.isAbsolute(file)) throw new Error('store and instructions paths must be absolute');
  }
  return parsed;
}

export async function ingestEnrichment({
  inputPath,
  snapshotPath,
  storePath,
  instructionsPath,
  catalog = loadNonconformityCatalog(),
  model = OFFLINE_MODEL,
}) {
  const [incoming, snapshot, instructions] = await Promise.all([
    readFile(inputPath, 'utf8').then((raw) => JSON.parse(raw)),
    readFile(snapshotPath, 'utf8').then((raw) => JSON.parse(raw)),
    readFile(instructionsPath, 'utf8'),
  ]);
  if (!Array.isArray(incoming?.records)) throw new Error('input records must be an array');
  if (!Array.isArray(snapshot?.records)) throw new Error('snapshot records must be an array');
  const bySnapshotId = new Map(snapshot.records.map((record) => [record?.id, record]));
  const promptSha = sha256Text(instructions);
  const byId = await readEnrichmentStore(storePath);
  const counts = { examined: 0, kept: 0, evidenceDropped: 0, aliasesDropped: 0, aliasesKept: 0, invalid: 0 };
  for (const item of incoming.records) {
    counts.examined += 1;
    const source = bySnapshotId.get(item?.id);
    if (!source) {
      counts.invalid += 1;
      continue;
    }
    let verified;
    try {
      verified = verifyEvidence(parseEnrichmentPayload(item), recordText(source, catalog), source.id);
    } catch {
      counts.invalid += 1;
      continue;
    }
    counts.evidenceDropped += verified.evidenceDropped;
    counts.aliasesDropped += verified.aliasesDropped;
    counts.aliasesKept += verified.aliasesKept;
    counts.kept += 1;
    byId.set(source.id, {
      schema: STORE_SCHEMA,
      recordId: source.id,
      sourceId: catalog.id ?? 'nonconformity',
      enrichmentSchemaVersion: verified.enrichmentSchemaVersion,
      promptSha256: promptSha,
      model,
      profile: model,
      createdAt: new Date().toISOString(),
      sourceRecordHash: sourceRecordHash(source, catalog),
      summary: verified.summary,
      queries: verified.queries,
      facets: verified.facets,
      aliases: verified.aliases,
      metrics: {
        latencyMs: null,
        evidenceDropped: verified.evidenceDropped,
        evidenceKept: verified.evidenceKept,
        aliasesDropped: verified.aliasesDropped,
        aliasesKept: verified.aliasesKept,
        promptTokens: null,
        completionTokens: null,
      },
    });
  }
  await writeEnrichmentStore(storePath, byId);
  return counts;
}

async function main() {
  const args = parseIngestArgs(process.argv.slice(2));
  const counts = await ingestEnrichment({
    inputPath: args.input,
    snapshotPath: args.snapshot,
    storePath: args.store,
    instructionsPath: args.instructions,
  });
  process.stdout.write(`${JSON.stringify(counts)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error?.message ?? error).slice(0, 300));
    process.exitCode = 1;
  });
}
