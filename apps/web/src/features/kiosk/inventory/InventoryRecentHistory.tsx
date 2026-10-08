import { useState } from 'react';

import { useInventoryCompartmentHistory } from '../../../api/hooks';

import { formatSignedDelta, inventoryActionLabel } from './inventoryDailyFlow';
import { ChevronDownIcon, ChevronUpIcon } from './InventoryIcons';
import { invButtonSmGhost, invEyebrow } from './inventoryUi';

const SHOWN = 5;
const FETCHED = 20;

function formatTime(value: string) {
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }).format(new Date(value));
}

function deltaColour(action: string, delta: number): string {
  if (action === 'CORRECTION' || action === 'CANCEL') return 'text-inv-muted';
  return delta < 0 ? 'text-inv-amber' : 'text-inv-green';
}

/** The latest movements; the rest open in place. */
export function InventoryRecentHistory({ compartmentId }: { compartmentId: string }) {
  const history = useInventoryCompartmentHistory(compartmentId, FETCHED);
  const [open, setOpen] = useState(false);
  const entries = history.data ?? [];
  const hidden = Math.max(entries.length - SHOWN, 0);
  const visible = open ? entries : entries.slice(0, SHOWN);
  return (
    <section aria-label="最近の動き" className="flex min-h-0 flex-col gap-1.5">
      <h3 className={invEyebrow}>最近の動き</h3>
      {history.isLoading ? <p className="text-sm text-inv-faint">読み込み中…</p> : null}
      {!history.isLoading && entries.length === 0 ? <p className="text-sm text-inv-faint">まだ記録がありません</p> : null}
      <ul className={`flex flex-col gap-1 ${open ? 'max-h-72 overflow-y-auto' : ''}`}>
        {visible.map((entry) => (
          <li key={entry.id} className="flex h-9 shrink-0 items-center gap-2.5 rounded-lg bg-inv-s2 px-3 text-[13px]">
            <span className="w-[84px] shrink-0 tabular-nums text-inv-faint">{formatTime(entry.createdAt)}</span>
            <span className="text-inv-muted">{inventoryActionLabel(entry.action)}</span>
            <span className={`font-black tabular-nums ${deltaColour(entry.action, entry.delta)}`}>{formatSignedDelta(entry.delta)}</span>
            <span className="ml-auto tabular-nums text-inv-faint">{entry.beforeQuantity}→{entry.afterQuantity}</span>
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <button type="button" className={`${invButtonSmGhost} min-h-11 self-start`} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          {open ? <><ChevronUpIcon />閉じる</> : <><ChevronDownIcon />あと{hidden}件</>}
        </button>
      ) : null}
    </section>
  );
}
