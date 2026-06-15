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
      <h2 className="mb-2 text-base font-bold text-slate-950">操作履歴</h2>
      <ul className="space-y-1">
        {list.length === 0 ? (
          <li className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
            （まだイベントなし）
          </li>
        ) : (
          list.map((ev) => (
            <li
              key={ev.id}
              className="truncate rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              title={ev.message}
            >
              <span className="mr-2 font-mono text-slate-500">{fmtTime(ev.at)}</span>
              {ev.message}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
