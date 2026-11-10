import { GRINDING_PLANNING_BOARD_RESOURCE_DAILY_HOURS } from '@raspi-system/shared-types';
import clsx from 'clsx';

import { usePlanningBoardOffline } from '../offline/PlanningBoardOfflineProvider';

import type { GrindingPlanningBoardItem, GrindingPlanningBoardResourceMinutesResponse, GrindingPlanningBoardResourceDailyHours } from '@raspi-system/shared-types';

export function PlanningBoardSingleResourceHead({ resourceCd, names, hours, pausesForBreaks, averageSeconds, disabled, pickerOpen, onOpenPicker, onCapacityChange, onBreaksChange, items = [], minutes, onSourceChange, sheetOpen = false, onToggleSheet, minutesPending = false }: {
  items?: GrindingPlanningBoardItem[];
  minutes?: GrindingPlanningBoardResourceMinutesResponse;
  onSourceChange?: (source: 'original' | 'own') => void;
  sheetOpen?: boolean;
  onToggleSheet?: () => void;
  minutesPending?: boolean;
  resourceCd: string;
  names: string[] | undefined;
  hours: GrindingPlanningBoardResourceDailyHours;
  pausesForBreaks: boolean;
  averageSeconds: number | undefined;
  disabled: boolean;
  pickerOpen: boolean;
  onOpenPicker?: (anchor: HTMLElement) => void;
  onCapacityChange: (resource: string, hours: GrindingPlanningBoardResourceDailyHours) => void;
  onBreaksChange?: (resource: string, runsThroughBreaks: boolean) => void;
}) {
  const { frozen } = usePlanningBoardOffline();
  const buttonClass = (pressed: boolean) => clsx('h-8 w-[52px] shrink-0 rounded-md border text-[15px] font-bold disabled:opacity-40 aria-disabled:opacity-40',
    pressed ? 'border-sky-300 bg-sky-400 text-slate-950' : 'border-slate-600 bg-slate-900 text-slate-200');
  return <div data-testid="planning-single-resource-head" className="flex h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-700 bg-slate-950 px-2 [scrollbar-width:none]">
    <button type="button" aria-label="1台の資源CDを選ぶ" aria-expanded={pickerOpen} onClick={(event) => onOpenPicker?.(event.currentTarget)}
      className="flex h-8 shrink-0 items-baseline gap-2 whitespace-nowrap rounded-md border border-slate-600 px-2">
      <b className="font-mono text-[17px]">{resourceCd}</b><span className="text-sm font-bold text-slate-300">{names?.join(' / ')}</span><span className="text-[11px] text-slate-400">▼</span>
    </button>
    <div className="flex gap-1" role="group" aria-label={`${resourceCd}の1日の稼働時間`}>
      {GRINDING_PLANNING_BOARD_RESOURCE_DAILY_HOURS.map((value) => <button key={value} type="button" className={buttonClass(hours === value)}
        aria-disabled={frozen || undefined} aria-pressed={hours === value} disabled={disabled} onClick={() => onCapacityChange(resourceCd, value)}>{value}H</button>)}
      <button type="button" className={clsx(buttonClass(pausesForBreaks), 'w-[60px]')} aria-disabled={frozen || undefined} aria-pressed={pausesForBreaks} disabled={disabled || hours === 24}
        onClick={() => onBreaksChange?.(resourceCd, pausesForBreaks)}>休憩</button>
    </div>
    {averageSeconds !== undefined && <div className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap" title="稼働した日の1日あたり稼働時間の中央値">
      <span className="text-[13px] font-bold text-slate-300">月平均</span><span className="font-mono text-base font-bold text-emerald-300">{(averageSeconds / 3600).toFixed(1)}h</span>
    </div>}
    <div className="flex-1" />
    <div className="flex shrink-0 rounded-md border border-slate-600" role="group" aria-label="所要時間の値">
      {(['original', 'own'] as const).map((source) => <button key={source} type="button" disabled={disabled || minutesPending} aria-disabled={frozen || undefined} aria-pressed={(minutes?.ownSourceResourceCds.includes(resourceCd) ?? false) === (source === 'own')}
        className={clsx('h-8 whitespace-nowrap px-3 text-sm font-bold disabled:opacity-40', (minutes?.ownSourceResourceCds.includes(resourceCd) ?? false) === (source === 'own') ? 'bg-amber-400 text-slate-950' : 'text-slate-300')}
        onClick={() => onSourceChange?.(source)}>{source === 'original' ? '元の値' : '独自の値'} <span className="font-mono">{(items.reduce((sum, item) => sum + ((source === 'own' ? item.ownRequiredMinutes ?? item.originalRequiredMinutes : item.originalRequiredMinutes) ?? 0), 0) / 60).toFixed(1)}h</span></button>)}
    </div>
    <button type="button" aria-expanded={sheetOpen} onClick={onToggleSheet} className="h-8 shrink-0 whitespace-nowrap rounded-md border border-amber-500 px-3 text-sm font-bold text-amber-300">品番の値 {minutes?.values.filter((value) => value.resourceCd === resourceCd).length ?? 0} {sheetOpen ? '▼' : '▲'}</button>
  </div>;
}
