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

type PrismaClientLike = Pick<typeof prismaSingleton, 'csvDashboardRow' | '$queryRaw'>;

const RESIDUAL_STATUS_CODES = new Set(['C', 'S', 'R', 'X']);
const CURRENT_SR_STATUS_CODES = new Set(['S', 'R']);
const OTHER_CX_STATUS_CODES = new Set(['C', 'X']);

let materializationCache:
  | {
      rawMailRowsRevision: string;
      materialization: ProcessChangeResidualStrongEvidenceMaterialization;
    }
  | undefined;

function toIsoOrNull(value: Date | null): string | null {
  return value == null ? null : value.toISOString();
}

function productFkojunGroupKey(row: Pick<FkojunstMailNormalizedRow, 'fsezono' | 'fkojun'>): string {
  return `${row.fsezono}\u0000${row.fkojun}`;
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
}

/**
 * raw `FKOJUNST_Status` を読み、{@link dedupeFkojunstMailRowsByLatest} と同型で最新化して強い疑いキー集合を返す。
 * SQL 相関 / cast は使わず、メール同期 pipeline と同一の JS 正本で residual 判定する。
 */
export async function materializeProcessChangeResidualStrongEvidence(
  prisma: PrismaClientLike,
  options?: { fkojunstStatusMailRowsRevision?: string }
): Promise<ProcessChangeResidualStrongEvidenceMaterialization> {
  const requestedRawMailRevision = options?.fkojunstStatusMailRowsRevision?.trim();
  if (
    requestedRawMailRevision != null &&
    requestedRawMailRevision.length > 0 &&
    materializationCache?.rawMailRowsRevision === requestedRawMailRevision
  ) {
    return materializationCache.materialization;
  }

  const { sourceRows, signals } = await fetchFkojunstStatusMailSourceRowsWithGenerationSignals(prisma);
  const rowsRevision = signals.rowsRevision;

  const { normalizedRows } = collectFkojunstMailNormalizedRowsFromSourceRows(sourceRows);
  const dedupedRows = dedupeFkojunstMailRowsByLatest(normalizedRows);
  const materialization = buildProcessChangeResidualStrongEvidenceFromDedupedRows(dedupedRows);
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
