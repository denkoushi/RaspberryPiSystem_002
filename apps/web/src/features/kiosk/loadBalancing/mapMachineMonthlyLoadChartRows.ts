import type { ProductionScheduleLoadBalancingMachineResourceMonthCell } from '../../../api/client';

export type MachineMonthlyStackedChartRow = {
  month: string;
  [resourceCd: string]: string | number;
};

const MAX_RESOURCE_SERIES = 24;

export function mapMachineMonthlyLoadChartRows(params: {
  months: string[];
  resourceMonths: ProductionScheduleLoadBalancingMachineResourceMonthCell[];
}): { chartRows: MachineMonthlyStackedChartRow[]; resourceCds: string[] } {
  const totalsByResource = new Map<string, number>();
  for (const cell of params.resourceMonths) {
    totalsByResource.set(cell.resourceCd, (totalsByResource.get(cell.resourceCd) ?? 0) + cell.requiredMinutes);
  }

  const resourceCds = [...totalsByResource.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_RESOURCE_SERIES)
    .map(([cd]) => cd);

  const resourceSet = new Set(resourceCds);
  const byMonth = new Map<string, MachineMonthlyStackedChartRow>();
  for (const month of params.months) {
    byMonth.set(month, { month });
  }

  for (const cell of params.resourceMonths) {
    if (!resourceSet.has(cell.resourceCd)) continue;
    const row = byMonth.get(cell.month) ?? { month: cell.month };
    row[cell.resourceCd] = Math.round(cell.requiredMinutes);
    byMonth.set(cell.month, row);
  }

  const chartRows = params.months.map((month) => {
    const base: MachineMonthlyStackedChartRow = { month };
    for (const cd of resourceCds) {
      const row = byMonth.get(month);
      base[cd] = typeof row?.[cd] === 'number' ? row[cd] : 0;
    }
    return base;
  });

  return { chartRows, resourceCds };
}
