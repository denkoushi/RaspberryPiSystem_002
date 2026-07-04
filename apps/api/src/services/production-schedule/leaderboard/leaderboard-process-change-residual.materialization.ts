import { performance } from 'node:perf_hooks';
import type { Prisma } from '@prisma/client';
import { prisma as defaultPrisma } from '../../../lib/prisma.js';
import type { prisma as prismaSingleton } from '../../../lib/prisma.js';
import {
  collectFkojunstMailNormalizedRowsFromSourceRows,
  dedupeFkojunstMailRowsByLatest,
  type FkojunstMailNormalizedRow
} from '../fkojunst-status-mail-sync.pipeline.js';
import {
  fetchFkojunstStatusMailSourceRowsWithGenerationSignals,
} from '../fkojunst-status-mail-generation-signals.js';
import {
  buildProcessChangeResidualStrongEvidenceKey,
  buildProcessChangeResidualStrongEvidenceKeyArrays,
  type ProcessChangeResidualStrongEvidenceKeyArrays
} from './leaderboard-process-change-residual.keys.js';
import type { ProcessChangeResidualEvidence } from './leaderboard-process-change-residual.types.js';
import { PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID } from '../constants.js';
import { PROCESS_CHANGE_RESIDUAL_EVIDENCE_ALGORITHM_VERSION } from './leaderboard-process-change-residual.version.js';

export type { ProcessChangeResidualStrongEvidenceKeyArrays } from './leaderboard-process-change-residual.keys.js';
export {
  buildProcessChangeResidualStrongEvidenceKey,
  parseProcessChangeResidualStrongEvidenceKey
} from './leaderboard-process-change-residual.keys.js';

export type ProcessChangeResidualStrongEvidenceMaterialization = {
  keys: ReadonlySet<string>;
  keyArrays: ProcessChangeResidualStrongEvidenceKeyArrays;
  evidenceByKey: ReadonlyMap<string, Omit<ProcessChangeResidualEvidence, never>>;
  rawMailRowsRevision?: string;
};

export type ProcessChangeResidualStrongEvidenceMaterializationTelemetryEvent = {
  cacheHit: boolean;
  persistedHit?: boolean;
  persistedEvidenceRowCount?: number;
  rawRowCount?: number;
  normalizedRowCount?: number;
  dedupedRowCount?: number;
  strongEvidenceKeyCount?: number;
  sourceRowFetchDurationMs?: number;
  normalizeDurationMs?: number;
  dedupeDurationMs?: number;
  buildEvidenceDurationMs?: number;
};

export type ProcessChangeResidualStrongEvidenceMaterializationOptions = {
  fkojunstStatusMailRowsRevision?: string;
  telemetry?: (event: ProcessChangeResidualStrongEvidenceMaterializationTelemetryEvent) => void;
};

type PrismaClientLike = Pick<typeof prismaSingleton, 'csvDashboardRow' | '$queryRaw'> &
  Partial<
    Pick<
      typeof prismaSingleton,
      'productionScheduleProcessChangeResidualSnapshot' | 'productionScheduleProcessChangeResidualEvidence'
    >
  >;

function isPrismaClientLike(
  value: PrismaClientLike | ProcessChangeResidualStrongEvidenceMaterializationOptions
): value is PrismaClientLike {
  return typeof value === 'object' && value !== null && ('$queryRaw' in value || 'csvDashboardRow' in value);
}

type PersistedProcessChangeResidualEvidenceRow = {
  productNo: string;
  fkojun: string;
  resourceCd: string;
  currentStatusCode: string;
  currentSourceUpdatedAt: Date;
  completedOtherResourceCd: string;
  completedOtherStatusCode: string;
  completedOtherSourceUpdatedAt: Date;
};

const RESIDUAL_STATUS_CODES = new Set(['C', 'S', 'R', 'X']);
const CURRENT_SR_STATUS_CODES = new Set(['S', 'R']);
const OTHER_CX_STATUS_CODES = new Set(['C', 'X']);

let materializationCache:
  | {
      rawMailRowsRevision: string;
      materialization: ProcessChangeResidualStrongEvidenceMaterialization;
    }
  | undefined;
let materializationInFlight: Promise<ProcessChangeResidualStrongEvidenceMaterialization> | undefined;

function toIsoOrNull(value: Date | null): string | null {
  return value == null ? null : value.toISOString();
}

function productFkojunGroupKey(row: Pick<FkojunstMailNormalizedRow, 'fsezono' | 'fkojun'>): string {
  return `${row.fsezono}\u0000${row.fkojun}`;
}

