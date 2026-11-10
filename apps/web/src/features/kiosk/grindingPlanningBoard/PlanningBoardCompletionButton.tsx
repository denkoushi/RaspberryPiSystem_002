import clsx from 'clsx';

import { usePlanningBoardOffline } from './offline/PlanningBoardOfflineProvider';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import type { CSSProperties } from 'react';

type Props = {
  item: GrindingPlanningBoardItem;
  onToggle: (item: GrindingPlanningBoardItem, intent: 'complete' | 'incomplete') => void;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
};

export function PlanningBoardCompletionButton({ item, onToggle, disabled, className, style }: Props) {
  const { frozen } = usePlanningBoardOffline();
  const imported = item.completionSource === 'import';
  return <button type="button" data-planning-board-piece-write="completion"
    className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 hover:bg-white/5 disabled:opacity-60 aria-disabled:opacity-55',
      imported ? 'border-sky-400 bg-cyan-700/35 text-sky-50 text-[9px] font-bold'
        : item.isCompleted ? 'border-slate-400 bg-slate-800 text-white/80 text-[11px]'
          : 'border-emerald-400 bg-emerald-600/20 text-emerald-100 text-[11px]', className)}
    style={style}
    aria-label={imported ? '取込で完了' : item.isCompleted ? '未完了に戻す' : '完了にする'}
    aria-disabled={frozen || undefined}
    disabled={disabled || imported}
    onClick={(event) => { event.stopPropagation(); onToggle(item, item.isCompleted ? 'incomplete' : 'complete'); }}>
    {imported ? '取込' : '✓'}
  </button>;
}
