import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadNonconformityCatalog, fieldsWithRole } from './catalog.mjs';
import { execute } from './executor.mjs';
import { QUERY_PLAN_SCHEMA } from './query-plan.mjs';
import { createRetrievalAnswering, noteDenseFallback } from './worker.mjs';
import {
  DGX_EMBED_BATCH,
  DGX_EMBED_DIM,
  denseDocumentText,
  denseQueryText,
  denseSettings,
  createDgxEmbedder,
  refreshDenseIndex,
  createDenseQueryRanker,
  readDenseStore,
} from './dense-dgx.mjs';

const catalog = loadNonconformityCatalog();
const bodyFields = fieldsWithRole(catalog, 'body');

function vector(seed) {
  const values = new Float32Array(DGX_EMBED_DIM);
  values[0] = seed;
  values[1] = 1;
  return values;
}

function fakeServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('dgx settings stay off unless the provider is dgx and the index flag is separate', () => {
  assert.equal(denseSettings({}).queryEnabled, false);
  assert.equal(denseSettings({}).indexEnabled, false);
  assert.equal(denseSettings({ HERMES_RETRIEVAL_DENSE_PROVIDER: 'off' }).queryEnabled, false);
  assert.equal(denseSettings({
    HERMES_RETRIEVAL_DENSE_PROVIDER: 'dgx',
    HERMES_RETRIEVAL_DENSE_INDEX_ENABLED: 'true',
  }).queryEnabled, true);
  assert.equal(denseSettings({ HERMES_RETRIEVAL_DENSE_INDEX_ENABLED: 'true' }).indexEnabled, true);
  assert.equal(denseSettings({ HERMES_RETRIEVAL_DENSE_INDEX_ENABLED: 'true' }).queryEnabled, false);
  assert.match(denseQueryText('qxprobe'), /^Instruct: .+\nQuery: qxprobe$/u);
  assert.equal(denseQueryText('qxprobe').includes('passage:'), false);
});

test('document embedding batches at most 8 inputs and does not prefix documents', async () => {
  const seen = [];
  const server = await fakeServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      seen.push(body.input);
      const data = body.input.map((text, index) => ({
        index,
        embedding: Array.from(vector(index + 1)),
      }));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data }));
    });
  });
  const embedder = createDgxEmbedder({ baseUrl: `http://127.0.0.1:${server.address().port}` });
  const texts = Array.from({ length: DGX_EMBED_BATCH + 1 }, (_, index) => `doc-${index}`);
  const vectors = await embedder.embed(texts, { role: 'document' });
  server.close();
  assert.equal(seen.length, 2);
  assert.equal(seen[0].length, DGX_EMBED_BATCH);
  assert.equal(seen[1].length, 1);
  assert.deepEqual(seen[0], texts.slice(0, DGX_EMBED_BATCH));
  assert.equal(seen[0].some((text) => text.startsWith('Instruct:')), false);
  assert.equal(vectors.length, texts.length);
  assert.equal(vectors[0].length, DGX_EMBED_DIM);
});

test('query embedding uses the instruction prefix only', async () => {
  let input;
  const server = await fakeServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      input = JSON.parse(Buffer.concat(chunks).toString()).input;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [{ index: 0, embedding: Array.from(vector(3)) }] }));
    });
  });
  const embedder = createDgxEmbedder({ baseUrl: `http://127.0.0.1:${server.address().port}`, timeoutMs: 800 });
  await embedder.embed(['qxprobe'], { role: 'query' });
  server.close();
  assert.deepEqual(input, [denseQueryText('qxprobe')]);
});

test('index refresh skips an unchanged text hash and resumes after a partial write', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dense-dgx-'));
  const storePath = path.join(directory, 'retrieval-dense-dgx.bin');
  const records = [
    { id: 'a', condition: 'alpha note' },
    { id: 'b', condition: 'beta note' },
    { id: 'c', condition: 'gamma note' },
  ];
  let calls = 0;
  const embed = async (texts) => {
    calls += 1;
    if (calls === 1) throw new Error('batch failed');
    return texts.map((_, index) => vector(index + 1));
  };
  const first = await refreshDenseIndex({
    records: records.slice(0, 2),
    bodyFields,
    storePath,
    embed,
  });
  assert.equal(first.failed, 2);
  assert.equal(first.embedded, 0);
  const second = await refreshDenseIndex({ records, bodyFields, storePath, embed });
  assert.equal(second.embedded, 3);
  const stored = await readDenseStore(storePath);
  assert.deepEqual(stored.map((entry) => entry.id).sort(), ['a', 'b', 'c']);
  const before = await readFile(storePath);
  const third = await refreshDenseIndex({ records, bodyFields, storePath, embed });
  assert.equal(third.skipped, 3);
  assert.equal(third.embedded, 0);
  assert.deepEqual(await readFile(storePath), before);
  const changed = { ...records[0], condition: 'alpha note changed' };
  const fourth = await refreshDenseIndex({
    records: [changed, records[1], records[2]],
    bodyFields,
    storePath,
    embed,
  });
  assert.equal(fourth.embedded, 1);
  assert.equal(fourth.skipped, 2);
  assert.equal(denseDocumentText(changed, bodyFields).includes('changed'), true);
});

test('a query timeout falls back to lexical and hybrid fusion still ranks a dense hit', async () => {
  const records = [
    { id: 'lexical-hit', condition: 'qxrare marker qxrare marker', discoveredOn: '2024-01-01', originDepartmentName: 'North Shop' },
    { id: 'dense-hit', condition: 'unrelated beta', discoveredOn: '2024-01-02', originDepartmentName: 'North Shop' },
  ];
  const entries = [
    { id: 'dense-hit', hash: Buffer.alloc(32), vector: vector(9) },
    { id: 'lexical-hit', hash: Buffer.alloc(32), vector: vector(0.1) },
  ];
  const hanging = createDenseQueryRanker(() => entries, () => new Promise(() => {}));
  const timed = await execute({
    schema: QUERY_PLAN_SCHEMA,
    sources: ['nonconformity'],
    filters: [],
    semanticQuery: 'qxrare marker',
    sort: 'relevance',
    limit: 2,
    display: ['condition'],
    unresolved: [],
  }, {
    records,
    catalog,
    retriever: 'hybrid',
    vectorBudgetMs: 30,
    vector: hanging,
  });
  assert.equal(timed.timings.vectorStatus, 'timeout');
  assert.equal(timed.results[0].recordId, 'lexical-hit');

  const fused = await execute({
    schema: QUERY_PLAN_SCHEMA,
    sources: ['nonconformity'],
    filters: [],
    semanticQuery: 'qxrare marker',
    sort: 'relevance',
    limit: 2,
    display: ['condition'],
    unresolved: [],
  }, {
    records,
    catalog,
    retriever: 'hybrid',
    vector: createDenseQueryRanker(() => entries, async () => [vector(9)]),
  });
  assert.equal(fused.timings.vectorStatus, 'ok');
  assert.equal(fused.results.some((result) => result.recordId === 'dense-hit'), true);

  const logs = [];
  const original = console.info;
  console.info = (line) => logs.push(line);
  noteDenseFallback('timeout');
  console.info = original;
  assert.match(logs[0], /dense fallback count=1 status=timeout/u);

  const answering = createRetrievalAnswering({
    records,
    catalog,
    valueIndex: null,
    dense: {
      queryEnabled: true,
      rank: async () => ({ ok: false, reason: 'missing vectors' }),
    },
    evaluate: async () => ({ plan: null }),
  });
  assert.equal(typeof answering.answer, 'function');
});
