
import { formatLoadBalancingMachineName } from './loadBalancingFormat';
import { partKey, resolveNamedTarget } from './loadBalancingNamedTargets';

export { partKey } from './loadBalancingNamedTargets';

import type {
  OutsourceSettings,
  OutsourceVendor,
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
  | { rowId: string; type: 'outsource'; vendorId?: string; groupId?: string }
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
  const allocations = row.allocations.filter((allocation) => allocation.bucket === LATE_BUCKET || months.includes(allocation.bucket));
  if (!action) {
    return allocations.map((allocation) => ({ resourceCd: row.resourceCd, ...allocation }));
  }
  switch (action.type) {
    case 'outsource':
      return [];
    case 'transfer':
      return allocations.map((allocation) => ({
        resourceCd: action.toResourceCd,
        bucket: allocation.bucket,
        minutes: allocation.minutes / action.efficiencyRatio
      }));
    case 'defer': {
      const target = nextBucket(action.fromBucket, months);
      const placed: PlacedAllocation[] = [];
      for (const allocation of allocations) {
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
    const action = byRow.get(row.rowId);
    const allocations = action ? placeRow(row, action, months) : row.allocations.filter((allocation) => allocation.bucket === LATE_BUCKET || months.includes(allocation.bucket));
    const resourceCd = action?.type === 'transfer' ? action.toResourceCd : row.resourceCd;
    for (const placed of allocations) {
      const perResource = matrix.get(resourceCd) ?? new Map<string, number>();
      perResource.set(placed.bucket, (perResource.get(placed.bucket) ?? 0) + placed.minutes);
      matrix.set(resourceCd, perResource);
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
  row?: ProductionScheduleLoadBalancingWorkspaceRow;
}): TransferDestination[] {
  const byCd = new Map(params.resources.map((resource) => [resource.resourceCd, resource]));
  const sourceClass = byCd.get(params.sourceResourceCd)?.classCode;
  if (!sourceClass) return [];

  const destinations = new Map<string, TransferDestination & { priority: number }>();
  const rules = params.rules
    .filter((rule) => rule.fromClassCode === sourceClass && Number.isFinite(rule.efficiencyRatio) && rule.efficiencyRatio > 0)
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
        fits: spareMinutes >= burdenMinutes && (!params.row || rowFitsEveryMonth(
          params.row, { resourceCd: resource.resourceCd, efficiencyRatio: rule.efficiencyRatio }, params.resources, params.matrix
        )),
        priority: rule.priority
      });
    }
  }
  return [...destinations.values()]
    .sort(
      (a, b) =>
        Number(b.fits) - Number(a.fits) || a.priority - b.priority || b.spareMinutes - a.spareMinutes || compareId(a.resourceCd, b.resourceCd)
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

/** Kept for existing callers; selection uses the same vendor-aware engine. */
export function autoLevelCell(params: ScenarioInput & { resourceCd: string; bucket: string }): ScenarioAction[] {
  return autoSelect(params, { resourceCd: params.resourceCd, bucket: params.bucket }).actions;
}

/** 行が複数月にまたがる場合、移管先の各月の余力に収まるか */
function rowFitsEveryMonth(
  row: ProductionScheduleLoadBalancingWorkspaceRow,
  destination: Pick<TransferDestination, 'resourceCd' | 'efficiencyRatio'>,
  resources: ProductionScheduleLoadBalancingWorkspaceResource[],
  matrix: LoadMatrix
): boolean {
  const resource = resources.find((item) => item.resourceCd === destination.resourceCd);
  const perMonth = new Map<string, number>();
  for (const allocation of row.allocations) perMonth.set(allocation.bucket, (perMonth.get(allocation.bucket) ?? 0) + allocation.minutes);
  return [...perMonth].every(([bucket, minutes]) => {
    const capacity = readCapacity(resource, bucket);
    if (capacity == null) return false;
    return (
      readLoad(matrix, destination.resourceCd, bucket) + minutes / destination.efficiencyRatio <=
      capacity
    );
  });
}

/** 試算バー用。操作のない初回表示では行索引を作らない。 */
export function summarizeScenarioActions(
  rows: ProductionScheduleLoadBalancingWorkspaceRow[],
  actions: ScenarioAction[]
) {
  const rowsById = actions.length > 0 ? new Map(rows.map((row) => [row.rowId, row])) : null;
  return (['outsource', 'transfer', 'defer'] as const).map((type) => {
    const ofType = actions.filter((action) => action.type === type);
    return {
      type,
      count: ofType.length,
      minutes: ofType.reduce((sum, action) => {
        const row = rowsById?.get(action.rowId);
        if (!row) return sum;
        return sum + (action.type === 'defer'
          ? row.allocations.find((allocation) => allocation.bucket === action.fromBucket)?.minutes ?? 0
          : row.totalMinutes);
      }, 0)
    };
  });
}

export const DEFAULT_OUTSOURCE_SETTINGS: OutsourceSettings = {
  vendors: [], mode: 'process', order: ['due', 'minutes', 'vendor']
};
export type NoTaker = { rowId: string; reason: '条件' | '上限' };
export type ScenarioResult = { actions: ScenarioAction[]; noTaker: NoTaker[] };
export type ScenarioInput = {
  rows: ProductionScheduleLoadBalancingWorkspaceRow[];
  actions: ScenarioAction[];
  months: string[];
  resources: ProductionScheduleLoadBalancingWorkspaceResource[];
  rules: ProductionScheduleLoadBalancingWorkspaceTransferRule[];
  settings?: OutsourceSettings;
  machine?: string;
  /** JST calendar date supplied by the workspace API. */
  today?: string;
  /** Rows reserved by stage zero cannot be picked by later stages, including part expansion. */
  excludedRowIds?: ReadonlySet<string>;
};
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

const normalizeVendorText = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();

export function vendorMatches(vendor: OutsourceVendor, row: ProductionScheduleLoadBalancingWorkspaceRow): boolean {
  return vendor.conditions.some((condition) =>
    (condition.resourceCds.length === 0 || condition.resourceCds.some((cd) => cd.trim().normalize('NFKC').toUpperCase() === row.resourceCd.trim().normalize('NFKC').toUpperCase())) &&
    normalizeVendorText(row.fhincd).startsWith(normalizeVendorText(condition.partPrefix)) &&
    normalizeVendorText(row.fhinmei).includes(normalizeVendorText(condition.partName)) &&
    (condition.maxMinutes === null || row.totalMinutes <= condition.maxMinutes)
  );
}

export function isScenarioCandidate(row: ProductionScheduleLoadBalancingWorkspaceRow, input: Pick<ScenarioInput, 'months' | 'machine' | 'excludedRowIds'>): boolean {
  return !input.excludedRowIds?.has(row.rowId) && Boolean(row.plannedStartDate && row.effectiveDueDate) && Number.isFinite(row.totalMinutes) && row.totalMinutes > 0 &&
    (!input.machine || formatLoadBalancingMachineName(row.machineName) === formatLoadBalancingMachineName(input.machine)) &&
    row.allocations.some((allocation) => (allocation.bucket === LATE_BUCKET || input.months.includes(allocation.bucket)) &&
      Number.isFinite(allocation.minutes) && allocation.minutes > 0);
}

/** Usage only includes visible normal months; overdue allocations always charge the real current month. */
export function vendorRowUsage(row: ProductionScheduleLoadBalancingWorkspaceRow, months: string[], today: string): Map<string, number> {
  const usage = new Map<string, number>();
  for (const allocation of row.allocations) {
    const month = allocation.bucket === LATE_BUCKET ? today.slice(0, 7) : allocation.bucket;
    if (allocation.bucket !== LATE_BUCKET && !months.includes(month)) continue;
    usage.set(month, (usage.get(month) ?? 0) + allocation.minutes);
  }
  return usage;
}

/** Always rebuild both ledgers from the effective final actions, never apply deltas. */
export function aggregateScenario(input: Pick<ScenarioInput, 'rows' | 'actions' | 'months' | 'today'>) {
  const byRow = indexActions(input.actions);
  const vendorUsage = new Map<string, Map<string, number>>();
  for (const row of input.rows) {
    const action = byRow.get(row.rowId);
    if (action?.type !== 'outsource' || !action.vendorId) continue;
    const used = vendorUsage.get(action.vendorId) ?? new Map<string, number>();
    for (const [month, minutes] of vendorRowUsage(row, input.months, input.today ?? '')) {
      used.set(month, (used.get(month) ?? 0) + minutes);
    }
    vendorUsage.set(action.vendorId, used);
  }
  return { matrix: buildLoadMatrix(input.rows, [...byRow.values()], input.months), vendorUsage };
}

export function outsourceOption(input: ScenarioInput, row: ProductionScheduleLoadBalancingWorkspaceRow, vendor: OutsourceVendor, usage = aggregateScenario(input).vendorUsage) {
  const acted = indexActions(input.actions);
  const matches = isScenarioCandidate(row, input) && !acted.has(row.rowId) && vendorMatches(vendor, row);
  const unit = !matches ? [] : (input.settings?.mode === 'part'
    ? input.rows.filter((other) => partKey(other) === partKey(row) && !acted.has(other.rowId) && isScenarioCandidate(other, input) && vendorMatches(vendor, other))
    : [row]).sort((a, b) => compareId(a.rowId, b.rowId));
  const required = new Map<string, number>();
  for (const other of unit) {
    for (const [month, minutes] of vendorRowUsage(other, input.months, input.today ?? '')) {
      required.set(month, (required.get(month) ?? 0) + minutes);
    }
  }
  const used = usage.get(vendor.id);
  const fits = matches && [...required].every(([month, minutes]) => vendor.monthlyCapacityMinutes === null ||
    (used?.get(month) ?? 0) + minutes <= vendor.monthlyCapacityMinutes);
  return { vendor, matches, fits, unit, required, used };
}

export function applyOutsource(input: ScenarioInput, rowId: string, vendorId: string, usage = aggregateScenario(input).vendorUsage): ScenarioAction[] {
  const row = input.rows.find((item) => item.rowId === rowId);
  const vendor = input.settings?.vendors.find((item) => item.id === vendorId);
  if (!row || !vendor) return input.actions;
  const option = outsourceOption(input, row, vendor, usage);
  if (!option.fits) return input.actions;
  // group identity comes from stable row/vendor IDs and records this exact operation, independent of later settings.
  const groupId = JSON.stringify([vendorId, option.unit.map((item) => item.rowId)]);
  return [...input.actions, ...option.unit.map((item): ScenarioAction => ({ rowId: item.rowId, type: 'outsource', vendorId, groupId }))];
}

export function cancelScenarioRow(actions: ScenarioAction[], rowId: string): ScenarioAction[] {
  const action = actions.find((item) => item.rowId === rowId);
  return actions.filter((item) => item.rowId !== rowId && !(action?.type === 'outsource' && action.groupId &&
    item.type === 'outsource' && item.groupId === action.groupId));
}

export function transferOptions(input: ScenarioInput, row: ProductionScheduleLoadBalancingWorkspaceRow, bucket: string, matrix = aggregateScenario(input).matrix) {
  if (!isScenarioCandidate(row, input) || indexActions(input.actions).has(row.rowId)) return [];
  return listTransferDestinations({
    sourceResourceCd: row.resourceCd, bucket,
    rowMinutes: row.allocations.filter((allocation) => allocation.bucket === bucket).reduce((sum, allocation) => sum + allocation.minutes, 0),
    resources: input.resources, rules: input.rules, matrix,
    row: { ...row, allocations: row.allocations.filter((allocation) => input.months.includes(allocation.bucket) || allocation.bucket === LATE_BUCKET) }
  });
}

function excessCells(input: ScenarioInput, matrix = aggregateScenario(input).matrix) {
  return input.resources.flatMap((resource) => input.months.flatMap((bucket) => {
    const capacity = readCapacity(resource, bucket);
    const over = capacity === null ? 0 : readLoad(matrix, resource.resourceCd, bucket) - capacity;
    return over > 0.5 ? [{ resourceCd: resource.resourceCd, bucket, over }] : [];
  })).sort((a, b) => b.over - a.over || compareId(a.resourceCd, b.resourceCd) || compareId(a.bucket, b.bucket));
}
function cellCandidates(input: ScenarioInput, cell: { resourceCd: string; bucket: string }) {
  const acted = indexActions(input.actions);
  return input.rows.filter((row) => row.resourceCd === cell.resourceCd && !acted.has(row.rowId) && isScenarioCandidate(row, input) &&
    row.allocations.some((allocation) => allocation.bucket === cell.bucket && allocation.minutes > 0));
}
const cellMinutes = (row: ProductionScheduleLoadBalancingWorkspaceRow, bucket: string) =>
  row.allocations.filter((allocation) => allocation.bucket === bucket).reduce((sum, allocation) => sum + allocation.minutes, 0);
const dueCompare = (a: ProductionScheduleLoadBalancingWorkspaceRow, b: ProductionScheduleLoadBalancingWorkspaceRow) =>
  compareId(a.effectiveDueDate, b.effectiveDueDate) || compareId(a.rowId, b.rowId);

/** Explanations are derived from the final actions, including when a previous no-taker later gets placed. */
export function collectNoTaker(input: ScenarioInput): NoTaker[] {
  const result = new Map<string, NoTaker>();
  const { matrix, vendorUsage } = aggregateScenario(input);
  const rowsById = new Map(input.rows.map((row) => [row.rowId, row]));
  for (const cell of excessCells(input, matrix)) {
    let remaining = cell.over;
    for (const row of cellCandidates(input, cell).sort(dueCompare)) {
      if (remaining <= 0.5) break;
      const options = (input.settings?.vendors ?? []).map((vendor) => outsourceOption(input, row, vendor, vendorUsage));
      if (options.some((option) => option.fits)) continue;
      result.set(row.rowId, { rowId: row.rowId, reason: options.some((option) => option.matches) ? '上限' : '条件' });
      remaining -= cellMinutes(row, cell.bucket);
    }
  }
  return [...result.values()].sort((a, b) => dueCompare(rowsById.get(a.rowId)!, rowsById.get(b.rowId)!));
}

/** Stage zero ignores vendor conditions and part mode, but shares the final-action usage ledger. */
export function selectNamedTargets(input: ScenarioInput): ScenarioResult {
  const actions = [...input.actions];
  const noTaker: NoTaker[] = [];
  const acted = indexActions(actions);
  const vendors = new Map((input.settings?.vendors ?? []).map((vendor) => [vendor.id, vendor]));
  const candidates = input.rows.flatMap((row) => {
    if (acted.has(row.rowId) || !isScenarioCandidate(row, input)) return [];
    const target = resolveNamedTarget(input.settings?.namedTargets ?? [], row);
    const vendor = target && vendors.get(target.vendorId);
    return vendor ? [{ row, vendor }] : [];
  }).sort((a, b) => a.vendor.priority - b.vendor.priority || dueCompare(a.row, b.row));
  for (const { row, vendor } of candidates) {
    const used = aggregateScenario({ ...input, actions }).vendorUsage.get(vendor.id);
    const fits = [...vendorRowUsage(row, input.months, input.today ?? '')].every(([month, minutes]) =>
      vendor.monthlyCapacityMinutes === null || (used?.get(month) ?? 0) + minutes <= vendor.monthlyCapacityMinutes);
    if (fits) actions.push({ rowId: row.rowId, type: 'outsource', vendorId: vendor.id });
    else noTaker.push({ rowId: row.rowId, reason: '上限' });
  }
  return { actions, noTaker };
}

/** All overloads, largest first. Every selection rebuilds loads and usage from the complete action set. */
export function autoSelect(initial: ScenarioInput, onlyCell?: { resourceCd: string; bucket: string }): ScenarioResult {
  const named = selectNamedTargets(initial);
  const input = { ...initial, settings: initial.settings ?? DEFAULT_OUTSOURCE_SETTINGS, actions: named.actions,
    excludedRowIds: new Set([...initial.excludedRowIds ?? [], ...named.noTaker.map((item) => item.rowId)]) };
  const processed = new Set<string>();
  let steps = 0;
  let activeCell: { resourceCd: string; bucket: string } | undefined;
  // Each step either acts on at least one untouched row or exhausts one resource/month cell.
  const MAX_STEPS = input.rows.length + input.resources.length * input.months.length + 1;
  while (steps < MAX_STEPS) {
    const { matrix, vendorUsage } = aggregateScenario(input);
    const cells = excessCells(input, matrix);
    // Finish the chosen cell before moving to the next largest remaining excess.
    const cell = (activeCell && cells.find((item) => item.resourceCd === activeCell!.resourceCd && item.bucket === activeCell!.bucket)) ??
      cells.find((item) => !processed.has(JSON.stringify([item.resourceCd, item.bucket])) &&
        (!onlyCell || (onlyCell.resourceCd === item.resourceCd && onlyCell.bucket === item.bucket)));
    if (!cell) break;
    activeCell = cell;
    steps += 1;
    const candidates = cellCandidates(input, cell);
    const bestFitOrder = [...candidates].sort((a, b) => {
      const am = cellMinutes(a, cell.bucket), bm = cellMinutes(b, cell.bucket);
      const af = am >= cell.over, bf = bm >= cell.over;
      return Number(bf) - Number(af) || (af ? am - bm : bm - am) || compareId(a.rowId, b.rowId);
    });
    let transferred = false;
    for (const row of bestFitOrder) {
      const destination = transferOptions(input, row, cell.bucket, matrix).find((option) => option.fits);
      if (!destination) continue;
      input.actions.push({ rowId: row.rowId, type: 'transfer', toResourceCd: destination.resourceCd, efficiencyRatio: destination.efficiencyRatio });
      transferred = true;
      break;
    }
    if (transferred) continue;
    const pairs = candidates.flatMap((row) => input.settings.vendors.filter((vendor) => vendorMatches(vendor, row)).map((vendor) => ({ row, vendor })));
    pairs.sort((a, b) => {
      for (const key of input.settings.order) {
        const comparison = key === 'due' ? compareId(a.row.effectiveDueDate, b.row.effectiveDueDate)
          : key === 'minutes' ? b.row.totalMinutes - a.row.totalMinutes : a.vendor.priority - b.vendor.priority;
        if (comparison) return comparison;
      }
      return compareId(a.row.rowId, b.row.rowId) || compareId(a.vendor.id, b.vendor.id);
    });
    let outsourced = false;
    for (const { row, vendor } of pairs) {
      const next = applyOutsource(input, row.rowId, vendor.id, vendorUsage);
      if (next === input.actions) continue;
      input.actions = next;
      outsourced = true;
      break;
    }
    if (outsourced) continue;
    processed.add(JSON.stringify([cell.resourceCd, cell.bucket]));
    activeCell = undefined;
  }
  const rowsById = new Map(input.rows.map((row) => [row.rowId, row]));
  return { actions: input.actions, noTaker: [...named.noTaker, ...collectNoTaker(input)]
    .sort((a, b) => dueCompare(rowsById.get(a.rowId)!, rowsById.get(b.rowId)!)) };
}
