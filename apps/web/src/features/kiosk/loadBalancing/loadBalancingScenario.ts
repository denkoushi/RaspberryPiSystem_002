import type {
  ProductionScheduleLoadBalancingWorkspaceResource,
  ProductionScheduleLoadBalancingWorkspaceRow,
  ProductionScheduleLoadBalancingWorkspaceTransferRule
} from '../../../api/client';

/**
 * 負荷調整の試算（DB は更新しない）。
 * サーバが返した「行 × 月の配分」を、外注・移管・後ろへ の操作で組み替えて資源×月の負荷を出す。
 */

export const LATE_BUCKET = 'late';

export type ScenarioAction =
  | { rowId: string; type: 'outsource' }
  | { rowId: string; type: 'transfer'; toResourceCd: string; efficiencyRatio: number }
  /** fromBucket にある分を次の月へ（late は表示範囲の先頭月へ） */
  | { rowId: string; type: 'defer'; fromBucket: string };

export type ScenarioActionType = ScenarioAction['type'];

export type PlacedAllocation = { resourceCd: string; bucket: string; minutes: number };

export type LoadMatrix = Map<string, Map<string, number>>;

export type TransferDestination = {
  resourceCd: string;
  efficiencyRatio: number;
  /** 移管先に載る分（行の分 / 効率係数） */
  burdenMinutes: number;
  spareMinutes: number;
  fits: boolean;
};

export function nextBucket(bucket: string, months: string[]): string | null {
  if (bucket === LATE_BUCKET) return months[0] ?? null;
  const index = months.indexOf(bucket);
  return index >= 0 && index + 1 < months.length ? months[index + 1]! : null;
}

/** 操作を適用した後、その行の負荷がどの資源・どの列に載るか（範囲外へ出た分は含めない） */
export function placeRow(
  row: ProductionScheduleLoadBalancingWorkspaceRow,
  action: ScenarioAction | undefined,
  months: string[]
): PlacedAllocation[] {
  if (!action) {
    return row.allocations.map((allocation) => ({ resourceCd: row.resourceCd, ...allocation }));
  }
  switch (action.type) {
    case 'outsource':
      return [];
    case 'transfer':
      return row.allocations.map((allocation) => ({
        resourceCd: action.toResourceCd,
        bucket: allocation.bucket,
        minutes: allocation.minutes / action.efficiencyRatio
      }));
    case 'defer': {
      const target = nextBucket(action.fromBucket, months);
      const placed: PlacedAllocation[] = [];
      for (const allocation of row.allocations) {
        const bucket = allocation.bucket === action.fromBucket ? target : allocation.bucket;
        if (bucket) placed.push({ resourceCd: row.resourceCd, bucket, minutes: allocation.minutes });
      }
      return placed;
    }
  }
}

export function indexActions(actions: ScenarioAction[]): Map<string, ScenarioAction> {
  return new Map(actions.map((action) => [action.rowId, action]));
}

export function buildLoadMatrix(
  rows: ProductionScheduleLoadBalancingWorkspaceRow[],
  actions: ScenarioAction[],
  months: string[]
): LoadMatrix {
  const byRow = indexActions(actions);
  const matrix: LoadMatrix = new Map();
  for (const row of rows) {
    for (const placed of placeRow(row, byRow.get(row.rowId), months)) {
      const perResource = matrix.get(placed.resourceCd) ?? new Map<string, number>();
      perResource.set(placed.bucket, (perResource.get(placed.bucket) ?? 0) + placed.minutes);
      matrix.set(placed.resourceCd, perResource);
    }
  }
  return matrix;
}

export function readLoad(matrix: LoadMatrix, resourceCd: string, bucket: string): number {
  return matrix.get(resourceCd)?.get(bucket) ?? 0;
}

export function readCapacity(
  resource: ProductionScheduleLoadBalancingWorkspaceResource | undefined,
  bucket: string
): number | null {
  if (!resource || bucket === LATE_BUCKET) return null;
  return resource.capacityByMonth[bucket] ?? null;
}

/** 能力が設定された資源・月だけで数えた超過分の合計（未設定は超過に数えない） */
export function sumOverMinutes(
  matrix: LoadMatrix,
  resources: ProductionScheduleLoadBalancingWorkspaceResource[],
  months: string[]
): { overMinutes: number; overResourceCount: number } {
  let overMinutes = 0;
  let overResourceCount = 0;
  for (const resource of resources) {
    let over = false;
    for (const month of months) {
      const capacity = readCapacity(resource, month);
      if (capacity == null) continue;
      const excess = readLoad(matrix, resource.resourceCd, month) - capacity;
      if (excess > 0.5) {
        overMinutes += excess;
        over = true;
      }
    }
    if (over) overResourceCount += 1;
  }
  return { overMinutes, overResourceCount };
}

