import type { ProductionScheduleLoadBalancingStartDateLevelingCell } from '../../../api/client';

const TOP_RESOURCE_LIMIT = 24;

export function mapStartDateLevelingChartRows(params: {
  bucketKeys: string[];
  cells: ProductionScheduleLoadBalancingStartDateLevelingCell[];
  bucket: 'month' | 'day';
}): { chartRows: Array<Record<string, string | number>>; resourceCds: string[] } {
  const totalsByResource = new Map<string, number>();
  for (const cell of params.cells) {
    totalsByResource.set(cell.resourceCd, (totalsByResource.get(cell.resourceCd) ?? 0) + cell.requiredMinutes);
  }
  const resourceCds = [...totalsByResource.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_RESOURCE_LIMIT)
    .map(([resourceCd]) => resourceCd);

  const chartRows = params.bucketKeys.map((bucketKey) => {
    const row: Record<string, string | number> = { bucket: bucketKey };
    for (const resourceCd of resourceCds) {
      const cell = params.cells.find((item) => item.bucketKey === bucketKey && item.resourceCd === resourceCd);
      row[resourceCd] = cell ? Math.round(cell.requiredMinutes) : 0;
      if (params.bucket === 'day') {
        row[`${resourceCd}_cap`] = cell?.availableMinutes == null ? 0 : Math.round(cell.availableMinutes);
      }
    }
    return row;
  });

  return { chartRows, resourceCds };
}

export function mapStartDateLevelingDayCompareRows(params: {
  days: string[];
  cells: ProductionScheduleLoadBalancingStartDateLevelingCell[];
  resourceCd: string;
}): Array<{ day: string; req: number; cap: number }> {
  return params.days.map((day) => {
    const cell = params.cells.find((item) => item.bucketKey === day && item.resourceCd === params.resourceCd);
    return {
      day,
      req: Math.round(cell?.requiredMinutes ?? 0),
      cap: cell?.availableMinutes == null ? 0 : Math.round(cell.availableMinutes)
    };
  });
}
