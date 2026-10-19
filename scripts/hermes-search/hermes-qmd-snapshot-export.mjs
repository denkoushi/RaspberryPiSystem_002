/*
 * Scratch-only Hermes/QMD snapshot exporter.
 *
 * This module is intentionally run by the already authenticated API
 * persistent worker. It reads the current projection directly through the
 * API container's existing Prisma client and does not add an HTTP/auth path,
 * write to the database, or invoke QMD. A single RepeatableRead transaction
 * is used so the rows and their projection watermark are one database view.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import readline from 'node:readline';

export const SNAPSHOT_SCHEMA = 'hermes-qmd-snapshot/v1';
export const SOURCE_KIND = 'nonconformity';
export const SOURCE_TABLE = 'ScawStfutekigoCurrent';
export const SCAW_STFUTEKIGO_DASHBOARD_ID = '3b1a4089-3274-448b-9f4e-ec20c294fe27';
export const PRISMA_MODULE_PATH = '/app/apps/api/dist/lib/prisma.js';

// Keep these definitions aligned with business-hermes-mcp.service.ts. They
// are passed to Prisma unchanged and deliberately contain no pagination.
export const ACTIVE_WHERE = Object.freeze({ isPresentInLatestSnapshot: true });
export const CANONICAL_SELECT = Object.freeze({
  id: true,
  nonconformityNo: true,
  partNumber: true,
  partName: true,
  machineName: true,
  originDepartmentCode: true,
  originDepartmentName: true,
  discoveredOn: true,
  nonconformityContent: true,
  remarks: true,
  correctiveContent1: true,
  correctiveContent2: true,
  dispositionContent: true,
  sourceUpdatedOn: true,
  lastEvaluatedIngestRunId: true,
  lastSnapshotReceivedAt: true,
});

const ORDER_BY = [
  { discoveredOn: { sort: 'desc', nulls: 'last' } },
  { nonconformityNo: 'desc' },
];

export class HermesSnapshotExportError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'HermesSnapshotExportError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new HermesSnapshotExportError(code, message);
}

function dateOnly(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) fail('SNAPSHOT_INVALID_DATE', `${fieldName} is invalid`);
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
    if (!match) fail('SNAPSHOT_INVALID_DATE', `${fieldName} is not YYYY-MM-DD: ${trimmed}`);
    const parsed = new Date(`${match[1]}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) fail('SNAPSHOT_INVALID_DATE', `${fieldName} is invalid`);
    return match[1];
  }
  fail('SNAPSHOT_INVALID_DATE', `${fieldName} must be a Date, string, or null`);
}

function isoTimestamp(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) fail('SNAPSHOT_INVALID_TIMESTAMP', `${fieldName} is invalid`);
  return parsed.toISOString();
}

/** Apply the exact nonconformity mapping used by BusinessHermesMcpService. */
export function toCanonicalNonconformity(row) {
  if (!row || typeof row !== 'object') fail('SNAPSHOT_INVALID_ROW', 'row must be an object');
  if (typeof row.id !== 'string' || !row.id) fail('SNAPSHOT_INVALID_ROW', 'row.id is required');
  if (typeof row.nonconformityNo !== 'string' || !row.nonconformityNo) {
    fail('SNAPSHOT_INVALID_ROW', `row ${row.id} has no nonconformityNo`);
  }
  return {
    kind: SOURCE_KIND,
    id: row.id,
    nonconformityNo: row.nonconformityNo,
    partNumber: row.partNumber ?? null,
    partName: row.partName ?? null,
    machineName: row.machineName ?? null,
    originDepartmentCode: row.originDepartmentCode ?? null,
    originDepartmentName: row.originDepartmentName ?? null,
    originDepartmentMeaning: '起因部署',
    evidenceKey: `nonconformity:${row.id}`,
    condition: row.nonconformityContent ?? null,
    remarks: row.remarks ?? null,
    // This is intentionally one canonical field, matching the MCP contract.
    correctiveContent: [row.correctiveContent1, row.correctiveContent2].filter(Boolean).join('\n') || null,
    disposition: row.dispositionContent ?? null,
    discoveredOn: dateOnly(row.discoveredOn, `row ${row.id}.discoveredOn`),
    sourceVersionDate: dateOnly(row.sourceUpdatedOn, `row ${row.id}.sourceUpdatedOn`),
    provenance: {
      source: SOURCE_TABLE,
      activeLatest: true,
      meaning: '不適合の発生状況と記録済みの対処を確認する情報源。',
    },
  };
}

