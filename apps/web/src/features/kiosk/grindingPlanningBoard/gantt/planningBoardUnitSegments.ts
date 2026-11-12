import type { GrindingPlanningBoardBar, GrindingPlanningBoardItem, GrindingPlanningBoardResourceMinutesResponse } from '@raspi-system/shared-types';

type Segment = { start: number; end: number };
export type OpSegment = Segment & { opNo: number; completed: boolean };
export const isUnitPiece = (item: GrindingPlanningBoardBar): item is GrindingPlanningBoardItem & { kind: 'piece'; unitRequiredMinutes: number } => item.kind === 'piece' && typeof item.unitRequiredMinutes === 'number';
export const ganttRequiredMinutes = (item: GrindingPlanningBoardBar) => item.kind === 'test' ? item.minutes : isUnitPiece(item) ? item.unitRequiredMinutes! : item.requiredMinutes;

export function unitSetupMinutesByResource(data?: GrindingPlanningBoardResourceMinutesResponse) {
  const own = new Set(data?.ownSourceResourceCds);
  const result = new Map<string, Map<string, number>>();
  for (const value of data?.values ?? []) {
    if (!own.has(value.resourceCd)) continue;
    let parts = result.get(value.resourceCd);
    if (!parts) result.set(value.resourceCd, parts = new Map());
    parts.set(value.fhincd, value.setupMinutes);
  }
  return result;
}

/** Match lane setup accounting in both layouts and machine balancing. */
export function planningBoardUnitSetupMinutes(item: GrindingPlanningBoardBar, previousPart: string | undefined,
  previousPieceId: string | undefined, setupByPart?: ReadonlyMap<string, number>) {
  if (!isUnitPiece(item)) return 0;
  if (previousPart === item.fhincd && !(item.opRange && item.pieceId && previousPieceId === item.pieceId)) return 0;
  return item.opRange ? item.setupMinutes ?? 0 : setupByPart?.get(item.fhincd) ?? 0;
}

/** Slice cumulative working time so breaks and folded windows keep operation boundaries. */
export function buildUnitSegments(item: GrindingPlanningBoardItem, segments: Segment[], setupMinutes: number) {
  const total = setupMinutes + item.unitRequiredMinutes!;
  const duration = segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
  const slice = (from: number, to: number): Segment[] => {
    let elapsed = 0;
    const result: Segment[] = [];
    for (const segment of segments) {
      const length = segment.end - segment.start;
      const start = Math.max(0, duration * from / total - elapsed);
      const end = Math.min(length, duration * to / total - elapsed);
      if (end > start + 1e-10) result.push({ start: segment.start + start, end: segment.start + end });
      elapsed += length;
    }
    return result;
  };
  const setupSegments = setupMinutes > 0 ? slice(0, setupMinutes) : [];
  const ops = [...(item.ops ?? [])].sort((a, b) => a.opNo - b.opNo);
  const sum = ops.reduce((sum, op) => sum + Math.max(0, op.minutes), 0);
  const completed = new Set(item.completedOpNos);
  let cursor = setupMinutes;
  const opSegments: OpSegment[] = [];
  for (const op of ops) {
    const end = cursor + (sum > 0 ? item.unitRequiredMinutes! * Math.max(0, op.minutes) / sum : 0);
    for (const segment of slice(cursor, end)) opSegments.push({ ...segment, opNo: op.opNo, completed: completed.has(op.opNo) });
    cursor = end;
  }
  return { setupSegments, opSegments };
}
