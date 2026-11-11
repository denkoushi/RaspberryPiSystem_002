import { PlanningBoardCompletionButton } from './PlanningBoardCompletionButton';

import type { GrindingPlanningBoardTestBar } from '@raspi-system/shared-types';
import type { Ref } from 'react';

export function PlanningBoardTestBarStrip({ item, bottom, onComplete, onRemove, onClose, disabled, ref }: {
  item: GrindingPlanningBoardTestBar; bottom: number; disabled?: boolean; ref?: Ref<HTMLDivElement>;
  onComplete: (item: GrindingPlanningBoardTestBar, intent: 'complete' | 'incomplete') => void;
  onRemove: (item: GrindingPlanningBoardTestBar) => void; onClose: () => void;
}) {
  return <div ref={ref} role="region" aria-label="テスト加工" style={{ bottom }} className="absolute inset-x-0 z-50 flex items-center gap-3 overflow-x-auto border-t border-slate-700 bg-slate-950 p-2 text-slate-100">
    <div className="shrink-0"><strong className="text-base">{item.name}</strong><div className="text-sm">{item.resourceCd} · {item.minutes}分</div></div>
    <PlanningBoardCompletionButton item={item} disabled={disabled} onToggle={onComplete} />
    <button type="button" onClick={() => onRemove(item)} disabled={disabled} className="min-h-11 rounded border border-slate-600 px-3 text-sm">消す</button>
    <button type="button" onClick={onClose} className="min-h-11 rounded border border-slate-600 px-3 text-sm">× 閉じる</button>
  </div>;
}
