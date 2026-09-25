// DGX dense vectors for retrieval v2. Default off.
// Query prefix (Qwen3-Embedding; the proxy adds nothing):
//   Instruct: Given a user question, retrieve relevant passages that answer the question
//   Query: {question}
// Documents are embedded with no prefix. The same recordPassage text used for
// lexical search (body fields plus enrichment summary/queries/tags) is hashed.

import { createHash } from 'node:crypto';
import { rename, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { throughEgress } from '../hermes-remote-inference.mjs';
import { recordPassage } from './executor.mjs';
import { rankByCosine } from './dense-index.mjs';
import { DEFAULT_EMBED_BUDGET_MS } from './query-embedding.mjs';

export const DGX_EMBED_MODEL = 'Qwen/Qwen3-Embedding-0.6B';
export const DGX_EMBED_DIM = 1024;
export const DGX_EMBED_BATCH = 8;
export const DGX_QUERY_TASK = 'Given a user question, retrieve relevant passages that answer the question';
export const DGX_QUERY_TIMEOUT_MS = DEFAULT_EMBED_BUDGET_MS;
export const DGX_INDEX_TIMEOUT_MS = 10_000;
export const DGX_MAX_INPUT_CHARS = 1800;
export const DEFAULT_DENSE_STORE = '/app/storage/hermes-search/runtime/retrieval-dense-dgx.bin';
const MAGIC = Buffer.from('HDG1');
const VERSION = 1;

export function denseQueryText(query) {
  return `Instruct: ${DGX_QUERY_TASK}\nQuery: ${query}`;
}

export function denseDocumentText(record, bodyFields) {
  return recordPassage(record, bodyFields).slice(0, DGX_MAX_INPUT_CHARS);
}

export function denseTextHash(text) {
  return createHash('sha256').update(text).digest();
}

export function denseSettings(env = process.env) {
  const provider = env.HERMES_RETRIEVAL_DENSE_PROVIDER || 'off';
  return {
    provider: provider === 'dgx' ? 'dgx' : 'off',
    queryEnabled: provider === 'dgx',
    indexEnabled: env.HERMES_RETRIEVAL_DENSE_INDEX_ENABLED === 'true',
    origin: env.HERMES_RETRIEVAL_DENSE_BASE_URL || env.HERMES_INFERENCE_ORIGIN || '',
    token: env.HERMES_INFERENCE_TOKEN || '',
    egress: env.HERMES_RETRIEVAL_DENSE_BASE_URL ? '' : (env.HERMES_INFERENCE_EGRESS || ''),
    storePath: env.HERMES_RETRIEVAL_DENSE_STORE || DEFAULT_DENSE_STORE,
  };
}

export function createDgxEmbedder({
  baseUrl,
  token = '',
  egress = '',
  fetchImpl,
  timeoutMs = DGX_INDEX_TIMEOUT_MS,
} = {}) {
  if (!baseUrl) throw new Error('dgx embedding origin is not configured');
  const fetchFn = fetchImpl ?? (egress ? throughEgress(egress) : fetch);
  return {
    modelId: DGX_EMBED_MODEL,
    async embed(texts, extra = {}) {
      const query = extra.role === 'query' || extra.query === true;
      const inputs = texts.map((text) => (query ? denseQueryText(text) : String(text ?? '').slice(0, DGX_MAX_INPUT_CHARS)));
      const vectors = [];
      for (let offset = 0; offset < inputs.length; offset += DGX_EMBED_BATCH) {
        const batch = inputs.slice(offset, offset + DGX_EMBED_BATCH);
        vectors.push(...await postEmbeddings(fetchFn, baseUrl, token, batch, timeoutMs));
      }
      return vectors;
    },
  };
}

async function postEmbeddings(fetchFn, baseUrl, token, inputs, timeoutMs) {
  if (inputs.length < 1 || inputs.length > DGX_EMBED_BATCH) throw new Error('embedding batch size');
  const headers = { 'content-type': 'application/json' };
  if (token) {
    headers.authorization = `Bearer ${token}`;
    headers['x-llm-token'] = token;
  }
  let response;
  try {
    response = await fetchFn(`${String(baseUrl).replace(/\/$/u, '')}/v1/embeddings`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers,
      body: JSON.stringify({ model: DGX_EMBED_MODEL, input: inputs }),
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw Object.assign(new Error(timedOut ? 'query embedding timed out' : 'embedding transport failed'), {
      code: timedOut ? 'timeout' : 'failed',
    });
  }
  if (!response.ok) {
    await response.text().catch(() => '');
    throw Object.assign(new Error('embedding http failed'), { code: 'failed' });
  }
  let payload;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw Object.assign(new Error('embedding payload failed'), { code: 'failed' });
  }
  const rows = Array.isArray(payload?.data) ? payload.data : null;
  if (!rows || rows.length !== inputs.length) {
    throw Object.assign(new Error('embedding count mismatch'), { code: 'failed' });
  }
  const vectors = new Array(inputs.length);
  for (const row of rows) {
    const index = Number(row?.index);
    const embedding = row?.embedding;
    if (!Number.isInteger(index) || index < 0 || index >= inputs.length || !Array.isArray(embedding) || embedding.length !== DGX_EMBED_DIM) {
      throw Object.assign(new Error('embedding shape mismatch'), { code: 'failed' });
    }
    vectors[index] = Float32Array.from(embedding);
  }
  if (vectors.some((vector) => !vector)) throw Object.assign(new Error('embedding shape mismatch'), { code: 'failed' });
  return vectors;
}

export function encodeDenseStore(entries) {
  const parts = [Buffer.alloc(16)];
  parts[0].write(MAGIC.toString('latin1'), 0, 4, 'latin1');
  parts[0].writeUInt32LE(VERSION, 4);
  parts[0].writeUInt32LE(DGX_EMBED_DIM, 8);
  parts[0].writeUInt32LE(entries.length, 12);
  for (const entry of entries) {
    const id = Buffer.from(String(entry.id), 'utf8');
    if (id.length > 65535) throw new Error('dense record id is too long');
    const header = Buffer.alloc(2);
    header.writeUInt16LE(id.length, 0);
    const hash = Buffer.from(entry.hash);
    if (hash.length !== 32) throw new Error('dense text hash must be 32 bytes');
    const vector = Buffer.from(entry.vector.buffer, entry.vector.byteOffset, entry.vector.byteLength);
    if (vector.length !== DGX_EMBED_DIM * 4) throw new Error('dense vector width');
    parts.push(header, id, hash, vector);
  }
  return Buffer.concat(parts);
}

export function decodeDenseStore(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (bytes.length < 16 || !bytes.subarray(0, 4).equals(MAGIC)) return [];
  if (bytes.readUInt32LE(4) !== VERSION || bytes.readUInt32LE(8) !== DGX_EMBED_DIM) return [];
  const count = bytes.readUInt32LE(12);
  const entries = [];
  let offset = 16;
  for (let index = 0; index < count; index += 1) {
    if (offset + 2 > bytes.length) return [];
    const idLength = bytes.readUInt16LE(offset);
    offset += 2;
    const idEnd = offset + idLength;
    const hashEnd = idEnd + 32;
    const vectorEnd = hashEnd + DGX_EMBED_DIM * 4;
    if (vectorEnd > bytes.length) return [];
    const id = bytes.toString('utf8', offset, idEnd);
    const hash = Buffer.from(bytes.subarray(idEnd, hashEnd));
    const vector = new Float32Array(bytes.subarray(hashEnd, vectorEnd).buffer.slice(
      bytes.subarray(hashEnd, vectorEnd).byteOffset,
      bytes.subarray(hashEnd, vectorEnd).byteOffset + DGX_EMBED_DIM * 4,
    ));
    entries.push({ id, hash, vector });
    offset = vectorEnd;
  }
  return offset === bytes.length ? entries : [];
}

export async function readDenseStore(storePath) {
  try {
    return decodeDenseStore(await readFile(storePath));
  } catch {
    return [];
  }
}

export async function writeDenseStore(storePath, entries) {
  const directory = path.dirname(storePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${storePath}.${process.pid}.tmp`;
  await writeFile(temporary, encodeDenseStore(entries), { mode: 0o600 });
  await rename(temporary, storePath);
}

export async function refreshDenseIndex({
  records,
  bodyFields,
  storePath,
  embed,
  onProgress,
}) {
  const started = Date.now();
  const previous = await readDenseStore(storePath);
  const byId = new Map(previous.map((entry) => [entry.id, entry]));
  const done = [];
  const pending = [];
  let skipped = 0;
  for (const record of records) {
    const id = record?.id;
    if (typeof id !== 'string' || !id) continue;
    const text = denseDocumentText(record, bodyFields);
    if (!text) continue;
    const hash = denseTextHash(text);
    const cached = byId.get(id);
    if (cached && cached.hash.equals(hash)) {
      done.push(cached);
      skipped += 1;
      continue;
    }
    pending.push({ id, text, hash });
  }
  let embedded = 0;
  let failed = 0;
  if (pending.length) await writeDenseStore(storePath, done);
  for (let offset = 0; offset < pending.length; offset += DGX_EMBED_BATCH) {
    const batch = pending.slice(offset, offset + DGX_EMBED_BATCH);
    try {
      const vectors = await embed(batch.map((item) => item.text), { role: 'document' });
      if (!Array.isArray(vectors) || vectors.length !== batch.length) throw new Error('embedding count mismatch');
      batch.forEach((item, index) => {
        const vector = vectors[index] instanceof Float32Array ? vectors[index] : Float32Array.from(vectors[index]);
        done.push({ id: item.id, hash: item.hash, vector });
      });
      embedded += batch.length;
      await writeDenseStore(storePath, done);
    } catch {
      failed += batch.length;
    }
  }
  const finalEntries = done;
  if (!pending.length) await writeDenseStore(storePath, finalEntries);
  const timingMs = Date.now() - started;
  console.info(`hermes retrieval dense index embedded=${embedded} skipped=${skipped} failed=${failed} stored=${finalEntries.length} ms=${timingMs}`);
  if (onProgress) onProgress(finalEntries);
  return { embedded, skipped, failed, stored: finalEntries.length, ms: timingMs, entries: finalEntries };
}

export function createDenseQueryRanker(getEntries, embedQuery) {
  return async function rank(query, filtered) {
    const entries = getEntries();
    if (!entries.length) return { ok: false, status: 'missing', reason: 'dense vectors are missing' };
    const allowed = Array.isArray(filtered) ? new Set(filtered.map((record) => record.id)) : null;
    const pool = allowed ? entries.filter((entry) => allowed.has(entry.id)) : entries;
    if (!pool.length) return { ok: false, status: 'missing', reason: 'dense vectors are missing' };
    const [vector] = await embedQuery([query], { role: 'query' });
    const top = rankByCosine(vector, pool, 50);
    return {
      ok: true,
      status: 'ok',
      orderedIds: top.map((item) => item.id),
      cosines: new Map(top.map((item) => [item.id, item.cosine])),
    };
  };
}

export function createDenseRuntime({
  settings,
  embed,
  embedQuery,
} = {}) {
  let entries = [];
  let chain = Promise.resolve();
  return {
    get queryEnabled() {
      return settings.queryEnabled === true;
    },
    entries() {
      return entries;
    },
    async load() {
      entries = await readDenseStore(settings.storePath);
      return entries.length;
    },
    schedule(records, bodyFields) {
      if (!settings.indexEnabled || !Array.isArray(records) || records.length === 0) return;
      chain = chain.then(async () => {
        if (!settings.origin) {
          console.info('hermes retrieval dense index embedded=0 skipped=0 failed=1 stored=0 ms=0');
          return;
        }
        const result = await refreshDenseIndex({
          records,
          bodyFields,
          storePath: settings.storePath,
          embed: embed ?? createDgxEmbedder({
            baseUrl: settings.origin,
            token: settings.token,
            egress: settings.egress,
            timeoutMs: DGX_INDEX_TIMEOUT_MS,
          }).embed,
          onProgress: (stored) => {
            entries = stored;
          },
        });
        entries = result.entries;
      }).catch(() => {
        console.info('hermes retrieval dense index embedded=0 skipped=0 failed=1 stored=0 ms=0');
      });
    },
    rank(query, filtered) {
      const queryEmbed = embedQuery ?? createDgxEmbedder({
        baseUrl: settings.origin,
        token: settings.token,
        egress: settings.egress,
        timeoutMs: DGX_QUERY_TIMEOUT_MS,
      }).embed;
      return createDenseQueryRanker(() => entries, queryEmbed)(query, filtered);
    },
  };
}
