import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { buildMissingStandardHoursProcesses, missingStandardHoursItemId, readMissingStandardHoursBoardRows,
  replaceMissingStandardHoursProcesses, type MissingStandardHoursBoardRow } from '../missing-standard-hours-process.js';
import { runFkojunstMailReplacementTransaction, runFkojunstMailClearTransaction, dedupeFkojunstMailRowsByLatest, type FkojunstMailNormalizedRow } from '../fkojunst-status-mail-sync.pipeline.js';
import { projectGrindingPlanningBoard } from '../grinding-planning-board-projection.js';
import { addMissingStandardHoursLoad, buildGrindingPlanningBoardLoadSummary } from '../grinding-planning-board-load-summary.js';

const mail = (extra: Partial<FkojunstMailNormalizedRow> = {}): FkojunstMailNormalizedRow => ({
  sourceRowId: 'mail', fsezono: '0004091808', fkojun: '710', fkoteicd: '587', statusCode: 'R',
  sourceUpdatedAt: new Date('2026-11-10'), hasUnparseableDate: false, ...extra
});
const schedule = (extra: Partial<{ ProductNo: string; FKOJUN: string; FSIGENCD: string }> = {}, id = 'donor') => ({ id,
  ProductNo: '0004091808', FKOJUN: '200', FSIGENCD: '587', ...extra,
  rowData: { ProductNo: '0004091808', FKOJUN: '200', FSIGENCD: '587', FSEIBAN: 'S', FHINCD: 'P', FHINMEI: '部品', FSIGENSHOYORYO: '100', ...extra } });
const boardRow = (extra: Partial<MissingStandardHoursBoardRow> = {}): MissingStandardHoursBoardRow => ({
  ...mail(), dueDate: null, excelDueDate: null, excelChangedAt: null, manualUpdatedAt: null, rowData: schedule().rowData, plannedQuantity: 3, plannedEndDate: new Date('2026-11-20'), ...extra
});