function compareNullableDateDescending(left, right) {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right.localeCompare(left);
}

function compareCanonicalRows(left, right) {
  return compareNullableDateDescending(left.discoveredOn, right.discoveredOn)
    || right.nonconformityNo.localeCompare(left.nonconformityNo);
}

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  if (value === undefined) return null;
  fail('SNAPSHOT_UNSERIALIZABLE', `unsupported value type: ${typeof value}`);
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function digestRecords(records) {
  return createHash('sha256').update(canonicalJson(records), 'utf8').digest('hex');
}

function rangeFor(records, field) {
  const values = records.map((record) => record[field]).filter((value) => value !== null);
  if (values.length === 0) return { min: null, max: null };
  const sorted = [...values].sort();
  return { min: sorted[0], max: sorted[sorted.length - 1] };
}

function markerFromRows(rows) {
  if (rows.length === 0) {
    fail('SNAPSHOT_INCOMPLETE', 'no active row can witness a complete run and watermark');
  }
  const markers = rows.map((row) => {
    if (typeof row.lastEvaluatedIngestRunId !== 'string' || !row.lastEvaluatedIngestRunId) {
      fail('SNAPSHOT_INCOMPLETE', `active row ${row.id ?? '(unknown)'} has no lastEvaluatedIngestRunId`);
    }
    const watermark = isoTimestamp(row.lastSnapshotReceivedAt, `row ${row.id ?? '(unknown)'}.lastSnapshotReceivedAt`);
    if (!watermark) fail('SNAPSHOT_INCOMPLETE', `active row ${row.id ?? '(unknown)'} has no lastSnapshotReceivedAt`);
    return { runId: row.lastEvaluatedIngestRunId, watermark };
  });
  const runIds = new Set(markers.map((marker) => marker.runId));
  const watermarks = new Set(markers.map((marker) => marker.watermark));
  if (runIds.size !== 1 || watermarks.size !== 1) {
    fail('SNAPSHOT_MIXED', 'active rows have mixed lastEvaluatedIngestRunId or lastSnapshotReceivedAt');
  }
  return markers[0];
}

function previousRecordIds(previousManifest) {
  if (previousManifest === null || previousManifest === undefined) return new Set();
  const records = Array.isArray(previousManifest)
    ? previousManifest
    : previousManifest && Array.isArray(previousManifest.records)
      ? previousManifest.records
      : null;
  if (!records) fail('SNAPSHOT_INVALID_PREVIOUS_MANIFEST', 'previous manifest records must be an array');
  const ids = new Set();
  for (const record of records) {
    if (!record || typeof record !== 'object') fail('SNAPSHOT_INVALID_PREVIOUS_MANIFEST', 'previous manifest record must be an object');
    if (record.kind !== undefined && record.kind !== SOURCE_KIND) continue;
    const id = typeof record.id === 'string' ? record.id : typeof record.recordId === 'string' ? record.recordId.replace(/^nonconformity:/, '') : null;
    if (id) ids.add(id);
  }
  return ids;
}

function makeTombstones(previousManifest, records) {
  const currentIds = new Set(records.map((record) => record.id));
  return [...previousRecordIds(previousManifest)]
    .filter((id) => !currentIds.has(id))
    .sort();
}

async function setReadOnly(tx) {
  if (typeof tx?.$executeRaw !== 'function') {
    fail('SNAPSHOT_TRANSACTION_UNAVAILABLE', 'transaction client lacks $executeRaw for READ ONLY');
  }
  // The SQL is a static literal. The isolation level is also supplied to
  // Prisma below so both properties are visible in the transaction contract.
  await tx.$executeRaw`SET TRANSACTION READ ONLY`;
}

