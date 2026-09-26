import { useState } from 'react';

import { kioskButtonSecondaryClassName, kioskInputClassName } from '../../kioskTheme';

type Props = {
  title: string;
  hint?: string;
  pending: boolean;
  error: string | null;
  onManualUid: (uid: string) => void;
  onCancel: () => void;
};

/** "Hold the tag" panel. Reading starts as soon as it is shown; typing the ID is a hidden fallback. */
export function NfcScanPanel({ title, hint = '読み取ると自動で登録します', pending, error, onManualUid, onCancel }: Props) {
  const [manualUid, setManualUid] = useState('');
  return (
    <section className="flex flex-col items-center gap-4 rounded-lg border-2 border-amber-400 bg-amber-950/40 p-6 text-center" aria-label={title}>
      <p className="text-base font-bold text-amber-200">{title}</p>
      <p className="text-3xl font-bold text-white">{pending ? '登録中…' : '新しいタグをリーダーにかざしてください'}</p>
      <p className="text-base text-amber-100/80">{hint}</p>
      {error ? <p className="w-full rounded border border-red-400/50 bg-red-950/60 p-3 text-base text-red-100" role="alert">{error}</p> : null}
      <button type="button" className={`${kioskButtonSecondaryClassName} min-h-12 w-full text-lg`} disabled={pending} onClick={onCancel}>やめる</button>
      <details className="w-full text-left text-sm text-white/70">
        <summary className="flex min-h-11 cursor-pointer items-center">読めないときはIDを手で入れる</summary>
        <div className="mt-2 flex gap-2">
          <input className={`${kioskInputClassName} min-w-0 flex-1`} aria-label="タグのID" placeholder="タグのID" value={manualUid} onChange={(event) => setManualUid(event.target.value)} />
          <button type="button" className={`${kioskButtonSecondaryClassName}`} disabled={pending || !manualUid.trim()} onClick={() => onManualUid(manualUid.trim())}>登録</button>
        </div>
      </details>
    </section>
  );
}
