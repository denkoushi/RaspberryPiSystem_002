import { formatHours } from './loadBalancingFormat';
import { LoadBalancingActionIcon } from './LoadBalancingIcons';

import type { ScenarioActionType } from './loadBalancingScenario';

type Props = {
  summary: Array<{ type: ScenarioActionType; count: number; minutes: number }>;
  overBeforeMinutes: number;
  overAfterMinutes: number;
  onUndoLast: () => void;
  onClear: () => void;
};

const PILL = {
  outsource: 'bg-amber-950 text-amber-200',
  transfer: 'bg-sky-950 text-sky-200',
  defer: 'bg-fuchsia-950 text-fuchsia-200'
} as const;
const LABEL = { outsource: '外注', transfer: '移管', defer: '後ろへ' } as const;

/** 試算の中身と効果。DB は更新しない */
export function LoadBalancingScenarioBar({ summary, overBeforeMinutes, overAfterMinutes, onUndoLast, onClear }: Props) {
  const empty = summary.every((item) => item.count === 0);
  return (
    <div className="flex min-h-[56px] items-center gap-2.5 border-t border-white/10 px-3 py-2" data-testid="load-balancing-scenario-bar">
      <span className="font-extrabold">試算</span>
      {empty ? <span className="text-white/35">—</span> : null}
      {summary
        .filter((item) => item.count > 0)
        .map((item) => (
          <span key={item.type} className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-bold ${PILL[item.type]}`}>
            <LoadBalancingActionIcon type={item.type} />
            {LABEL[item.type]} {item.count} · {formatHours(item.minutes)}H
          </span>
        ))}
      {!empty ? (
        <>
          <span className="ml-auto text-sm font-bold text-white/55">超過計</span>
          <span className="text-lg font-extrabold tabular-nums text-emerald-300">
            {formatHours(overBeforeMinutes)} → {formatHours(overAfterMinutes)}H
          </span>
          <button type="button" className="h-10 rounded-lg border border-white/15 px-3.5 font-bold" onClick={onUndoLast}>
            ↶ 1つ戻す
          </button>
          <button type="button" className="h-10 rounded-lg border border-white/15 px-3.5 font-bold" onClick={onClear}>
            クリア
          </button>
        </>
      ) : null}
    </div>
  );
}
