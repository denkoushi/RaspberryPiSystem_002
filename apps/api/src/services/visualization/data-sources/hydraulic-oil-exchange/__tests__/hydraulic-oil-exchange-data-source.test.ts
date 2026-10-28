import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HydraulicOilExchangeDataSource } from '../hydraulic-oil-exchange-data-source.js';

const { queryRaw, findMany } = vi.hoisted(() => ({ queryRaw: vi.fn(), findMany: vi.fn() }));
vi.mock('../../../../../lib/prisma.js', () => ({ prisma: { $queryRaw: queryRaw, machine: { findMany } } }));
const csvDashboardId = '11111111-1111-1111-1111-111111111111';
const record = (number: string, date: string, cycle: string | null = '6M') => ({
  equipmentManagementNumber: number, occurredAt: new Date(`${date}T00:00:00+09:00`), cycle,
  machineName: 'ａｂｃ', masterName: null, classification: null, maker: 'MAKER',
});

describe('HydraulicOilExchangeDataSource', () => {
  let now: Date;
  let source: HydraulicOilExchangeDataSource;
  beforeEach(() => {
    vi.resetAllMocks();
    findMany.mockResolvedValue([]);
    now = new Date('2026-10-28T00:00:00+09:00');
    source = new HydraulicOilExchangeDataSource(() => now);
  });
  it('maps master names and fallback names, sorts by urgency then equipment, and counts all states', async () => {
    queryRaw.mockResolvedValue([
      record('M9', '2026-01-01', ''), record('M8', '2026-10-01'), record('M2', '2026-04-01'),
      { ...record('M1', '2026-04-01'), masterName: 'ｍｃ-１', classification: 'MC' },
      record('M3', '2026-04-28'), record('M4', '2026-05-27'),
    ]);
    const result = await source.fetchData({ csvDashboardId, inspectionItem: ' 作動油の交換 ' });
    expect(result.rows.map((row) => row.equipmentManagementNumber)).toEqual(['M1', 'M2', 'M3', 'M4', 'M8', 'M9']);
    expect(result.rows[0]).toMatchObject({ machineName: 'MC-1', subText: 'MC', lastDate: '2026-04-01', nextDate: '2026-10-01', remainingDays: -27, state: 'overdue' });
    expect(result.rows[1]).toMatchObject({ machineName: 'ABC', subText: 'MAKER' });
    expect(result.metadata).toEqual({ today: '2026-10-28', counts: { overdue: 2, soon: 2, ok: 1, unknown: 1, none: 0 } });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = queryRaw.mock.calls[0];
    const sql = strings.join('?');
    expect(sql).toContain('DISTINCT ON');
    expect(sql).toContain('"occurredAt" DESC');
    expect(sql).toContain('"csvDashboardId" = ?');
    expect(sql).toContain('"occurredAt" >= now() - interval \'25 months\'');
    expect(sql).toContain('LEFT JOIN "Machine"');
    expect(values).toEqual([csvDashboardId, '作動油の交換']);
  });
  it('unions selected machines with records once and retains missing master numbers as none', async () => {
    queryRaw.mockResolvedValue([record('M1', '2026-04-01'), record('M2', '2026-04-01')]);
    findMany.mockResolvedValue([
      { equipmentManagementNumber: 'M2', name: 'ＭＣ２', classification: null, maker: null },
      { equipmentManagementNumber: 'M3', name: 'ＭＣ３', classification: 'MC', maker: null },
    ]);
    const result = await source.fetchData({ csvDashboardId, targetEquipmentNumbers: ['M3', 'M2', 'M4', ' M3 '] });
    expect(result.rows.map((row) => row.equipmentManagementNumber)).toEqual(['M1', 'M2', 'M3', 'M4']);
    expect(result.rows[2]).toMatchObject({ machineName: 'MC3', subText: 'MC', state: 'none', lastDate: null, nextDate: null, remainingDays: null });
    expect(result.rows[3]).toMatchObject({ machineName: 'M4', state: 'none' });
    expect(result.metadata?.counts).toMatchObject({ overdue: 2, none: 2 });
    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: { equipmentManagementNumber: { in: ['M2', 'M3', 'M4'] } },
      select: { equipmentManagementNumber: true, name: true, classification: true, maker: true },
    });
  });
  it('does not add running machines when no targets or records exist', async () => {
    queryRaw.mockResolvedValue([]);
    expect((await source.fetchData({ csvDashboardId })).rows).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
  it('excludes ROBODRILL from selected machines and records including alternate spellings', async () => {
    queryRaw.mockResolvedValue([
      { ...record('R1', '2026-04-01'), masterName: 'ＲＯＢＯＤＲＩＬＬ' },
      { ...record('R2', '2026-04-01'), machineName: 'ﾛﾎﾞﾄﾞﾘﾙ' },
      { ...record('R3', '2026-04-01'), machineName: 'ROBODRILL' },
      record('R4', '2026-04-01'),
      record('M1', '2026-04-01'),
    ]);
    findMany.mockResolvedValue([
      { equipmentManagementNumber: 'R3', name: 'other' },
      { equipmentManagementNumber: 'R4', name: 'robo drill' },
      { equipmentManagementNumber: 'R5', name: 'ロボドリル' },
      { equipmentManagementNumber: 'R6', name: 'ＲＯＢＯＤＲＩＬＬ' },
      { equipmentManagementNumber: 'R7', name: 'ﾛﾎﾞﾄﾞﾘﾙ' },
    ]);
    const result = await source.fetchData({ csvDashboardId, targetEquipmentNumbers: ['R3', 'R4', 'R5', 'R6', 'R7', 'M2'] });
    expect(result.rows.map((row) => row.equipmentManagementNumber)).toEqual(['M1', 'M2']);
  });
  it('keys the cache by sorted targets and ignores target order and duplicates', async () => {
    queryRaw.mockResolvedValue([]);
    await source.fetchData({ csvDashboardId, targetEquipmentNumbers: ['M2', 'M1'] });
    await source.fetchData({ csvDashboardId, targetEquipmentNumbers: ['M1', 'M2', 'M1'] });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect((await source.fetchData({ csvDashboardId, targetEquipmentNumbers: ['M3'] })).rows[0].equipmentManagementNumber).toBe('M3');
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect((await source.fetchData({ csvDashboardId })).rows).toEqual([]);
    expect(queryRaw).toHaveBeenCalledTimes(3);
  });
  it('caches independently of maxRows, expires at ten minutes, and can reset', async () => {
    queryRaw.mockResolvedValue([record('M1', '2026-04-01'), record('M2', '2026-10-01')]);
    expect((await source.fetchData({ csvDashboardId, maxRows: 1 })).rows).toHaveLength(1);
    expect((await source.fetchData({ csvDashboardId })).rows).toHaveLength(2);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    now = new Date(now.getTime() + 600_000);
    await source.fetchData({ csvDashboardId });
    expect(queryRaw).toHaveBeenCalledTimes(2);
    source.resetCache();
    await source.fetchData({ csvDashboardId });
    expect(queryRaw).toHaveBeenCalledTimes(3);
  });
  it('isolates dashboard/item keys and bounds the cache to twenty entries', async () => {
    queryRaw.mockResolvedValue([]);
    for (let index = 0; index < 21; index++) await source.fetchData({ csvDashboardId, inspectionItem: `item${index}` });
    await source.fetchData({ csvDashboardId, inspectionItem: 'item0' });
    await source.fetchData({ csvDashboardId: '22222222-2222-2222-2222-222222222222', inspectionItem: 'item0' });
    expect(queryRaw).toHaveBeenCalledTimes(23);
  });
  it('refreshes at midnight JST even within the TTL', async () => {
    queryRaw.mockResolvedValue([record('M1', '2026-04-28')]);
    now = new Date('2026-10-28T14:59:59Z');
    expect((await source.fetchData({ csvDashboardId })).rows[0].remainingDays).toBe(0);
    now = new Date('2026-10-28T15:00:00Z');
    expect((await source.fetchData({ csvDashboardId })).rows[0].remainingDays).toBe(-1);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
  it('caps rows at 200 while preserving full state counts', async () => {
    queryRaw.mockResolvedValue(Array.from({ length: 205 }, (_, index) => record(`M${index}`, '2026-04-01')));
    expect((await source.fetchData({ csvDashboardId })).rows).toHaveLength(200);
    const result = await source.fetchData({ csvDashboardId, maxRows: 999 });
    expect(result.rows).toHaveLength(200);
    expect(result.metadata?.counts).toMatchObject({ overdue: 205 });
  });
  it('returns errors as metadata and does not cache failed queries', async () => {
    expect((await source.fetchData({})).metadata?.error).toBe('csvDashboardId is required');
    expect(queryRaw).not.toHaveBeenCalled();
    queryRaw.mockRejectedValueOnce(new Error('query failed')).mockResolvedValueOnce([]);
    expect((await source.fetchData({ csvDashboardId })).metadata?.error).toBe('query failed');
    expect((await source.fetchData({ csvDashboardId })).metadata?.error).toBeUndefined();
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});
