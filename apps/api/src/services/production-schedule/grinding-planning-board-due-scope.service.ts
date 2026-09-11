import { createHash, randomUUID } from 'node:crypto';

import { Prisma, type ProductionScheduleGrindingPlanningBoardDueScope, type ProductionScheduleGrindingPlanningBoardOverride } from '@prisma/client';
import type {
  GrindingPlanningBoardDueScope,
  GrindingPlanningBoardDueScopeRequest,
  GrindingPlanningBoardDueScopeSnapshot
} from '@raspi-system/shared-types';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { type DueManagementSeibanDetail } from './due-management-query.service.js';
import { getDueManagementSeibanDetailWithScope } from './due-management-location-scope-adapter.service.js';
import { presentDueManagementSeibanDetail, type PartEffectiveDueDate, type PresentedDueManagementSeibanDetail } from './due-management-detail-presentation.service.js';
import { isValidDueDateText, listSeibanRowIdsForWriteback } from './due-date-writeback.service.js';
import { readLeaderboardShellSnapshotGenerationToken } from './leaderboard/leaderboard-shell-snapshot-generation.js';
import { buildGrindingPlanningBoardRowItemId } from './grinding-planning-board-projection.js';
import { acquireProductionScheduleParentRowLockInTransaction } from './order-split/production-schedule-parent-row-lock.service.js';

type DbClient = Prisma.TransactionClient | typeof prisma;
type RowData = Record<string, unknown>;
type TargetRow = { id: string; rowData: Prisma.JsonValue; updatedAt: Date | null };
type ScopeRow = ProductionScheduleGrindingPlanningBoardDueScope;
type TargetSplit = { id: string; parentCsvDashboardRowId: string; dueDate: Date | null; updatedAt: Date };
type OriginalProcessingRow = { processingType: string; dueDate: Date; updatedAt: Date };
type TargetMetadata = { rowId: string; dueDate: Date | null; processingType: string | null; noteUpdatedAt: Date | null; plannedEndDate: Date | null; supplementUpdatedAt: Date | null; completed: boolean; progressUpdatedAt: Date | null; externalCompleted: boolean; externalUpdatedAt: Date | null };
type TargetBaseDue = { dueDate: Date | null; plannedEndDate: Date | null };
type ProcessingMapping = { fhincd: string; processingType: string; updatedAt: Date | null };

function asRowData(value: unknown): RowData {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as RowData : {};
}

function rowValue(data: RowData, key: string): string {
  const value = data[key];
  return value == null ? '' : String(value);
}

function dateText(value: Date | null | undefined): string | null {
  return value == null ? null : value.toISOString().slice(0, 10);
}

function dateValue(value: string): Date | null {
  return value.length === 0 ? null : new Date(`${value}T00:00:00.000Z`);
}

function scopeKey(scope: GrindingPlanningBoardDueScope): string {
  return scope.kind === 'seiban' ? 'seiban' : `processing:${scope.processingType.trim()}`;
}

function normalizeScope(scope: GrindingPlanningBoardDueScope): GrindingPlanningBoardDueScope {
  if (scope.kind === 'seiban') return scope;
  const processingType = scope.processingType.trim();
  if (!processingType) throw new ApiError(400, '表面処理は必須です', undefined, 'INVALID_PROCESSING_TYPE');
  return { kind: 'processing', processingType };
}

async function readTargetRows(client: DbClient, fseiban: string): Promise<TargetRow[]> {
  const rowIds = await listSeibanRowIdsForWriteback({ client, fseiban });
  if (rowIds.length === 0) return [];
  return client.csvDashboardRow.findMany({
    where: { id: { in: rowIds } },
    select: { id: true, rowData: true, updatedAt: true },
    orderBy: { id: 'asc' }
  });
}

async function readScopeRows(client: DbClient, siteKey: string, fseiban: string): Promise<ScopeRow[]> {
  return client.productionScheduleGrindingPlanningBoardDueScope.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, fseiban },
    orderBy: { scopeKey: 'asc' }
  });
}

