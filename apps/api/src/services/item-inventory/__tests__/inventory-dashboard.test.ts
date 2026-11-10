import { describe, expect, it, vi } from 'vitest';

import { aggregateInventoryDashboard, dashboardPeriod, inventoryMachine, type DashboardIssueRow, type DashboardItemRow } from '../inventory-dashboard.js';
import { ItemInventoryService } from '../item-inventory.service.js';

const now = new Date('2026-10-14T23:00:00Z');
const place = (area: string) => ({ drawer: { shelf: { area } } });
const item = (id: string, price: number | null, stock = 2): DashboardItemRow => ({ id, name: id, toolName: 'ドリル', maker: 'OSG', unit: '本', unitPrice: price,
  compartments: [{ labelNumber: 12, stockQuantity: stock, ...place('A 北') }, { labelNumber: 13, stockQuantity: 1, ...place('B 南') }] });
const issue = (id: string, date: string, quantity: number, area = 'A 北', cancelled = false): DashboardIssueRow => ({ machineId: null, machine: null, inventoryItemId: id, createdAt: new Date(date), delta: -quantity, compartment: place(area), reversedBy: cancelled ? { id: 'cancel' } : null });

describe('inventory dashboard', () => {
  it('uses Monday midnight in Tokyo across year and UTC day boundaries', () => {
    expect(dashboardPeriod(4, new Date('2026-01-04T14:59:59Z')).start.toISOString()).toBe('2025-12-07T15:00:00.000Z');
    expect(dashboardPeriod(4, new Date('2026-01-04T15:00:00Z')).start.toISOString()).toBe('2025-12-14T15:00:00.000Z');
    expect(inventoryMachine('Ａ　北')).toBe('A');
    expect(inventoryMachine('A')).toBe('A');
  });
  it('fills weeks/months, excludes reversed issues, compares periods and uses current prices', () => {
    const result = aggregateInventoryDashboard([item('priced', 100), item('free', 0), item('unpriced', null)], [
      issue('priced', '2026-09-20T15:00:00Z', 3), // first Monday
      issue('priced', '2026-09-20T14:59:59Z', 4), // previous period
      issue('priced', '2026-10-12T00:00:00Z', 8, 'A 北', true),
      issue('free', '2026-10-12T00:00:00Z', 2), issue('unpriced', '2026-10-13T00:00:00Z', 5),
      issue('deleted', '2026-10-13T00:00:00Z', 100), issue('priced', '2026-08-01T00:00:00Z', 100),
      issue('priced', '2026-11-01T00:00:00Z', 100),
    ], 4, now);
    expect(result.weeks.map(w => w.weekStart)).toEqual(['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12']);
    expect(result.weeks.map(w => w.issued)).toEqual([3, 0, 0, 7]);
    expect(result.totalIssued).toBe(10);
    expect(result.previousTotalIssued).toBe(4);
    expect(result.cost).toEqual({ total: 300, previousTotal: 400, byMonth: [{ month: '2026-09', amount: 300 }, { month: '2026-10', amount: 0 }] });
    expect(result.pricedItemCount).toBe(2);
    expect(result.items[0].weekly).toEqual([3, 0, 0, 0]);
    expect(result.lowStockCount).toBe(0);
  });
  it('filters compartment stock, labels and transactions by exact machine', () => {
    const result = aggregateInventoryDashboard([item('a', 2)], [issue('a', '2026-10-12T00:00:00Z', 3), issue('a', '2026-10-12T00:00:00Z', 20, 'B 南')], 4, now, 'A');
    expect(result.totalIssued).toBe(3);
    expect(result.items[0]).toMatchObject({ stock: 2, labelNumbers: [12] });
    expect(result.lowStockCount).toBe(1);
    expect(result.machines).toEqual(['A', 'B']);
    expect(aggregateInventoryDashboard([item('a', 2)], [], 4, now, 'unknown').items).toEqual([]);
  });
  it('groups current usage by machine, keeps null last, and respects reversals and shelves', () => {
    const assigned = (id: string, quantity: number, machineId: string, shortName: string | null = null) => ({
      ...issue(id, '2026-10-12T00:00:00Z', quantity), machineId, machine: { name: `Machine ${machineId}`, shortName },
    });
    const issues = [assigned('a', 3, 'm1', 'MC1'), assigned('b', 2, 'm1', 'MC1'), assigned('a', 8, 'm2'),
      issue('a', '2026-09-21T00:00:00Z', 20), // null sorts last despite the largest quantity
      { ...assigned('a', 100, 'm3'), reversedBy: { id: 'cancel' } },
      { ...assigned('a', 100, 'm4'), compartment: place('B 南') },
      { ...assigned('a', 100, 'm5'), createdAt: new Date('2026-09-14T00:00:00Z') }];
    const result = aggregateInventoryDashboard([item('a', 2), item('b', 3)], issues, 4, now, 'A');
    expect(result.machineUsage).toEqual([
      { machineId: 'm2', name: 'Machine m2', issued: 8, weekly: [0, 0, 0, 8], itemIssued: { a: 8 } },
      { machineId: 'm1', name: 'MC1', issued: 5, weekly: [0, 0, 0, 5], itemIssued: { a: 3, b: 2 } },
      { machineId: null, name: '加工機なし', issued: 20, weekly: [20, 0, 0, 0], itemIssued: { a: 20 } },
    ]);
    expect(result.machineUsage.reduce((sum, row) => sum + row.issued, 0)).toBe(result.totalIssued);
    expect(aggregateInventoryDashboard([item('a', 2)], [assigned('a', 3, 'm1')], 4, now).machineUsage).toHaveLength(1);
    expect(aggregateInventoryDashboard([item('a', 2)], [], 4, now).machineUsage).toEqual([]);
  });
  it('returns zero-filled empty periods and all items without a location when unfiltered', () => {
    const row = { ...item('no-location', null), compartments: [] };
    const result = aggregateInventoryDashboard([row], [], 52, now);
    expect(result.weeks).toHaveLength(52);
    expect(result.totalIssued).toBe(0);
    expect(result.itemCount).toBe(1);
    expect(result.lowStockCount).toBe(1);
  });
  it('bounds the database query by dates and ISSUE action, selecting reversal identity only', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new ItemInventoryService({ inventoryItem: { findMany }, inventoryTransaction: { findMany } } as never);
    await service.dashboard(12, undefined, now);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { action: 'ISSUE', createdAt: { gte: dashboardPeriod(12, now).previousStart, lte: now }, inventoryItem: { deletedAt: null } }, select: expect.objectContaining({ delta: true, machineId: true, machine: { select: { name: true, shortName: true } }, reversedBy: { select: { id: true } } }) }));
  });
  it('persists all unique sorted dismissal pairs and preserves raw merge sources', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 3 });
    const service = new ItemInventoryService({ inventoryToolValueDistinct: { createMany } } as never);
    await service.dismissToolValueVariants('maker', ['B', 'A', 'C', 'A']);
    expect(createMany).toHaveBeenCalledWith({ data: [ { field: 'maker', valueA: 'A', valueB: 'B' }, { field: 'maker', valueA: 'B', valueB: 'C' }, { field: 'maker', valueA: 'A', valueB: 'C' } ], skipDuplicates: true });
    const rename = vi.spyOn(service, 'renameToolFieldValue').mockResolvedValue({ field: 'maker', value: 'OSG', updatedItems: 1 });
    await service.mergeToolValueVariants('maker', 'OSG', ['ＯＳＧ ', 'osg', 'osg']);
    expect(rename).toHaveBeenCalledTimes(2);
    expect(rename).toHaveBeenCalledWith('maker', 'ＯＳＧ ', 'OSG', 'default');
  });
  it.each([null, 0, 10000000])('saves valid price %s and rejects out of range prices', async unitPrice => {
    const update = vi.fn().mockResolvedValue({});
    const service = new ItemInventoryService({ inventoryItem: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null }), update } } as never);
    await service.updateItemDetails('id', { unitPrice });
    expect(update).toHaveBeenCalledWith({ where: { id: 'id' }, data: { unitPrice } });
    for (const bad of [-1, 0.5, 10000001]) await expect(service.updateItemDetails('id', { unitPrice: bad })).rejects.toMatchObject({ statusCode: 400 });
  });
});
