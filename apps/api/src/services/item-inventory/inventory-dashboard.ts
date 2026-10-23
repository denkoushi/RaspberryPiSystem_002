import type { InventoryDashboard } from '@raspi-system/shared-types';

import { normalizeInventoryArea } from './inventory-area.js';

export const LOW_STOCK_THRESHOLD = 2;
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const TOKYO_OFFSET = 9 * 60 * 60 * 1000;
const localDate = (date: Date) => new Date(date.getTime() + TOKYO_OFFSET).toISOString().slice(0, 10);
export function inventoryMachine(area: string): string {
  const normalized = normalizeInventoryArea(area);
  return /^(.*\S)\s+[東西南北]$/.exec(normalized)?.[1] ?? normalized;
}
export function dashboardPeriod(weeks: number, now: Date) {
  const local = new Date(now.getTime() + TOKYO_OFFSET);
  const monday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - (local.getUTCDay() + 6) % 7) - TOKYO_OFFSET;
  const start = new Date(monday - (weeks - 1) * WEEK);
  return { start, previousStart: new Date(start.getTime() - weeks * WEEK), end: now };
}
export type DashboardItemRow = {
  id: string; name: string; toolName: string | null; maker: string | null; unit: string | null; unitPrice: number | null;
  compartments: Array<{ labelNumber: number; stockQuantity: number; drawer: { shelf: { area: string } } }>;
};
export type DashboardIssueRow = {
  inventoryItemId: string; delta: number; createdAt: Date;
  compartment: { drawer: { shelf: { area: string } } } | null;
  reversedBy: { id: string } | null;
};

/** Rows are ISSUE only. Reversals remove usage at its original date, even across periods. */
export function aggregateInventoryDashboard(
  rows: DashboardItemRow[], issues: DashboardIssueRow[], weeks: number, now: Date, machine?: string,
): InventoryDashboard {
  const period = dashboardPeriod(weeks, now);
  const inScope = (area: string) => !machine || inventoryMachine(area) === machine;
  const machines = [...new Set(rows.flatMap(item => item.compartments.map(c => inventoryMachine(c.drawer.shelf.area))))].sort();
  const scopedIssues = issues.filter(row => !row.reversedBy && row.createdAt >= period.previousStart && row.createdAt <= now
    && (!machine || (row.compartment && inScope(row.compartment.drawer.shelf.area))));
  const activeIds = new Set(scopedIssues.map(row => row.inventoryItemId));
  const items = rows.filter(item => !machine || item.compartments.some(c => inScope(c.drawer.shelf.area)) || activeIds.has(item.id)).map(item => {
    const compartments = item.compartments.filter(c => inScope(c.drawer.shelf.area));
    return { id: item.id, name: item.name, toolName: item.toolName, maker: item.maker, unit: item.unit, unitPrice: item.unitPrice,
      labelNumbers: compartments.map(c => c.labelNumber).sort((a, b) => a - b),
      stock: compartments.reduce((sum, c) => sum + c.stockQuantity, 0), issued: 0, weekly: Array<number>(weeks).fill(0) };
  });
  const result: InventoryDashboard = {
    weeks: Array.from({ length: weeks }, (_, i) => ({ weekStart: localDate(new Date(period.start.getTime() + i * WEEK)), issued: 0 })),
    totalIssued: 0, previousTotalIssued: 0, items, machines,
    lowStockCount: items.filter(item => item.stock <= LOW_STOCK_THRESHOLD).length,
    pricedItemCount: items.filter(item => item.unitPrice !== null).length, itemCount: items.length,
    cost: { total: 0, previousTotal: 0, byMonth: [] },
  };
  const months = new Map<string, number>();
  const firstMonth = localDate(period.start).slice(0, 7);
  const lastMonth = localDate(now).slice(0, 7);
  for (let month = firstMonth; month <= lastMonth;) {
    months.set(month, 0);
    const [year, number] = month.split('-').map(Number);
    month = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
  }
  const byId = new Map(items.map(item => [item.id, item]));
  for (const issue of scopedIssues) {
    const item = byId.get(issue.inventoryItemId);
    if (!item) continue;
    const quantity = -issue.delta;
    // Cost deliberately uses the item's current price, not a historical purchase price.
    const amount = quantity * (item.unitPrice ?? 0);
    if (issue.createdAt < period.start) {
      result.previousTotalIssued += quantity;
      result.cost.previousTotal += amount;
      continue;
    }
    const index = Math.floor((issue.createdAt.getTime() - period.start.getTime()) / WEEK);
    item.weekly[index] += quantity;
    item.issued += quantity;
    result.weeks[index].issued += quantity;
    result.totalIssued += quantity;
    result.cost.total += amount;
    const month = localDate(issue.createdAt).slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + amount);
  }
  result.cost.byMonth = [...months].map(([month, amount]) => ({ month, amount }));
  return result;
}