function dateFromEvidenceIso(value: string | null): Date {
  return value == null || value.length === 0 ? new Date('1970-01-01T00:00:00.000Z') : new Date(value);
}

function buildMaterializationFromPersistedEvidenceRows(
  rows: readonly PersistedProcessChangeResidualEvidenceRow[],
  rawMailRowsRevision: string
): ProcessChangeResidualStrongEvidenceMaterialization {
  const keys = new Set<string>();
  const evidenceByKey = new Map<string, ProcessChangeResidualEvidence>();

  for (const row of rows) {
    const key = buildProcessChangeResidualStrongEvidenceKey({
      productNo: row.productNo,
      fkojun: row.fkojun,
      resourceCd: row.resourceCd
    });
    keys.add(key);
    evidenceByKey.set(key, {
      current: {
        productNo: row.productNo,
        fkojun: row.fkojun,
        resourceCd: row.resourceCd,
        status: row.currentStatusCode,
        fupdtedt: toIsoOrNull(row.currentSourceUpdatedAt)
      },
      completedOtherResource: {
        productNo: row.productNo,
        fkojun: row.fkojun,
        resourceCd: row.completedOtherResourceCd,
        status: row.completedOtherStatusCode,
        fupdtedt: toIsoOrNull(row.completedOtherSourceUpdatedAt)
      }
    });
  }

  return {
    keys,
    keyArrays: buildProcessChangeResidualStrongEvidenceKeyArrays(keys),
    evidenceByKey,
    rawMailRowsRevision
  };
}

export function buildProcessChangeResidualEvidenceCreateInputs(
  materialization: ProcessChangeResidualStrongEvidenceMaterialization
): Prisma.ProductionScheduleProcessChangeResidualEvidenceCreateManyInput[] {
  return [...materialization.evidenceByKey.values()].map((evidence) => ({
    sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
    productNo: evidence.current.productNo,
    fkojun: evidence.current.fkojun,
    resourceCd: evidence.current.resourceCd,
    currentStatusCode: evidence.current.status,
    currentSourceUpdatedAt: dateFromEvidenceIso(evidence.current.fupdtedt),
    completedOtherResourceCd: evidence.completedOtherResource.resourceCd,
    completedOtherStatusCode: evidence.completedOtherResource.status,
    completedOtherSourceUpdatedAt: dateFromEvidenceIso(evidence.completedOtherResource.fupdtedt)
  }));
}

/**
 * {@link dedupeFkojunstMailRowsByLatest} 済み raw 行から強い工程変更残骸疑いキー集合を構築する。
 * FUPDTEDT 解釈・tie-break はメール同期 pipeline と同一（JS 正本）。
 */
export function buildProcessChangeResidualStrongEvidenceFromDedupedRows(
  dedupedRows: readonly FkojunstMailNormalizedRow[]
): ProcessChangeResidualStrongEvidenceMaterialization {
  const rowsByProductFkojun = new Map<string, FkojunstMailNormalizedRow[]>();

  for (const row of dedupedRows) {
    if (!RESIDUAL_STATUS_CODES.has(row.statusCode)) {
      continue;
    }
    const groupKey = productFkojunGroupKey(row);
    const group = rowsByProductFkojun.get(groupKey) ?? [];
    group.push(row);
    rowsByProductFkojun.set(groupKey, group);
  }

  const keys = new Set<string>();
  const evidenceByKey = new Map<string, ProcessChangeResidualEvidence>();

  for (const row of dedupedRows) {
    if (!CURRENT_SR_STATUS_CODES.has(row.statusCode) || row.hasUnparseableDate) {
      continue;
    }

    const peers = rowsByProductFkojun.get(productFkojunGroupKey(row)) ?? [];
    for (const other of peers) {
      if (other.fkoteicd === row.fkoteicd) {
        continue;
      }
      if (!OTHER_CX_STATUS_CODES.has(other.statusCode) || other.hasUnparseableDate) {
        continue;
      }
      if (other.sourceUpdatedAt.getTime() < row.sourceUpdatedAt.getTime()) {
        continue;
      }

      const key = buildProcessChangeResidualStrongEvidenceKey({
        productNo: row.fsezono,
        fkojun: row.fkojun,
        resourceCd: row.fkoteicd
      });
      keys.add(key);

      const candidate: ProcessChangeResidualEvidence = {
        current: {
          productNo: row.fsezono,
          fkojun: row.fkojun,
          resourceCd: row.fkoteicd,
          status: row.statusCode,
          fupdtedt: toIsoOrNull(row.sourceUpdatedAt)
        },
        completedOtherResource: {
          productNo: other.fsezono,
          fkojun: other.fkojun,
          resourceCd: other.fkoteicd,
          status: other.statusCode,
          fupdtedt: toIsoOrNull(other.sourceUpdatedAt)
        }
      };

      const existing = evidenceByKey.get(key);
      if (existing == null) {
        evidenceByKey.set(key, candidate);
        continue;
      }

      const existingOtherAt = existing.completedOtherResource.fupdtedt ?? '';
      const candidateOtherAt = candidate.completedOtherResource.fupdtedt ?? '';
      if (candidateOtherAt > existingOtherAt) {
        evidenceByKey.set(key, candidate);
      }
    }
  }

  return {
    keys,
    keyArrays: buildProcessChangeResidualStrongEvidenceKeyArrays(keys),
    evidenceByKey
  };
}

