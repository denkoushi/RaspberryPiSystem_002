import type {
  InspectionResult,
  PartMeasurementProcessGroup,
  SelfInspectionEntryPersistenceStatus,
  SelfInspectionMeasurementReviewStatus,
  SelfInspectionMode,
} from '@prisma/client';

import { prisma } from '../../lib/prisma.js';

/** キオスク自主検査一覧と同じ、仕掛中セッションの取得上限。 */
export const SELF_INSPECTION_MACHINE_BOARD_ACTIVE_SESSION_LIMIT = 200;

export type SelfInspectionMachineBoardActiveSession = {
  id: string;
  sessionBusinessKey: string;
  productNo: string;
  processGroup: PartMeasurementProcessGroup;
  resourceCd: string;
  scheduleRowId: string | null;
  fseiban: string | null;
  fhincd: string;
  fhinmei: string;
  /** 自主検査開始時に保存された機種名。旧セッションでは null のことがある。 */
  machineName: string | null;
  plannedQuantity: number;
  expectedEntryCount: number;
  completedAt: Date | null;
  updatedAt: Date;
  template: {
    selfInspectionMode: SelfInspectionMode;
    selfInspectionFixedCount: number | null;
    selfInspectionSampleSize: number | null;
    items: Array<{ id: string }>;
  };
  inspectorRemeasurementRequiredAt: Date | null;
  recordApproval: { id: string } | null;
  /** DRAFT も含む。存在判定は全 entry、進捗・判定は CONFIRMED entry のみを使う。 */
  entries: Array<{
    entryIndex: number;
    persistenceStatus: SelfInspectionEntryPersistenceStatus;
    values: Array<{
      judgementResult: InspectionResult | null;
      reviewStatus: SelfInspectionMeasurementReviewStatus;
      finalReviewStatus: string | null;
    }>;
  }>;
  inspectorEntries: Array<{
    entryIndex: number;
    values: Array<{
      templateItemId: string;
      inspectorValue: unknown | null;
      inspectorJudgementResult: string | null;
    }>;
  }>;
};

export type SelfInspectionMachineBoardActiveSessionList = {
  sessions: SelfInspectionMachineBoardActiveSession[];
  limit: number;
  hasMore: boolean;
};

function resolveLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return SELF_INSPECTION_MACHINE_BOARD_ACTIVE_SESSION_LIMIT;
  }
  return Math.max(
    1,
    Math.min(SELF_INSPECTION_MACHINE_BOARD_ACTIVE_SESSION_LIMIT, Math.floor(value as number))
  );
}

/**
 * キオスク自主検査画面の通常表示に対応する active session 集合を取得する。
 *
 * `entries: { some: {} }` は DRAFT-only を落とさないための意図的な条件である。
 * 取得後の判定列は active-board の純粋変換で行い、CONFIRMED のみ進捗へ反映する。
 */
export async function fetchSelfInspectionMachineBoardActiveSessions(input: {
  limit?: number;
} = {}): Promise<SelfInspectionMachineBoardActiveSessionList> {
  const limit = resolveLimit(input.limit);
  const rows = await prisma.selfInspectionSession.findMany({
    where: {
      invalidatedAt: null,
      completedAt: null,
      entries: { some: {} },
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: {
      id: true,
      sessionBusinessKey: true,
      productNo: true,
      processGroup: true,
      resourceCd: true,
      scheduleRowId: true,
      fseiban: true,
      fhincd: true,
      fhinmei: true,
      machineName: true,
      plannedQuantity: true,
      expectedEntryCount: true,
      completedAt: true,
      inspectorRemeasurementRequiredAt: true,
      updatedAt: true,
      recordApproval: { select: { id: true } },
      template: {
        select: {
          selfInspectionMode: true,
          selfInspectionFixedCount: true,
          selfInspectionSampleSize: true,
          items: { select: { id: true } },
        },
      },
      entries: {
        orderBy: { entryIndex: 'asc' },
        select: {
          entryIndex: true,
          persistenceStatus: true,
          values: {
            select: {
              judgementResult: true,
              reviewStatus: true,
              finalReviewStatus: true,
            },
          },
        },
      },
      inspectorEntries: {
        orderBy: { entryIndex: 'asc' },
        select: {
          entryIndex: true,
          values: {
            select: {
              templateItemId: true,
              inspectorValue: true,
              inspectorJudgementResult: true,
            },
          },
        },
      },
    },
  });

  const hasMore = rows.length > limit;
  return {
    sessions: (hasMore ? rows.slice(0, limit) : rows) as SelfInspectionMachineBoardActiveSession[],
    limit,
    hasMore,
  };
}

export const listSelfInspectionMachineBoardActiveSessions =
  fetchSelfInspectionMachineBoardActiveSessions;