async function readTargetOverrideRows(client: DbClient, siteKey: string, rows: readonly TargetRow[]): Promise<ProductionScheduleGrindingPlanningBoardOverride[]> {
  const rowIds = rows.map((row) => row.id);
  const splits = rowIds.length === 0
    ? []
    : await client.productionScheduleOrderSplit.findMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, parentCsvDashboardRowId: { in: rowIds } },
      select: { id: true }
    });
  const itemKeys = [
    ...rows.map((row) => buildGrindingPlanningBoardRowItemId(asRowData(row.rowData))),
    ...splits.map((split) => `split:${split.id}`)
  ];
  if (itemKeys.length === 0) return [];
  return client.productionScheduleGrindingPlanningBoardOverride.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, itemKey: { in: itemKeys } },
    orderBy: { itemKey: 'asc' }
  });
}

function buildScopeRevision(params: {
  sourceGenerationToken: string;
  state: { version: number; updatedAt: Date | null } | null;
  scopes: readonly ScopeRow[];
  overrides: readonly ProductionScheduleGrindingPlanningBoardOverride[];
  rows: readonly TargetRow[];
  splits: readonly TargetSplit[];
  originalProcessing: readonly OriginalProcessingRow[];
  originalSeiban: { dueDate: Date | null; updatedAt: Date } | null;
  processingMappings: readonly ProcessingMapping[];
  metadata: readonly TargetMetadata[];
}): string {
  const payload = {
    sourceGenerationToken: params.sourceGenerationToken,
    boardVersion: params.state?.version ?? 0,
    boardUpdatedAt: params.state?.updatedAt?.toISOString() ?? '',
    scopes: params.scopes.map((row) => ({ scopeKey: row.scopeKey, version: row.version, dueDate: dateText(row.dueDate) })),
    overrides: params.overrides.map((row) => ({ itemKey: row.itemKey, version: row.version })),
    rows: params.rows.map((row) => ({ id: row.id, updatedAt: row.updatedAt?.toISOString() ?? '', data: row.rowData })),
    splits: [...params.splits].sort((left, right) => left.id.localeCompare(right.id)).map((split) => ({ id: split.id, parentId: split.parentCsvDashboardRowId, updatedAt: split.updatedAt.toISOString(), dueDate: dateText(split.dueDate) })),
    metadata: params.metadata.map((row) => ({ ...row, noteUpdatedAt: row.noteUpdatedAt?.toISOString() ?? '', supplementUpdatedAt: row.supplementUpdatedAt?.toISOString() ?? '', progressUpdatedAt: row.progressUpdatedAt?.toISOString() ?? '', externalUpdatedAt: row.externalUpdatedAt?.toISOString() ?? '', dueDate: dateText(row.dueDate), plannedEndDate: dateText(row.plannedEndDate) })),
    originalProcessing: [...params.originalProcessing].sort((a, b) => a.processingType.localeCompare(b.processingType)).map((row) => ({ processingType: row.processingType, dueDate: dateText(row.dueDate), updatedAt: row.updatedAt.toISOString() })),
    originalSeiban: params.originalSeiban == null ? null : { dueDate: dateText(params.originalSeiban.dueDate), updatedAt: params.originalSeiban.updatedAt.toISOString() },
    processingMappings: [...params.processingMappings].sort((a, b) => a.fhincd.localeCompare(b.fhincd)).map((row) => ({ fhincd: row.fhincd, processingType: row.processingType, updatedAt: row.updatedAt?.toISOString() ?? '' }))
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function readSnapshotParts(params: { client: DbClient; siteKey: string; fseiban: string; sourceGenerationToken?: string }): Promise<{ sourceGenerationToken: string; scopeRevision: string; scopes: ScopeRow[]; overrides: ProductionScheduleGrindingPlanningBoardOverride[]; rows: TargetRow[]; splits: TargetSplit[]; baseDueByRowId: Map<string, TargetBaseDue>; originalProcessing: Map<string, Date>; originalSeiban: { dueDate: Date | null; updatedAt: Date } | null }> {
  const sourceGenerationToken = params.sourceGenerationToken ?? await readLeaderboardShellSnapshotGenerationToken();
  const [state, scopes, rows, originalProcessing, originalSeiban] = await Promise.all([
    params.client.productionScheduleGrindingPlanningBoardState.findUnique({
      where: { csvDashboardId_siteKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: params.siteKey } },
      select: { version: true, updatedAt: true }
    }),
    readScopeRows(params.client, params.siteKey, params.fseiban),
    readTargetRows(params.client, params.fseiban),
    params.client.productionScheduleSeibanProcessingDueDate.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban: params.fseiban }, select: { processingType: true, dueDate: true, updatedAt: true } }),
    params.client.productionScheduleSeibanDueDate.findUnique({ where: { csvDashboardId_fseiban: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban: params.fseiban } }, select: { dueDate: true, updatedAt: true } })
  ]);
  const splits = await params.client.productionScheduleOrderSplit.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, parentCsvDashboardRowId: { in: rows.map((row) => row.id) } },
    select: { id: true, parentCsvDashboardRowId: true, dueDate: true, updatedAt: true },
    orderBy: { id: 'asc' }
  });
  const [notes, supplements, progress, external, processingMappings] = await Promise.all([
    params.client.productionScheduleRowNote.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, csvDashboardRowId: { in: rows.map((row) => row.id) } }, select: { csvDashboardRowId: true, dueDate: true, processingType: true, updatedAt: true } }),
    params.client.productionScheduleOrderSupplement.findMany({ where: { csvDashboardRowId: { in: rows.map((row) => row.id) } }, select: { csvDashboardRowId: true, plannedEndDate: true, updatedAt: true } }),
    params.client.productionScheduleProgress.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, csvDashboardRowId: { in: rows.map((row) => row.id) } }, select: { csvDashboardRowId: true, isCompleted: true, updatedAt: true } }),
    params.client.productionScheduleExternalCompletion.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, csvDashboardRowId: { in: rows.map((row) => row.id) } }, select: { csvDashboardRowId: true, isExternallyCompleted: true, updatedAt: true } }),
    params.client.productionSchedulePartProcessingType.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fhincd: { in: rows.map((row) => rowValue(asRowData(row.rowData), 'FHINCD')) } }, select: { fhincd: true, processingType: true, updatedAt: true } })
  ]);
  const noteMap = new Map(notes.map((row) => [row.csvDashboardRowId, row]));
  const supplementMap = new Map(supplements.map((row) => [row.csvDashboardRowId, row]));
  const progressMap = new Map(progress.map((row) => [row.csvDashboardRowId, row]));
  const externalMap = new Map(external.map((row) => [row.csvDashboardRowId, row]));
  const metadata = rows.map((row) => ({
    rowId: row.id,
    dueDate: noteMap.get(row.id)?.dueDate ?? null,
    processingType: noteMap.get(row.id)?.processingType ?? null,
    noteUpdatedAt: noteMap.get(row.id)?.updatedAt ?? null,
    plannedEndDate: supplementMap.get(row.id)?.plannedEndDate ?? null,
    supplementUpdatedAt: supplementMap.get(row.id)?.updatedAt ?? null,
    completed: progressMap.get(row.id)?.isCompleted ?? false,
    progressUpdatedAt: progressMap.get(row.id)?.updatedAt ?? null,
    externalCompleted: externalMap.get(row.id)?.isExternallyCompleted ?? false,
    externalUpdatedAt: externalMap.get(row.id)?.updatedAt ?? null
  }));
  const overrides = await readTargetOverrideRows(params.client, params.siteKey, rows);
  return {
    sourceGenerationToken,
    scopeRevision: buildScopeRevision({ sourceGenerationToken, state, scopes, overrides, rows, splits, originalProcessing, originalSeiban, processingMappings, metadata }),
    scopes,
    overrides,
    rows,
    splits,
    baseDueByRowId: new Map(metadata.map((row) => [row.rowId, { dueDate: row.dueDate, plannedEndDate: row.plannedEndDate }])),
    originalProcessing: new Map(originalProcessing.map((row) => [row.processingType, row.dueDate] as const)),
    originalSeiban
  };
}

