import { buildLeaderboardPartKeyFromScheduleRow } from './leaderboardDecorationStalePolicy';

import type {
  ProductionScheduleLeaderboardBoardResponse,
  ProductionScheduleLeaderboardDecorationsResponse,
  ProductionScheduleListResponse,
  ProductionScheduleRow
} from '../../../api/client';
import type { SelfInspectionStatus } from '../../part-measurement/types';

export type LeaderboardRowDecoration = {
  resolvedMachineName: string | null;
  customerName: string | null;
  hasSelfInspectionDrawing: boolean;
  selfInspectionTemplateId: string | null;
  selfInspectionStatus: SelfInspectionStatus | null;
  selfInspectionEntryPath: string | null;
  selfInspectionResourceCds?: string[];
  selfInspectionResourceCd?: string | null;
};

type LeaderboardFooterChipsByPartKey = NonNullable<
  ProductionScheduleListResponse['leaderboardFooterChipsByPartKey']
>;

type LeaderboardMaterialArrivalByPartKey = NonNullable<
  ProductionScheduleListResponse['leaderboardMaterialArrivalByPartKey']
>;

export type AccumulatedLeaderboardDecorations = {
  rowDecorationsById: Map<string, LeaderboardRowDecoration>;
  leaderboardFooterChipsByPartKey: LeaderboardFooterChipsByPartKey;
  leaderboardMaterialArrivalByPartKey: LeaderboardMaterialArrivalByPartKey;
};

export function createEmptyAccumulatedLeaderboardDecorations(): AccumulatedLeaderboardDecorations {
  return {
    rowDecorationsById: new Map(),
    leaderboardFooterChipsByPartKey: {},
    leaderboardMaterialArrivalByPartKey: {}
  };
}

/** 増分 `leaderboard-decorations` 応答を累積状態へマージ（partKey は上書きマージ） */
export function mergeLeaderboardDecorationsIntoAccumulator(
  prev: AccumulatedLeaderboardDecorations,
  response: ProductionScheduleLeaderboardDecorationsResponse
): AccumulatedLeaderboardDecorations {
  const rowDecorationsById = new Map(prev.rowDecorationsById);
  for (const d of response.rowDecorations) {
    rowDecorationsById.set(d.id, {
      resolvedMachineName: d.resolvedMachineName ?? null,
      customerName: d.customerName ?? null,
      hasSelfInspectionDrawing: d.hasSelfInspectionDrawing,
      selfInspectionTemplateId: d.selfInspectionTemplateId ?? null,
      selfInspectionStatus: d.selfInspectionStatus ?? null,
      selfInspectionEntryPath: d.selfInspectionEntryPath ?? null,
      selfInspectionResourceCds: d.selfInspectionResourceCds ?? [],
      selfInspectionResourceCd: d.selfInspectionResourceCd ?? null
    });
  }
  const leaderboardFooterChipsByPartKey: LeaderboardFooterChipsByPartKey = {
    ...prev.leaderboardFooterChipsByPartKey,
    ...(response.leaderboardFooterChipsByPartKey ?? {})
  };
  return {
    rowDecorationsById,
    leaderboardFooterChipsByPartKey,
    leaderboardMaterialArrivalByPartKey: mergeLeaderboardMaterialArrivalByPartKey(prev, response)
  };
}

/**
 * 材料の入荷状況を累積へマージする。応答は「材料行がある部品」だけを返すので、
 * 今回の応答で工程チップが届いた部品（＝再取得した部品）は一度消してから上書きし、
 * 材料行が無くなった部品のバッジが残らないようにする。
 */
function mergeLeaderboardMaterialArrivalByPartKey(
  prev: AccumulatedLeaderboardDecorations,
  response: ProductionScheduleLeaderboardDecorationsResponse
): LeaderboardMaterialArrivalByPartKey {
  const next: LeaderboardMaterialArrivalByPartKey = { ...prev.leaderboardMaterialArrivalByPartKey };
  for (const partKey of Object.keys(response.leaderboardFooterChipsByPartKey ?? {})) {
    delete next[partKey];
  }
  return { ...next, ...(response.leaderboardMaterialArrivalByPartKey ?? {}) };
}

export function mergeLeaderboardBoardWithDecorations(
  board: ProductionScheduleLeaderboardBoardResponse,
  decorations: AccumulatedLeaderboardDecorations
): ProductionScheduleListResponse & Pick<
  ProductionScheduleLeaderboardBoardResponse,
  | 'processChangeResidualTotal'
  | 'processChangeResidualRows'
  | 'processChangeResidualRepresentativeLimit'
  | 'resources'
  | 'deltaRows'
  | 'snapshotExpired'
> {
  const rows = board.rows.map((row): ProductionScheduleRow => {
    const deco = decorations.rowDecorationsById.get(row.id);
    const materialArrivalStatus =
      decorations.leaderboardMaterialArrivalByPartKey?.[buildLeaderboardPartKeyFromScheduleRow(row)] ?? null;
    if (!deco && materialArrivalStatus == null) return row;
    return { ...row, ...deco, materialArrivalStatus };
  });
  const footerKeys = Object.keys(decorations.leaderboardFooterChipsByPartKey);
  return {
    page: board.page,
    pageSize: board.pageSize,
    total: board.total,
    rows,
    resources: board.resources,
    ...(board.deltaRows != null ? { deltaRows: board.deltaRows } : {}),
    ...(board.snapshotExpired != null ? { snapshotExpired: board.snapshotExpired } : {}),
    ...(board.processChangeResidualTotal != null
      ? { processChangeResidualTotal: board.processChangeResidualTotal }
      : {}),
    ...(board.processChangeResidualRows != null
      ? { processChangeResidualRows: board.processChangeResidualRows }
      : {}),
    ...(board.processChangeResidualRepresentativeLimit != null
      ? { processChangeResidualRepresentativeLimit: board.processChangeResidualRepresentativeLimit }
      : {}),
    ...(footerKeys.length > 0
      ? { leaderboardFooterChipsByPartKey: decorations.leaderboardFooterChipsByPartKey }
      : {})
  };
}

export function listUndecoratedLeaderboardRowIds(
  rowIds: readonly string[],
  decoratedIds: ReadonlySet<string>
): string[] {
  return rowIds.filter((id) => !decoratedIds.has(id));
}