async function loadRun(tx, marker) {
  if (!tx?.csvDashboardIngestRun || typeof tx.csvDashboardIngestRun.findUnique !== 'function') {
    fail('SNAPSHOT_TRANSACTION_UNAVAILABLE', 'transaction client lacks CsvDashboardIngestRun read access');
  }
  const run = await tx.csvDashboardIngestRun.findUnique({
    where: { id: marker.runId },
    select: {
      id: true,
      csvDashboardId: true,
      status: true,
      startedAt: true,
      sourceReceivedAt: true,
      completedAt: true,
      rowsProcessed: true,
    },
  });
  if (!run) fail('SNAPSHOT_RUN_NOT_FOUND', `ingest run not found: ${marker.runId}`);
  if (run.csvDashboardId !== SCAW_STFUTEKIGO_DASHBOARD_ID) {
    fail('SNAPSHOT_RUN_SCOPE_MISMATCH', `ingest run ${marker.runId} is for another dashboard`);
  }
  if (run.status !== 'COMPLETED' || !run.completedAt) {
    fail('SNAPSHOT_RUN_NOT_COMPLETED', `ingest run ${marker.runId} is not completed`);
  }
  const runWatermark = isoTimestamp(run.sourceReceivedAt ?? run.startedAt, `ingest run ${marker.runId}.watermark`);
  if (!runWatermark || runWatermark !== marker.watermark) {
    fail('SNAPSHOT_WATERMARK_MISMATCH', `active rows watermark ${marker.watermark} does not match run ${marker.runId}`);
  }
  if (Number.isSafeInteger(run.rowsProcessed) && run.rowsProcessed < 0) {
    fail('SNAPSHOT_RUN_INVALID', `ingest run ${marker.runId} has a negative rowsProcessed count`);
  }
  return {
    id: run.id,
    csvDashboardId: run.csvDashboardId,
    status: run.status,
    startedAt: isoTimestamp(run.startedAt, `ingest run ${marker.runId}.startedAt`),
    sourceReceivedAt: isoTimestamp(run.sourceReceivedAt, `ingest run ${marker.runId}.sourceReceivedAt`),
    completedAt: isoTimestamp(run.completedAt, `ingest run ${marker.runId}.completedAt`),
    rowsProcessed: Number.isSafeInteger(run.rowsProcessed) ? run.rowsProcessed : null,
  };
}

/**
 * Export every active latest nonconformity row in one read-only snapshot.
 * `db` is injectable only for synthetic tests; production callers use the
 * API container's already configured Prisma client via `loadDefaultPrisma`.
 */
export async function exportHermesQmdSnapshot({ db, previousManifest = null } = {}) {
  const client = db ?? await loadDefaultPrisma();
  if (!client || typeof client.$transaction !== 'function') {
    fail('SNAPSHOT_DATABASE_UNAVAILABLE', 'Prisma client is required');
  }
  return client.$transaction(async (tx) => {
    await setReadOnly(tx);
    if (!tx?.scawStfutekigoCurrent || typeof tx.scawStfutekigoCurrent.findMany !== 'function') {
      fail('SNAPSHOT_TRANSACTION_UNAVAILABLE', 'transaction client lacks ScawStfutekigoCurrent read access');
    }
    const rows = await tx.scawStfutekigoCurrent.findMany({
      where: ACTIVE_WHERE,
      orderBy: ORDER_BY,
      select: CANONICAL_SELECT,
    });
    if (!Array.isArray(rows)) fail('SNAPSHOT_INVALID_QUERY_RESULT', 'current projection query did not return an array');
    const marker = markerFromRows(rows);
    const run = await loadRun(tx, marker);
    const records = rows.map(toCanonicalNonconformity).sort(compareCanonicalRows);
    if (run.rowsProcessed !== null && records.length > run.rowsProcessed) {
      fail('SNAPSHOT_INCOMPLETE', `active record count ${records.length} exceeds run rowsProcessed ${run.rowsProcessed}`);
    }
    const digest = digestRecords(records);
    return {
      schema: SNAPSHOT_SCHEMA,
      kind: SOURCE_KIND,
      status: 'ready',
      runId: marker.runId,
      watermark: marker.watermark,
      run,
      source: {
        table: SOURCE_TABLE,
        dashboardId: SCAW_STFUTEKIGO_DASHBOARD_ID,
        predicate: 'isPresentInLatestSnapshot=true',
      },
      recordCount: records.length,
      digest,
      digestAlgorithm: 'sha256',
      sourceRange: {
        ingestRunId: marker.runId,
        watermark: marker.watermark,
        discoveredOn: rangeFor(records, 'discoveredOn'),
        sourceVersionDate: rangeFor(records, 'sourceVersionDate'),
      },
      tombstones: makeTombstones(previousManifest, records),
      records,
    };
  }, { isolationLevel: 'RepeatableRead' });
}

let defaultPrismaPromise;
async function loadDefaultPrisma() {
  defaultPrismaPromise ??= import(PRISMA_MODULE_PATH).then((module) => module.prisma ?? module.default ?? module);
  return defaultPrismaPromise;
}