function cloneDetail(detail: DueManagementSeibanDetail): DueManagementSeibanDetail {
  return {
    ...detail,
    parts: detail.parts.map((part) => ({
      ...part,
      processes: part.processes.map((process) => ({ ...process }))
    }))
  };
}

function toDateTextDetail(detail: PresentedDueManagementSeibanDetail) {
  return {
    ...detail,
    dueDate: typeof detail.dueDate === 'string' ? detail.dueDate : dateText(detail.dueDate as unknown as Date | null),
    processingTypeDueDates: detail.processingTypeDueDates.map((entry) => ({
      ...entry,
      dueDate: dateText(entry.dueDate)
    })),
    parts: detail.parts.map((part) => ({
      ...part,
      plannedStartDate: typeof part.plannedStartDate === 'string' ? part.plannedStartDate : dateText(part.plannedStartDate as unknown as Date | null),
      plannedEndDate: typeof part.plannedEndDate === 'string' ? part.plannedEndDate : dateText(part.plannedEndDate as unknown as Date | null),
      effectiveDueDate: dateText(part.effectiveDueDate)
    }))
  };
}

function buildAlternateDetail(params: { original: DueManagementSeibanDetail; scopes: readonly ScopeRow[]; originalProcessing: ReadonlyMap<string, Date>; rows: readonly TargetRow[]; baseDueByRowId: ReadonlyMap<string, TargetBaseDue>; overrides: readonly ProductionScheduleGrindingPlanningBoardOverride[] }): PresentedDueManagementSeibanDetail {
  const original = cloneDetail(params.original);
  const rowById = new Map(params.rows.map((row) => [row.id, row]));
  const overrideByItemKey = new Map(params.overrides.map((row) => [row.itemKey, row]));
  const seiban = params.scopes.find((scope) => scope.scopeKind === 'seiban');
  const processing = new Map(params.scopes.filter((scope) => scope.scopeKind === 'processing').map((scope) => [scope.processingType ?? '', scope]));
  const activeSeibanDue = seiban?.dueDate ?? null;
  const seibanDue = activeSeibanDue ?? original.dueDate;
  const processingTypes = new Set([
    ...original.parts.map((part) => part.processingType ?? ''),
    ...processing.keys()
  ]);
  const processingDueDateMap = new Map<string, Date>();
  for (const processingType of [...processingTypes].filter(Boolean)) {
    const planning = processing.get(processingType);
    const originalDue = params.originalProcessing.get(processingType);
    const effective = planning?.dueDate
      ?? (planning !== undefined ? activeSeibanDue ?? original.dueDate : originalDue ?? activeSeibanDue ?? original.dueDate)
      ?? original.dueDate;
    if (effective != null) processingDueDateMap.set(processingType, effective);
  }

  const partEffectiveDueDateMap = new Map<string, PartEffectiveDueDate>();
  for (const part of original.parts) {
    const processOverrides = part.processes.map((process) => {
      const sourceRow = rowById.get(process.rowId);
      if (!sourceRow) return undefined;
      return overrideByItemKey.get(buildGrindingPlanningBoardRowItemId(asRowData(sourceRow.rowData)));
    });
    const itemDates = processOverrides.map((override) => override?.overrideDueDate).filter((value): value is Date => value != null);
    // A part is an aggregate of several process rows. Apply an item override
    // only when it is unambiguous across the aggregate; otherwise let the
    // shared processing/source rule represent the part instead of picking the
    // first process arbitrarily.
    if (itemDates.length === part.processes.length && itemDates.length > 0 && itemDates.every((value) => value.getTime() === itemDates[0]!.getTime())) {
      partEffectiveDueDateMap.set(part.fhincd, { dueDate: itemDates[0]!, source: 'manual' });
      continue;
    }
    const planning = part.processingType == null ? undefined : processing.get(part.processingType);
    if (planning?.dueDate == null && planning !== undefined && processOverrides.length === part.processes.length) {
      if (processOverrides.every((override) => override?.dueDateCleared === true)) {
        partEffectiveDueDateMap.set(part.fhincd, {
          dueDate: part.plannedEndDate,
          source: part.plannedEndDate == null ? null : 'csv'
        });
        continue;
      }
      if (processOverrides.every((override) => override?.dueDateCleared === false)) {
        const baseDates = part.processes.map((process) => {
          const base = params.baseDueByRowId.get(process.rowId);
          if (base?.dueDate != null) return { dueDate: base.dueDate, source: 'manual' as const };
          if (base?.plannedEndDate != null) return { dueDate: base.plannedEndDate, source: 'csv' as const };
          return { dueDate: null, source: null };
        });
        const first = baseDates[0];
        if (first && baseDates.every((value) => value.source === first.source && value.dueDate?.getTime() === first.dueDate?.getTime())) {
          partEffectiveDueDateMap.set(part.fhincd, first);
        }
      }
    }
  }
  const rawAlternate: DueManagementSeibanDetail = {
    ...cloneDetail(params.original),
    dueDate: seibanDue
  };
  return presentDueManagementSeibanDetail({
    detail: rawAlternate,
    processingDueDateMap,
    partEffectiveDueDateMap
  });
}

