import type {
  ProductionScheduleLeaderboardBoardResponse,
  ProductionScheduleLeaderboardDecorationsResponse,
  ProductionScheduleListResponse,
  ProductionScheduleRow
} from '../../../api/client';

export type LeaderboardRowDecoration = {
  resolvedMachineName: string | null;
  customerName: string | null;
  hasSelfInspectionDrawing: boolean;
  selfInspectionTemplateId: string | null;
  selfInspectionStatus: 'not_started' | 'in_progress' | 'completed' | null;
  selfInspectionEntryPath: string | null;
};

type LeaderboardFooterChipsByPartKey = NonNullable<
  ProductionScheduleListResponse['leaderboardFooterChipsByPartKey']
>;

export type AccumulatedLeaderboardDecorations = {
  rowDecorationsById: Map<string, LeaderboardRowDecoration>;
  leaderboardFooterChipsByPartKey: LeaderboardFooterChipsByPartKey;
};

export function createEmptyAccumulatedLeaderboardDecorations(): AccumulatedLeaderboardDecorations {
  return {
    rowDecorationsById: new Map(),
    leaderboardFooterChipsByPartKey: {}
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
      selfInspectionEntryPath: d.selfInspectionEntryPath ?? null
    });
  }
  const leaderboardFooterChipsByPartKey: LeaderboardFooterChipsByPartKey = {
    ...prev.leaderboardFooterChipsByPartKey,
    ...(response.leaderboardFooterChipsByPartKey ?? {})
  };
  return { rowDecorationsById, leaderboardFooterChipsByPartKey };
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
    return deco ? { ...row, ...deco } : row;
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
