import { useState } from 'react';

import { NfcIcon } from '../InventoryIcons';
import { invButtonSm, invButtonSmGhost, invError, invField, invPanel } from '../inventoryUi';
import { NfcPrompt } from '../NfcPrompt';

type Props = {
  label: string;
  sub?: string;
  pending: boolean;
  error: string | null;
  onManualUid: (uid: string) => void;
  onCancel: () => void;
  /** Big target with rings, for a screen whose only job is reading one tag. */
  large?: boolean;
  cancelLabel?: string;
  cancelWhilePending?: boolean;
};

/** One-row "hold the tag" prompt. Reading starts as soon as it is shown; the ID can be typed as a fallback. */
export function NfcScanPanel({ label, sub, pending, error, onManualUid, onCancel, large = false, cancelLabel = 'やめる', cancelWhilePending = false }: Props) {
  const [manualOpen, setManualOpen] = useState(false);
  const [manualUid, setManualUid] = useState('');
  const manual = manualOpen ? (
    <span className="flex items-center gap-2">
      <input aria-label="タグのID" placeholder="タグのID" className={`${invField} w-56`} value={manualUid} onChange={(event) => setManualUid(event.target.value)} />
      <button type="button" className={invButtonSm} disabled={pending || !manualUid.trim()} onClick={() => onManualUid(manualUid.trim())}>使う</button>
    </span>
  ) : (
    <button type="button" className="inline-flex min-h-11 min-w-11 items-center text-[13px] text-inv-cyan underline underline-offset-2" onClick={() => setManualOpen(true)}>IDを手で入れる</button>
  );
  if (large) {
    return (
      <section className={`${invPanel} flex flex-col items-center gap-5 border-inv-amber/50 px-7 py-9`} aria-label="タグを読む">
        <div className="relative flex h-[200px] w-[200px] items-center justify-center" aria-hidden="true">
          <span className="absolute inset-0 rounded-full border-2 border-inv-amber/20" />
          <span className="absolute inset-6 rounded-full border-2 border-inv-amber/40" />
          <span className="flex h-28 w-28 items-center justify-center rounded-full bg-inv-amber text-inv-amber-ink"><NfcIcon size={60} /></span>
        </div>
        <p role="status" className="text-center text-[28px] font-black">{pending ? '登録中…' : label}</p>
        {sub ? <p className="-mt-3 text-center text-sm text-inv-muted">{sub}</p> : null}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button type="button" className={invButtonSmGhost} disabled={pending && !cancelWhilePending} onClick={onCancel}>{cancelLabel}</button>
          {manual}
        </div>
        <div className="h-10 w-full overflow-hidden">{error ? <p className={`line-clamp-2 rounded-lg border px-3 py-0.5 text-sm leading-4 ${invError}`} role="alert">{error}</p> : null}</div>
      </section>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {pending ? <span role="status" className="inline-flex h-11 items-center px-2 text-base font-bold">登録中…</span> : <NfcPrompt size="small" tone="amber" label={label} sub={sub} />}
        <button type="button" className={invButtonSmGhost} disabled={pending && !cancelWhilePending} onClick={onCancel}>{cancelLabel}</button>
        {manual}
      </div>
      <div className="h-10 w-full overflow-hidden">{error ? <p className={`line-clamp-2 rounded-lg border px-3 py-0.5 text-sm leading-4 ${invError}`} role="alert">{error}</p> : null}</div>
    </div>
  );
}
