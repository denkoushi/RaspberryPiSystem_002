import { readFile } from 'node:fs/promises';
import { CAUSE_CATEGORY_IDS } from './cause-categories.mjs';
import { writeAtomic } from './enrichment-store.mjs';

export const CAUSE_STORE_SCHEMA = 'hermes-retrieval-cause/v1';
export const DEFAULT_CAUSE_STORE_PATH = '/app/storage/hermes-search/runtime/retrieval-cause.jsonl';
export const DEFAULT_CAUSE_STATUS_PATH = '/app/storage/hermes-search/runtime/retrieval-cause-status.json';
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
export const causeStorePathFromEnv = (env = process.env) => env.HERMES_RETRIEVAL_CAUSE_STORE || DEFAULT_CAUSE_STORE_PATH;
export const causeStatusPathFromEnv = (env = process.env) => env.HERMES_RETRIEVAL_CAUSE_STATUS || DEFAULT_CAUSE_STATUS_PATH;
export const causeFailuresPathFor = storePath => `${storePath.replace(/\.jsonl$/u, '')}-failures.json`;

async function readOptional(filePath) {
  try { return await readFile(filePath, 'utf8'); } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

export async function readCauseStore(filePath) {
  const byHash = new Map();
  for (const line of (await readOptional(filePath)).split('\n')) {
    try {
      const row = JSON.parse(line);
      if (row?.schema !== CAUSE_STORE_SCHEMA || !isHash(row.textSha256)
        || !CAUSE_CATEGORY_IDS.includes(row.categoryId) || !isHash(row.promptSha256)
        || typeof row.classifiedAt !== 'string') continue;
      byHash.set(row.textSha256, row);
    } catch { /* A malformed line must not hide the rest of the cache. */ }
  }
  return byHash;
}

export async function writeCauseStore(filePath, byHash) {
  const lines = [...byHash.values()].map(row => JSON.stringify(row));
  await writeAtomic(filePath, lines.length ? `${lines.join('\n')}\n` : '');
}

export async function writeCauseStatus(filePath, status) {
  await writeAtomic(filePath, `${JSON.stringify(status)}\n`);
}

export async function readCauseFailures(filePath) {
  const raw = await readOptional(filePath);
  let payload;
  try { payload = JSON.parse(raw); } catch { return new Map(); }
  return new Map((Array.isArray(payload?.records) ? payload.records : [])
    .filter(row => isHash(row?.textSha256) && Number.isInteger(row.attempts) && row.attempts >= 0 && typeof row.lastAt === 'string')
    .map(row => [row.textSha256, row]));
}

export async function writeCauseFailures(filePath, failures) {
  await writeAtomic(filePath, `${JSON.stringify({ records: [...failures.values()] })}\n`);
}
