import { encodeSessakuPieceKey, sessakuPieceKeyFromRow, type SessakuPieceSet } from '../sessaku-pieces/piece-key.js';

import type { GrindingPlanningBoardCategory } from '@raspi-system/shared-types';
import { describe, expect, it } from 'vitest';

import {
  buildGrindingPlanningBoardLogicalKey,
  buildGrindingPlanningBoardRowItemId,
  projectGrindingPlanningBoard,
  resolveGrindingPlanningBoardParentDueDate,
  sortGrindingPlanningBoardProjectionItems,
  type GrindingPlanningBoardProjectionOverride,
  type GrindingPlanningBoardProjectionRow,
  type GrindingPlanningBoardProjectionRowDetail
} from '../grinding-planning-board-projection.js';

const sourceRow = (
  overrides: Record<string, unknown> = {},
  id = 'row-1'
): GrindingPlanningBoardProjectionRow => ({
  id,
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  rowData: {
    FSEIBAN: 'S-001',
    ProductNo: '10',
    FHINCD: 'P-001',
    FSIGENCD: 'G-01',
    FKOJUN: '20',
    FHINMEI: '部品A',
    FSIGENSHOYORYO: '100',
    ...overrides
  }
});

const detail = (overrides: Partial<GrindingPlanningBoardProjectionRowDetail> & { orderSplits?: unknown[] } = {}): GrindingPlanningBoardProjectionRowDetail => ({
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  rowNotes: [{ dueDate: new Date('2026-09-10T00:00:00.000Z') }],
  orderSupplements: [{ plannedQuantity: 3, plannedEndDate: null }],
  productionScheduleProgress: { isCompleted: false, updatedAt: new Date('2026-09-01T00:00:00.000Z') },
  productionScheduleExternalCompletion: null,
  ...overrides
});

const baseParams = (overrides: Partial<Parameters<typeof projectGrindingPlanningBoard>[0]> = {}) => ({
  rows: [sourceRow()],
  details: new Map([['row-1', detail()]]),
  ranks: { rows: new Map() },
  overrides: new Map<string, GrindingPlanningBoardProjectionOverride>(),
  category: 'grinding' as const,
  seibanOrder: ['S-001'],
  machineNameBySeiban: new Map([['S-001', '機種A']]),
  isResourceInCategory: (resourceCd: string, category: GrindingPlanningBoardCategory) =>
    category === 'grinding' && resourceCd.startsWith('G-'),
  ...overrides
});