export async function getGrindingPlanningBoardDueScope(params: { siteKey: string; deviceScopeKey?: string; fseiban: string }): Promise<GrindingPlanningBoardDueScopeSnapshot & { scope: GrindingPlanningBoardDueScope }> {
  const fseiban = params.fseiban.trim();
  if (!fseiban) throw new ApiError(400, '製番は必須です', undefined, 'INVALID_SEIBAN');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await readSnapshotParts({ client: prisma, siteKey: params.siteKey, fseiban });
    const original = await getDueManagementSeibanDetailWithScope({ locationScope: { siteKey: params.siteKey, deviceScopeKey: params.deviceScopeKey }, fseiban });
    const after = await readSnapshotParts({ client: prisma, siteKey: params.siteKey, fseiban });
    if (before.sourceGenerationToken !== after.sourceGenerationToken || before.scopeRevision !== after.scopeRevision) {
      if (attempt === 0) continue;
      throw new ApiError(409, '表示中に対象データが更新されました。再読み込みしてください', undefined, 'STALE_PLANNING_DUE_SCOPE');
    }
    const originalPresented = presentDueManagementSeibanDetail({ detail: original, processingDueDateMap: after.originalProcessing });
    const alternate = buildAlternateDetail({ original, scopes: after.scopes, originalProcessing: after.originalProcessing, rows: after.rows, baseDueByRowId: after.baseDueByRowId, overrides: after.overrides });
    return {
      original: toDateTextDetail(originalPresented),
      alternate: toDateTextDetail(alternate),
      sourceGenerationToken: after.sourceGenerationToken,
      scopeRevision: after.scopeRevision,
      scope: { kind: 'seiban' }
    };
  }
  throw new ApiError(409, '表示中に対象データが更新されました。再読み込みしてください', undefined, 'STALE_PLANNING_DUE_SCOPE');
}

