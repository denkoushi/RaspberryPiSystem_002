#!/usr/bin/env node
// Offline retained-memory measurements. Never emit record text or write inputs.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { fieldsWithRole, loadCatalog } from '../catalog.mjs';
import { authorizedRecords, buildCorpusView } from '../corpus.mjs';
import { prepareLexicalCorpus } from '../executor.mjs';
import { buildValueIndex } from '../value-index.mjs';
// dense-index.mjs exports rankers only; binary IO lives in dense-dgx.mjs.
import { readDenseStore } from '../dense-dgx.mjs';
import { readEnrichmentStore } from '../enrichment-store.mjs';
import { attachEnrichment } from '../enrichment-attach.mjs';
import { snapshotPathFromEnv, WORKER_PREFIX } from '../worker.mjs';

const MiB = 1024 ** 2;
const metrics = ['heapUsed', 'rss', 'external', 'arrayBuffers'];
const execFileAsync = promisify(execFile);
const usage = 'node --expose-gc --max-old-space-size=384 retrieval/prototypes/worker-memory.mjs --snapshot <file> [--dense <bin>] [--enrichment <jsonl>] [--out <json>]';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].slice(2);
    if (!argv[i].startsWith('--') || !['snapshot', 'dense', 'enrichment', 'out'].includes(key)
      || args[key] || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(usage);
    args[key] = path.resolve(argv[++i]);
  }
  if (!args.snapshot) throw new Error(usage);
  for (const key of ['snapshot', 'dense', 'enrichment']) {
    if (args[key] && !fs.statSync(args[key]).isFile()) throw new Error(`${key} must be a file`);
  }
  if (args.out) {
    args.out = path.join(fs.realpathSync(path.dirname(args.out)), path.basename(args.out));
    const privatePath = path.join(os.homedir(), 'Documents/hermes-retrieval-private');
    const privateRoot = fs.existsSync(privatePath) ? fs.realpathSync(privatePath) : privatePath;
    if (args.out === privateRoot || args.out.startsWith(`${privateRoot}${path.sep}`) || fs.existsSync(args.out)) {
      throw new Error('--out must be a new file outside hermes-retrieval-private');
    }
  }
  return args;
}

async function memory() {
  // Let async read callbacks release temporary buffers before measuring retention.
  await new Promise(setImmediate);
  global.gc();
  global.gc();
  const current = process.memoryUsage();
  return Object.fromEntries(metrics.map((key) => [key, current[key]]));
}

const difference = (after, before) => Object.fromEntries(metrics.map((key) => [key, after[key] - before[key]]));

function loadRecords(snapshot, catalog) {
  const payload = JSON.parse(fs.readFileSync(snapshot, 'utf8'));
  if (!Array.isArray(payload?.records)) throw new Error('snapshot records must be an array');
  return authorizedRecords(payload.records, catalog);
}

function bodyStats(records, bodyFields) {
  let utf8Bytes = 0;
  let utf16Bytes = 0;
  for (const record of records) {
    for (const key of bodyFields) {
      const value = record[key];
      if (typeof value !== 'string') continue;
      utf8Bytes += Buffer.byteLength(value, 'utf8');
      utf16Bytes += value.length * 2;
    }
  }
  return { fields: bodyFields, utf8Bytes, utf16Bytes, utf8BytesPerDocument: utf8Bytes / (records.length || 1) };
}

function lexicalStats(corpus, heapBytes) {
  let foldedUtf8Bytes = 0;
  let foldedUtf16Bytes = 0;
  let estimatedStringPayloadBytes = 0;
  for (const { folded } of corpus.documents) {
    foldedUtf8Bytes += Buffer.byteLength(folded, 'utf8');
    foldedUtf16Bytes += folded.length * 2;
    estimatedStringPayloadBytes += folded.length * (/[^\u0000-\u00ff]/u.test(folded) ? 2 : 1);
  }
  return {
    structure: '{ documents: Array<{ id, folded, length }>, docCount, totalLength, avgLength }; id shares the record string; folded is NFKC/lowercase/whitespace-removed body; no persistent postings or term-count maps',
    documents: corpus.docCount, foldedUtf8Bytes, foldedUtf16Bytes, estimatedStringPayloadBytes,
    retainedHeapBytes: heapBytes, retainedHeapBytesPerDocument: heapBytes / (corpus.docCount || 1),
    estimatedStringPayloadBytesPerDocument: estimatedStringPayloadBytes / (corpus.docCount || 1),
  };
}

