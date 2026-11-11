import clsx from 'clsx';
import { forwardRef } from 'react';

type Props = {
  seibanColors: ReadonlyMap<string, string>;
  focusedSeiban: string | null;
  onFocusedSeibanChange: (seiban: string | null) => void;
  onFocusSeiban: (seiban: string) => void;
};

export const PlanningBoardSeibanLegend = forwardRef<HTMLDivElement, Props>(function PlanningBoardSeibanLegend({
  seibanColors, focusedSeiban, onFocusedSeibanChange: setFocusedSeiban, onFocusSeiban
}, ref) {
  return <div ref={ref} role="group" aria-label="製番の色分け凡例" className="flex max-h-[52px] snap-y snap-mandatory scroll-pt-1 flex-wrap gap-2 overflow-y-auto overscroll-contain border-t border-slate-700 px-2 py-1 text-xs text-slate-200">
    {[...seibanColors].map(([seiban, color]) => <button key={seiban} type="button" aria-pressed={focusedSeiban === seiban}
      onClick={() => focusedSeiban === seiban ? setFocusedSeiban(null) : onFocusSeiban(seiban)}
      className={clsx('inline-flex min-h-[44px] snap-start items-center gap-1 rounded bg-slate-800 px-1.5 py-1 font-mono focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300', focusedSeiban === seiban && 'ring-2 ring-white')}>
      <span className={clsx('h-3 w-3 rounded-sm', color)} />{seiban}
    </button>)}
    {focusedSeiban !== null && <button type="button" onClick={() => setFocusedSeiban(null)}
      className="min-h-[44px] snap-start rounded bg-slate-800 px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">すべて表示</button>}
  </div>;
});