describe('missing standard hours selection', () => {
  it.each(['R', 'S'])('accepts visible %s state for 0004091808/710/587', (statusCode) => {
    expect(buildMissingStandardHoursProcesses([mail({ statusCode })], [schedule()])).toEqual([
      expect.objectContaining({ fsezono: '0004091808', fkojun: '710', fkoteicd: '587', statusCode, csvDashboardRowId: 'donor' })
    ]);
  });
  it.each(['C', 'X', 'O', 'P', '', '?'])('excludes latest %s status', (statusCode) => {
    const rows = dedupeFkojunstMailRowsByLatest([mail(), mail({ statusCode, sourceUpdatedAt: new Date('2026-11-11') })]);
    expect(buildMissingStandardHoursProcesses(rows, [schedule()])).toEqual([]);
  });
  it('requires a donor with exactly the same manufacturing order', () => {
    expect(buildMissingStandardHoursProcesses([mail()], [schedule({ ProductNo: 'other' })])).toEqual([]);
  });
  it.each(['587', '999', ''])('excludes a scheduled process on resource %s', (resource) => {
    expect(buildMissingStandardHoursProcesses([mail()], [schedule(), schedule({ FKOJUN: '710', FSIGENCD: resource }, 'present')])).toEqual([]);
  });
  it.each(['S', 'C', 'O', '?'])('excludes old resource even when newer resource status is %s', (statusCode) => {
    const rows = [mail(), mail({ fkoteicd: '999', statusCode, sourceUpdatedAt: new Date('2026-11-11') })];
    expect(buildMissingStandardHoursProcesses(rows, [schedule()])).toEqual([]);
  });
  it('keeps equal timestamps, as only a strictly newer other resource excludes a triple', () => {
    expect(buildMissingStandardHoursProcesses([mail(), mail({ fkoteicd: '999' })], [schedule()])).toHaveLength(1);
  });
  it.each(['731', 'OUTSOURCE'])('excludes resource %s absent from every schedule row', (fkoteicd) => {
    expect(buildMissingStandardHoursProcesses([mail({ fkoteicd })], [schedule()])).toEqual([]);
  });
  it('skips values wider than the evidence columns instead of failing the mail sync', () => {
    const order = '0'.repeat(33);
    expect(buildMissingStandardHoursProcesses([mail({ fkojun: '7'.repeat(21) })], [schedule()])).toEqual([]);
    expect(buildMissingStandardHoursProcesses([mail({ fsezono: order })], [schedule({ ProductNo: order })])).toEqual([]);
  });
  it('allows resource membership supplied by another manufacturing order', () => {
    expect(buildMissingStandardHoursProcesses([mail({ fkoteicd: '588' })], [schedule(), schedule({ ProductNo: 'other', FSIGENCD: '588' }, 'other')])).toHaveLength(1);
  });
  it('chooses numeric minimum process, then smallest row ID regardless of input order', () => {
    const rows = [schedule({ FKOJUN: '100' }, 'a'), schedule({ FKOJUN: '20' }, 'z'), schedule({ FKOJUN: '20' }, 'b')];
    for (const ordered of [rows, [...rows].reverse()]) {
      expect(buildMissingStandardHoursProcesses([mail()], ordered)[0]?.csvDashboardRowId).toBe('b');
    }
  });
  it('replaces and clears evidence inside the supplied transaction', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([schedule()]),
      productionScheduleMissingStandardHoursProcess: { deleteMany: vi.fn(), createMany: vi.fn() } };
    await replaceMissingStandardHoursProcesses(tx as unknown as Prisma.TransactionClient, [mail()]);
    expect(tx.productionScheduleMissingStandardHoursProcess.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ csvDashboardRowId: 'donor' })] });
    await replaceMissingStandardHoursProcesses(tx as unknown as Prisma.TransactionClient, []);
    expect(tx.productionScheduleMissingStandardHoursProcess.deleteMany).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const query = tx.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.sql).toContain(`"rowData"->>'ProductNo'`);
    expect(query.sql).toContain(`"rowData"->>'FKOJUN'`);
    expect(query.sql).toContain(`"rowData"->>'FSIGENCD'`);
    expect(query.sql).not.toContain('"rowData",');
  });
  it('publishes missing evidence in the same locked mail replacement transaction and clears it', async () => {
    const tx = { $executeRaw: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([schedule()]),
      productionScheduleMissingStandardHoursProcess: { deleteMany: vi.fn(), createMany: vi.fn() },
      productionScheduleFkojunstMailStatus: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      productionScheduleSessakuPieceSet: { findFirst: vi.fn().mockResolvedValue(null) } };
    const client = { $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx)) };
    await runFkojunstMailReplacementTransaction(client as never, { scanned: 1, normalized: 1, matched: 0, unmatched: 1,
      skippedInvalidStatus: 0, skippedUnparseableDate: 0, createInputs: [], missingStandardHoursMailRows: [mail()] });
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.productionScheduleMissingStandardHoursProcess.createMany).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.productionScheduleMissingStandardHoursProcess.deleteMany.mock.invocationCallOrder[0]);
    await runFkojunstMailClearTransaction(client as never, 0, 0, 0);
    expect(tx.productionScheduleMissingStandardHoursProcess.deleteMany).toHaveBeenCalledTimes(2);
  });
  it('reads all donor data in one indexed-table query without joining editable state', async () => {
    const client = { $queryRaw: vi.fn().mockResolvedValue([boardRow()]) };
    expect(await readMissingStandardHoursBoardRows(client as unknown as Pick<Prisma.TransactionClient, '$queryRaw'>)).toHaveLength(1);
    expect(client.$queryRaw).toHaveBeenCalledTimes(1);
    const query = client.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.sql).toContain('m."csvDashboardId" = ?');
    expect(query.sql).toContain('"CsvDashboardRow"."id" = m."csvDashboardRowId"');
    expect(query.sql).not.toMatch(/Override|Progress|Piece|OrderAssignment/);
    expect(query.sql).toContain('"ProductionScheduleRowNote"');
    expect(query.sql).toContain('ORDER BY "note"."updatedAt" DESC');
    expect(query.sql).toContain('"ProductionScheduleDScheduleMinutes"');
    expect(query.sql).toContain('AS "manualUpdatedAt"');
  });
});

