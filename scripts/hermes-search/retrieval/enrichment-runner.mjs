// Incremental, resumable enrichment. A DGX failure backs off and never answers chat.
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadNonconformityCatalog } from './catalog.mjs';
import { recordFromAuthorizedRow } from './corpus.mjs';
import {
  ENRICHMENT_SCHEMA_VERSION,
  STATUS_SCHEMA,
  STORE_SCHEMA,
  promptSha256,
  promptTemplate,
  recordText,
  sourceRecordHash,
  verifyEvidence,
} from './enrichment-contract.mjs';
import { enrichmentSettings, requestEnrichment, withinWindow } from './enrichment-dgx.mjs';
import {
  failuresPathFor,
  readEnrichmentFailures,
  readEnrichmentStore,
  statusPathFromEnv,
  storePathFromEnv,
  writeEnrichmentFailures,
  writeEnrichmentStore,
  writeStatus,
} from './enrichment-store.mjs';

const BACKOFF_MS = [5_000, 15_000, 60_000];
// The model answers the same record the same way, so a record is set aside after this many content failures.
export const MAX_CONTENT_ATTEMPTS = 3;
// Failures that belong to the answer for one record. Transport, timeout, and HTTP failures mean DGX
// itself is unhealthy, so only those count toward backoff.
const CONTENT_FAILURES = new Set(['invalid_json', 'schema_mismatch', 'truncated', 'rule_violation']);
const ID_LINE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export async function readIdAllowlist(filePath) {
  const raw = await readFile(filePath, 'utf8');
  const ids = new Set();
  for (const line of raw.split('\n')) {
    const id = line.trim();
    if (!id) continue;
    if (!ID_LINE.test(id)) throw new Error('enrichment id allowlist line is not an id');
    ids.add(id);
  }
  if (ids.size === 0) throw new Error('enrichment id allowlist is empty');
  return ids;
}

export function selectRecords(records) {
  return (records ?? []).map((row) => (
    row?.kind === 'nonconformity' ? recordFromAuthorizedRow(row) : row
  )).filter((row) => row && typeof row.id === 'string' && row.id);
}

export function needsEnrichment(existing, record, catalog, promptHash) {
  if (!existing) return true;
  return existing.enrichmentSchemaVersion !== ENRICHMENT_SCHEMA_VERSION
    || existing.promptSha256 !== promptHash
    || existing.sourceRecordHash !== sourceRecordHash(record, catalog);
}

