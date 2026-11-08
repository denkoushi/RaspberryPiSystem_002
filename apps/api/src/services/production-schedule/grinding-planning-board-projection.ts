import { resolveRequiredMinutes } from './grinding-planning-board-required-minutes.js';
import { compareProcessOrder } from './process-order.js';
import { encodeSessakuPieceKey, sessakuPieceKeyFromRow, type SessakuPieceSet } from './sessaku-pieces/piece-key.js';
import { resolveBoardDueDate, type BoardDueSource } from './d-schedule-minutes/resolve-board-due-date.js';
import { createHash } from 'node:crypto';

import type { Prisma } from '@prisma/client';
import type {
  GrindingPlanningBoardResourceMinutesResponse,
  GrindingPlanningBoardCategory,
  GrindingPlanningBoardItem,
  GrindingPlanningBoardLoad,
  GrindingPlanningBoardSpecialDue,
  GrindingPlanningBoardView
} from '@raspi-system/shared-types';

import {
  PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS,
  isUnassignedProductionSeiban,
} from './row-resolver/constants.js';

export type GrindingPlanningBoardRowData = Prisma.JsonValue | Record<string, unknown>;

export type GrindingPlanningBoardProjectionRow = {
  id: string;
  rowData: GrindingPlanningBoardRowData;
  updatedAt: Date | null;
};

export type GrindingPlanningBoardProjectionRowDetail = {
  manualUpdatedAt?: Date | null;
  excelDueDate?: Date | null;
  excelChangedAt?: Date | null;
  updatedAt: Date | null;
  rowNotes: ReadonlyArray<{ dueDate: Date | null }>;
  orderSupplements: ReadonlyArray<{
    plannedQuantity: number | null;
    plannedEndDate: Date | null;
  }>;
  productionScheduleProgress: { isCompleted: boolean; updatedAt: Date } | null;
  productionScheduleExternalCompletion: { isExternallyCompleted: boolean; updatedAt: Date } | null;
};

export type GrindingPlanningBoardProjectionRank = {
  resourceCd: string;
  orderNumber: number;
};

export type GrindingPlanningBoardProjectionRanks = {
  rows: ReadonlyMap<string, GrindingPlanningBoardProjectionRank>;
};

export type GrindingPlanningBoardProjectionOverride = {
  overrideResourceCd: string | null;
  overrideDueDate: Date | null;
  dueDateCleared?: boolean | null;
  orderPinned?: boolean;
  alternateRank: number | null;
  specialDueKind?: string | null;
  specialDueExpiresAt?: Date | null;
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
  resourceMinutes?: GrindingPlanningBoardResourceMinutesResponse;
  includePieces?: boolean;
  pieceSets?: ReadonlyMap<string, SessakuPieceSet>;
  dueSource?: BoardDueSource;
  rows: readonly GrindingPlanningBoardProjectionRow[];
  details: ReadonlyMap<string, GrindingPlanningBoardProjectionRowDetail>;
  ranks: GrindingPlanningBoardProjectionRanks;
  overrides: ReadonlyMap<string, GrindingPlanningBoardProjectionOverride>;
  /** All logical source process rows, before category/completion filtering. */
  progressRows?: readonly GrindingPlanningBoardProgressRow[];
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
  const parts = PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS.map((column) => rowValue(rowData, column));
  if (isUnassignedProductionSeiban(rowValue(rowData, 'FSEIBAN'))) {
    parts.push(rowValue(rowData, 'ProductNo'));
  }
  return JSON.stringify(parts);
}

export function buildGrindingPlanningBoardRowItemId(rowData: GrindingPlanningBoardRowData): string {
  return `row:${Buffer.from(buildGrindingPlanningBoardLogicalKey(rowData), 'utf8').toString('base64url')}`;
}

