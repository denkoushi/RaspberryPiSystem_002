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
