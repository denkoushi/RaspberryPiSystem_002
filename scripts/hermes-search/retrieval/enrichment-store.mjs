// Private runtime store. Writes are atomic and logs stay free of record text.
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { STORE_SCHEMA } from './enrichment-contract.mjs';

export const DEFAULT_STORE_PATH = '/app/storage/hermes-search/runtime/retrieval-enrichment.jsonl';
export const DEFAULT_STATUS_PATH = '/app/storage/hermes-search/runtime/retrieval-enrichment-status.json';

export function storePathFromEnv(env = process.env) {
  return env.HERMES_RETRIEVAL_ENRICHMENT_STORE || DEFAULT_STORE_PATH;
}

export function statusPathFromEnv(env = process.env) {
  return env.HERMES_RETRIEVAL_ENRICHMENT_STATUS || DEFAULT_STATUS_PATH;
}

export async function readEnrichmentStore(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return new Map();
    throw error;
  }
  const byId = new Map();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row?.schema !== STORE_SCHEMA || typeof row.recordId !== 'string' || !row.recordId) continue;
    byId.set(row.recordId, row);
  }
  return byId;
}

export async function writeEnrichmentStore(filePath, byId) {
  const lines = [...byId.values()].map((row) => JSON.stringify(row));
  const body = lines.length ? `${lines.join('\n')}\n` : '';
  await writeAtomic(filePath, body);
}

// Content failures per record, so a record the model cannot answer does not block the rest.
export function failuresPathFor(storePath) {
  return `${storePath.replace(/\.jsonl$/u, '')}-failures.json`;
}

export async function readEnrichmentFailures(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return new Map();
    throw error;
  }
  const byId = new Map();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return byId;
  }
  for (const row of Array.isArray(payload?.records) ? payload.records : []) {
    if (typeof row?.recordId !== 'string' || !row.recordId || !Number.isInteger(row.attempts)) continue;
    byId.set(row.recordId, row);
  }
  return byId;
}

export async function writeEnrichmentFailures(filePath, byId) {
  await writeAtomic(filePath, `${JSON.stringify({ records: [...byId.values()] })}\n`);
}

export async function writeStatus(filePath, status) {
  await writeAtomic(filePath, `${JSON.stringify(status)}\n`);
}

export async function writeAtomic(filePath, body) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'w', 0o600);
  try {
    await handle.writeFile(body, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
  await handle.close();
  try {
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
