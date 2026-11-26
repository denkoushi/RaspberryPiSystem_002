import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useId, useState } from 'react';

import {
  createKioskGrindingPlanningBoardPair, deleteKioskGrindingPlanningBoardPair,
  getKioskGrindingPlanningBoardPairs, getKioskGrindingPlanningBoardPairSuggestions
} from '../../../api/domains/production-schedule/grinding-planning-board';
import { usePlanningBoardTestBarPartCandidates } from '../../../api/hooks/production-schedule/grinding-planning-board-test-bar-parts';
import { productionScheduleQueryKeys } from '../../../api/queryKeys/productionSchedule';
import { Dialog } from '../../../components/ui/Dialog';

import { usePlanningBoardOffline } from './offline/planningBoardOfflineContext';
import { PlanningBoardPartSearchKeyboard, usePlanningBoardPartSearch } from './PlanningBoardPartSearchKeyboard';

function slotClass(name: string | null, active: boolean) {
  return clsx('min-h-12 min-w-11 break-words rounded-[10px] border-2 px-2 text-base font-bold',
    name ? 'border-violet-400 bg-violet-400/15 text-violet-100' : 'border-dashed border-slate-600',
    active && '!border-violet-300');
}

export function PlanningBoardPairsDialog({ onClose }: { onClose: () => void }) {
  const [first, setFirst] = useState('');
  const [secondChoice, setSecondChoice] = useState<string | null>();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const { frozen, gate, enabled, refreshRead } = usePlanningBoardOffline();
  const client = useQueryClient();
  const pairsKey = ['kiosk-grinding-planning-board-pairs', useId()] as const;
  const { data: registered, isError: pairsError } = useQuery({ queryKey: pairsKey, queryFn: getKioskGrindingPlanningBoardPairs, enabled: !frozen });
  const { data: candidates, isLoading: candidatesLoading } = usePlanningBoardTestBarPartCandidates();
  const search = usePlanningBoardPartSearch(candidates?.parts);
  const suggestions = useQuery({
    queryKey: [...pairsKey, 'suggestions', first], queryFn: () => getKioskGrindingPlanningBoardPairSuggestions(first),
    enabled: Boolean(first) && !frozen
  });
  const pairs = registered?.pairs ?? [];
  const partnerByName = new Map(pairs.flatMap(({ firstPartName, secondPartName }) => [
    [firstPartName, secondPartName] as const, [secondPartName, firstPartName] as const
  ]));
  const availableSuggestions = suggestions.data?.suggestions.filter(({ partName }) => !partnerByName.has(partName)) ?? [];
  const second = secondChoice === undefined ? availableSuggestions[0]?.partName ?? null : secondChoice;
  const options = availableSuggestions.length ? availableSuggestions : search.hits;
  const disabled = pending || frozen || !registered || candidatesLoading || (Boolean(first) && suggestions.isLoading);
  const canSave = first && second && !partnerByName.has(first) && !partnerByName.has(second) && !disabled;
  const reset = () => { setFirst(''); setSecondChoice(undefined); };

  const save = async (operation: () => Promise<unknown>, afterSave?: () => void) => {
    setPending(true);
    setFailed(false);
    try {
      await gate.run(operation);
      afterSave?.();
      if (enabled) void refreshRead('board').catch(() => undefined);
      else void client.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
    } catch {
      setFailed(true);
    } finally {
      await client.invalidateQueries({ queryKey: pairsKey, exact: true });
      setPending(false);
    }
  };

  return <Dialog isOpen ariaLabel="組" onClose={pending ? () => undefined : onClose} size="full"
    overlayZIndex={90} overlayClassName="!items-center"
    className="!my-0 !max-w-[960px] overflow-y-auto !rounded-[14px] !border !border-slate-600 !bg-slate-950 !px-6 !pb-6 !pt-5 !text-slate-100">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-[22px] font-bold">組</h2>
      <button type="button" aria-label="閉じる" onClick={onClose} disabled={pending}
        className="h-11 w-11 rounded-lg border border-slate-600 text-xl">✕</button>
    </div>
    <div className="mt-3.5 grid gap-3 min-[721px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <PlanningBoardPartSearchKeyboard search={search} disabled={pending || frozen || candidatesLoading} largeButtons />
      <div className="min-w-0 overflow-hidden rounded-[10px] border border-slate-600" aria-busy={candidatesLoading || suggestions.isLoading}>
        <div className="bg-slate-800 px-3 py-2 text-right text-sm tabular-nums text-slate-400">{availableSuggestions.length ? `${first} ⇄` : `${options.length}件`}</div>
        <div role="group" aria-label="品名候補" className="h-[250px] overflow-y-auto">
          {options.map((part) => {
            const { partName } = part;
            const partner = partnerByName.get(partName);
            return <button key={partName} type="button" aria-pressed={partName === first || partName === second}
              disabled={disabled || Boolean(partner) || partName === first}
              onClick={() => first ? setSecondChoice(second === partName ? null : partName) : setFirst(partName)}
              className={clsx('flex min-h-12 w-full items-center justify-between gap-2 border-t border-slate-600 px-3 py-1.5 text-left disabled:opacity-55',
                (partName === first || partName === second) && 'bg-violet-400/20 font-bold text-violet-100')}>
              <span className="min-w-0 break-words">{partName}</span>
              <span className="shrink-0 text-[13px] text-violet-300">
                {partner ? `⇄ ${partner}` : 'seibanCount' in part && `${part.seibanCount}製番`}
              </span>
            </button>;
          })}
        </div>
      </div>
    </div>
    <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)_120px] items-center gap-2">
      <button type="button" aria-label={first ? `1つ目 ${first}` : '1つ目'} disabled={pending || !first} className={slotClass(first, !first)} onClick={reset}>{first}</button>
      <span aria-hidden="true" className="text-center text-xl text-slate-400">⇄</span>
      <button type="button" aria-label={second ? `2つ目 ${second}` : '2つ目'} disabled={pending || !second} className={slotClass(second, Boolean(first) && !second)}
        onClick={() => setSecondChoice(null)}>{second}</button>
      <button type="button" disabled={!canSave} className="h-12 rounded-[10px] bg-violet-300 text-base font-extrabold text-indigo-950 disabled:opacity-35"
        onClick={() => { if (canSave) void save(() => createKioskGrindingPlanningBoardPair(first, second), () => { reset(); search.setQuery(''); }); }}>組にする</button>
    </div>
    {(failed || pairsError) && <p role="alert" className="mt-2 text-sm text-rose-300">{failed ? '組を更新できませんでした。' : '組を読み込めませんでした。'}</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      {pairs.map((pair) => <div key={pair.id} className="flex min-h-12 items-center gap-2.5 rounded-[10px] border border-slate-600 py-px pl-3.5 pr-1.5 text-base font-bold">
        {pair.firstPartName} <span className="text-slate-400">⇄</span> {pair.secondPartName}
        <button type="button" aria-label={`${pair.firstPartName} ⇄ ${pair.secondPartName}を削除`} disabled={pending || frozen}
          className="h-11 w-11 rounded-lg border border-slate-600" onClick={() => void save(() => deleteKioskGrindingPlanningBoardPair(pair.id))}>✕</button>
      </div>)}
    </div>
  </Dialog>;
}