describe('grinding-planning-board-projection', () => {
  it('projects operation ranges, frozen sources, independent overrides and completion', () => {
    const key = sessakuPieceKeyFromRow(sourceRow().rowData);
    const now = new Date('2026-11-11');
    const piece = { id: 'range', pieceSetId: 'set', position: 1, quantity: 1, sourcePieceId: null,
      isCompleted: false, completedAt: null, createdAt: now, updatedAt: now,
      opCompletions: [{ opNo: 1 }, { opNo: 2 }, { opNo: 19 }],
      opSplits: [{ fromOpNo: 3, sourceResourceCd: 'G-01', leadingSourceResourceCd: 'G-01' }] };
    const set: SessakuPieceSet = { ...key, id: 'set', csvDashboardId: 'dashboard', version: 2, nextPosition: 2,
      sourcePieceSetId: null, plannedQuantity: 1, quantityWarning: null, createdAt: now, updatedAt: now, pieces: [piece] };
    const ops = [1, 2, 3, 4].map((opNo) => ({ opNo, minutes: opNo * 10, setupMinutes: opNo }));
    const params = baseParams({ includePieces: true, pieceSets: new Map([[encodeSessakuPieceKey(key), set]]),
      resourceMinutes: { ownSourceResourceCds: ['G-01', 'G-02'], values: [
        { resourceCd: 'G-01', fhincd: key.fhincd, perUnitMinutes: 100, setupMinutes: 10, ops },
        { resourceCd: 'G-02', fhincd: key.fhincd, perUnitMinutes: 999, setupMinutes: 99, ops: [{ opNo: 1, minutes: 999 }] }
      ] }, resourceCapacity: { dailyHoursByResource: {}, runsThroughBreaksResources: [], unitSplitEnabledByResource: { 'G-02': false } } });
    const project = () => projectGrindingPlanningBoard(params);
    const initial = project();
    const [head, tail] = initial.items;
    expect(head).toMatchObject({ itemId: 'piece:range', pieceId: 'range', opRange: { fromOpNo: 1, toOpNo: 2 },
      unitRequiredMinutes: 30, setupMinutes: 3, completedOpNos: [1, 2], isCompleted: true });
    expect(tail).toMatchObject({ itemId: 'pieceops:range:3', pieceId: 'range', parentItemId: head.parentItemId,
      opRange: { fromOpNo: 3, toOpNo: 4 }, unitRequiredMinutes: 70, setupMinutes: 7, completedOpNos: [], isCompleted: false });
    expect(head.ops?.map((op) => op.opNo)).toEqual([1, 2]);
    expect(tail.ops?.map((op) => op.opNo)).toEqual([3, 4]);
    params.overrides.set(tail.itemId, { overrideResourceCd: 'G-02', overrideDueDate: new Date('2026-11-20'), alternateRank: 42, orderPinned: true, version: 1 });
    expect(project().items.find((item) => item.itemId === tail.itemId)).toMatchObject({
      effectiveResourceCd: 'G-02', unitRequiredMinutes: 70, setupMinutes: 7, effectiveDueDate: '2026-11-20', alternateRank: 42, orderPinned: true });
    piece.opSplits.push({ fromOpNo: 4, sourceResourceCd: 'G-01', leadingSourceResourceCd: 'G-01' });
    const multiple = project().items;
    expect(multiple).toHaveLength(3);
    expect(multiple.find((item) => item.itemId === 'pieceops:range:3')?.opRange).toEqual({ fromOpNo: 3, toOpNo: 3 });
    expect(multiple.find((item) => item.itemId === head.itemId)?.itemRevision).not.toBe(head.itemRevision);
    piece.position = 2;
    set.pieces.push({ ...piece, id: 'first', position: 1, opSplits: [], isCompleted: true });
    expect(project().items.filter((item) => item.pieceId === piece.id).every((item) => item.setupMinutes === 0)).toBe(true);
    piece.isCompleted = true;
    expect(project().items.filter((item) => item.pieceId === piece.id).every((item) => item.isCompleted)).toBe(true);
  });
  it('links a later process to the last operation bar of its source piece', () => {
    const row = sourceRow();
    const later = sourceRow({ FKOJUN: '30' }, 'later-row');
    const now = new Date('2026-11-11');
    const key = sessakuPieceKeyFromRow(row.rowData);
    const piece = { id: 'source', pieceSetId: 'set', position: 1, quantity: 1, sourcePieceId: null,
      isCompleted: false, completedAt: null, createdAt: now, updatedAt: now,
      opSplits: [{ fromOpNo: 3, sourceResourceCd: 'G-01' }] };
    const set: SessakuPieceSet = { ...key, id: 'set', csvDashboardId: 'dashboard', version: 2, nextPosition: 2,
      sourcePieceSetId: null, plannedQuantity: 1, quantityWarning: null, createdAt: now, updatedAt: now, pieces: [piece] };
    const laterKey = sessakuPieceKeyFromRow(later.rowData);
    const projected = projectGrindingPlanningBoard(baseParams({ rows: [row, later], includePieces: true,
      details: new Map([['row-1', detail()], ['later-row', detail()]]),
      pieceSets: new Map([[encodeSessakuPieceKey(key), set], [encodeSessakuPieceKey(laterKey), { ...set, ...laterKey,
        id: 'later-set', sourcePieceSetId: set.id, pieces: [{ ...piece, id: 'later-piece', sourcePieceId: piece.id, sourcePiece: { opSplits: [{ fromOpNo: 3 }] }, opSplits: [] }] }]]) }));
    expect(projected.items.find((item) => item.pieceId === 'later-piece')?.sourceItemId).toBe('pieceops:source:3');
    const laterOnly = projectGrindingPlanningBoard(baseParams({ rows: [later], includePieces: true,
      details: new Map([['later-row', detail()]]), pieceSets: new Map([[encodeSessakuPieceKey(laterKey), { ...set, ...laterKey,
        id: 'later-set', sourcePieceSetId: set.id, pieces: [{ ...piece, id: 'later-piece', sourcePieceId: piece.id,
          sourcePiece: { opSplits: [{ fromOpNo: 3 }] }, opSplits: [] }] }]]) }));
    expect(laterOnly.items[0].sourceItemId).toBe('pieceops:source:3');
  });
  it.each([true, false])('adds separate setup/operation fields only on enabled effective resources (enabled=%s)', (enabled) => {
    const source = sourceRow({ FSIGENCD: '021' });
    const key = sessakuPieceKeyFromRow(source.rowData);
    const updatedAt = new Date('2026-11-09');
    const set: SessakuPieceSet = { ...key, id: 'set', csvDashboardId: 'dashboard', version: 2, nextPosition: 3,
      sourcePieceSetId: null, plannedQuantity: 3, quantityWarning: null, createdAt: updatedAt, updatedAt,
      pieces: [1, 2].map((quantity, index) => ({ id: `op-${index}`, pieceSetId: 'set', position: index + 1,
        quantity, sourcePieceId: null, isCompleted: false, completedAt: null, createdAt: updatedAt, updatedAt,
        opCompletions: [{ opNo: 2 }, { opNo: 19 }] })) };
    const ops = [{ opNo: 1, minutes: 4 }, { opNo: 2, minutes: 6 }];
    const params = baseParams({ rows: [source], includePieces: true, isResourceInCategory: () => true,
      pieceSets: new Map([[encodeSessakuPieceKey(key), set]]),
      resourceMinutes: { ownSourceResourceCds: ['022'], values: [{ resourceCd: '022', fhincd: 'P-001', perUnitMinutes: 10, setupMinutes: 30, ops }] },
      resourceCapacity: { dailyHoursByResource: {}, runsThroughBreaksResources: [], unitSplitEnabledByResource: { '022': enabled } },
      overrides: new Map([[buildGrindingPlanningBoardRowItemId(source.rowData), {
        overrideResourceCd: '022', overrideDueDate: null, alternateRank: null, version: 1
      }]]) });
    const items = projectGrindingPlanningBoard(params).items;
    const placement = projectGrindingPlanningBoard({ ...params, placementOnly: true });
    const orderingFields = (values: typeof items) => values.map(({ itemRevision, progress, ...item }) => item);
    expect(orderingFields(placement.items)).toEqual(orderingFields(items));
    expect(placement.items.every((item) => item.itemRevision === '')).toBe(true);
    expect(placement.load).toEqual([]);
    expect(items.map((item) => item.requiredMinutes)).toEqual([40, 20]);
    if (enabled) {
      expect(items.map((item) => item.unitRequiredMinutes)).toEqual([10, 20]);
      expect(items.map((item) => item.setupMinutes)).toEqual([30, 0]);
      expect(items[0].ops).toEqual(ops);
      expect(items[0].completedOpNos).toEqual([2]);
    } else {
      for (const item of items) expect(item).not.toHaveProperty('unitRequiredMinutes');
    }
    const original = projectGrindingPlanningBoard({ ...params,
      resourceMinutes: { ...params.resourceMinutes!, ownSourceResourceCds: [] } }).items;
    if (enabled) expect(original[0]).toMatchObject({ unitRequiredMinutes: 100 / 3, setupMinutes: 0 });
  });
  it.each([true, false])('charges setup on the minimum position including completed pieces (unitSplit=%s)', (enabled) => {
    const source = sourceRow();
    const key = sessakuPieceKeyFromRow(source.rowData);
    const updatedAt = new Date('2026-11-09');
    const set: SessakuPieceSet = { ...key, id: 'set', csvDashboardId: 'dashboard', version: 1, nextPosition: 30,
      plannedQuantity: 10, quantityWarning: null, createdAt: updatedAt, updatedAt,
      pieces: Array.from({ length: 10 }, (_, index) => ({ id: `unit-${index}`, pieceSetId: 'set', position: 5 + index * 2,
        quantity: 1, sourcePieceId: null, isCompleted: false, completedAt: null, createdAt: updatedAt, updatedAt })).reverse() };
    const params = baseParams({ includePieces: true, pieceSets: new Map([[encodeSessakuPieceKey(key), set]]),
      details: new Map([['row-1', detail({ orderSupplements: [{ plannedQuantity: 10, plannedEndDate: null }] })]]),
      resourceMinutes: { ownSourceResourceCds: ['G-01', 'G-02'], values: ['G-01', 'G-02'].map((resourceCd) =>
        ({ resourceCd, fhincd: 'P-001', perUnitMinutes: 30, setupMinutes: 60 })) },
      resourceCapacity: { dailyHoursByResource: {}, runsThroughBreaksResources: [], unitSplitEnabledByResource: { 'G-01': enabled } } });
    const project = () => projectGrindingPlanningBoard(params);
    const items = project().items;
    expect(items.find((item) => item.piecePosition === 5)).toMatchObject({ requiredMinutes: 90, ownRequiredMinutes: 90 });
    expect(items.filter((item) => item.piecePosition !== 5).every((item) => item.requiredMinutes === 30 && item.ownRequiredMinutes === 30)).toBe(true);
    expect(project().load[0].requiredMinutes).toBe(360);
    if (enabled) expect(items.filter((item) => item.piecePosition !== 5).every((item) => item.setupMinutes === 0)).toBe(true);
    params.overrides.set('piece:unit-0', { overrideResourceCd: 'G-02', overrideDueDate: null, alternateRank: null, version: 1 });
    expect(project().load.find((entry) => entry.resourceCd === 'G-02')?.requiredMinutes).toBe(90);
    expect(project().load.find((entry) => entry.resourceCd === 'G-01')?.requiredMinutes).toBe(270);
    set.pieces.find((piece) => piece.position === 5)!.isCompleted = true;
    expect(project().items.filter((item) => !item.isCompleted).every((item) => item.requiredMinutes === 30)).toBe(true);
    expect(project().load.find((entry) => entry.resourceCd === 'G-01')?.requiredMinutes).toBe(270);
  });
  it.each(['100', ''])('uses own minutes with CSV %j and the effective resource for rows and split bars', (csvMinutes) => {
    const source = sourceRow({ FSIGENSHOYORYO: csvMinutes, FHINCD: ' P-001 ' });
    const key = sessakuPieceKeyFromRow(source.rowData);
    const updatedAt = new Date('2026-11-09');
    const set: SessakuPieceSet = { ...key, id: 'set', csvDashboardId: 'dashboard', version: 1, nextPosition: 3,
      plannedQuantity: 3, quantityWarning: null, createdAt: updatedAt, updatedAt,
      pieces: [1, 2].map((quantity, index) => ({ id: `own-${index}`, pieceSetId: 'set', position: index + 1,
        quantity, sourcePieceId: null, isCompleted: false, completedAt: null, createdAt: updatedAt, updatedAt })) };
    const resourceMinutes = { ownSourceResourceCds: ['G-02'], values: [
      { resourceCd: 'G-02', fhincd: 'P-001', perUnitMinutes: 10, setupMinutes: 30 }
    ] };
    const overrides = new Map([[buildGrindingPlanningBoardRowItemId(source.rowData), {
      overrideResourceCd: 'G-02', overrideDueDate: null, alternateRank: null, version: 1
    }]]);
    const params = baseParams({ rows: [source], resourceMinutes, overrides, pieceSets: new Map([[encodeSessakuPieceKey(key), set]]) });
    const parent = projectGrindingPlanningBoard(params).items[0]!;
    expect(parent).toMatchObject({ requiredMinutes: 60, ownRequiredMinutes: 60, requiredMinutesSource: 'own',
      originalRequiredMinutes: csvMinutes ? 100 : null });
    const result = projectGrindingPlanningBoard({ ...params, includePieces: true });
    expect(result.items.map((item) => item.requiredMinutes)).toEqual([40, 20]);
    expect(result.items.map((item) => item.originalRequiredMinutes)).toEqual(csvMinutes ? [100 / 3, 200 / 3] : [null, null]);
    expect(result.load.find((entry) => entry.resourceCd === 'G-02')?.requiredMinutes).toBe(60);
    const moved = projectGrindingPlanningBoard({ ...params, includePieces: true,
      overrides: new Map([...overrides, ['piece:own-0', { overrideResourceCd: 'G-03', overrideDueDate: null, alternateRank: null, version: 1 }]]) });
    expect(moved.items.find((item) => item.pieceId === 'own-0')).toMatchObject({
      requiredMinutesSource: 'original', ownRequiredMinutes: null
    });
  });

  it('keeps proportional piece minutes unrounded and treats zero or null parents as unknown', () => {
    const updatedAt = new Date('2026-11-06');
    const source = sourceRow({ FSIGENSHOYORYO: '1' });
    const key = sessakuPieceKeyFromRow(source.rowData);
    const set: SessakuPieceSet = { ...key, id: 'set', csvDashboardId: 'dashboard', version: 1, nextPosition: 3,
      plannedQuantity: 3, quantityWarning: null, createdAt: updatedAt, updatedAt,
      pieces: [1, 2].map((quantity, index) => ({ id: `piece-${index}`, pieceSetId: 'set', position: index + 1,
        quantity, sourcePieceId: null, isCompleted: false, completedAt: null, createdAt: updatedAt, updatedAt })) };
    const project = (minutes: string) => projectGrindingPlanningBoard(baseParams({ rows: [{ ...source, rowData: { ...source.rowData as object, FSIGENSHOYORYO: minutes } }],
      includePieces: true, pieceSets: new Map([[encodeSessakuPieceKey(key), set]]) })).items;
    const items = project('1');
    expect(items.map((item) => item.requiredMinutes)).toEqual([1 / 3, 2 / 3]);
    expect(items.reduce((sum, item) => sum + item.requiredMinutes!, 0)).toBe(1);
    for (const minutes of ['0', '']) expect(project(minutes).map((item) => [item.requiredMinutes, item.requiredMinutesKnown])).toEqual([[null, false], [null, false]]);
  });
  it.each([false, true])('projects the set-level later flag with detached pieces or an empty set (empty=%s)', (empty) => {
    const updatedAt = new Date('2026-11-07');
    const key = sessakuPieceKeyFromRow(sourceRow().rowData);
    const set: SessakuPieceSet = { ...key, id: 'later', sourcePieceSetId: 'cutting', csvDashboardId: 'dashboard',
      version: 2, nextPosition: 3, plannedQuantity: 5, quantityWarning: null, createdAt: updatedAt, updatedAt,
      pieces: empty ? [] : [2, 3].map((quantity, index) => ({ id: `later-${index}`, sourcePieceId: null,
        pieceSetId: 'later', position: index + 1, quantity, isCompleted: false, completedAt: null, createdAt: updatedAt, updatedAt })) };
    const project = (sourcePieceSetId: string | null) => projectGrindingPlanningBoard(baseParams({ includePieces: true,
      pieceSets: new Map([[encodeSessakuPieceKey(key), { ...set, sourcePieceSetId }]]) })).items;
    const items = project('cutting');
    expect(items).toHaveLength(empty ? 1 : 2);
    expect(items.every((item) => item.isLaterProcess === true)).toBe(true);
    expect(items.every((item) => item.kind === (empty ? 'row' : 'piece') && !item.sourcePieceId)).toBe(true);
    expect(project(null).every((item) => item.isLaterProcess === false)).toBe(true);
  });
  it.each([5, null])('projects linked grinding pieces with proportional load using supplement total %s', (plannedQuantity) => {
    const updatedAt = new Date('2026-11-07');
    const key = sessakuPieceKeyFromRow(sourceRow().rowData);
    const set: SessakuPieceSet = { ...key, id: 'later', csvDashboardId: 'dashboard', version: 2, nextPosition: 4,
      plannedQuantity: 5, quantityWarning: null, createdAt: updatedAt, updatedAt,
      pieces: [1, 2, 2].map((quantity, index) => ({ id: `later-${index}`, sourcePieceId: `cut-${index}`, pieceSetId: 'later',
        position: index + 1, quantity, isCompleted: index === 1, completedAt: index === 1 ? updatedAt : null, createdAt: updatedAt, updatedAt })) };
    const result = projectGrindingPlanningBoard(baseParams({ includePieces: true,
      details: new Map([['row-1', detail({ orderSupplements: [{ plannedQuantity, plannedEndDate: null }] })]]),
      pieceSets: new Map([[encodeSessakuPieceKey(key), set]]) }));
    expect(result.items.map((item) => [item.sourcePieceId, item.quantity, item.requiredMinutes, item.isCompleted])).toEqual([
      ['cut-0', 1, 20, false], ['cut-1', 2, 40, true], ['cut-2', 2, 40, false]
    ]);
    expect(result.items.map((item) => item.parentPlannedQuantity)).toEqual([5, 5, 5]);
    expect(result.items.every((item) => item.requiredMinutesKnown)).toBe(true);
    expect(result.unknownRequiredMinutesCount).toBe(0);
    expect(result.load[0].requiredMinutes).toBe(60);
  });
  it.each([
    [false, false, null], [true, false, 'manual'], [false, true, 'import'], [true, true, 'import']
  ] as const)('projects manual=%s external=%s as %s for parent rows even with legacy records', (manual, external, completionSource) => {
    const updatedAt = new Date('2026-09-01');
    const sourceDetail = detail({
      productionScheduleProgress: { isCompleted: manual, updatedAt },
      productionScheduleExternalCompletion: { isExternallyCompleted: external, updatedAt }
    });
    const project = (value: GrindingPlanningBoardProjectionRowDetail) => projectGrindingPlanningBoard(baseParams({
      details: new Map([['row-1', value]])
    })).items;
    expect(project(sourceDetail)[0]).toMatchObject({ kind: 'row', isCompleted: manual || external, completionSource });
    const splits = project({ ...sourceDetail, ...{ orderSplits: [
      { id: 'split-1', splitQuantity: 1, dueDate: null, updatedAt },
      { id: 'split-2', splitQuantity: 2, dueDate: null, updatedAt }
    ] } });
    expect(splits).toHaveLength(1);
    for (const split of splits) expect(split).toMatchObject({ kind: 'row', isCompleted: manual || external, completionSource });
  });

  it('changes the item revision when manual completion becomes import completion', () => {
    const updatedAt = new Date('2026-09-01');
    const manual = detail({ productionScheduleProgress: { isCompleted: true, updatedAt } });
    const project = (value: GrindingPlanningBoardProjectionRowDetail) => projectGrindingPlanningBoard(baseParams({
      details: new Map([['row-1', value]])
    })).items[0]!;
    expect(project({ ...manual, productionScheduleExternalCompletion: { isExternallyCompleted: true, updatedAt } }).itemRevision)
      .not.toBe(project(manual).itemRevision);
  });

  it('exposes a pin without changing original resource, due or rank semantics', () => {
    const input = baseParams();
    const original = projectGrindingPlanningBoard(input).items[0]!;
    const pinned = projectGrindingPlanningBoard({ ...input, overrides: new Map([[original.itemId, {
      overrideResourceCd: null, overrideDueDate: null, dueDateCleared: null, alternateRank: null, orderPinned: true, version: 1
    }]]) }).items[0]!;
    expect(original.orderPinned).toBe(false);
    expect(pinned).toMatchObject({ orderPinned: true, effectiveResourceCd: original.effectiveResourceCd,
      effectiveDueDate: original.effectiveDueDate, originalRank: original.originalRank, alternateRank: original.alternateRank });
    expect(pinned.itemRevision).not.toBe(original.itemRevision);
  });
  it('distinguishes CSV fallback clears from explicit original restores and restores parent dates', () => {
    const originalParentDueDate = new Date('2026-09-21T00:00:00.000Z');
    const plannedEndDate = new Date('2026-09-30T00:00:00.000Z');
    expect(resolveGrindingPlanningBoardParentDueDate({
      originalParentDueDate,
      plannedEndDate,
      override: { overrideDueDate: null, dueDateCleared: true }
    })).toBe('2026-09-30');
    expect(resolveGrindingPlanningBoardParentDueDate({
      originalParentDueDate,
      plannedEndDate,
      override: { overrideDueDate: null, dueDateCleared: false }
    })).toBe('2026-09-21');
    expect(resolveGrindingPlanningBoardParentDueDate({
      originalParentDueDate,
      plannedEndDate,
      override: { overrideDueDate: null, dueDateCleared: true }
    })).toBe('2026-09-30');
  });

  it('uses the exact logical key and the resolved machine/rank maps', () => {
    const params = baseParams({
      ranks: {
        rows: new Map([['row-1', { resourceCd: 'G-01', orderNumber: 4 }]]),
      }
    });
    const result = projectGrindingPlanningBoard(params);
    const item = result.items[0];
    expect(buildGrindingPlanningBoardLogicalKey(params.rows[0]!.rowData)).toBe(
      '["S-001","P-001","G-01","20"]'
    );
    expect(item?.itemId).toBe(buildGrindingPlanningBoardRowItemId(params.rows[0]!.rowData));
    expect(item?.machineName).toBe('機種A');
    expect(item?.originalRank).toBe(4);
    expect(item?.alternateRank).toBeNull();
  });

  it('uses order-specific IDs and part progress for unassigned seiban', () => {
    const first = sourceRow({ FSEIBAN: '********', ProductNo: '0003729969' }, 'row-old');
    const second = sourceRow({ FSEIBAN: '********', ProductNo: '0004104427' }, 'row-new');
    expect(buildGrindingPlanningBoardRowItemId(first.rowData)).not.toBe(
      buildGrindingPlanningBoardRowItemId(second.rowData));
    const result = projectGrindingPlanningBoard(baseParams({
      rows: [first, second],
      details: new Map([
        ['row-old', detail({ productionScheduleProgress: { isCompleted: true, updatedAt: new Date('2026-09-01') } })],
        ['row-new', detail()],
      ]),
    }));
    expect(result.items).toHaveLength(2);
    expect(new Set(result.items.map((item) => item.itemId)).size).toBe(2);
    expect(result.items.find((item) => item.productNo === '0003729969')?.progress).toEqual({
      completed: 1, total: 1, quantityKnown: false
    });
    expect(result.items.find((item) => item.productNo === '0004104427')?.progress).toEqual({
      completed: 0, total: 1, quantityKnown: false
    });
  });

  it('projects special due metadata and sorts resource items by expiry before rank', () => {
    const first = sourceRow({ FKOJUN: '10' }, 'row-first');
    const second = sourceRow({ FKOJUN: '20' }, 'row-second');
    const firstId = buildGrindingPlanningBoardRowItemId(first.rowData);
    const secondId = buildGrindingPlanningBoardRowItemId(second.rowData);
    const result = projectGrindingPlanningBoard(baseParams({
      rows: [first, second],
      details: new Map([
        ['row-first', detail()],
        ['row-second', detail()]
      ]),
      overrides: new Map([
        [firstId, {
          overrideResourceCd: null,
          overrideDueDate: null,
          alternateRank: 1,
          specialDueKind: 'overnight',
          specialDueExpiresAt: new Date('2026-09-13T23:00:00.000Z'),
          version: 1
        }],
        [secondId, {
          overrideResourceCd: null,
          overrideDueDate: null,
          alternateRank: 9,
          specialDueKind: 'today',
          specialDueExpiresAt: new Date('2026-09-11T15:00:00.000Z'),
          version: 1
        }]
      ])
    }));

    expect(result.items.find((item) => item.itemId === secondId)?.specialDue).toEqual({
      kind: 'today',
      expiresAt: '2026-09-11T15:00:00.000Z'
    });
    expect(sortGrindingPlanningBoardProjectionItems(result.items, ['S-001'], 'resource', 'alternate').map((item) => item.itemId)).toEqual([
      secondId,
      firstId
    ]);
  });

  it('coerces logical-key values as SQL JSON text and sorts original mode by original fields', () => {
    const first = sourceRow({ ProductNo: 10, FKOJUN: 20 }, 'row-original');
    const second = sourceRow({
      FKOJUN: 30,
      FSIGENSHOYORYO: '50'
    }, 'row-second');
    const result = projectGrindingPlanningBoard(
      baseParams({
        rows: [first, second],
        details: new Map([
          ['row-original', detail()],
          ['row-second', detail({ rowNotes: [{ dueDate: new Date('2026-09-01T00:00:00.000Z') }] })]
        ]),
        overrides: new Map([
          [
            buildGrindingPlanningBoardRowItemId(first.rowData),
            { overrideResourceCd: 'G-02', overrideDueDate: new Date('2026-09-30T00:00:00.000Z'), alternateRank: null, version: 1 }
          ]
        ]),
        allocation: 'original'
      })
    );
    expect(buildGrindingPlanningBoardLogicalKey(first.rowData)).toBe(
      '["S-001","P-001","G-01","20"]'
    );
    expect(result.items.map((item) => item.itemId)).toEqual([
      buildGrindingPlanningBoardRowItemId(second.rowData),
      buildGrindingPlanningBoardRowItemId(first.rowData)
    ]);
  });

  it('ignores legacy records and applies parent resource, due and rank with full quantity/time', () => {
    const splitDetail = detail({
      orderSplits: [
        { id: 'split-1', splitQuantity: 1, dueDate: null, updatedAt: new Date('2026-09-01T00:00:00.000Z') },
        { id: 'split-2', splitQuantity: 2, dueDate: null, updatedAt: new Date('2026-09-01T00:00:00.000Z') }
      ],
      orderSupplements: [{ plannedQuantity: 5, plannedEndDate: null }]
    });
    const parentOverride: GrindingPlanningBoardProjectionOverride = {
      overrideResourceCd: 'G-02',
      overrideDueDate: new Date('2026-09-20T00:00:00.000Z'),
      alternateRank: 1,
      version: 1
    };
    const result = projectGrindingPlanningBoard(
      baseParams({
        details: new Map([['row-1', splitDetail]]),
        overrides: new Map([[buildGrindingPlanningBoardRowItemId(sourceRow().rowData), parentOverride]])
      })
    );
    expect(result.items.map((item) => item.itemId)).toEqual([buildGrindingPlanningBoardRowItemId(sourceRow().rowData)]);
    expect(result.items[0]?.plannedQuantity).toBe(5);
    expect(result.items.map((item) => item.effectiveResourceCd)).toEqual(['G-02']);
    expect(result.items.map((item) => item.originalDueDate)).toEqual(['2026-09-10']);
    expect(result.items.map((item) => item.effectiveDueDate)).toEqual(['2026-09-20']);
    expect(result.items.map((item) => item.alternateRank)).toEqual([1]);
    expect(result.items.map((item) => item.requiredMinutes)).toEqual([100]);
  });

  it('keeps a source-category item visible when its effective resource is supplied by the caller', () => {
    const result = projectGrindingPlanningBoard(
      baseParams({
        overrides: new Map([
          [
            buildGrindingPlanningBoardRowItemId(sourceRow().rowData),
            { overrideResourceCd: 'C-01', overrideDueDate: null, alternateRank: null, version: 1 }
          ]
        ])
      })
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.originalResourceCd).toBe('G-01');
    expect(result.items[0]?.effectiveResourceCd).toBe('C-01');
  });

  it('counts logical process progress before filtering and does not multiply it per split', () => {
    const splitDetail = detail({
      orderSplits: [
        { id: 'split-1', splitQuantity: 1, dueDate: null, updatedAt: new Date('2026-09-01T00:00:00.000Z') },
        { id: 'split-2', splitQuantity: 2, dueDate: null, updatedAt: new Date('2026-09-01T00:00:00.000Z') }
      ]
    });
    const result = projectGrindingPlanningBoard(
      baseParams({
        details: new Map([['row-1', splitDetail]]),
        progressRows: [
          { rowId: 'row-1', fseiban: 'S-001', productNo: '10', fhincd: 'P-001', isCompleted: false },
          { rowId: 'row-2', fseiban: 'S-001', productNo: '10', fhincd: 'P-001', isCompleted: true },
          { rowId: 'row-3', fseiban: 'S-001', productNo: '99', fhincd: 'P-001', isCompleted: false }
        ]
      })
    );
    expect(result.items.map((item) => item.progress)).toEqual([
      { completed: 1, total: 3, quantityKnown: false }
    ]);
    expect(result.progress.bySeiban.get('S-001')).toEqual({ completed: 1, total: 3 });
  });

  it('counts every unfinished item once in both original and effective resource loads', () => {
    const moved = sourceRow({ FSIGENCD: 'G-01', FKOJUN: '10' }, 'row-moved');
    const unknown = sourceRow({ FSIGENCD: 'G-01', FKOJUN: '30', FSIGENSHOYORYO: 'unknown' }, 'row-unknown');
    const result = projectGrindingPlanningBoard(
      baseParams({
        rows: [moved, unknown],
        details: new Map([
          ['row-moved', detail()],
          ['row-unknown', detail()]
        ]),
        overrides: new Map([
          [
            buildGrindingPlanningBoardRowItemId(moved.rowData),
            { overrideResourceCd: 'G-02', overrideDueDate: null, alternateRank: null, version: 1 }
          ]
        ])
      })
    );
    expect(result.load).toEqual([
      {
        resourceCd: 'G-01',
        originalItemCount: 2,
        alternateItemCount: 1,
        originalRequiredMinutes: 100,
        alternateRequiredMinutes: null,
        unfinishedItemCount: 1,
        requiredMinutes: null,
        unknownItemCount: 1,
        originalUnknownItemCount: 1,
        alternateUnknownItemCount: 1
      },
      {
        resourceCd: 'G-02',
        originalItemCount: 0,
        alternateItemCount: 1,
        originalRequiredMinutes: 0,
        alternateRequiredMinutes: 100,
        unfinishedItemCount: 1,
        requiredMinutes: 100,
        unknownItemCount: 0,
        originalUnknownItemCount: 0,
        alternateUnknownItemCount: 0
      }
    ]);
    expect(result.unknownRequiredMinutesCount).toBe(1);
  });
});