export async function runEnrichmentBatch({
  records,
  catalog = loadNonconformityCatalog(),
  storePath,
  statusPath,
  settings = enrichmentSettings(),
  fetchImpl,
  now = () => new Date(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const started = performance.now();
  const loaded = selectRecords(records);
  const allowlist = settings.idAllowlist ? await readIdAllowlist(settings.idAllowlist) : null;
  const selected = allowlist ? loaded.filter((record) => allowlist.has(record.id)) : loaded;
  const status = emptyStatus(settings, selected.length);
  status.allowlistCount = allowlist ? allowlist.size : 0;
  status.allowlistMatched = allowlist ? selected.length : 0;
  if (!settings.enabled) {
    status.reason = 'disabled';
    await publish(statusPath, status);
    return status;
  }
  if (!withinWindow(settings.window, now())) {
    status.reason = 'outside_window';
    await publish(statusPath, status);
    return status;
  }
  if (!settings.origin || !settings.token) {
    status.reason = 'missing_inference';
    status.failed = 0;
    await publish(statusPath, status);
    return status;
  }
  const byId = await readEnrichmentStore(storePath);
  const failuresPath = storePath ? failuresPathFor(storePath) : null;
  const failures = failuresPath ? await readEnrichmentFailures(failuresPath) : new Map();
  const promptHash = promptSha256(catalog);
  const template = promptTemplate(catalog);
  const pending = [];
  for (const record of selected) {
    const existing = byId.get(record.id);
    if (!needsEnrichment(existing, record, catalog, promptHash)) {
      status.skipped += 1;
      continue;
    }
    const attempts = contentAttempts(failures.get(record.id), record, catalog, promptHash);
    if (attempts >= MAX_CONTENT_ATTEMPTS) {
      status.gaveUp += 1;
      continue;
    }
    pending.push({ record, attempts });
  }
  // Untried records go first, so records that failed before do not hold back the rest.
  pending.sort((left, right) => left.attempts - right.attempts);
  const capped = pending.slice(0, settings.maxRecords).map((item) => item.record);
  status.deferred = pending.length - capped.length;
  let consecutiveFailures = 0;
  let failuresChanged = false;
  let stoppedOutside = false;
  for (let index = 0; index < capped.length && !stoppedOutside; index += settings.concurrency) {
    const slice = [];
    for (const record of capped.slice(index, index + settings.concurrency)) {
      if (!withinWindow(settings.window, now())) {
        stoppedOutside = true;
        break;
      }
      slice.push(record);
    }
    if (slice.length === 0) break;
    const results = await Promise.all(slice.map((record) => enrichOne({
      record, catalog, template, promptHash, settings, fetchImpl, now,
    })));
    for (const result of results) {
      if (result.stopped) {
        stoppedOutside = true;
        continue;
      }
      status.examined += 1;
      status.latencyMsTotal += result.latencyMs;
      status.latenciesMs.push(result.latencyMs);
      if (!result.ok) {
        status.failed += 1;
        status.lastErrorClass = result.errorClass;
        countFailure(status, result);
        if (CONTENT_FAILURES.has(result.errorClass)) {
          status.parseFailures += 1;
          recordContentFailure(failures, result, catalog, promptHash);
          failuresChanged = true;
          continue;
        }
        consecutiveFailures += 1;
        continue;
      }
      consecutiveFailures = 0;
      if (failures.delete(result.row.recordId)) failuresChanged = true;
      status.succeeded += 1;
      if (result.aliasesRejected) status.aliasesRejected += 1;
      status.evidenceDropped += result.evidenceDropped;
      status.evidenceKept += result.evidenceKept;
      status.aliasesDropped += result.aliasesDropped;
      status.aliasesKept += result.aliasesKept;
      addUsage(status, result.usage);
      byId.set(result.row.recordId, result.row);
    }
    if (results.some((result) => result.ok)) await writeEnrichmentStore(storePath, byId);
    if (failuresChanged && failuresPath) {
      await writeEnrichmentFailures(failuresPath, failures);
      failuresChanged = false;
    }
    if (stoppedOutside) break;
    if (consecutiveFailures >= 3) {
      status.reason = 'backoff';
      await sleep(BACKOFF_MS[Math.min(consecutiveFailures, BACKOFF_MS.length) - 1]);
      break;
    }
    if (consecutiveFailures > 0) {
      await sleep(BACKOFF_MS[Math.min(consecutiveFailures, BACKOFF_MS.length) - 1]);
    }
  }
  if (stoppedOutside) status.reason = 'outside_window';
  status.elapsedMs = Math.round(performance.now() - started);
  status.estimatedFullCorpusMs = estimateFullCorpus(status, selected.length);
  await publish(statusPath, status);
  return status;
}

async function enrichOne({ record, catalog, template, promptHash, settings, fetchImpl, now }) {
  const text = recordText(record, catalog);
  const response = await requestEnrichment({
    settings, systemPrompt: template, recordText: text, fetchImpl, now,
  });
  if (response.stopped) {
    return { ok: false, stopped: true, latencyMs: response.latencyMs ?? 0 };
  }
  if (!response.ok) {
    return {
      ok: false, record, errorClass: response.errorClass, detail: response.detail, latencyMs: response.latencyMs ?? 0,
    };
  }
  let verified;
  try {
    verified = verifyEvidence(response.parsed, text, record.id, { aliasFallback: true });
  } catch (error) {
    return {
      ok: false, record, errorClass: 'rule_violation', detail: error?.message, latencyMs: response.latencyMs ?? 0,
    };
  }
  return {
    ok: true,
    latencyMs: response.latencyMs ?? 0,
    evidenceDropped: verified.evidenceDropped,
    evidenceKept: verified.evidenceKept,
    aliasesDropped: verified.aliasesDropped,
    aliasesKept: verified.aliasesKept,
    aliasesRejected: verified.aliasesRejected,
    usage: response.usage,
    row: {
      schema: STORE_SCHEMA,
      recordId: record.id,
      sourceId: catalog.id ?? 'nonconformity',
      enrichmentSchemaVersion: verified.enrichmentSchemaVersion,
      promptSha256: promptHash,
      model: settings.model,
      profile: settings.profile,
      createdAt: new Date().toISOString(),
      sourceRecordHash: sourceRecordHash(record, catalog),
      summary: verified.summary,
      queries: verified.queries,
      facets: verified.facets,
      aliases: verified.aliases,
      metrics: {
        latencyMs: response.latencyMs ?? 0,
        evidenceDropped: verified.evidenceDropped,
        evidenceKept: verified.evidenceKept,
        aliasesDropped: verified.aliasesDropped,
        aliasesKept: verified.aliasesKept,
        promptTokens: response.usage?.promptTokens ?? null,
        completionTokens: response.usage?.completionTokens ?? null,
      },
    },
  };
}

function emptyStatus(settings, corpusCount) {
  return {
    schema: STATUS_SCHEMA,
    updatedAt: new Date().toISOString(),
    enabled: settings.enabled,
    reason: 'completed',
    corpusCount,
    maxRecords: settings.maxRecords,
    concurrency: settings.concurrency,
    allowlistCount: 0,
    allowlistMatched: 0,
    examined: 0,
    skipped: 0,
    succeeded: 0,
    failed: 0,
    deferred: 0,
    evidenceDropped: 0,
    evidenceKept: 0,
    aliasesDropped: 0,
    aliasesKept: 0,
    parseFailures: 0,
    failureCounts: {},
    failureDetails: {},
    gaveUp: 0,
    aliasesRejected: 0,
    latenciesMs: [],
    latencyMsTotal: 0,
    promptTokens: 0,
    completionTokens: 0,
    lastErrorClass: null,
    elapsedMs: 0,
    estimatedFullCorpusMs: null,
  };
}

function contentAttempts(entry, record, catalog, promptHash) {
  if (!entry) return 0;
  // A changed record or prompt earns fresh attempts.
  if (entry.sourceRecordHash !== sourceRecordHash(record, catalog) || entry.promptSha256 !== promptHash) return 0;
  return entry.attempts;
}

function recordContentFailure(failures, result, catalog, promptHash) {
  const { record } = result;
  const attempts = contentAttempts(failures.get(record.id), record, catalog, promptHash) + 1;
  failures.set(record.id, {
    recordId: record.id,
    attempts,
    lastErrorClass: result.errorClass,
    lastDetail: typeof result.detail === 'string' ? result.detail : null,
    sourceRecordHash: sourceRecordHash(record, catalog),
    promptSha256: promptHash,
    lastAttemptAt: new Date().toISOString(),
  });
}

function countFailure(status, result) {
  status.failureCounts[result.errorClass] = (status.failureCounts[result.errorClass] ?? 0) + 1;
  if (typeof result.detail !== 'string') return;
  status.failureDetails[result.detail] = (status.failureDetails[result.detail] ?? 0) + 1;
}

function addUsage(status, usage) {
  if (!usage) return;
  if (Number.isFinite(usage.promptTokens)) status.promptTokens += usage.promptTokens;
  if (Number.isFinite(usage.completionTokens)) status.completionTokens += usage.completionTokens;
}

export function estimateFullCorpus(status, corpusCount) {
  const done = status.succeeded + status.skipped;
  if (!status.succeeded || !corpusCount) return null;
  const mean = status.latencyMsTotal / Math.max(1, status.examined);
  const remaining = Math.max(0, corpusCount - done);
  return Math.round(mean * remaining / Math.max(1, status.concurrency));
}

async function publish(statusPath, status) {
  status.updatedAt = new Date().toISOString();
  if (!statusPath) return;
  await writeStatus(statusPath, status);
  const line = [
    'hermes retrieval enrichment',
    `reason=${status.reason}`,
    `examined=${status.examined}`,
    `skipped=${status.skipped}`,
    `succeeded=${status.succeeded}`,
    `failed=${status.failed}`,
    `gaveUp=${status.gaveUp}`,
    `evidenceDropped=${status.evidenceDropped}`,
    `latencyMsTotal=${status.latencyMsTotal}`,
    `estimatedFullCorpusMs=${status.estimatedFullCorpusMs ?? 'na'}`,
  ].join(' ');
  console.info(line);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return [];
  const payload = JSON.parse(raw);
  return Array.isArray(payload) ? payload : payload.records;
}

export async function main() {
  try {
    const records = await readStdin();
    const status = await runEnrichmentBatch({
      records,
      storePath: storePathFromEnv(),
      statusPath: statusPathFromEnv(),
    });
    if (status.reason === 'backoff') process.exitCode = 0;
  } catch {
    console.info('hermes retrieval enrichment reason=runner_failed');
    process.exitCode = 0;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
