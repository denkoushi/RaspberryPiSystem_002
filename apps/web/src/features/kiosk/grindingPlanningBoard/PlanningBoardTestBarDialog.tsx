import { useRef, useState } from 'react';

import { usePlanningBoardTestBarPartCandidates } from '../../../api/hooks/production-schedule/grinding-planning-board-test-bar-parts';
import { Dialog } from '../../../components/ui/Dialog';

import { PlanningBoardPartSearchKeyboard, usePlanningBoardPartSearch } from './PlanningBoardPartSearchKeyboard';

export function PlanningBoardTestBarDialog({ sequence, resources, initialResource, onInsert, onClose }: {
  sequence: number; resources: readonly string[]; initialResource: string;
  onInsert: (resource: string, minutes: number, partName: string | null) => Promise<boolean>; onClose: () => void;
}) {
  const [minutes, setMinutes] = useState('30');
  const [resource, setResource] = useState(initialResource);
  const [partName, setPartName] = useState('');
  const { data: candidates, isLoading: candidatesLoading } = usePlanningBoardTestBarPartCandidates(resource);
  const search = usePlanningBoardPartSearch(candidates?.parts);
  const { hits, setQuery } = search;
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const value = Number(minutes);
  const valid = Number.isInteger(value) && value >= 5 && value <= 1440;
  const step = (delta: number) => setMinutes(String(Math.max(5, Math.min(1440, (valid ? value : 30) + delta))));
  return <Dialog isOpen ariaLabel="テスト加工" title={partName || `テスト${sequence}`} onClose={onClose} initialFocusRef={input}
    size="full" overlayZIndex={90} overlayClassName="!items-center" className="!my-0 !max-w-[960px] overflow-y-auto !border-slate-600 !bg-slate-950 !text-slate-100">
    <form onSubmit={(event) => { event.preventDefault(); if (!valid || pending) return;
      setPending(true); setFailed(false); void onInsert(resource, value, partName || null).then((saved) => { if (saved) onClose(); else { setPending(false); setFailed(true); } });
    }}>
      {resources.length >= 2 && <div role="group" aria-label="機械" className="mt-3 flex flex-wrap gap-1.5">
        {resources.map((cd) => <button key={cd} type="button" aria-pressed={resource === cd} disabled={pending} onClick={() => { if (resource !== cd) { setResource(cd); setPartName(''); setQuery(''); } }}
          className={`h-11 min-w-[72px] rounded-lg border px-3 font-mono text-base font-bold ${resource === cd ? 'border-violet-300 bg-violet-300 text-indigo-950' : 'border-slate-600'}`}>{cd}</button>)}
      </div>}
      <div className="mt-3 grid gap-3 min-[721px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <PlanningBoardPartSearchKeyboard search={search} disabled={pending || candidatesLoading} />
        <div className="min-w-0 overflow-hidden rounded-[10px] border border-slate-600" aria-busy={candidatesLoading}>
          <div className="bg-slate-800 px-3 py-2 text-right text-sm tabular-nums text-slate-400">{hits.length}件</div>
          <div role="group" aria-label="部品候補" className="max-h-[352px] overflow-y-auto">
            {[{ partName: '', machineStock: false }, ...hits].map((part) => <button key={part.partName} type="button" aria-pressed={partName === part.partName}
              disabled={pending || candidatesLoading} onClick={() => setPartName(part.partName)}
              className={`flex min-h-12 w-full items-center justify-between gap-2 border-t border-slate-600 px-3 py-1.5 text-left disabled:opacity-40 ${partName === part.partName ? 'bg-violet-400/20 font-bold text-violet-100' : ''}`}>
              <span className="min-w-0 break-words">{part.partName || `テスト${sequence}`}</span>{part.machineStock && <span aria-hidden="true" className="text-xs font-bold text-amber-400">★</span>}
            </button>)}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <label htmlFor="planning-test-minutes" className="mr-1 text-sm text-slate-400">時間(分)</label>
          <div className="flex gap-1.5">
            <button type="button" aria-label="時間を5分減らす" className="h-11 w-11 rounded border border-slate-600 text-xl" disabled={pending || value <= 5} onClick={() => step(-5)}>−</button>
            <input ref={input} id="planning-test-minutes" type="number" min={5} max={1440} step={5} value={minutes} disabled={pending}
              onChange={(event) => setMinutes(event.target.value)} className="h-11 w-[90px] min-w-0 rounded border border-slate-600 bg-slate-900 text-center font-mono text-lg" />
            <button type="button" aria-label="時間を5分増やす" className="h-11 w-11 rounded border border-slate-600 text-xl" disabled={pending || value >= 1440} onClick={() => step(5)}>＋</button>
          </div>
        </div>
        <div className="flex min-w-[260px] flex-1 gap-2"><button type="submit" disabled={!valid || pending} className="h-12 flex-1 rounded-lg bg-violet-300 font-bold text-indigo-950 disabled:opacity-40">差し込む</button>
          <button type="button" onClick={onClose} disabled={pending} className="h-12 flex-1 rounded-lg border border-slate-600">やめる</button></div>
      </div>
      {failed && <p role="alert" className="mt-2 text-sm text-rose-300">差し込めませんでした。</p>}
    </form>
  </Dialog>;
}
