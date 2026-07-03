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
      <h2 className="mb-2 text-base font-bold text-white">操作履歴</h2>
      <ul className="space-y-1">
        {list.length === 0 ? (
          <li className="rounded border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/60">
            （まだイベントなし）
          </li>
        ) : (
          list.map((ev) => (
            <li
              key={ev.id}
              className="truncate rounded border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/70"
              title={ev.message}
            >
              <span className="mr-2 font-mono text-white/60">{fmtTime(ev.at)}</span>
              {ev.message}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
