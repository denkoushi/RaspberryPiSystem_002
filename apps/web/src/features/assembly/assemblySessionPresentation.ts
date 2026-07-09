import { normalizeAssemblyUpperIdentifier } from './assemblyUiHelpers';

import type { AssemblyWorkSessionSummaryDto } from './types';

export function progressText(session: Pick<AssemblyWorkSessionSummaryDto, 'acceptedBoltCount' | 'totalBoltCount'>): string {
  if (session.totalBoltCount <= 0) return '0/0';
  return `${session.acceptedBoltCount}/${session.totalBoltCount}`;
}

export function progressPercent(session: Pick<AssemblyWorkSessionSummaryDto, 'acceptedBoltCount' | 'totalBoltCount'>): number {
  if (session.totalBoltCount <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((session.acceptedBoltCount / session.totalBoltCount) * 100)));
}

export function areaStatusText(
  session: Pick<AssemblyWorkSessionSummaryDto, 'currentAreaName' | 'currentBoltMarkerNo'>
): string {
  const areaName = session.currentAreaName ?? 'エリア完了';
  const position = session.currentBoltMarkerNo
    ? `締付位置 #${session.currentBoltMarkerNo}`
    : '次工程待ち';
  return `${areaName} ・ ${position}`;
}

export function areaStatusShortText(
  session: Pick<AssemblyWorkSessionSummaryDto, 'currentAreaName' | 'currentBoltMarkerNo'>
): string {
  const areaName = session.currentAreaName ?? 'エリア完了';
  if (session.currentBoltMarkerNo != null) {
    return `${areaName} ・ #${session.currentBoltMarkerNo}`;
  }
  return `${areaName} ・ 次工程`;
}

export function formatLotQty(productNo: string, lotQtyByProductNo: Record<string, number>): string {
  const lotQty = lotQtyByProductNo[normalizeAssemblyUpperIdentifier(productNo)];
  if (lotQty == null || !Number.isFinite(lotQty)) return '-';
  return Number.isInteger(lotQty) ? String(lotQty) : lotQty.toLocaleString('ja-JP');
}