function buildPartKey(fseiban: string, productNo: string, fhincd: string): string {
  const parts = [fseiban.trim(), fhincd.trim()];
  if (isUnassignedProductionSeiban(fseiban)) parts.push(productNo.trim());
  return parts.join('\0');
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


function compareText(a: string, b: string): number {
  return a.localeCompare(b, 'ja');
}

function specialDueForOverride(override: GrindingPlanningBoardProjectionOverride | undefined): GrindingPlanningBoardSpecialDue | null {
  if (override?.specialDueKind !== 'today' && override?.specialDueKind !== 'overnight') return null;
  if (!(override.specialDueExpiresAt instanceof Date) || Number.isNaN(override.specialDueExpiresAt.getTime())) return null;
  return { kind: override.specialDueKind, expiresAt: override.specialDueExpiresAt.toISOString() };
}

function compareResourceProcessOrder(a: string, b: string): number {
  const left = Number(a);
  const right = Number(b);
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
  return a.localeCompare(b, 'ja');
}

function comparePiecePosition(left: GrindingPlanningBoardItem, right: GrindingPlanningBoardItem): number {
  return left.parentItemId != null && left.parentItemId === right.parentItemId
    ? (left.piecePosition ?? 0) - (right.piecePosition ?? 0) : 0;
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
    if (view === 'resource' && allocation === 'alternate') {
      const leftSpecialDue = left.specialDue;
      const rightSpecialDue = right.specialDue;
      if (leftSpecialDue == null && rightSpecialDue != null) return 1;
      if (leftSpecialDue != null && rightSpecialDue == null) return -1;
      if (leftSpecialDue != null && rightSpecialDue != null) {
        const expiry = leftSpecialDue.expiresAt.localeCompare(rightSpecialDue.expiresAt);
        if (expiry !== 0) return expiry;
      }
      const rank = compareNullableRank(left.alternateRank, right.alternateRank);
      if (rank !== 0) return rank;
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
    if (view === 'resource' && allocation === 'alternate') {
      return (
        compareText(left.fseiban, right.fseiban) ||
        compareText(left.productNo, right.productNo) ||
        compareResourceProcessOrder(left.processOrder, right.processOrder) ||
        compareText(left.fhincd, right.fhincd) ||
        comparePiecePosition(left, right) || compareText(left.itemId, right.itemId)
      );
    }
    const process = compareProcessOrder(left.processOrder, right.processOrder);
    if (process !== 0) return process;
    return comparePiecePosition(left, right) || left.itemId.localeCompare(right.itemId);
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

  const orderedItems = [...items].sort((left, right) => left.sourceRowId < right.sourceRowId ? -1 : left.sourceRowId > right.sourceRowId ? 1
    : (left.pieceId ?? '') < (right.pieceId ?? '') ? -1 : (left.pieceId ?? '') > (right.pieceId ?? '') ? 1 : 0);
  for (const item of orderedItems) {
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
    const completionSource = detail.productionScheduleExternalCompletion?.isExternallyCompleted
      ? 'import' : detail.productionScheduleProgress?.isCompleted ? 'manual' : null;
    const rowItemId = buildGrindingPlanningBoardRowItemId(data);
    const itemId = rowItemId;
    const override = params.overrides.get(itemId);
    const effectiveResourceCd = normalizeResourceCd(override?.overrideResourceCd ?? originalResourceCd);

    const displayFields = { plannedQuantity: sourceQuantity, machineRequiredMinutes: sourceMinutes ?? undefined };
    const resolvedMinutes = resolveRequiredMinutes({ originalMinutes: sourceMinutes, originalKnown: sourceMinutes != null,
      quantity: sourceQuantity, effectiveResourceCd, fhincd: rowValue(data, 'FHINCD') }, params.resourceMinutes);
    const parentDue = resolveBoardDueDate({
      source: params.dueSource ?? 'excel', itemOverride: null,
      manualDueDate: ymd(detail.rowNotes[0]?.dueDate), manualUpdatedAt: detail.manualUpdatedAt ?? null,
      excelDueDate: ymd(detail.excelDueDate), excelChangedAt: detail.excelChangedAt ?? null,
      scawPlannedEndDate: ymd(detail.orderSupplements[0]?.plannedEndDate)
    });
    const originalParentDueDate = parentDue ? new Date(`${parentDue}T00:00:00.000Z`) : null;
    const originalDueDate = ymd(originalParentDueDate);
    const effectiveDueDate = resolveGrindingPlanningBoardParentDueDate({
      originalParentDueDate,
      plannedEndDate: detail.orderSupplements[0]?.plannedEndDate ?? null,
      override
    });
    const rankRow = params.ranks.rows.get(row.id);
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
    const pieceSet = params.pieceSets?.get(encodeSessakuPieceKey(sessakuPieceKeyFromRow(data)));
    const revisionInput = {
      ...(pieceSet ? { pieceSetVersion: pieceSet.version, quantityWarning: pieceSet.pieces.length ? pieceSet.quantityWarning : null } : {}),
      rowId: row.id,
      rowUpdatedAt: row.updatedAt?.toISOString() ?? null,
      detailUpdatedAt: detail.updatedAt?.toISOString() ?? null,
      logicalKey: buildGrindingPlanningBoardLogicalKey(data),
      originalResourceCd,
      originalDueDate,
      sourceMinutes,
      rowCompleted,
      completionSource,
      sourceQuantity,
      overrideVersion: override?.version ?? 0,
      overrideResourceCd: override?.overrideResourceCd ?? null,
      overrideDueDate: ymd(override?.overrideDueDate),
      dueDateCleared: override?.dueDateCleared ?? null,
      effectiveDueDate,
      alternateRank: override?.alternateRank ?? null,
      orderPinned: override?.orderPinned ?? false,
      specialDueKind: override?.specialDueKind ?? null,
      specialDueExpiresAt: override?.specialDueExpiresAt?.toISOString() ?? null,
      originalRank
    };
    items.push({
      itemId,
      kind: 'row',
      ...(pieceSet ? { isLaterProcess: Boolean(pieceSet.sourcePieceSetId), pieceSetVersion: pieceSet.version, quantityWarning: (pieceSet.pieces.length ? pieceSet.quantityWarning : null) as GrindingPlanningBoardItem['quantityWarning'] } : {}),
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
      orderPinned: override?.orderPinned ?? false,
      specialDue: specialDueForOverride(override),
      plannedQuantity: displayFields.plannedQuantity ?? null,
      ...resolvedMinutes,
      isCompleted: rowCompleted,
      lslhSurface: false,
      completionSource,
      progress: {
        completed: itemProgress.completed,
        total: itemProgress.total,
        quantityKnown: false
      }
    });
  }
  return items;
}

function expandSessakuPieces(params: GrindingPlanningBoardProjectionInput, parents: GrindingPlanningBoardItem[]): GrindingPlanningBoardItem[] {
  return parents.flatMap((parent) => {
    const row = params.rows.find((row) => row.id === parent.sourceRowId);
    const set = row && params.pieceSets?.get(encodeSessakuPieceKey(sessakuPieceKeyFromRow(row.rowData)));
    if (!set?.pieces.length) return [parent];
    const external = params.details.get(parent.sourceRowId)?.productionScheduleExternalCompletion?.isExternallyCompleted === true;
    return set.pieces.map((piece): GrindingPlanningBoardItem => {
      const itemId = `piece:${piece.id}`;
      const inherited = params.overrides.get(parent.itemId);
      const own = params.overrides.get(itemId);
      const override = own ?? inherited;
      const total = parent.plannedQuantity ?? (set.sourcePieceSetId || piece.sourcePieceId ? set.plannedQuantity : null);
      const minutes = total != null && total > 0 && set.quantityWarning !== 'INVALID_PLANNED_QUANTITY' && parent.originalRequiredMinutes != null && parent.originalRequiredMinutes > 0
        ? parent.originalRequiredMinutes * piece.quantity / total : null;
      const resolvedMinutes = resolveRequiredMinutes({ originalMinutes: minutes, originalKnown: minutes != null,
        quantity: piece.quantity, effectiveResourceCd: normalizeResourceCd(override?.overrideResourceCd ?? parent.originalResourceCd),
        fhincd: parent.fhincd }, params.resourceMinutes);
      const isCompleted = external || piece.isCompleted;
      const effectiveDueDate = resolveGrindingPlanningBoardParentDueDate({
        originalParentDueDate: parent.originalDueDate ? new Date(`${parent.originalDueDate}T00:00:00.000Z`) : null,
        plannedEndDate: params.details.get(parent.sourceRowId)?.orderSupplements[0]?.plannedEndDate ?? null,
        override
      });
      return {
        ...parent, itemId, kind: 'piece', parentItemId: parent.itemId, pieceId: piece.id,
        ...(piece.sourcePieceId ? { sourcePieceId: piece.sourcePieceId } : {}),
        piecePosition: piece.position, pieceSetVersion: set.version, quantity: piece.quantity,
        parentPlannedQuantity: total, plannedQuantity: piece.quantity,
        quantityWarning: set.quantityWarning as GrindingPlanningBoardItem['quantityWarning'],
        manualIsCompleted: piece.isCompleted, isCompleted,
        completionSource: external ? 'import' : piece.isCompleted ? 'manual' : null,
        effectiveResourceCd: normalizeResourceCd(override?.overrideResourceCd ?? parent.originalResourceCd),
        effectiveDueDate, alternateRank: override?.alternateRank ?? null,
        orderPinned: override?.orderPinned ?? false, specialDue: specialDueForOverride(override),
        version: own?.version ?? 0, ...resolvedMinutes,
        itemRevision: createItemRevision({ parentRevision: parent.itemRevision, pieceId: piece.id, position: piece.position,
          pieceSetVersion: set.version, quantity: piece.quantity, manualIsCompleted: piece.isCompleted,
          quantityWarning: set.quantityWarning, external, inherited, own })
      };
    });
  });
}

export function projectGrindingPlanningBoard(
  params: GrindingPlanningBoardProjectionInput
): GrindingPlanningBoardProjectionResult {
  const progressRows = params.progressRows ?? buildProgressRowsFromSource(params.rows, params.details);
  const progress = buildProgressProjection(progressRows);
  const parents = buildItems(params, progress);
  const pieces = expandSessakuPieces(params, parents);
  const allItems = params.includePieces ? pieces : parents;
  const sortedAllItems = sortGrindingPlanningBoardProjectionItems(
    allItems,
    params.seibanOrder,
    params.view,
    params.allocation
  );
  const items = params.selectedFseibans
    ? sortedAllItems.filter((item) => params.selectedFseibans?.has(item.fseiban))
    : sortedAllItems;
  const loadResult = buildLoad(pieces);
  return {
    items,
    allItems: sortedAllItems,
    load: loadResult.load,
    unknownRequiredMinutesCount: loadResult.unknownRequiredMinutesCount,
    progress
  };
}
