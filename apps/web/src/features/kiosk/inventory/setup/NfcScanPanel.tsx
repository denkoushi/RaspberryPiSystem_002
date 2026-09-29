import { useState } from 'react';

import { NfcPrompt } from '../NfcPrompt';

type Props = {
  label: string;
  sub?: string;
  pending: boolean;
  error: string | null;
  onManualUid: (uid: string) => void;
  onCancel: () => void;
};

/** One-row "hold the tag" prompt. Reading starts as soon as it is shown; the ID can be typed as a fallback. */
export function NfcScanPanel({ label, sub, pending, error, onManualUid, onCancel }: Props) {
  const [manualOpen, setManualOpen] = useState(false);
  const [manualUid, setManualUid] = useState('');
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-900/70 px-3 py-2.5">
        {pending ? <span role="status" className="inline-flex h-11 items-center px-2 text-base font-bold text-white">登録中…</span> : <NfcPrompt size="small" tone="amber" label={label} sub={sub} />}
        <button type="button" className="h-10 rounded-lg border border-white/25 px-3 text-sm text-white hover:bg-slate-800 disabled:opacity-40" disabled={pending} onClick={onCancel}>やめる</button>
        {manualOpen ? (
          <span className="flex items-center gap-2">
            <input aria-label="タグのID" placeholder="タグのID" className="h-10 w-56 rounded-md border border-white/25 bg-slate-950 px-2.5 text-base text-white focus:border-sky-400 focus:outline-none" value={manualUid} onChange={(event) => setManualUid(event.target.value)} />
            <button type="button" className="h-10 rounded-lg border border-white/25 bg-slate-800 px-3 text-sm text-white disabled:opacity-40" disabled={pending || !manualUid.trim()} onClick={() => onManualUid(manualUid.trim())}>使う</button>
          </span>
        ) : (
          <button type="button" className="text-sm text-sky-300 underline" onClick={() => setManualOpen(true)}>IDを手で入れる</button>
        )}
      </div>
      {error ? <p className="rounded border border-red-400/50 bg-red-950/60 px-3 py-2 text-sm text-red-100" role="alert">{error}</p> : null}
    </div>
  );
}
