import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import type { BoardConnectivityPhase } from './planningBoardConnectivity';

const subscribeZoom = (listener: () => void) => {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
};
const readZoom = () => Number(document.documentElement.style.zoom) || 1;

export const PLANNING_BOARD_BANNER_SLOT = 'planning-board-connectivity-slot';
export function PlanningBoardConnectivityBanner({ phase, displayedAt, recoveredUntil }: {
  phase: BoardConnectivityPhase; displayedAt: number | null; recoveredUntil: number | null;
}) {
  const zoom = useSyncExternalStore(subscribeZoom, readZoom);
  const slot = document.getElementById(PLANNING_BOARD_BANNER_SLOT);
  const offline = phase === 'offline' || phase === 'refreshing';
  if (!slot || (!offline && recoveredUntil === null)) return null;
  const time = displayedAt === null ? '--:--' : new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(displayedAt);
  return createPortal(<div role="status" aria-atomic="true" className="relative z-[100] flex h-[52px] shrink-0 items-center gap-6 px-6 text-[26px] font-bold"
    style={{ zoom: 1 / zoom, background: offline ? '#fbbf24' : '#34d399', color: offline ? '#1c1300' : '#03251a' }}>
    <span className="text-[28px] tracking-wider">{offline ? '圏外' : '復帰'}</span>
    <span>{offline ? '操作できません' : '最新に更新しました'}</span>
    {offline && <span className="ml-auto">{time} の表示</span>}
  </div>, slot);
}
