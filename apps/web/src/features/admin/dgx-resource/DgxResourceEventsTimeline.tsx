import type { DgxResourceEvent } from '../../../api/dgx-resource.types';

type Props = {
  events: DgxResourceEvent[];
};

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso.slice(11, 19);
  }
}

export function DgxResourceEventsTimeline({ events }: Props) {
  const list = events.slice(0, 5);
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <h2 className="mb-1.5 text-xs font-semibold text-emerald-200/90">操作履歴</h2>
      <ul className="space-y-1">
        {list.length === 0 ? (
          <li className="rounded border border-white/10 bg-slate-950/40 px-2 py-1.5 text-[10px] text-white/55">
            （まだイベントなし）
          </li>
        ) : (
          list.map((ev) => (
            <li
              key={ev.id}
              className="truncate rounded border border-white/10 bg-slate-950/40 px-2 py-1 text-[10px] text-white/80"
              title={ev.message}
            >
              <span className="mr-2 font-mono text-white/45">{fmtTime(ev.at)}</span>
              {ev.message}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
