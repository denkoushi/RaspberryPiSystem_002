import { createHash } from 'node:crypto';

import type { Prisma } from '@prisma/client';
import type {
  GrindingPlanningBoardCategory,
  GrindingPlanningBoardItem,
  GrindingPlanningBoardLoad,
  GrindingPlanningBoardView
} from '@raspi-system/shared-types';

import { PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS } from './row-resolver/constants.js';
import { applySplitQuantityToProductionScheduleRowDisplayFields } from './order-split/split-display-required-minutes.js';

export type GrindingPlanningBoardRowData = Prisma.JsonValue | Record<string, unknown>;

export type GrindingPlanningBoardProjectionRow = {
  id: string;
  rowData: GrindingPlanningBoardRowData;
  updatedAt: Date | null;
};

export type GrindingPlanningBoardProjectionRowDetail = {
  updatedAt: Date | null;
  rowNotes: ReadonlyArray<{ dueDate: Date | null }>;
  orderSupplements: ReadonlyArray<{
    plannedQuantity: number | null;
    plannedEndDate: Date | null;
  }>;
  productionScheduleProgress: { isCompleted: boolean; updatedAt: Date } | null;
  productionScheduleExternalCompletion: { isExternallyCompleted: boolean; updatedAt: Date } | null;
  orderSplits: ReadonlyArray<{
    id: string;
    splitQuantity: number;
    dueDate: Date | null;
    updatedAt: Date;
  }>;
};

export type GrindingPlanningBoardProjectionRank = {
  resourceCd: string;
  orderNumber: number;
};

export type GrindingPlanningBoardProjectionRanks = {
  rows: ReadonlyMap<string, GrindingPlanningBoardProjectionRank>;
  splits: ReadonlyMap<string, GrindingPlanningBoardProjectionRank>;
};

export type GrindingPlanningBoardProjectionOverride = {
  overrideResourceCd: string | null;
  overrideDueDate: Date | null;
  dueDateCleared?: boolean | null;
  alternateRank: number | null;
  version: number;
};

/**
 * 進捗の集計単位。呼び出し側は、カテゴリや完了フィルターを適用する前の
 * 全工程行を渡す。分割片はここへ渡さず、親の工程行を一度だけ渡す。
 */
export type GrindingPlanningBoardProgressRow = {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  isCompleted: boolean;
};

export type GrindingPlanningBoardProgress = {
  completed: number;
  total: number;
};

export type GrindingPlanningBoardProgressProjection = {
  byPart: ReadonlyMap<string, GrindingPlanningBoardProgress>;
  bySeiban: ReadonlyMap<string, GrindingPlanningBoardProgress>;
};

export type GrindingPlanningBoardProjectionInput = {
  rows: readonly GrindingPlanningBoardProjectionRow[];
  details: ReadonlyMap<string, GrindingPlanningBoardProjectionRowDetail>;
  ranks: GrindingPlanningBoardProjectionRanks;
  overrides: ReadonlyMap<string, GrindingPlanningBoardProjectionOverride>;
  /** All logical source process rows, before category/completion filtering. */
  progressRows?: readonly GrindingPlanningBoardProgressRow[];
  /** Backend passes false when the order-split feature is disabled. */
  splitEnabled?: boolean;
  category: GrindingPlanningBoardCategory;
  view?: GrindingPlanningBoardView;
  allocation?: 'original' | 'alternate';
  seibanOrder: readonly string[];
  selectedFseibans?: ReadonlySet<string>;
  machineNameBySeiban?: ReadonlyMap<string, string | null>;
  /** Resource-category policy is owned by the caller and remains outside this pure module. */
  isResourceInCategory?: (resourceCd: string, category: GrindingPlanningBoardCategory) => boolean;
};

export type GrindingPlanningBoardProjectionResult = {
  /** Items after selected製番 filtering, before the caller's completion filter. */
  items: GrindingPlanningBoardItem[];
  /** All category items. Use this collection for unselected製番 load aggregation. */
  allItems: GrindingPlanningBoardItem[];
  load: GrindingPlanningBoardLoad[];
  unknownRequiredMinutesCount: number;
  progress: GrindingPlanningBoardProgressProjection;
};