/** 移管ルール（分類 → 分類）で行ける資源と、その月の余力 */
export function listTransferDestinations(params: {
  sourceResourceCd: string;
  bucket: string;
  rowMinutes: number;
  resources: ProductionScheduleLoadBalancingWorkspaceResource[];
  rules: ProductionScheduleLoadBalancingWorkspaceTransferRule[];
  matrix: LoadMatrix;
}): TransferDestination[] {
  const byCd = new Map(params.resources.map((resource) => [resource.resourceCd, resource]));
  const sourceClass = byCd.get(params.sourceResourceCd)?.classCode;
  if (!sourceClass) return [];

  const destinations = new Map<string, TransferDestination & { priority: number }>();
  const rules = params.rules
    .filter((rule) => rule.fromClassCode === sourceClass)
    .sort((a, b) => a.priority - b.priority);
  for (const rule of rules) {
    for (const resource of params.resources) {
      if (resource.classCode !== rule.toClassCode || resource.resourceCd === params.sourceResourceCd) continue;
      if (destinations.has(resource.resourceCd)) continue;
      const capacity = readCapacity(resource, params.bucket);
      if (capacity == null) continue;
      const spareMinutes = capacity - readLoad(params.matrix, resource.resourceCd, params.bucket);
      const burdenMinutes = params.rowMinutes / rule.efficiencyRatio;
      destinations.set(resource.resourceCd, {
        resourceCd: resource.resourceCd,
        efficiencyRatio: rule.efficiencyRatio,
        burdenMinutes,
        spareMinutes,
        fits: spareMinutes >= burdenMinutes,
        priority: rule.priority
      });
    }
  }
  return [...destinations.values()]
    .sort(
      (a, b) =>
        Number(b.fits) - Number(a.fits) || a.priority - b.priority || b.spareMinutes - a.spareMinutes
    )
    .map(({ priority: _priority, ...destination }) => destination);
}

/** その資源・列に今載っている行と、その列での分 */
export function listCellRows(params: {
  rows: ProductionScheduleLoadBalancingWorkspaceRow[];
  actions: ScenarioAction[];
  months: string[];
  resourceCd: string;
  bucket: string;
}): Array<{
  row: ProductionScheduleLoadBalancingWorkspaceRow;
  /** 元の配置でこの列にある分（操作前） */
  originalMinutes: number;
  /** 操作後にこの列に載る分 */
  placedMinutes: number;
  action: ScenarioAction | undefined;
  movedIn: boolean;
}> {
  const byRow = indexActions(params.actions);
  const result = [];
  for (const row of params.rows) {
    const originalMinutes =
      row.resourceCd === params.resourceCd
        ? row.allocations.find((allocation) => allocation.bucket === params.bucket)?.minutes ?? 0
        : 0;
    const action = byRow.get(row.rowId);
    const placedMinutes = placeRow(row, action, params.months)
      .filter((placed) => placed.resourceCd === params.resourceCd && placed.bucket === params.bucket)
      .reduce((sum, placed) => sum + placed.minutes, 0);
    if (originalMinutes <= 0 && placedMinutes <= 0) continue;
    result.push({ row, originalMinutes, placedMinutes, action, movedIn: originalMinutes <= 0 && placedMinutes > 0 });
  }
  return result.sort((a, b) => b.originalMinutes + b.placedMinutes - (a.originalMinutes + a.placedMinutes));
}

/**
 * 1 セルの超過を崩す操作を自動で選ぶ。
 * 超過量に一番近い（それ以上の）行を優先し、同じ分類の移管先に余力があれば移管、なければ外注。
 */
export function autoLevelCell(params: {
  rows: ProductionScheduleLoadBalancingWorkspaceRow[];
  actions: ScenarioAction[];
  months: string[];
  resources: ProductionScheduleLoadBalancingWorkspaceResource[];
  rules: ProductionScheduleLoadBalancingWorkspaceTransferRule[];
  resourceCd: string;
  bucket: string;
}): ScenarioAction[] {
  const resource = params.resources.find((item) => item.resourceCd === params.resourceCd);
  const capacity = readCapacity(resource, params.bucket);
  if (capacity == null) return params.actions;

  const actions = [...params.actions];
  for (let guard = 0; guard < 200; guard += 1) {
    const matrix = buildLoadMatrix(params.rows, actions, params.months);
    const over = readLoad(matrix, params.resourceCd, params.bucket) - capacity;
    if (over <= 0.5) break;

    const acted = new Set(actions.map((action) => action.rowId));
    const candidates = params.rows
      .filter((row) => row.resourceCd === params.resourceCd && !acted.has(row.rowId))
      .map((row) => ({
        row,
        minutes: row.allocations.find((allocation) => allocation.bucket === params.bucket)?.minutes ?? 0
      }))
      .filter((candidate) => candidate.minutes > 0);
    if (candidates.length === 0) break;

    const bestFit =
      candidates.filter((candidate) => candidate.minutes >= over).sort((a, b) => a.minutes - b.minutes)[0] ??
      candidates.sort((a, b) => b.minutes - a.minutes)[0]!;

    const destination = listTransferDestinations({
      sourceResourceCd: params.resourceCd,
      bucket: params.bucket,
      rowMinutes: bestFit.minutes,
      resources: params.resources,
      rules: params.rules,
      matrix
    }).find((item) => item.fits && rowFitsEveryMonth(bestFit.row, item, params.resources, matrix));

    actions.push(
      destination
        ? {
            rowId: bestFit.row.rowId,
            type: 'transfer',
            toResourceCd: destination.resourceCd,
            efficiencyRatio: destination.efficiencyRatio
          }
        : { rowId: bestFit.row.rowId, type: 'outsource' }
    );
  }
  return actions;
}

/** 行が複数月にまたがる場合、移管先の各月の余力に収まるか */
function rowFitsEveryMonth(
  row: ProductionScheduleLoadBalancingWorkspaceRow,
  destination: TransferDestination,
  resources: ProductionScheduleLoadBalancingWorkspaceResource[],
  matrix: LoadMatrix
): boolean {
  const resource = resources.find((item) => item.resourceCd === destination.resourceCd);
  return row.allocations.every((allocation) => {
    const capacity = readCapacity(resource, allocation.bucket);
    if (capacity == null) return allocation.bucket === LATE_BUCKET;
    return (
      readLoad(matrix, destination.resourceCd, allocation.bucket) + allocation.minutes / destination.efficiencyRatio <=
      capacity
    );
  });
}