describe('missing standard hours read projection and load', () => {
  const params = () => ({ rows: [], details: new Map(), ranks: { rows: new Map() }, overrides: new Map(),
    category: 'grinding' as const, seibanOrder: ['S'], missingStandardHoursRows: [boardRow()],
    isResourceInCategory: (cd: string) => cd === '587',
    resourceMinutes: { ownSourceResourceCds: ['587'], values: [{ resourceCd: '587', fhincd: 'P', perUnitMinutes: 999, setupMinutes: 99 }] } });
  it('borrows only display data, keeps synthetic IDs and null duration even with own-time settings', () => {
    const input = params(), id = missingStandardHoursItemId(mail());
    input.overrides.set(id, { overrideResourceCd: '999', overrideDueDate: new Date('2030-01-01'), alternateRank: 1, version: 2 });
    const result = projectGrindingPlanningBoard({ ...input, includePieces: true });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ itemId: id, sourceRowId: id, standardHoursMissing: true,
      fseiban: 'S', fhincd: 'P', fhinmei: '部品', productNo: '0004091808', processOrder: '710',
      originalResourceCd: '587', effectiveResourceCd: '587', plannedQuantity: 3,
      originalDueDate: '2026-11-20', effectiveDueDate: '2026-11-20', originalRank: null, alternateRank: null,
      version: 0, requiredMinutes: null, requiredMinutesKnown: false, originalRequiredMinutes: null,
      ownRequiredMinutes: null, isCompleted: false, completionSource: null });
    expect(result.items[0]?.pieceSetVersion).toBeUndefined();
    expect(result.unknownRequiredMinutesCount).toBe(1);
    expect(result.load[0]?.requiredMinutes).toBeNull();
  });
  it.each([
    { source: 'excel' as const, excel: '2026-11-25', manual: null, updated: null, expected: '2026-11-25' },
    { source: 'excel' as const, excel: null, manual: null, updated: null, expected: '2026-11-20' },
    { source: 'excel' as const, excel: null, manual: '2026-11-24', updated: null, expected: '2026-11-24' },
    { source: 'excel' as const, excel: '2026-11-25', manual: '2026-11-24', updated: '2026-11-12', expected: '2026-11-24' },
    { source: 'excel' as const, excel: '2026-11-25', manual: '2026-11-24', updated: '2026-11-01', expected: '2026-11-25' },
    { source: 'scaw' as const, excel: '2026-11-25', manual: null, updated: null, expected: '2026-11-20' },
  ])('matches the normal order bar due: %j', ({ source, excel, manual, updated, expected }) => {
    const date = (value: string | null) => value ? new Date(value) : null;
    const evidence = boardRow({ excelDueDate: date(excel), dueDate: date(manual),
      manualUpdatedAt: date(updated), excelChangedAt: new Date('2026-11-10') });
    const input = params();
    const result = projectGrindingPlanningBoard({ ...input, dueSource: source,
      rows: [{ id: 'donor', updatedAt: evidence.sourceUpdatedAt, rowData: evidence.rowData }],
      details: new Map([['donor', { rowNotes: [{ dueDate: evidence.dueDate }],
        excelDueDate: evidence.excelDueDate, excelChangedAt: evidence.excelChangedAt, manualUpdatedAt: evidence.manualUpdatedAt,
        orderSupplements: [{ plannedQuantity: evidence.plannedQuantity, plannedEndDate: evidence.plannedEndDate }],
        productionScheduleProgress: null, productionScheduleExternalCompletion: null }]]),
      missingStandardHoursRows: [evidence] });
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.effectiveDueDate)).toEqual([expected, expected]);
    expect(result.items.map((item) => item.originalDueDate)).toEqual([expected, expected]);
  });
  it('applies existing category and selected-seiban filters', () => {
    expect(projectGrindingPlanningBoard({ ...params(), isResourceInCategory: () => false }).items).toEqual([]);
    expect(projectGrindingPlanningBoard({ ...params(), selectedFseibans: new Set(['other']) }).items).toEqual([]);
  });
  it('adds unknown counts but never original/alternate minutes', () => {
    const summary = buildGrindingPlanningBoardLoadSummary([{ itemId: 'row', sourceRowId: 'row', kind: 'row',
      originalResourceCd: '587', effectiveResourceCd: '587', requiredMinutes: 120, requiredMinutesKnown: true, isCompleted: false }]);
    const result = addMissingStandardHoursLoad(summary, [boardRow()], params());
    expect(result.unknownRequiredMinutesCount).toBe(1);
    expect(result.load[0]).toMatchObject({ originalItemCount: 2, alternateItemCount: 2, unknownItemCount: 1,
      originalRequiredMinutes: 120, alternateRequiredMinutes: 120, requiredMinutes: 120 });
    expect(summary.unknownRequiredMinutesCount).toBe(0);
  });
  it('excludes category and schedule-source mismatches from load', () => {
    for (const extra of [{ isResourceInCategory: () => false }, { excludedFseibans: ['S'] }]) {
      expect(addMissingStandardHoursLoad({ load: [], unknownRequiredMinutesCount: 0 }, [boardRow()], { ...params(), ...extra })).toEqual({ load: [], unknownRequiredMinutesCount: 0 });
    }
  });
});
