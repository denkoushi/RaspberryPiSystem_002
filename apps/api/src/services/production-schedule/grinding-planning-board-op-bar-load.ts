import { resolveRequiredMinutes } from './grinding-planning-board-required-minutes.js';
import { Prisma } from '@prisma/client';
import type { GrindingPlanningBoardResourceMinutesResponse } from '@raspi-system/shared-types';

export type OpBarSummaryFields = {
  opBarFromOpNo?: number | null;
  opBarToOpNo?: number | null;
  opBarSourceResourceCd?: string | null;
  completedOpNos?: number[];
};

// The nullable leading start retains piece:<id>; later starts use pieceops:<id>:<opNo>.
// No split produces one null lateral row, preserving the existing quantity path.
export const OP_BAR_LOAD_JOINS_SQL = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT starts."fromOpNo" AS "opBarFromOpNo",
      LEAD(starts."fromOpNo") OVER (ORDER BY starts."fromOpNo" NULLS FIRST) - 1 AS "opBarToOpNo",
      starts."sourceResourceCd" AS "opBarSourceResourceCd",
      ARRAY(SELECT completion."opNo" FROM "ProductionScheduleSessakuPieceOpCompletion" completion
        WHERE completion."pieceId" = pc."id" ORDER BY completion."opNo") AS "completedOpNos"
    FROM (
      SELECT split."fromOpNo", split."sourceResourceCd"
      FROM "ProductionScheduleSessakuPieceOpSplit" split WHERE split."pieceId" = pc."id"
      UNION ALL
      SELECT NULL::integer, COALESCE(first_split."leadingSourceResourceCd", first_split."sourceResourceCd")
      FROM (SELECT split."leadingSourceResourceCd", split."sourceResourceCd"
        FROM "ProductionScheduleSessakuPieceOpSplit" split WHERE split."pieceId" = pc."id"
        ORDER BY split."fromOpNo" LIMIT 1) first_split
    ) starts
  ) op_bars ON TRUE
`;

export function resolveOpBarMinutes(
  row: OpBarSummaryFields & { includeSetup?: boolean },
  quantity: number | null,
  fhincd: string,
  settings: GrindingPlanningBoardResourceMinutesResponse
): { requiredMinutes: number | null; isCompleted: boolean } {
  const definition = settings.values.find((value) => value.resourceCd === row.opBarSourceResourceCd && value.fhincd === fhincd.trim());
  const ops = (definition?.ops ?? []).filter((op) => (row.opBarFromOpNo == null || op.opNo >= row.opBarFromOpNo)
    && (row.opBarToOpNo == null || op.opNo <= row.opBarToOpNo));
  return {
    requiredMinutes: ops.length && quantity != null
      ? ops.reduce((sum, op) => sum + op.minutes, 0) * quantity
        + (row.includeSetup === false ? 0 : ops.reduce((sum, op) => sum + (op.setupMinutes ?? 0), 0)) : null,
    isCompleted: ops.length > 0 && ops.every((op) => row.completedOpNos?.includes(op.opNo))
  };
}

export type LoadSummaryAggregateRow = OpBarSummaryFields & {
  originalResourceCd: string | null;
  effectiveResourceCd: string | null;
  includeSetup?: boolean;
  fhincd?: string | null; quantity?: number | null;
  itemCount: bigint;
  unknownItemCount: bigint;
  requiredMinutesSum: number | null;
};


export function resolveOpBarLoadAggregates(aggregateRows: LoadSummaryAggregateRow[], resourceMinutes: GrindingPlanningBoardResourceMinutesResponse) {
  return aggregateRows.flatMap((row) => {
    const count = Number(row.itemCount);
    if (row.opBarSourceResourceCd) {
      const resolved = resolveOpBarMinutes(row, row.quantity ?? null, row.fhincd ?? '', resourceMinutes);
      return resolved.isCompleted ? [] : [{ ...row,
        requiredMinutesSum: resolved.requiredMinutes == null ? null : resolved.requiredMinutes * count,
        unknownItemCount: resolved.requiredMinutes == null ? row.itemCount : 0n }];
    }
    const resolved = resolveRequiredMinutes({
      originalMinutes: row.requiredMinutesSum == null ? null : row.requiredMinutesSum / count,
      originalKnown: Number(row.unknownItemCount) === 0,
      quantity: row.quantity ?? null, includeSetup: row.includeSetup, effectiveResourceCd: row.effectiveResourceCd, fhincd: row.fhincd ?? ''
    }, resourceMinutes);
    return [resolved.requiredMinutesSource === 'own'
      ? { ...row, requiredMinutesSum: resolved.requiredMinutes! * count, unknownItemCount: 0n } : row];
  });
}