type TargetWrite = { itemKey: string; nextDueDate?: Date | null; dueDateCleared?: boolean | null; resetRank: boolean };

async function readWriteTargets(params: { client: Prisma.TransactionClient; siteKey: string; fseiban: string; scope: GrindingPlanningBoardDueScope; dueDate: Date | null; scopesAfter: readonly ScopeRow[]; originalProcessing: ReadonlyMap<string, Date>; originalSeibanDue: Date | null }): Promise<TargetWrite[]> {
  const rows = await readTargetRows(params.client, params.fseiban);
  const rowIds = rows.map((row) => row.id);
  const [notes, processingTypes, splits, supplements] = await Promise.all([
    params.client.productionScheduleRowNote.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, csvDashboardRowId: { in: rowIds } }, select: { csvDashboardRowId: true, dueDate: true, processingType: true } }),
    params.client.productionSchedulePartProcessingType.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fhincd: { in: rows.map((row) => rowValue(asRowData(row.rowData), 'FHINCD')) } }, select: { fhincd: true, processingType: true } }),
    params.client.productionScheduleOrderSplit.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, parentCsvDashboardRowId: { in: rowIds } }, select: { id: true, parentCsvDashboardRowId: true, dueDate: true } }),
    params.client.productionScheduleOrderSupplement.findMany({ where: { csvDashboardRowId: { in: rowIds } }, select: { csvDashboardRowId: true, plannedEndDate: true } })
  ]);
  const overrides = await readTargetOverrideRows(params.client, params.siteKey, rows);
  const overrideMap = new Map(overrides.map((row) => [row.itemKey, row]));
  const noteMap = new Map(notes.map((note) => [note.csvDashboardRowId, note]));
  const supplementMap = new Map(supplements.map((supplement) => [supplement.csvDashboardRowId, supplement]));
  const processingMap = new Map(processingTypes.map((row) => [row.fhincd, row.processingType]));
  const planningProcessing = new Map(params.scopesAfter.filter((scope) => scope.scopeKind === 'processing').map((scope) => [scope.processingType ?? '', scope]));
  const planningSeiban = params.scopesAfter.find((scope) => scope.scopeKind === 'seiban');
  const processingClearFallsBackToCsv = params.scope.kind === 'processing' && params.dueDate == null && planningSeiban?.dueDate == null && params.originalSeibanDue == null;
  let matchedProcessing = false;
  const targetDueForRow = (row: TargetRow): Date | null | undefined => {
    const data = asRowData(row.rowData);
    const processingType = processingMap.get(rowValue(data, 'FHINCD')) ?? noteMap.get(row.id)?.processingType ?? null;
    if (params.scope.kind === 'processing' && processingType !== params.scope.processingType) return undefined;
    if (params.scope.kind === 'processing') matchedProcessing = true;
    if (params.scope.kind === 'seiban') {
      const planning = processingType ? planningProcessing.get(processingType) : undefined;
      // A seiban set is protected by an active planning processing due. An
      // explicit processing tombstone means that protection was released and
      // the next seiban value should apply. When no planning processing row
      // exists, the original processing due remains protected.
      if (params.dueDate == null) {
        // Clearing removes the planning parent override. The effective date
        // then comes from the original row/split projection.
        return null;
      }
      if (processingType && planning?.dueDate != null) {
        return undefined;
      }
      if (processingType && planning === undefined && params.originalProcessing.has(processingType)) return undefined;
    }
    if (params.scope.kind === 'processing') {
      return params.dueDate ?? planningSeiban?.dueDate ?? params.originalSeibanDue ?? noteMap.get(row.id)?.dueDate ?? supplementMap.get(row.id)?.plannedEndDate ?? null;
    }
    return params.dueDate ?? noteMap.get(row.id)?.dueDate ?? supplementMap.get(row.id)?.plannedEndDate ?? params.originalSeibanDue ?? null;
  };
  const writes: TargetWrite[] = [];
  for (const row of rows) {
    const nextParentDate = targetDueForRow(row);
    if (nextParentDate === undefined) continue;
    const key = buildGrindingPlanningBoardRowItemId(asRowData(row.rowData));
    const current = overrideMap.get(key);
    const base = noteMap.get(row.id)?.dueDate ?? supplementMap.get(row.id)?.plannedEndDate ?? null;
    const before = current?.dueDateCleared === true
      ? supplementMap.get(row.id)?.plannedEndDate ?? null
      : current?.overrideDueDate ?? base;
    const after = processingClearFallsBackToCsv
      ? supplementMap.get(row.id)?.plannedEndDate ?? null
      : nextParentDate ?? base;
    const changed = before?.getTime() !== after?.getTime();
    writes.push({ itemKey: key, nextDueDate: processingClearFallsBackToCsv ? null : nextParentDate, dueDateCleared: processingClearFallsBackToCsv ? true : params.scope.kind === 'processing' || params.scope.kind === 'seiban' ? false : current?.dueDateCleared ?? null, resetRank: changed });
    for (const split of splits.filter((candidate) => candidate.parentCsvDashboardRowId === row.id)) {
      const splitKey = `split:${split.id}`;
      const splitOverride = overrideMap.get(splitKey);
      if (split.dueDate != null || splitOverride?.overrideDueDate != null) continue;
      const inheritedBefore = current?.dueDateCleared === true
        ? supplementMap.get(row.id)?.plannedEndDate ?? null
        : current?.overrideDueDate ?? base;
      // Keep the split override absent: projection inherits the parent item
      // value. Only its rank is invalidated when the inherited effective due
      // changes.
      const inheritedAfter = processingClearFallsBackToCsv
        ? supplementMap.get(row.id)?.plannedEndDate ?? null
        : nextParentDate ?? base;
      writes.push({ itemKey: splitKey, resetRank: inheritedBefore?.getTime() !== inheritedAfter?.getTime() });
    }
  }
  if (params.scope.kind === 'processing' && !matchedProcessing) {
    throw new ApiError(404, '指定された製番内に対象の表面処理が見つかりません', undefined, 'PROCESSING_TYPE_NOT_FOUND');
  }
  return writes;
}