const SPLIT_PREFIX = 'split:';

function rowValue(data: GrindingPlanningBoardRowData, key: string): string {
  const value = asRowData(data)[key];
  return value == null ? '' : String(value);
}

function asRowData(value: GrindingPlanningBoardRowData): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function ymd(value: Date | null | undefined): string | null {
  return value == null ? null : value.toISOString().slice(0, 10);
}

export function resolveGrindingPlanningBoardParentDueDate(params: {
  originalParentDueDate: Date | null;
  plannedEndDate: Date | null;
  override?: Pick<GrindingPlanningBoardProjectionOverride, 'overrideDueDate' | 'dueDateCleared'>;
}): string | null {
  if (params.override?.overrideDueDate != null) return ymd(params.override.overrideDueDate);
  if (params.override?.dueDateCleared === true) return ymd(params.plannedEndDate);
  return ymd(params.originalParentDueDate);
}

export function resolveGrindingPlanningBoardItemDueDate(params: {
  splitDueDate: Date | null;
  originalParentDueDate: Date | null;
  plannedEndDate: Date | null;
  override?: Pick<GrindingPlanningBoardProjectionOverride, 'overrideDueDate' | 'dueDateCleared'>;
  parentOverride?: Pick<GrindingPlanningBoardProjectionOverride, 'overrideDueDate' | 'dueDateCleared'>;
}): string | null {
  if (params.override?.overrideDueDate != null) return ymd(params.override.overrideDueDate);
  if (params.splitDueDate != null) return ymd(params.splitDueDate);
  return resolveGrindingPlanningBoardParentDueDate({
    originalParentDueDate: params.originalParentDueDate,
    plannedEndDate: params.plannedEndDate,
    override: params.parentOverride
  });
}