function syntheticRow(overrides = {}) {
  return {
    id: 'row-1',
    nonconformityNo: 'NC-001',
    partNumber: 'PART-1',
    partName: '部品',
    machineName: '機械',
    originDepartmentCode: 'D01',
    originDepartmentName: '起因部署',
    discoveredOn: new Date('2026-09-01T00:00:00.000Z'),
    nonconformityContent: '内容',
    remarks: '備考',
    correctiveContent1: '是正1',
    correctiveContent2: '是正2',
    dispositionContent: '処置',
    sourceUpdatedOn: new Date('2026-09-02T00:00:00.000Z'),
    lastEvaluatedIngestRunId: 'run-1',
    lastSnapshotReceivedAt: new Date('2026-09-03T00:00:00.000Z'),
    ...overrides,
  };
}

function syntheticDb(rows, run = {}) {
  const options = [];
  return {
    options,
    async $transaction(callback, txOptions) {
      options.push(txOptions);
      const tx = {
        async $executeRaw() {},
        scawStfutekigoCurrent: {
          async findMany() { return rows; },
        },
        csvDashboardIngestRun: {
          async findUnique() {
            return {
              id: 'run-1',
              csvDashboardId: SCAW_STFUTEKIGO_DASHBOARD_ID,
              status: 'COMPLETED',
              startedAt: new Date('2026-09-03T00:00:00.000Z'),
              sourceReceivedAt: new Date('2026-09-03T00:00:00.000Z'),
              completedAt: new Date('2026-09-03T00:01:00.000Z'),
              rowsProcessed: rows.length,
              ...run,
            };
          },
        },
      };
      return callback(tx);
    },
  };
}

export async function runSyntheticSnapshotTests() {
  const first = syntheticRow();
  const second = syntheticRow({ id: 'row-2', nonconformityNo: 'NC-002', discoveredOn: null });
  const db = syntheticDb([first, second]);
  const result = await exportHermesQmdSnapshot({ db, previousManifest: { records: [{ kind: SOURCE_KIND, id: 'row-old' }] } });
  assert.equal(result.status, 'ready');
  assert.equal(result.recordCount, 2);
  assert.equal(result.records[0].evidenceKey, 'nonconformity:row-1');
  assert.equal(result.records[0].correctiveContent, '是正1\n是正2');
  assert.deepEqual(result.tombstones, ['row-old']);
  assert.deepEqual(db.options, [{ isolationLevel: 'RepeatableRead' }]);
  assert.equal(result.digest, digestRecords(result.records));
  assert.deepEqual(result.sourceRange.discoveredOn, { min: '2026-09-01', max: '2026-09-01' });

  await assert.rejects(
    () => exportHermesQmdSnapshot({ db: syntheticDb([first, syntheticRow({ id: 'row-2', lastEvaluatedIngestRunId: 'run-2' })]) }),
    (error) => error?.code === 'SNAPSHOT_MIXED'
  );
  await assert.rejects(
    () => exportHermesQmdSnapshot({ db: syntheticDb([syntheticRow({ lastSnapshotReceivedAt: null })]) }),
    (error) => error?.code === 'SNAPSHOT_INCOMPLETE'
  );
  await assert.rejects(
    () => exportHermesQmdSnapshot({ db: syntheticDb([first], { sourceReceivedAt: new Date('2026-09-04T00:00:00.000Z') }) }),
    (error) => error?.code === 'SNAPSHOT_WATERMARK_MISMATCH'
  );
  return { ok: true, recordCount: result.recordCount, digest: result.digest };
}

async function handleWorkerMessage(row, activeRequests) {
  if (row?.type === 'request' && typeof row.requestId === 'string') {
    try {
      const result = await exportHermesQmdSnapshot({ previousManifest: row.input?.previousManifest ?? null });
      process.stdout.write(`__HERMES_SNAPSHOT__${JSON.stringify({ workerRequestId: row.requestId, result })}\n`);
    } catch (error) {
      process.stdout.write(`__HERMES_SNAPSHOT__${JSON.stringify({
        workerRequestId: row.requestId,
        workerError: error instanceof Error ? error.message : String(error),
        errorCode: error?.code ?? null,
      })}\n`);
    } finally {
      activeRequests.delete(row.requestId);
    }
  }
}

async function main() {
  if (process.argv.includes('--self-test')) {
    process.stdout.write(`${JSON.stringify(await runSyntheticSnapshotTests())}\n`);
    return;
  }
  process.stdout.write('__HERMES_SNAPSHOT__{"workerReady":true}\n');
  const activeRequests = new Set();
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      process.stdout.write('__HERMES_SNAPSHOT__{"workerError":"invalid JSON request"}\n');
      continue;
    }
    if (row?.type === 'request' && typeof row.requestId === 'string') activeRequests.add(row.requestId);
    await handleWorkerMessage(row, activeRequests);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