async function writeTargetOverride(client: Prisma.TransactionClient, siteKey: string, target: TargetWrite, current: ProductionScheduleGrindingPlanningBoardOverride | undefined): Promise<void> {
  const nextDueDate = target.nextDueDate === undefined ? current?.overrideDueDate ?? null : target.nextDueDate;
  const nextDueDateCleared = target.dueDateCleared === undefined ? current?.dueDateCleared ?? null : target.dueDateCleared;
  const changed = (target.nextDueDate !== undefined && (current == null ? nextDueDate != null : current.overrideDueDate?.getTime() !== nextDueDate?.getTime())) || (current?.dueDateCleared ?? null) !== nextDueDateCleared;
  const nextRank = target.resetRank ? null : current?.alternateRank ?? null;
  if (!changed && nextRank === (current?.alternateRank ?? null)) return;
  await client.productionScheduleGrindingPlanningBoardOverride.upsert({
    where: { csvDashboardId_siteKey_itemKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, itemKey: target.itemKey } },
    create: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, itemKey: target.itemKey, overrideDueDate: nextDueDate, dueDateCleared: nextDueDateCleared, overrideResourceCd: current?.overrideResourceCd ?? null, alternateRank: nextRank, specialDueKind: current?.specialDueKind ?? null, specialDueExpiresAt: current?.specialDueExpiresAt ?? null },
    update: { overrideDueDate: nextDueDate, dueDateCleared: nextDueDateCleared, alternateRank: nextRank, specialDueKind: current?.specialDueKind ?? null, specialDueExpiresAt: current?.specialDueExpiresAt ?? null, version: { increment: 1 } }
  });
}