async function readRss(pid) {
  if (fs.existsSync(`/proc/${pid}/status`)) {
    const match = fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/^VmRSS:\s+(\d+)\s+kB$/mu);
    if (!match) throw new Error('worker VmRSS unavailable');
    return { rssBytes: Number(match[1]) * 1024, method: '/proc/<pid>/status VmRSS' };
  }
  const { stdout } = await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)]);
  const kib = Number(stdout.trim());
  if (!Number.isFinite(kib) || kib <= 0) throw new Error('worker ps RSS unavailable');
  return { rssBytes: kib * 1024, method: 'ps -o rss= -p <pid>' };
}

async function measureWorker(args, count) {
  // Whitelist the environment: no inherited credentials, providers, or NODE_OPTIONS.
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG'].filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]));
  Object.assign(env, {
    HERMES_TRIAL_SNAPSHOT_PATH: args.snapshot,
    HERMES_RETRIEVAL_SOURCES: 'nonconformity',
    HERMES_RETRIEVAL_VECTOR_ENABLED: 'false',
    HERMES_RETRIEVAL_DENSE_INDEX_ENABLED: 'false',
    HERMES_RETRIEVAL_ENRICHMENT_ENABLED: args.enrichment ? 'true' : 'false',
    HERMES_JEV_PROVIDER: 'offline-memory-measurement',
  });
  if (args.enrichment) env.HERMES_RETRIEVAL_ENRICHMENT_STORE = args.enrichment;
  if (snapshotPathFromEnv(env) !== args.snapshot) throw new Error('worker snapshot environment mismatch');
  const child = spawn(process.execPath, ['--max-old-space-size=384', fileURLToPath(new URL('../worker.mjs', import.meta.url))], {
    env, stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr.resume(); // Worker diagnostics may include input context; suppress them.
  child.stdin.on('error', () => {});
  const lines = readline.createInterface({ input: child.stdout });
  let exited = false;
  const closed = new Promise((resolve) => child.once('close', (code) => { exited = true; resolve(code); }));
  let timeout;
  try {
    const sample = await new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('workerReady timeout (60s)')), 60_000);
      child.once('error', reject);
      child.once('exit', () => reject(new Error('worker exited before RSS measurement')));
      let measuring = false;
      lines.on('line', (line) => {
        if (measuring || !line.startsWith(WORKER_PREFIX)) return;
        let payload;
        try { payload = JSON.parse(line.slice(WORKER_PREFIX.length)); }
        catch { reject(new Error('invalid worker protocol JSON')); return; }
        if (payload.workerError) { reject(new Error('worker startup failed')); return; }
        if (!payload.workerReady) return;
        measuring = true;
        if (payload.runtime?.snapshot?.count !== count || payload.runtime?.snapshot?.snapshotId === 'pending-refresh') {
          reject(new Error('worker silently fell back or loaded a different record count'));
          return;
        }
        readRss(child.pid).then((rss) => resolve({ ...rss, snapshotCount: count }), (error) => {
          if (!['EPERM', 'EACCES'].includes(error.code)) { reject(error); return; }
          resolve({ rssBytes: null, method: 'ps -o rss= -p <pid>', snapshotCount: count,
            rssUnavailable: `${error.code}: sandbox denied RSS observation; workerReady received` });
        });
      });
    });
    // EOF only: no query is sent, hence neither JEV nor DGX is called.
    child.stdin.end();
    const code = await closed;
    if (code !== 0) throw new Error('worker did not exit cleanly');
    return { ...sample, maxOldSpaceSizeMiB: 384, denseProvider: 'unset', enrichmentEnabled: Boolean(args.enrichment), forcedGc: false };
  } finally {
    clearTimeout(timeout);
    lines.close();
    if (!exited) { child.kill(); await closed; }
  }
}

