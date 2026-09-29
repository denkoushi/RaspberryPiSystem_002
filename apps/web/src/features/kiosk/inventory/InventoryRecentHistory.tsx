import { useState } from 'react';

import { useInventoryCompartmentHistory } from '../../../api/hooks';

import { formatSignedDelta, inventoryActionLabel } from './inventoryDailyFlow';

const SHOWN = 3;
const FETCHED = 20;

function formatTime(value: string) {
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }).format(new Date(value));
}

/** The latest three movements; the rest open in place with ▼. */
export function InventoryRecentHistory({ compartmentId }: { compartmentId: string }) {
  const history = useInventoryCompartmentHistory(compartmentId, FETCHED);
  const [open, setOpen] = useState(false);
  const entries = history.data ?? [];
  const hidden = Math.max(entries.length - SHOWN, 0);
  const visible = open ? entries : entries.slice(0, SHOWN);
  return (
    <section aria-label="最近の動き" className="flex w-[300px] shrink-0 flex-col gap-1">
      <h3 className="text-sm font-semibold text-white/70">最近の動き</h3>
      {history.isLoading ? <p className="text-sm text-white/50">読み込み中…</p> : null}
      {!history.isLoading && entries.length === 0 ? <p className="text-sm text-white/50">まだ記録がありません</p> : null}
      <ul className={`flex flex-col gap-1 ${open ? 'max-h-72 overflow-y-auto' : ''}`}>
        {visible.map((entry) => (
          <li key={entry.id} className="flex gap-2.5 rounded bg-slate-950/50 px-2.5 py-1.5 text-sm text-white/85">
            <span className="w-[84px] shrink-0 text-white/55">{formatTime(entry.createdAt)}</span>
            <span>{inventoryActionLabel(entry.action)} {formatSignedDelta(entry.delta)}（{entry.beforeQuantity}→{entry.afterQuantity}）</span>
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <button type="button" className="h-9 self-start rounded-md border border-white/25 px-2.5 text-sm text-white/80 hover:bg-slate-800" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          {open ? '▲ 閉じる' : `▼ あと${hidden}件`}
        </button>
      ) : null}
    </section>
  );
}