export async function updateGrindingPlanningBoardDueScope(params: { siteKey: string; fseiban: string; request: GrindingPlanningBoardDueScopeRequest }): Promise<{ success: true; sourceGenerationToken: string; scopeRevision: string }> {
  const fseiban = params.fseiban.trim();
  if (!fseiban) throw new ApiError(400, '製番は必須です', undefined, 'INVALID_SEIBAN');
  const scope = normalizeScope(params.request.scope);
  if (!isValidDueDateText(params.request.dueDate)) throw new ApiError(400, '納期日はYYYY-MM-DD形式で入力してください', undefined, 'INVALID_DUE_DATE');
  const dueDate = dateValue(params.request.dueDate.trim());
  try {
    await prisma.$transaction(async (client) => {
      const rowsToLock = await readTargetRows(client, fseiban);
      for (const row of rowsToLock) await acquireProductionScheduleParentRowLockInTransaction(client, row.id);
      const before = await readSnapshotParts({ client, siteKey: params.siteKey, fseiban, sourceGenerationToken: await readLeaderboardShellSnapshotGenerationToken() });
      if (before.sourceGenerationToken !== params.request.sourceGenerationToken || before.scopeRevision !== params.request.scopeRevision) throw new ApiError(409, '表示時点の納期設定が更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_DUE_SCOPE');
      const originalProcessingRows = await client.productionScheduleSeibanProcessingDueDate.findMany({
        where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban },
        select: { processingType: true, dueDate: true }
      });
      const originalProcessing = new Map(originalProcessingRows.map((row) => [row.processingType, row.dueDate] as const));
      const originalSeiban = await client.productionScheduleSeibanDueDate.findUnique({ where: { csvDashboardId_fseiban: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban } }, select: { dueDate: true } });
      const key = scopeKey(scope);
      const scopesAfter = before.scopes
        .filter((row) => !(scope.kind === 'seiban' && dueDate == null && row.scopeKind === 'processing'))
        .map((row) => ({ ...row }));
      const existing = scopesAfter.find((row) => row.scopeKey === key);
      if (existing) existing.dueDate = dueDate;
      else scopesAfter.push({ id: '', csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: params.siteKey, fseiban, scopeKey: key, scopeKind: scope.kind, processingType: scope.kind === 'processing' ? scope.processingType : null, dueDate, version: 1, createdAt: new Date(0), updatedAt: new Date(0) });
      const targets = await readWriteTargets({ client, siteKey: params.siteKey, fseiban, scope, dueDate, scopesAfter, originalProcessing, originalSeibanDue: originalSeiban?.dueDate ?? null });
      const currentOverrides = await readTargetOverrideRows(client, params.siteKey, rowsToLock);
      const currentMap = new Map(currentOverrides.map((row) => [row.itemKey, row]));
      await client.productionScheduleGrindingPlanningBoardDueScope.upsert({
        where: { csvDashboardId_siteKey_fseiban_scopeKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: params.siteKey, fseiban, scopeKey: key } },
        create: { id: randomUUID(), csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: params.siteKey, fseiban, scopeKey: key, scopeKind: scope.kind, processingType: scope.kind === 'processing' ? scope.processingType : null, dueDate },
        update: { dueDate, scopeKind: scope.kind, processingType: scope.kind === 'processing' ? scope.processingType : null, version: { increment: 1 } }
      });
      if (scope.kind === 'seiban' && dueDate == null) {
        await client.productionScheduleGrindingPlanningBoardDueScope.deleteMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: params.siteKey, fseiban, scopeKind: 'processing' } });
      }
      for (const target of targets) await writeTargetOverride(client, params.siteKey, target, currentMap.get(target.itemKey));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002')) throw new ApiError(409, '同時更新がありました。再読み込みしてください', undefined, 'STALE_PLANNING_DUE_SCOPE');
    throw error;
  }
  const after = await readSnapshotParts({ client: prisma, siteKey: params.siteKey, fseiban });
  return { success: true, sourceGenerationToken: after.sourceGenerationToken, scopeRevision: after.scopeRevision };
}
