/**
 * Fill colors for treemap cells from (持出中, 台数). Matches design-preview semantics.
 */

export interface TreemapCellStyle {
  fill: string;
  textFill: string;
}

export function treemapCellStyle(o: number, t: number): TreemapCellStyle {
  const avail = t - o;
  if (avail <= 0) return { fill: '#991b1b', textFill: '#fecaca' };
  if (t > 0 && avail / t <= 0.25) return { fill: '#ca8a04', textFill: '#fef9c3' };
  const r = o / Math.max(1, t);
  if (r >= 0.55) return { fill: '#166534', textFill: '#bbf7d0' };
  return { fill: '#14532d', textFill: '#86efac' };
}
