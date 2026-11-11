import { useRef, useState } from 'react';

import { Dialog } from '../../../components/ui/Dialog';

export function PlanningBoardTestBarDialog({ sequence, resources, initialResource, onInsert, onClose }: {
  sequence: number; resources: readonly string[]; initialResource: string;
  onInsert: (resource: string, minutes: number) => Promise<boolean>; onClose: () => void;
}) {
  const [minutes, setMinutes] = useState('30');
  const [resource, setResource] = useState(initialResource);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const value = Number(minutes);
  const valid = Number.isInteger(value) && value >= 5 && value <= 1440;
  const step = (delta: number) => setMinutes(String(Math.max(5, Math.min(1440, (valid ? value : 30) + delta))));
  return <Dialog isOpen ariaLabel="テスト加工" title={`テスト${sequence}`} onClose={onClose} initialFocusRef={input}
    size="sm" overlayZIndex={90} className="!border-slate-600 !bg-slate-950 !text-slate-100">
    <form onSubmit={(event) => { event.preventDefault(); if (!valid || pending) return;
      setPending(true); setFailed(false); void onInsert(resource, value).then((saved) => { if (saved) onClose(); else { setPending(false); setFailed(true); } });
    }}>
      <label htmlFor="planning-test-minutes" className="mt-4 block text-sm font-bold">時間(分)</label>
      <div className="mt-2 flex gap-2">
        <button type="button" aria-label="時間を5分減らす" className="h-11 w-11 rounded border border-slate-600 text-xl" disabled={pending || value <= 5} onClick={() => step(-5)}>−</button>
        <input ref={input} id="planning-test-minutes" type="number" min={5} max={1440} step={5} value={minutes} disabled={pending}
          onChange={(event) => setMinutes(event.target.value)} className="h-11 min-w-0 flex-1 rounded border border-slate-600 bg-slate-900 text-center font-mono text-lg" />
        <button type="button" aria-label="時間を5分増やす" className="h-11 w-11 rounded border border-slate-600 text-xl" disabled={pending || value >= 1440} onClick={() => step(5)}>＋</button>
      </div>
      {resources.length === 2 && <><span className="mt-4 block text-sm font-bold">機械</span><div role="group" aria-label="機械" className="mt-2 flex gap-2">
        {resources.map((cd) => <button key={cd} type="button" aria-pressed={resource === cd} disabled={pending} onClick={() => setResource(cd)}
          className={`h-11 flex-1 rounded border font-bold ${resource === cd ? 'border-violet-300 bg-violet-300 text-indigo-950' : 'border-slate-600'}`}>{cd}</button>)}
      </div></>}
      {failed && <p role="alert" className="mt-2 text-sm text-rose-300">差し込めませんでした。</p>}
      <div className="mt-5 flex gap-2"><button type="submit" disabled={!valid || pending} className="h-11 flex-1 rounded bg-violet-300 font-bold text-indigo-950 disabled:opacity-40">差し込む</button>
        <button type="button" onClick={onClose} disabled={pending} className="h-11 flex-1 rounded border border-slate-600">やめる</button></div>
    </form>
  </Dialog>;
}