/** テスト用: generation token キャッシュをクリアする。 */
export function resetProcessChangeResidualStrongEvidenceMaterializationCacheForTests(): void {
  materializationCache = undefined;
  materializationInFlight = undefined;
}

function emitProcessChangeResidualStrongEvidenceMaterializationTelemetry(
  telemetry: ProcessChangeResidualStrongEvidenceMaterializationOptions['telemetry'],
  event: ProcessChangeResidualStrongEvidenceMaterializationTelemetryEvent
): void {
  if (!telemetry) return;
  try {
    telemetry(event);
  } catch {
    // 計測 callback は診断専用。失敗しても residual 判定結果を壊さない。
  }
}

async function fetchPersistedProcessChangeResidualStrongEvidence(
  prisma: PrismaClientLike,
  rawMailRowsRevision: string | undefined
): Promise<ProcessChangeResidualStrongEvidenceMaterialization | undefined> {
  const requestedRawMailRevision = rawMailRowsRevision?.trim();
  if (requestedRawMailRevision == null || requestedRawMailRevision.length === 0) {
    return undefined;
  }

  const snapshotDelegate = prisma.productionScheduleProcessChangeResidualSnapshot;
  const evidenceDelegate = prisma.productionScheduleProcessChangeResidualEvidence;
  if (snapshotDelegate == null || evidenceDelegate == null) {
    return undefined;
  }

  const snapshot = await snapshotDelegate.findUnique({
    where: {
      sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID
    },
    select: {
      rawMailRowsRevision: true,
      algorithmVersion: true,
      evidenceCount: true
    }
  });
  if (
    snapshot?.rawMailRowsRevision !== requestedRawMailRevision ||
    snapshot.algorithmVersion !== PROCESS_CHANGE_RESIDUAL_EVIDENCE_ALGORITHM_VERSION
  ) {
    return undefined;
  }

  const evidenceRows =
    snapshot.evidenceCount > 0
      ? await evidenceDelegate.findMany({
          where: {
            sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID
          },
          select: {
            productNo: true,
            fkojun: true,
            resourceCd: true,
            currentStatusCode: true,
            currentSourceUpdatedAt: true,
            completedOtherResourceCd: true,
            completedOtherStatusCode: true,
            completedOtherSourceUpdatedAt: true
          },
          orderBy: [{ productNo: 'asc' }, { fkojun: 'asc' }, { resourceCd: 'asc' }]
        })
      : [];

  return buildMaterializationFromPersistedEvidenceRows(evidenceRows, requestedRawMailRevision);
}

/**
 * raw `FKOJUNST_Status` を読み、{@link dedupeFkojunstMailRowsByLatest} と同型で最新化して強い疑いキー集合を返す。
 * SQL 相関 / cast は使わず、メール同期 pipeline と同一の JS 正本で residual 判定する。
 */
