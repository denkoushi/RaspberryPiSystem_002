import type { ProductionScheduleLeaderboardBoardResponse, ProductionScheduleRow } from '../../../api/client';

const normalizeSlotCd = (raw: string): string => String(raw ?? '').trim().toUpperCase();

/**
 * `leaderboard-board` の集約行は `boardResourceCds` 順でスロット化され、`rows` は `[slot0..., slot1..., ...]`。
 */
export function leaderboardCompositeRowSlotResourceCd(row: ProductionScheduleRow): string | null {
  const data = row.rowData as Record<string, unknown> | undefined;
  if (!data) return null;
  const fs = data.FSIGENCD;
  const s = typeof fs === 'string' ? fs.trim() : '';
  return s.length > 0 ? s.toUpperCase() : null;
}

export function partitionLeaderboardCompositeRowsBySlotOrder(
  rows: ProductionScheduleRow[],
  orderedSlotResourceCds: readonly string[]
): ProductionScheduleRow[][] | null {
  if (orderedSlotResourceCds.length === 0) return [];
  let i = 0;
  const out: ProductionScheduleRow[][] = [];

  for (const slotCd of orderedSlotResourceCds) {
    const expected = normalizeSlotCd(slotCd);
    if (!expected) return null;
    const slice: ProductionScheduleRow[] = [];
    while (i < rows.length) {
      const at = leaderboardCompositeRowSlotResourceCd(rows[i]!);
      if (at === null || at !== expected) break;
      slice.push(rows[i]!);
      i += 1;
    }
    out.push(slice);
  }

  if (i !== rows.length) return null;
  return out;
}

type SlotSlices = ProductionScheduleRow[][];

function slotSlicesAlignWithAuthority(
  prevSlices: SlotSlices,
  deltaSlices: SlotSlices,
  authSlices: SlotSlices,
  orderedSlotResourceCds: readonly string[]
): boolean {
  if (
    prevSlices.length !== orderedSlotResourceCds.length ||
    deltaSlices.length !== orderedSlotResourceCds.length ||
    authSlices.length !== orderedSlotResourceCds.length
  ) {
    return false;
  }

  for (let si = 0; si < orderedSlotResourceCds.length; si += 1) {
    const p = prevSlices[si]!;
    const d = deltaSlices[si]!;
    const a = authSlices[si]!;
    if (p.length + d.length !== a.length) return false;
    for (let j = 0; j < p.length; j += 1) {
      if (p[j]!.id !== a[j]!.id) return false;
    }
    for (let j = p.length; j < a.length; j += 1) {
      const di = j - p.length;
      if (d[di]!.id !== a[j]!.id) return false;
    }
  }
  return true;
}

function reconcileRowsWithOptionalDeltaReferences(
  authorityRows: ProductionScheduleRow[],
  prevBoardRows: ProductionScheduleRow[],
  deltaRows: ProductionScheduleRow[]
): ProductionScheduleRow[] {
  const prevById = new Map(prevBoardRows.map((r) => [r.id, r] as const));
  const deltaById = new Map(deltaRows.map((r) => [r.id, r] as const));

  return authorityRows.map((authRow) => {
    const fromDelta = deltaById.get(authRow.id);
    if (fromDelta) return fromDelta;
    const fromPrev = prevById.get(authRow.id);
    if (fromPrev) return fromPrev;
    return authRow;
  });
}

/**
 * `deltaRows` をスロット整合・ID 列検証できるときのみ参照再利用マージを行う。
 */
export function canMergeLeaderboardContinueDelta(
  prevBoardRows: ProductionScheduleRow[],
  nextBoardResponse: ProductionScheduleLeaderboardBoardResponse,
  orderedSlotResourceCds: readonly string[]
): boolean {
  const { rows: authorityRows, deltaRows } = nextBoardResponse;
  if (!deltaRows) return false;

  const prevSlices = partitionLeaderboardCompositeRowsBySlotOrder(prevBoardRows, orderedSlotResourceCds);
  const deltaSlices = partitionLeaderboardCompositeRowsBySlotOrder(deltaRows, orderedSlotResourceCds);
  const authSlices = partitionLeaderboardCompositeRowsBySlotOrder(authorityRows, orderedSlotResourceCds);

  if (!prevSlices || !deltaSlices || !authSlices) return false;
  return slotSlicesAlignWithAuthority(prevSlices, deltaSlices, authSlices, orderedSlotResourceCds);
}

/**
 * `continue` が `deltaRows` を同梱したとき、累積 `rows` の表示オブジェクト参照を可能な範囲で再利用する。
 * 不整合・パーティション不能時は `nextBoardResponse` をそのまま返す（安全フォールバック）。
 */
export function mergeLeaderboardBoardContinueResponseWithOptionalDelta(
  prevBoardRows: ProductionScheduleRow[],
  nextBoardResponse: ProductionScheduleLeaderboardBoardResponse,
  orderedSlotResourceCds: readonly string[],
  prevBoardMeta?: Pick<
    ProductionScheduleLeaderboardBoardResponse,
    'processChangeResidualTotal' | 'processChangeResidualRows' | 'processChangeResidualRepresentativeLimit'
  >
): ProductionScheduleLeaderboardBoardResponse {
  if (!canMergeLeaderboardContinueDelta(prevBoardRows, nextBoardResponse, orderedSlotResourceCds)) {
    return preserveProcessChangeResidualMeta(nextBoardResponse, prevBoardMeta);
  }

  const { rows: authorityRows, deltaRows } = nextBoardResponse;
  const reconciledRows = reconcileRowsWithOptionalDeltaReferences(
    authorityRows,
    prevBoardRows,
    deltaRows!
  );

  return preserveProcessChangeResidualMeta(
    { ...nextBoardResponse, rows: reconciledRows },
    prevBoardMeta
  );
}

function preserveProcessChangeResidualMeta(
  board: ProductionScheduleLeaderboardBoardResponse,
  prevBoardMeta?: Pick<
    ProductionScheduleLeaderboardBoardResponse,
    'processChangeResidualTotal' | 'processChangeResidualRows' | 'processChangeResidualRepresentativeLimit'
  >
): ProductionScheduleLeaderboardBoardResponse {
  if (prevBoardMeta == null) {
    return board;
  }
  return {
    ...board,
    processChangeResidualTotal: prevBoardMeta.processChangeResidualTotal ?? board.processChangeResidualTotal,
    processChangeResidualRows: prevBoardMeta.processChangeResidualRows ?? board.processChangeResidualRows,
    processChangeResidualRepresentativeLimit:
      prevBoardMeta.processChangeResidualRepresentativeLimit ?? board.processChangeResidualRepresentativeLimit
  };
}