function markdown(report) {
  const mb = (bytes) => (bytes / MiB).toFixed(2);
  const workerRss = report.worker.rssBytes == null ? `unavailable (${report.worker.rssUnavailable})` : `${mb(report.worker.rssBytes)} MB`;
  const projectedRss = report.extrapolation.naiveWorkerRssBytes == null ? 'unavailable' : `${mb(report.extrapolation.naiveWorkerRssBytes)} MB`;
  const lines = [
    '# Hermes worker memory', '',
    `Node ${report.environment.node}, ${report.environment.platform}/${report.environment.arch}; ${report.documents} documents. MB = MiB (2^20 bytes).`, '',
    '| Stage | heapUsed MB | rss MB | external MB | arrayBuffers MB | Δheap MB | Δrss MB |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.stages.map((stage) => `| ${stage.label} | ${metrics.map((key) => mb(stage.after[key])).join(' | ')} | ${mb(stage.delta.heapUsed)} | ${mb(stage.delta.rss)} |`), '',
    'Δ is each stage after minus its own before (both after GC), not necessarily the previous row.',
    'Stage 3 replaces records with facet copies; before stage 4, discard facets and reload the snapshot.',
    'Stages 4–6 retain standalone lexicalCorpus/valueIndex AND the full view, matching worker startup duplication.',
    'Stage 8 retains the store and attaches enrichment to view records without rebuilding lexicalCorpus (worker behavior).', '',
    `Body UTF-8: ${report.body.utf8Bytes} bytes (${mb(report.body.utf8Bytes)} MB), ${report.body.utf8BytesPerDocument.toFixed(0)} bytes/document.`,
    `lexicalCorpus: ${mb(report.lexical.retainedHeapBytes)} MB incremental heap, ${report.lexical.retainedHeapBytesPerDocument.toFixed(0)} bytes/document.`,
    `Folded string payload estimate: ${report.lexical.estimatedStringPayloadBytesPerDocument.toFixed(0)} bytes/document (excludes objects/array/string headers, shared IDs).`,
    report.lexical.structure, '',
    `Worker at workerReady: RSS ${workerRss} (${report.worker.method}; 384 MiB old-space cap; dense off; enrichment ${report.worker.enrichmentEnabled ? 'on' : 'off'}; no forced GC).`, '',
    `Bodyless records: heap saving ${mb(report.estimates.bodylessHeapSavingBytes)} MB; observed RSS delta ${mb(-report.estimates.bodylessRssSavingBytes)} MB.`,
    `valueIndex: ${mb(report.estimates.valueIndexHeapBytes)} MB incremental heap; distinct field values ${report.valueIndex.distinctFieldValues}.`,
    `10× (${report.extrapolation.documents} documents), linear estimates: body saving ${mb(report.extrapolation.bodylessHeapSavingBytes)} MB, lexical ${mb(report.extrapolation.lexicalHeapBytes)} MB, valueIndex ${mb(report.extrapolation.valueIndexHeapBytes)} MB; naive worker RSS ${projectedRss}.`, '',
    `Final measured stage at 10×, retaining baseline once: heap ${mb(report.extrapolation.withStoresHeapBytes)} MB, RSS ${mb(report.extrapolation.withStoresRssBytes)} MB (prototype only, not worker RSS).`, '',
    'Single Mac measurement; post-GC retained heap is not startup peak. RSS includes allocator/JIT/GC slack and need not shrink after freeing objects.',
    '10× is a linear projection, not a measurement: value cardinality, V8 limits and platform overhead may change. external includes arrayBuffers; do not add them together.',
  ];
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof global.gc !== 'function') throw new Error('global.gc unavailable; start with --expose-gc');
  const stages = [];
  const state = {};
  async function stage(id, label, action) {
    const before = await memory();
    await action();
    const after = await memory();
    const row = { id, label, before, after, delta: difference(after, before) };
    stages.push(row);
    return row;
  }
  await stage(1, '1 baseline (imports only)', () => {});
  const catalog = loadCatalog(['nonconformity']);
  const bodyFields = fieldsWithRole(catalog, 'body');
  await stage(2, '2 authorized records', () => { state.records = loadRecords(args.snapshot, catalog); });
  const documents = state.records.length;
  const body = bodyStats(state.records, bodyFields);
  const facetStage = await stage(3, '3 facet-only records', () => {
    state.records = state.records.map((record) => Object.fromEntries(
      Object.entries(record).filter(([key]) => !bodyFields.includes(key)),
    ));
  });
  // Stage 3 is an alternative design, not the input for current-worker stages.
  state.records = null;
  await memory();
  state.records = loadRecords(args.snapshot, catalog);
  const lexicalStage = await stage(4, '4 records + lexicalCorpus', () => {
    state.lexical = prepareLexicalCorpus(state.records, bodyFields);
  });
  const valueStage = await stage(5, '5 + valueIndex', () => { state.valueIndex = buildValueIndex(state.records, catalog); });
  const distinctFieldValues = Object.values(state.valueIndex.values).reduce((sum, source) =>
    sum + Object.values(source).reduce((count, values) => count + values.length, 0), 0);
  await stage(6, '6 + full corpus view', () => { state.view = buildCorpusView(state.records, catalog, null); });
  let dense = null;
  if (args.dense) {
    await stage(7, '7 + dense store', async () => {
      state.dense = await readDenseStore(args.dense);
      if (!state.dense.length) throw new Error('dense store empty or unreadable/invalid');
    });
    dense = { entries: state.dense.length, vectorBytes: state.dense.reduce((sum, entry) => sum + entry.vector.byteLength, 0) };
  }
  let enrichment = null;
  if (args.enrichment) {
    await stage(8, '8 + enrichment store/attach', async () => {
      state.enrichment = await readEnrichmentStore(args.enrichment);
      if (!state.enrichment.size) throw new Error('enrichment store empty or invalid');
      const records = attachEnrichment(state.view.bySource.nonconformity.records, state.enrichment);
      state.view = {
        ...state.view, records,
        bySource: { ...state.view.bySource, nonconformity: { ...state.view.bySource.nonconformity, records } },
      };
    });
    enrichment = { stored: state.enrichment.size, attached: state.view.records.filter((record) => record.enrichment).length };
  }
  const worker = await measureWorker(args, documents);
  // Inspect folded content only after ALL samples: Buffer.byteLength may flatten
  // V8 rope strings and change their retained representation.
  const lexical = lexicalStats(state.lexical, lexicalStage.delta.heapUsed);
  const estimates = {
    bodylessHeapSavingBytes: -facetStage.delta.heapUsed,
    bodylessRssSavingBytes: -facetStage.delta.rss,
    lexicalHeapBytes: lexicalStage.delta.heapUsed,
    valueIndexHeapBytes: valueStage.delta.heapUsed,
  };
  const report = {
    schema: 'hermes-worker-memory/v1', measuredAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, arch: process.arch, execArgv: process.execArgv },
    units: 'bytes; Markdown MB means MiB', documents, stages, body, lexical,
    valueIndex: { distinctFieldValues }, dense, enrichment, worker, estimates,
    extrapolation: {
      factor: 10, documents: documents * 10,
      bodylessHeapSavingBytes: estimates.bodylessHeapSavingBytes * 10,
      lexicalHeapBytes: estimates.lexicalHeapBytes * 10,
      valueIndexHeapBytes: estimates.valueIndexHeapBytes * 10,
      withStoresHeapBytes: stages[0].after.heapUsed + (stages.at(-1).after.heapUsed - stages[0].after.heapUsed) * 10,
      withStoresRssBytes: stages[0].after.rss + (stages.at(-1).after.rss - stages[0].after.rss) * 10,
      naiveWorkerRssBytes: worker.rssBytes == null ? null : worker.rssBytes * 10,
    },
  };
  // Keep measured objects alive until every sample has completed.
  if (state.view.snapshotCount !== documents) throw new Error('corpus count changed');
  if (args.out) fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(markdown(report));
}

main().catch((error) => {
  // JSON parse errors can contain body snippets; report only safe error categories.
  process.stderr.write(`${error instanceof SyntaxError ? 'Invalid input JSON (context suppressed)' : error.message}\n`);
  process.exitCode = 1;
});