export async function materializeProcessChangeResidualStrongEvidence(
  options: ProcessChangeResidualStrongEvidenceMaterializationOptions
): Promise<ProcessChangeResidualStrongEvidenceMaterialization>;
export async function materializeProcessChangeResidualStrongEvidence(
  prisma: PrismaClientLike,
  options?: ProcessChangeResidualStrongEvidenceMaterializationOptions
): Promise<ProcessChangeResidualStrongEvidenceMaterialization>;
export async function materializeProcessChangeResidualStrongEvidence(
  prismaOrOptions: PrismaClientLike | ProcessChangeResidualStrongEvidenceMaterializationOptions,
  maybeOptions?: ProcessChangeResidualStrongEvidenceMaterializationOptions
): Promise<ProcessChangeResidualStrongEvidenceMaterialization> {
  const prisma = isPrismaClientLike(prismaOrOptions) ? prismaOrOptions : defaultPrisma;
  const options = isPrismaClientLike(prismaOrOptions) ? maybeOptions : prismaOrOptions;
  const requestedRawMailRevision = options?.fkojunstStatusMailRowsRevision?.trim();
  if (
    requestedRawMailRevision != null &&
    requestedRawMailRevision.length > 0 &&
    materializationCache?.rawMailRowsRevision === requestedRawMailRevision
  ) {
    emitProcessChangeResidualStrongEvidenceMaterializationTelemetry(options?.telemetry, {
      cacheHit: true,
      strongEvidenceKeyCount: materializationCache.materialization.keys.size
    });
    return materializationCache.materialization;
  }

  if (materializationInFlight) {
    const materialization = await materializationInFlight;
    emitProcessChangeResidualStrongEvidenceMaterializationTelemetry(options?.telemetry, {
      cacheHit: true,
      strongEvidenceKeyCount: materialization.keys.size
    });
    return materialization;
  }

  const inFlight = materializeProcessChangeResidualStrongEvidenceUncached(prisma, options);
  materializationInFlight = inFlight;
  try {
    return await inFlight;
  } finally {
    if (materializationInFlight === inFlight) {
      materializationInFlight = undefined;
    }
  }
}

async function materializeProcessChangeResidualStrongEvidenceUncached(
  prisma: PrismaClientLike,
  options?: ProcessChangeResidualStrongEvidenceMaterializationOptions
): Promise<ProcessChangeResidualStrongEvidenceMaterialization> {
  const persistedStarted = performance.now();
  const persistedMaterialization = await fetchPersistedProcessChangeResidualStrongEvidence(
    prisma,
    options?.fkojunstStatusMailRowsRevision
  );
  const persistedDurationMs = performance.now() - persistedStarted;
  if (persistedMaterialization != null) {
    emitProcessChangeResidualStrongEvidenceMaterializationTelemetry(options?.telemetry, {
      cacheHit: false,
      persistedHit: true,
      persistedEvidenceRowCount: persistedMaterialization.keys.size,
      strongEvidenceKeyCount: persistedMaterialization.keys.size,
      sourceRowFetchDurationMs: persistedDurationMs,
      normalizeDurationMs: 0,
      dedupeDurationMs: 0,
      buildEvidenceDurationMs: 0
    });
    materializationCache = {
      rawMailRowsRevision: persistedMaterialization.rawMailRowsRevision ?? '',
      materialization: persistedMaterialization
    };
    return persistedMaterialization;
  }

  const sourceRowFetchStarted = performance.now();
  const { sourceRows, signals } = await fetchFkojunstStatusMailSourceRowsWithGenerationSignals(prisma);
  const sourceRowFetchDurationMs = performance.now() - sourceRowFetchStarted;
  const rowsRevision = signals.rowsRevision;

  const normalizeStarted = performance.now();
  const { normalizedRows } = collectFkojunstMailNormalizedRowsFromSourceRows(sourceRows);
  const normalizeDurationMs = performance.now() - normalizeStarted;

  const dedupeStarted = performance.now();
  const dedupedRows = dedupeFkojunstMailRowsByLatest(normalizedRows);
  const dedupeDurationMs = performance.now() - dedupeStarted;

  const buildEvidenceStarted = performance.now();
  const materialization = buildProcessChangeResidualStrongEvidenceFromDedupedRows(dedupedRows);
  const buildEvidenceDurationMs = performance.now() - buildEvidenceStarted;

  emitProcessChangeResidualStrongEvidenceMaterializationTelemetry(options?.telemetry, {
    cacheHit: false,
    rawRowCount: sourceRows.length,
    normalizedRowCount: normalizedRows.length,
    dedupedRowCount: dedupedRows.length,
    strongEvidenceKeyCount: materialization.keys.size,
    sourceRowFetchDurationMs,
    normalizeDurationMs,
    dedupeDurationMs,
    buildEvidenceDurationMs
  });

  const materializationWithRevision = {
    ...materialization,
    rawMailRowsRevision: rowsRevision
  };

  if (rowsRevision.length > 0) {
    materializationCache = {
      rawMailRowsRevision: rowsRevision,
      materialization: materializationWithRevision
    };
  }

  return materializationWithRevision;
}