describe('D schedule due source in the grinding projection', () => {
  it('uses changed Excel dates by default, newer manual dates, and exact legacy dates in scaw mode', () => {
    const value = detail({ excelDueDate: new Date('2026-11-10Z'), excelChangedAt: new Date('2026-11-04Z'), manualUpdatedAt: new Date('2026-11-03Z') });
    const input = baseParams({ details: new Map([['row-1', value]]) });
    expect(projectGrindingPlanningBoard(input).items[0]?.effectiveDueDate).toBe('2026-11-10');
    expect(projectGrindingPlanningBoard({ ...input, dueSource: 'scaw' }).items[0]?.effectiveDueDate).toBe('2026-09-10');
    value.manualUpdatedAt = new Date('2026-11-05Z');
    expect(projectGrindingPlanningBoard(input).items[0]?.effectiveDueDate).toBe('2026-09-10');
  });

  it('ignores legacy dates and overrides while preserving parent overrides ahead of Excel', () => {
    const updatedAt = new Date('2026-11-04Z');
    const input = baseParams({ details: new Map([['row-1', detail({ excelDueDate: new Date('2026-11-10Z'), excelChangedAt: updatedAt,
      orderSplits: [{ id: 'd-test-split', splitQuantity: 1, dueDate: new Date('2026-11-06Z'), updatedAt }] })]]) });
    expect(projectGrindingPlanningBoard(input).items[0]?.effectiveDueDate).toBe('2026-11-10');
    input.overrides.set('split:d-test-split', { overrideResourceCd: null, overrideDueDate: new Date('2026-11-07Z'), alternateRank: null, version: 1 });
    expect(projectGrindingPlanningBoard(input).items[0]?.effectiveDueDate).toBe('2026-11-10');
    input.overrides.set(buildGrindingPlanningBoardRowItemId(sourceRow().rowData), { overrideResourceCd: null, overrideDueDate: new Date('2026-11-07Z'), alternateRank: null, version: 1 });
    expect(projectGrindingPlanningBoard(input).items[0]?.effectiveDueDate).toBe('2026-11-07');
  });

  it('produces identical responses for both sources when Excel has no stored rows', () => {
    const input = baseParams();
    expect(projectGrindingPlanningBoard({ ...input, dueSource: 'excel' })).toEqual(projectGrindingPlanningBoard({ ...input, dueSource: 'scaw' }));
  });
});
