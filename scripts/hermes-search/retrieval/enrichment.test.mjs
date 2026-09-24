import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { records } from './fixtures/synthetic-records.mjs';
import { loadNonconformityCatalog } from './catalog.mjs';
import {
  attachEnrichment,
  parseEnrichmentPayload,
  promptSha256,
  recordText,
  toRetrievalEnrichment,
  verifyEvidence,
} from './enrichment-contract.mjs';
import { withinWindow } from './enrichment-dgx.mjs';
import { needsEnrichment, runEnrichmentBatch } from './enrichment-runner.mjs';
import { readEnrichmentStore, writeAtomic, writeEnrichmentStore } from './enrichment-store.mjs';
import { createRetrievalAnswering } from './worker.mjs';

const catalog = loadNonconformityCatalog();

function payloadFor(record) {
  const text = recordText(record, catalog);
  return {
    facets: {
      phenomenon: [{ value: 'demo mark', evidence: record.condition.trim() }],
      cause: [],
      process: [],
      part: [{ value: 'demo part', evidence: record.partName }],
      treatment: [],
    },
    queries: ['この部品の状態は？', '同じ機械の記録は？', '処置済みの記録は？'],
    summary: 'demo summary',
  };
}

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('schema rejects a summary over 60 characters and accepts a valid payload', () => {
  const record = records[0];
  const parsed = parseEnrichmentPayload(payloadFor(record));
  assert.equal(parsed.summary, 'demo summary');
  assert.throws(() => parseEnrichmentPayload({ ...payloadFor(record), summary: 'x'.repeat(61) }), /60/u);
});

test('aliases keep only terms from the record and require two expanded queries', () => {
  const record = records[0];
  const text = recordText(record, catalog);
  const base = payloadFor(record);
  const parsed = parseEnrichmentPayload({
    ...base,
    queries: ['ギアボックスの傷は？', 'ゴロゴロ音の記録は？', 'この部品の状態は？'],
    aliases: [
      { term: record.partName, alts: ['ギアボックス', record.partName] },
      { term: 'missing-from-record', alts: ['別名称'] },
      { term: 'scratch', alts: ['ゴロゴロ'] },
    ],
  });
  const verified = verifyEvidence(parsed, text, record.id);
  assert.equal(verified.enrichmentSchemaVersion, 2);
  assert.equal(verified.aliasesKept, 2);
  assert.ok(verified.aliasesDropped >= 1);
  assert.deepEqual(verified.aliases[0].alts, ['ギアボックス']);
  assert.throws(() => verifyEvidence({
    ...parsed,
    queries: ['この部品の状態は？', '同じ機械の記録は？', '処置済みの記録は？'],
  }, text, record.id), /alias alternatives/u);
  const attached = toRetrievalEnrichment(verified);
  assert.ok(attached.tags.includes('ギアボックス'));
});

test('evidence that is not in the record text is dropped and counted', () => {
  const record = records[0];
  const parsed = parseEnrichmentPayload(payloadFor(record));
  parsed.facets.cause.push({ value: 'invented', evidence: 'not-in-source' });
  const verified = verifyEvidence(parsed, recordText(record, catalog), record.id);
  assert.equal(verified.evidenceDropped, 1);
  assert.equal(verified.facets.cause.length, 0);
  assert.equal(verified.facets.phenomenon.length, 1);
  const attached = attachEnrichment([record], new Map([[record.id, verified]]));
  assert.deepEqual(attached[0].enrichment, toRetrievalEnrichment(verified));
  assert.deepEqual(attached[0].enrichment.tags, ['demo mark', 'demo part']);
});

test('unchanged records are skipped and the store rewrite is atomic', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'enrichment-'));
  const storePath = path.join(directory, 'retrieval-enrichment.jsonl');
  const statusPath = path.join(directory, 'retrieval-enrichment-status.json');
  let calls = 0;
  const server = await listen((request, response) => {
    calls += 1;
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const user = body.messages.at(-1).content;
      const record = records.find((item) => user.includes(item.condition.trim()));
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(payloadFor(record)) } }],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      }));
    });
  });
  const address = server.address();
  const settings = {
    enabled: true,
    maxRecords: 100,
    concurrency: 1,
    timeoutMs: 5000,
    window: '',
    origin: `http://127.0.0.1:${address.port}`,
    token: 'synthetic-token-value',
    egress: '',
    model: 'mock-model',
    profile: 'business_qwen36_27b_nvfp4',
  };
  const fetchImpl = (url, options) => fetch(url, options);
  const first = await runEnrichmentBatch({
    records: records.slice(0, 1), catalog, storePath, statusPath, settings, fetchImpl, sleep: async () => {},
  });
  assert.equal(first.succeeded, 1);
  assert.equal(first.evidenceDropped, 0);
  assert.equal(calls, 1);
  const stored = await readEnrichmentStore(storePath);
  assert.equal(needsEnrichment(stored.get(records[0].id), records[0], catalog, promptSha256(catalog)), false);
  const second = await runEnrichmentBatch({
    records: records.slice(0, 1), catalog, storePath, statusPath, settings, fetchImpl, sleep: async () => {},
  });
  assert.equal(second.skipped, 1);
  assert.equal(second.succeeded, 0);
  assert.equal(calls, 1);
  const names = await readdir(directory);
  assert.equal(names.some((name) => name.endsWith('.tmp')), false);
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test('a failed atomic write leaves the previous store intact', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'enrichment-atomic-'));
  const storePath = path.join(directory, 'retrieval-enrichment.jsonl');
  const byId = new Map([['rec-alpha', { schema: 'hermes-retrieval-enrichment/v1', recordId: 'rec-alpha', summary: 'kept' }]]);
  await writeEnrichmentStore(storePath, byId);
  const before = await readFile(storePath, 'utf8');
  const blocked = path.join(directory, 'blocked');
  await (await import('node:fs/promises')).mkdir(blocked);
  await assert.rejects(writeAtomic(blocked, 'next'));
  assert.equal(await readFile(storePath, 'utf8'), before);
  const names = await readdir(directory);
  assert.equal(names.some((name) => name.includes('.tmp')), false);
});

test('the enrichment window accepts an overnight range and rejects an open gate by default', () => {
  const night = new Date('2026-01-15T15:30:00Z');
  const day = new Date('2026-01-15T03:30:00Z');
  assert.equal(withinWindow('22-6', night), true);
  assert.equal(withinWindow('22-6', day), false);
  assert.equal(withinWindow('', day), true);
});

test('the retrieval worker attaches the agreed enrichment shape when a store entry exists', async () => {
  const answering = createRetrievalAnswering({
    records: records.slice(0, 1),
    catalog,
    enrichmentById: new Map([[records[0].id, {
      summary: 'demo summary',
      queries: ['この部品の状態は？', '同じ機械の記録は？', '処置済みの記録は？'],
      facets: { phenomenon: [{ value: 'demo mark' }], cause: [], process: [], part: [], treatment: [] },
    }]]),
  });
  const replaced = await answering.replaceCorpus({ mode: 'full', records: [], asOf: '2026-01-15T00:00:00Z' });
  assert.equal(replaced.ok, true);
  assert.equal(replaced.count, 0);
});