function parseRequiredMinutes(data: GrindingPlanningBoardRowData): number | null {
  const raw = rowValue(data, 'FSIGENSHOYORYO').trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function isCompleted(detail: GrindingPlanningBoardProjectionRowDetail): boolean {
  return Boolean(
    detail.productionScheduleProgress?.isCompleted ||
      detail.productionScheduleExternalCompletion?.isExternallyCompleted
  );
}

function normalizeResourceCd(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function isInCategory(
  resourceCd: string | null,
  category: GrindingPlanningBoardCategory,
  predicate: GrindingPlanningBoardProjectionInput['isResourceInCategory']
): boolean {
  return resourceCd != null && (predicate?.(resourceCd, category) ?? true);
}

/** Existing winner identity semantics: COALESCE(raw, '') and SQL text coercion. */
export function buildGrindingPlanningBoardLogicalKey(rowData: GrindingPlanningBoardRowData): string {
  return JSON.stringify(PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS.map((column) => rowValue(rowData, column)));
}

export function buildGrindingPlanningBoardRowItemId(rowData: GrindingPlanningBoardRowData): string {
  return `row:${Buffer.from(buildGrindingPlanningBoardLogicalKey(rowData), 'utf8').toString('base64url')}`;
}

function buildPartKey(fseiban: string, productNo: string, fhincd: string): string {
  void productNo;
  return [fseiban.trim(), fhincd.trim()].join('\0');
}

function buildProgressProjection(
  rows: readonly GrindingPlanningBoardProgressRow[]
): GrindingPlanningBoardProgressProjection {
  const byPart = new Map<string, GrindingPlanningBoardProgress>();
  const seenRows = new Set<string>();
  for (const row of rows) {
    if (seenRows.has(row.rowId)) continue;
    seenRows.add(row.rowId);
    const partKey = buildPartKey(row.fseiban, row.productNo, row.fhincd);
    const current = byPart.get(partKey) ?? { completed: 0, total: 0 };
    current.total += 1;
    if (row.isCompleted) current.completed += 1;
    byPart.set(partKey, current);
  }

  const bySeiban = new Map<string, GrindingPlanningBoardProgress>();
  for (const [partKey, progress] of byPart) {
    const fseiban = partKey.split('\0', 1)[0] ?? '';
    const current = bySeiban.get(fseiban) ?? { completed: 0, total: 0 };
    current.completed += progress.completed;
    current.total += progress.total;
    bySeiban.set(fseiban, current);
  }

  return { byPart, bySeiban };
}

function progressForItem(
  item: { fseiban: string; productNo: string; fhincd: string; isCompleted: boolean },
  progress: GrindingPlanningBoardProgressProjection
): GrindingPlanningBoardProgress {
  return (
    progress.byPart.get(buildPartKey(item.fseiban, item.productNo, item.fhincd)) ?? {
      completed: item.isCompleted ? 1 : 0,
      total: 1
    }
  );
}

function createItemRevision(input: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function compareNullableRank(a: number | null, b: number | null): number {
  return (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER);
}

function compareProcessOrder(a: string, b: string): number {
  const left = Number(a);
  const right = Number(b);
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
  return a.localeCompare(b);
}

export function sortGrindingPlanningBoardProjectionItems(
  items: readonly GrindingPlanningBoardItem[],
  seibanOrder: readonly string[],
  view: GrindingPlanningBoardView = 'seiban',
  allocation: 'original' | 'alternate' = 'alternate'
): GrindingPlanningBoardItem[] {
  const orderMap = new Map(seibanOrder.map((fseiban, index) => [fseiban, index] as const));
  return [...items].sort((left, right) => {
    const leftResource = allocation === 'original' ? left.originalResourceCd : left.effectiveResourceCd;
    const rightResource = allocation === 'original' ? right.originalResourceCd : right.effectiveResourceCd;
    if (view === 'resource') {
      const resource = (leftResource ?? '').localeCompare(rightResource ?? '');
      if (resource !== 0) return resource;
    }
    const seiban =
      (orderMap.get(left.fseiban) ?? Number.MAX_SAFE_INTEGER) -
      (orderMap.get(right.fseiban) ?? Number.MAX_SAFE_INTEGER);
    if (seiban !== 0) return seiban;
    const leftDue = allocation === 'original' ? left.originalDueDate : left.effectiveDueDate;
    const rightDue = allocation === 'original' ? right.originalDueDate : right.effectiveDueDate;
    const due = (leftDue ?? '9999-12-31').localeCompare(rightDue ?? '9999-12-31');
    if (due !== 0) return due;
    const rank = compareNullableRank(
      allocation === 'original' ? left.originalRank : left.alternateRank,
      allocation === 'original' ? right.originalRank : right.alternateRank
    );
    if (rank !== 0) return rank;
    const process = compareProcessOrder(left.processOrder, right.processOrder);
    if (process !== 0) return process;
    return left.itemId.localeCompare(right.itemId);
  });
}

function addMinutes(entry: GrindingPlanningBoardLoad, field: 'originalRequiredMinutes' | 'alternateRequiredMinutes', minutes: number | null): void {
  if (minutes == null) return;
  entry[field] = (entry[field] ?? 0) + minutes;
}

function buildLoad(items: readonly GrindingPlanningBoardItem[]): {
  load: GrindingPlanningBoardLoad[];
  unknownRequiredMinutesCount: number;
} {
  const byResource = new Map<string, GrindingPlanningBoardLoad>();
  let unknownRequiredMinutesCount = 0;

  const ensure = (resourceCd: string): GrindingPlanningBoardLoad => {
    const existing = byResource.get(resourceCd);
    if (existing) return existing;
    const created: GrindingPlanningBoardLoad = {
      resourceCd,
      originalItemCount: 0,
      alternateItemCount: 0,
      originalRequiredMinutes: null,
      alternateRequiredMinutes: null,
      unfinishedItemCount: 0,
      requiredMinutes: null,
      unknownItemCount: 0,
      originalUnknownItemCount: 0,
      alternateUnknownItemCount: 0
    };
    byResource.set(resourceCd, created);
    return created;
  };

  for (const item of items) {
    if (item.isCompleted) continue;
    const originalResource = item.originalResourceCd;
    const alternateResource = item.effectiveResourceCd;
    if (originalResource == null && alternateResource == null) continue;

    const unknown = !item.requiredMinutesKnown || item.requiredMinutes == null;
    if (unknown) unknownRequiredMinutesCount += 1;

    if (originalResource != null) {
      const originalEntry = ensure(originalResource);
      originalEntry.originalItemCount += 1;
      addMinutes(originalEntry, 'originalRequiredMinutes', item.requiredMinutes);
      if (unknown) originalEntry.originalUnknownItemCount += 1;
    }

    if (alternateResource != null) {
      const alternateEntry = ensure(alternateResource);
      alternateEntry.alternateItemCount += 1;
      alternateEntry.unfinishedItemCount += 1;
      addMinutes(alternateEntry, 'alternateRequiredMinutes', item.requiredMinutes);
      if (unknown) {
        alternateEntry.alternateUnknownItemCount += 1;
        alternateEntry.unknownItemCount += 1;
      }
    }
  }

  for (const entry of byResource.values()) {
    if (entry.originalItemCount === 0 && entry.originalUnknownItemCount === 0) {
      entry.originalRequiredMinutes = 0;
    }
    if (entry.alternateItemCount === 0 && entry.alternateUnknownItemCount === 0) {
      entry.alternateRequiredMinutes = 0;
    }
    entry.requiredMinutes = entry.alternateRequiredMinutes;
  }
  return {
    load: [...byResource.values()].sort((left, right) => left.resourceCd.localeCompare(right.resourceCd)),
    unknownRequiredMinutesCount
  };
}

function buildProgressRowsFromSource(
  rows: readonly GrindingPlanningBoardProjectionRow[],
  details: ReadonlyMap<string, GrindingPlanningBoardProjectionRowDetail>
): GrindingPlanningBoardProgressRow[] {
  return rows.flatMap((row) => {
    const detail = details.get(row.id);
    if (!detail) return [];
    return [
      {
        rowId: row.id,
        fseiban: rowValue(row.rowData, 'FSEIBAN'),
        productNo: rowValue(row.rowData, 'ProductNo'),
        fhincd: rowValue(row.rowData, 'FHINCD'),
        isCompleted: isCompleted(detail)
      }
    ];
  });
}

function buildItems(
  params: GrindingPlanningBoardProjectionInput,
  progress: GrindingPlanningBoardProgressProjection
): GrindingPlanningBoardItem[] {
  const items: GrindingPlanningBoardItem[] = [];
  const predicate = params.isResourceInCategory;
  for (const row of params.rows) {
    const data = asRowData(row.rowData);
    const fseiban = rowValue(data, 'FSEIBAN');
    const detail = params.details.get(row.id);
    if (!detail) continue;
    const originalResourceCd = normalizeResourceCd(rowValue(data, 'FSIGENCD'));
    if (!isInCategory(originalResourceCd, params.category, predicate)) continue;

    const sourceMinutes = parseRequiredMinutes(data);
    const sourceQuantity = detail.orderSupplements[0]?.plannedQuantity ?? null;
    const rowCompleted = isCompleted(detail);
    const rowItemId = buildGrindingPlanningBoardRowItemId(data);
    const parentOverride = params.overrides.get(rowItemId);
    const splits = params.splitEnabled === false
      ? [null]
      : detail.orderSplits.length > 0
        ? detail.orderSplits
        : [null];

    for (const split of splits) {
      const itemId = split == null ? rowItemId : `${SPLIT_PREFIX}${split.id}`;
      const override = params.overrides.get(itemId);
      const effectiveResourceCd = normalizeResourceCd(override?.overrideResourceCd ?? originalResourceCd);

      const displayFields = split == null
        ? { plannedQuantity: sourceQuantity, machineRequiredMinutes: sourceMinutes ?? undefined }
        : applySplitQuantityToProductionScheduleRowDisplayFields(
            {
              plannedQuantity: sourceQuantity,
              machineRequiredMinutes: sourceMinutes ?? undefined,
              laborRequiredMinutes: undefined,
              rowData: data as Prisma.JsonValue
            },
            split.splitQuantity
          );
      const requiredMinutes = displayFields.machineRequiredMinutes ?? null;
      const requiredMinutesKnown = requiredMinutes != null;
      const originalParentDueDate = detail.rowNotes[0]?.dueDate ?? detail.orderSupplements[0]?.plannedEndDate ?? null;
      const originalDueDate = ymd(split?.dueDate) ?? ymd(originalParentDueDate);
      const effectiveDueDate = resolveGrindingPlanningBoardItemDueDate({
        splitDueDate: split?.dueDate ?? null,
        originalParentDueDate,
        plannedEndDate: detail.orderSupplements[0]?.plannedEndDate ?? null,
        override,
        parentOverride
      });
      const rankRow = split == null ? params.ranks.rows.get(row.id) : params.ranks.splits.get(split.id);
      const originalRank =
        rankRow != null && normalizeResourceCd(rankRow.resourceCd) === originalResourceCd
          ? rankRow.orderNumber
          : null;
      const itemProgress = progressForItem(
        {
          fseiban,
          productNo: rowValue(data, 'ProductNo'),
          fhincd: rowValue(data, 'FHINCD'),
          isCompleted: rowCompleted
        },
        progress
      );
      const revisionInput = {
        rowId: row.id,
        rowUpdatedAt: row.updatedAt?.toISOString() ?? null,
        detailUpdatedAt: detail.updatedAt?.toISOString() ?? null,
        logicalKey: buildGrindingPlanningBoardLogicalKey(data),
        splitId: split?.id ?? null,
        splitUpdatedAt: split?.updatedAt.toISOString() ?? null,
        splitQuantity: split?.splitQuantity ?? null,
        originalResourceCd,
        originalDueDate,
        sourceMinutes,
        rowCompleted,
        sourceQuantity,
        overrideVersion: override?.version ?? 0,
        overrideResourceCd: override?.overrideResourceCd ?? null,
        overrideDueDate: ymd(override?.overrideDueDate),
        dueDateCleared: override?.dueDateCleared ?? null,
        inheritedParentOverrideVersion: parentOverride?.version ?? 0,
        inheritedParentOverrideDueDate: ymd(parentOverride?.overrideDueDate),
        inheritedParentOverrideDueDateCleared: parentOverride?.dueDateCleared ?? null,
        effectiveDueDate,
        alternateRank: override?.alternateRank ?? null,
        originalRank
      };
      items.push({
        itemId,
        kind: split == null ? 'row' : 'split',
        itemRevision: createItemRevision(revisionInput),
        version: override?.version ?? 0,
        sourceRowId: row.id,
        fseiban,
        fhincd: rowValue(data, 'FHINCD'),
        fhinmei: rowValue(data, 'FHINMEI') || null,
        machineName: params.machineNameBySeiban?.get(fseiban) ?? null,
        productNo: rowValue(data, 'ProductNo'),
        processOrder: rowValue(data, 'FKOJUN'),
        originalResourceCd,
        effectiveResourceCd,
        originalDueDate,
        effectiveDueDate,
        originalRank,
        alternateRank: override?.alternateRank ?? null,
        plannedQuantity: displayFields.plannedQuantity ?? null,
        requiredMinutes,
        requiredMinutesKnown,
        isCompleted: rowCompleted,
        progress: {
          completed: itemProgress.completed,
          total: itemProgress.total,
          quantityKnown: false
        }
      });
    }
  }
  return items;
}

export function projectGrindingPlanningBoard(
  params: GrindingPlanningBoardProjectionInput
): GrindingPlanningBoardProjectionResult {
  const progressRows = params.progressRows ?? buildProgressRowsFromSource(params.rows, params.details);
  const progress = buildProgressProjection(progressRows);
  const allItems = buildItems(params, progress);
  const sortedAllItems = sortGrindingPlanningBoardProjectionItems(
    allItems,
    params.seibanOrder,
    params.view,
    params.allocation
  );
  const items = params.selectedFseibans
    ? sortedAllItems.filter((item) => params.selectedFseibans?.has(item.fseiban))
    : sortedAllItems;
  const loadResult = buildLoad(sortedAllItems);
  return {
    items,
    allItems: sortedAllItems,
    load: loadResult.load,
    unknownRequiredMinutesCount: loadResult.unknownRequiredMinutesCount,
    progress
  };
}
