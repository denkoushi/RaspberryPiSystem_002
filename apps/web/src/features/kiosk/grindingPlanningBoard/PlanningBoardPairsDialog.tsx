import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useId, useState } from 'react';

import {
  createKioskGrindingPlanningBoardPair, deleteKioskGrindingPlanningBoardPair,
  getKioskGrindingPlanningBoardPairCandidates, getKioskGrindingPlanningBoardPairs,
  getKioskGrindingPlanningBoardPairStatus, getKioskGrindingPlanningBoardPairSuggestions,
  type GrindingPlanningBoardPairPart
} from '../../../api/domains/production-schedule/grinding-planning-board';
import { productionScheduleQueryKeys } from '../../../api/queryKeys/productionSchedule';
import { Dialog } from '../../../components/ui/Dialog';

import { usePlanningBoardOffline } from './offline/planningBoardOfflineContext';
import { PlanningBoardPartSearchKeyboard, usePlanningBoardPartSearch } from './PlanningBoardPartSearchKeyboard';

function partLabel(part: GrindingPlanningBoardPairPart) {
  return `${part.partName} ${part.partCode}`;
}

export function PlanningBoardPairsDialog({ onClose }: { onClose: () => void }) {
  const [first, setFirst] = useState<GrindingPlanningBoardPairPart | null>(null);
  const [secondChoice, setSecondChoice] = useState<GrindingPlanningBoardPairPart | null>();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const { frozen, gate, enabled, refreshRead } = usePlanningBoardOffline();
  const client = useQueryClient();
  const pairsKey = ['kiosk-grinding-planning-board-pairs', useId()] as const;
  const registered = useQuery({ queryKey: pairsKey, queryFn: getKioskGrindingPlanningBoardPairs, enabled: !frozen });
  const candidates = useQuery({ queryKey: [...pairsKey, 'candidates'], queryFn: getKioskGrindingPlanningBoardPairCandidates, enabled: !frozen });
  const status = useQuery({ queryKey: [...pairsKey, 'status'], queryFn: getKioskGrindingPlanningBoardPairStatus, enabled: !frozen });
  const search = usePlanningBoardPartSearch(candidates.data?.parts);
  const partnerByCode = new Map(registered.data?.pairs.flatMap((pair) => [
    [pair.firstPartCode, { id: pair.id, partCode: pair.secondPartCode, partName: pair.secondPartName }] as const,
    [pair.secondPartCode, { id: pair.id, partCode: pair.firstPartCode, partName: pair.firstPartName }] as const
  ]));
  const firstCode = first?.partCode ?? '';
  const registeredPartner = partnerByCode.get(firstCode);
  const suggestions = useQuery({
    queryKey: [...pairsKey, 'suggestions', firstCode], queryFn: () => getKioskGrindingPlanningBoardPairSuggestions(firstCode),
    enabled: Boolean(firstCode) && !registeredPartner && !frozen
  });
  const availableSuggestions = suggestions.data?.suggestions.filter(({ partCode }) => !partnerByCode.has(partCode)) ?? [];
  const second = registeredPartner ?? (secondChoice === undefined ? availableSuggestions[0] ?? null : secondChoice);
  const options = availableSuggestions.length ? availableSuggestions : search.hits;
  const listedCodes = new Set(status.data?.parts.map(({ partCode }) => partCode));
  const statusParts = [...(status.data?.parts ?? []), ...(registered.data?.pairs ?? []).flatMap((pair) => [
    { partCode: pair.firstPartCode, partName: pair.firstPartName, seibanCount: 0 },
    { partCode: pair.secondPartCode, partName: pair.secondPartName, seibanCount: 0 }
  ]).filter(({ partCode }) => !listedCodes.has(partCode))];
  const pairedCount = statusParts.filter(({ partCode }) => partnerByCode.has(partCode)).length;
  const disabled = pending || frozen || !registered.data;
  const canSave = first && second && !disabled && !suggestions.isLoading && !registeredPartner && !partnerByCode.has(second.partCode);
  const pickFirst = (part: GrindingPlanningBoardPairPart | null) => {
    setFirst(part);
    setSecondChoice(undefined);
  };
  const isSelected = (partCode: string) => partCode === firstCode || partCode === second?.partCode;

  const save = async (operation: () => Promise<unknown>, afterSave: () => void) => {
    setPending(true);
    setFailed(false);
    try {
      await gate.run(operation);
      afterSave();
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
    className="!my-0 !max-w-[1760px] overflow-y-auto !rounded-[14px] !border !border-slate-600 !bg-slate-950 !px-6 !pb-6 !pt-5 !text-slate-100">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-[22px] font-bold">組</h2>
      <button type="button" aria-label="閉じる" onClick={onClose} disabled={pending}
        className="h-11 w-11 rounded-lg border border-slate-600 text-xl">✕</button>
    </div>
    <div className="mt-3.5 grid gap-3.5 min-[1100px]:grid-cols-[min(520px,29.5%)_minmax(0,1fr)_minmax(0,1fr)]">
      <PlanningBoardPartSearchKeyboard search={search} disabled={pending || frozen || candidates.isLoading} largeButtons />
      <div className="flex min-w-0 flex-col overflow-hidden rounded-[10px] border border-slate-600"
        aria-busy={candidates.isLoading || suggestions.isLoading}>
        <div className="bg-slate-800 px-3 py-2 text-right text-sm tabular-nums text-slate-400">
          {first && availableSuggestions.length ? `${partLabel(first)} ⇄` : `${options.length}件`}
        </div>
        <div role="group" aria-label="品番候補" className="h-[clamp(250px,calc(100dvh-200px),690px)] overflow-y-auto">
          {options.map((part) => {
            const { partCode, partName } = part;
            const partner = partnerByCode.get(partCode);
            const selected = isSelected(partCode);
            return <button key={partLabel(part)} type="button" aria-pressed={selected}
              disabled={disabled || suggestions.isLoading}
              onClick={() => {
                if (!first || registeredPartner || partner) pickFirst(part);
                else if (partCode === firstCode) pickFirst(null);
                else setSecondChoice(partCode === second?.partCode ? null : part);
              }}
              className={clsx('flex min-h-12 w-full items-center justify-between gap-2 border-t border-slate-600 px-3 py-1.5 text-left',
                selected && 'bg-violet-400/20 font-bold text-violet-100', (partner || disabled) && 'opacity-60')}>
              <span className="flex min-w-0 flex-col gap-0.5 break-words">{partName}
                <span className="font-mono text-[13px] text-slate-400">{partCode}</span>
              </span>
              <span className="shrink-0 font-mono text-[13px] text-violet-300">
                {partner ? `⇄ ${partner.partCode}` : 'seibanCount' in part && `${part.seibanCount}製番`}
              </span>
            </button>;
          })}
        </div>
      </div>
      <div className="flex min-w-0 flex-col overflow-hidden rounded-[10px] border border-slate-600" aria-busy={status.isLoading || registered.isLoading}>
        <div className="bg-slate-800 px-3 py-2 text-right text-sm tabular-nums text-slate-400">組 {pairedCount} / {statusParts.length}</div>
        <div role="group" aria-label="組の有無" className="flex h-[clamp(250px,calc(100dvh-200px),690px)] flex-col gap-1.5 overflow-y-auto p-1.5">
          {statusParts.map((part) => {
            const partner = partnerByCode.get(part.partCode);
            const selected = isSelected(part.partCode);
            return <div key={partLabel(part)} className={clsx('flex min-h-[46px] shrink-0 items-center gap-2 rounded-[10px] border pl-3 pr-1.5',
              selected ? 'border-violet-300 bg-violet-400/15' : 'border-slate-700')}>
              <button type="button" aria-pressed={selected} disabled={disabled} onClick={() => pickFirst(part)}
                className="grid min-h-11 min-w-0 flex-1 grid-cols-[minmax(0,1.1fr)_auto_minmax(0,1.4fr)] items-center gap-2 text-left">
                <b className="truncate text-[15px]" title={part.partName}>{part.partName}</b>
                <span className="font-mono text-[13px] text-slate-400">{part.partCode}</span>
                {partner
                  ? <span className="min-w-0 break-words text-sm text-sky-300">⇄ {partner.partName} <span className="font-mono text-[13px]">{partner.partCode}</span></span>
                  : <span className="flex flex-wrap items-center justify-between gap-x-1 text-sm text-slate-500">未
                    <span className="font-mono text-xs">{part.seibanCount}製番</span>
                  </span>}
              </button>
              {partner && <button type="button" aria-label={`${partLabel(part)} ⇄ ${partLabel(partner)}を削除`} disabled={disabled}
                className="h-11 w-11 shrink-0 rounded-lg border border-slate-600"
                onClick={() => void save(() => deleteKioskGrindingPlanningBoardPair(partner.id), () => pickFirst(null))}>✕</button>}
            </div>;
          })}
        </div>
      </div>
    </div>
    <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)_minmax(100px,160px)] items-center gap-2">
      {[first, second].map((part, index) => <button key={index} type="button" style={{ gridColumn: index ? 3 : 1, gridRow: 1 }}
        aria-label={part ? `${index + 1}つ目 ${partLabel(part)}` : `${index + 1}つ目`}
        disabled={pending || !part || (index === 1 && Boolean(registeredPartner))}
        onClick={() => index === 0 ? pickFirst(null) : setSecondChoice(null)}
        className={clsx('flex min-h-12 min-w-11 flex-col items-center justify-center gap-0.5 break-words rounded-[10px] border-2 px-2 text-base font-bold leading-tight',
          part ? 'border-violet-400 bg-violet-400/15 text-violet-100' : 'border-dashed border-slate-600',
          !part && (index === 0 || first) && '!border-violet-300')}>
        {part && <><span>{part.partName}</span><small className="font-mono text-[13px] font-semibold text-slate-400">{part.partCode}</small></>}
      </button>)}
      <span aria-hidden="true" className="col-start-2 row-start-1 text-center text-xl text-slate-400">⇄</span>
      <button type="button" disabled={!canSave}
        className={clsx('col-start-4 row-start-1 h-12 rounded-[10px] text-base font-extrabold',
          registeredPartner ? 'border-2 border-sky-300 text-sky-300' : 'bg-violet-300 text-indigo-950 disabled:opacity-35')}
        onClick={() => {
          if (canSave) void save(() => createKioskGrindingPlanningBoardPair({
            firstPartCode: first.partCode, firstPartName: first.partName,
            secondPartCode: second.partCode, secondPartName: second.partName
          }), () => { pickFirst(null); search.setQuery(''); });
        }}>{registeredPartner ? '登録済み' : '組にする'}</button>
    </div>
    {(failed || registered.isError || candidates.isError || status.isError) &&
      <p role="alert" className="mt-2 text-sm text-rose-300">{failed ? '組を更新できませんでした。' : '組を読み込めませんでした。'}</p>}
  </Dialog>;
}
