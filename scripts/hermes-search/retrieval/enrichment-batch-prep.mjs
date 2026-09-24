// Write a private batch of catalog text for offline enrichment. No logging of record text.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fieldsWithRole, loadNonconformityCatalog } from './catalog.mjs';
import { evenIndexes } from './enrichment-cli.mjs';

const EXTRA_KEYS = ['partName', 'machineName'];

export function prepFieldKeys(catalog = loadNonconformityCatalog()) {
  const keys = [...fieldsWithRole(catalog, 'body')];
  for (const key of EXTRA_KEYS) {
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

export function slimRecord(record, keys) {
  const slim = { id: record.id };
  for (const key of keys) {
    const value = record?.[key];
    slim[key] = typeof value === 'string' ? value : '';
  }
  return slim;
}

export function parsePrepArgs(argv) {
  const parsed = { snapshot: null, start: null, count: null, indexes: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--snapshot') parsed.snapshot = argv[++index];
    else if (arg === '--start') parsed.start = Number(argv[++index]);
    else if (arg === '--count') parsed.count = Number(argv[++index]);
    else if (arg === '--indexes') parsed.indexes = argv[++index].split(',').map((item) => Number(item));
    else if (arg === '--out') parsed.out = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!parsed.snapshot || !parsed.out) throw new Error('snapshot and out are required');
  if (!path.isAbsolute(parsed.out)) throw new Error('output path must be absolute');
  const hasRange = Number.isInteger(parsed.start) && Number.isInteger(parsed.count);
  const hasIndexes = Array.isArray(parsed.indexes);
  if (hasRange === hasIndexes) throw new Error('Use --start and --count, or --indexes');
  if (hasRange && (parsed.start < 0 || parsed.count < 1)) throw new Error('start and count must select a range');
  if (hasIndexes && parsed.indexes.some((item) => !Number.isInteger(item) || item < 0)) {
    throw new Error('indexes must be non-negative integers');
  }
  return parsed;
}

export async function writePrepBatch({ snapshotPath, indexes, outPath, catalog = loadNonconformityCatalog() }) {
  const payload = JSON.parse(await readFile(snapshotPath, 'utf8'));
  if (!Array.isArray(payload?.records)) throw new Error('snapshot records must be an array');
  const keys = prepFieldKeys(catalog);
  const records = [];
  for (const index of indexes) {
    const record = payload.records[index];
    if (!record || typeof record.id !== 'string' || !record.id) throw new Error(`missing record at index ${index}`);
    records.push(slimRecord(record, keys));
  }
  await mkdir(path.dirname(outPath), { recursive: true, mode: 0o700 });
  await writeFile(outPath, `${JSON.stringify({ indexes, records })}\n`, { encoding: 'utf8', mode: 0o600 });
  return { records: records.length };
}

export function evenBatchIndexes(length, sampleSize, batchIndex, batchSize) {
  const all = evenIndexes(length, sampleSize);
  const start = batchIndex * batchSize;
  return all.slice(start, start + batchSize);
}

async function main() {
  const args = parsePrepArgs(process.argv.slice(2));
  const payload = JSON.parse(await readFile(args.snapshot, 'utf8'));
  const length = Array.isArray(payload?.records) ? payload.records.length : 0;
  const indexes = args.indexes ?? Array.from({ length: args.count }, (_, offset) => args.start + offset);
  if (indexes.some((index) => index >= length)) throw new Error('index is outside the snapshot');
  const result = await writePrepBatch({ snapshotPath: args.snapshot, indexes, outPath: args.out });
  process.stdout.write(`${JSON.stringify({ records: result.records })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error?.message ?? error).slice(0, 300));
    process.exitCode = 1;
  });
}
