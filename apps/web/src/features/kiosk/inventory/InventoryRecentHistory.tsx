import { useInventoryCompartmentHistory } from '../../../api/hooks';

import { formatSignedDelta, inventoryActionLabel } from './inventoryDailyFlow';

function formatTime(value: string) {
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }).format(new Date(value));
}

export function InventoryRecentHistory({ compartmentId }: { compartmentId: string }) {
  const history = useInventoryCompartmentHistory(compartmentId);
  const entries = history.data ?? [];
  return (
    <section aria-label="最近の動き" className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold text-white/70">最近の動き</h3>
      {history.isLoading ? <p className="text-sm text-white/50">読み込み中…</p> : null}
      {!history.isLoading && entries.length === 0 ? <p className="text-sm text-white/50">まだ記録がありません</p> : null}
      <ul className="flex flex-col gap-1">
        {entries.map((entry) => (
          <li key={entry.id} className="flex gap-3 rounded bg-slate-950/50 px-3 py-2 text-base text-white/85">
            <span className="w-28 shrink-0 text-white/55">{formatTime(entry.createdAt)}</span>
            <span>{inventoryActionLabel(entry.action)} {formatSignedDelta(entry.delta)}（{entry.beforeQuantity} → {entry.afterQuantity}）</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
