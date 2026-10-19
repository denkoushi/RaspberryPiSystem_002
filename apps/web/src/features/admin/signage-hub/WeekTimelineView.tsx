import { formatMinute, type SignageContentKind, type WeekTimeline } from './weekTimelineModel';

const KIND_LABEL: Record<SignageContentKind, string> = {
  web_page: 'ページ撮影',
  data: 'データ',
  pdf: 'PDF',
  chat: 'Chat',
};
const LANE_HEIGHT = 20;
const LANE_GAP = 3;

export function WeekTimelineView({
  timeline,
  clientName,
  selectedScheduleId,
  onSelectSchedule,
  offTimeline = [],
}: {
  timeline: WeekTimeline;
  clientName: string | null;
  selectedScheduleId: string | null;
  onSelectSchedule: (scheduleId: string) => void;
  /** 表に出ない予定（無効、または他の端末向け）。ここから開いて編集・再有効化できる。 */
  offTimeline?: Array<{ scheduleId: string; name: string; reason: string }>;
}) {
  const span = timeline.endMinute - timeline.startMinute;
  const pct = (minute: number) => `${((minute - timeline.startMinute) / span) * 100}%`;
  const hours: number[] = [];
  for (let minute = timeline.startMinute; minute <= timeline.endMinute; minute += 120) hours.push(minute);
  const nowVisible = timeline.nowMinute >= timeline.startMinute && timeline.nowMinute <= timeline.endMinute;

  return (
    <div className="sh-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="sh-row-between" style={{ flexWrap: 'wrap' }}>
        <span className="sh-eyebrow" title="同じ時間に複数の予定があるときは、順番に切り替えて表示します。予定のない時間は、優先順位のいちばん高い予定を表示します。">
          週間スケジュール{clientName ? ` · ${clientName}` : ''}
        </span>
        <div className="sh-legend">
          {(Object.keys(KIND_LABEL) as SignageContentKind[]).map((kind) => (
            <span key={kind}>
              <i className="sh-swatch" style={{ background: `var(--sh-kind-${kind})` }} />
              {KIND_LABEL[kind]}
            </span>
          ))}
        </div>
      </div>
      <div className="sh-timeline">
        <div />
        <div className="sh-axis sh-mono">
          {hours.map((minute) => (
            <span key={minute} style={{ left: pct(minute) }}>
              {minute / 60}
            </span>
          ))}
          {nowVisible && (
            <span className="sh-now-label" style={{ left: pct(timeline.nowMinute) }}>
              {formatMinute(timeline.nowMinute)}
            </span>
          )}
        </div>
        {timeline.days.map((day) => {
          const lanes = Math.max(1, ...day.blocks.map((block) => block.laneCount));
          const height = lanes * LANE_HEIGHT + (lanes - 1) * LANE_GAP + 6;
          return (
            <div key={day.dayOfWeek} style={{ display: 'contents' }}>
              <div className="sh-day-label" data-today={day.isToday}>
                {day.label}
              </div>
              <div className="sh-day-track" data-today={day.isToday} style={{ height }}>
                {day.blocks.length === 0 && <span className="sh-day-empty">予定なし</span>}
                {day.blocks.map((block) => (
                  <button
                    key={`${block.scheduleId}-${block.startMinute}`}
                    type="button"
                    className="sh-block"
                    data-kind={block.kind}
                    data-past={block.isPast}
                    data-onair={block.isOnAir && selectedScheduleId === null}
                    data-selected={selectedScheduleId === block.scheduleId}
                    data-dimmed={selectedScheduleId !== null && selectedScheduleId !== block.scheduleId}
                    style={{
                      left: pct(block.startMinute),
                      width: `calc(${((block.endMinute - block.startMinute) / span) * 100}% - 2px)`,
                      top: 3 + block.lane * (LANE_HEIGHT + LANE_GAP),
                      height: LANE_HEIGHT,
                    }}
                    title={`${block.name}（${formatMinute(block.startMinute)}–${formatMinute(block.endMinute)}）`}
                    aria-label={`${day.label}曜 ${formatMinute(block.startMinute)}から${formatMinute(block.endMinute)} ${block.name} を編集`}
                    onClick={() => onSelectSchedule(block.scheduleId)}
                  >
                    {block.name}
                  </button>
                ))}
                {nowVisible && day.isToday && <span className="sh-now-line" style={{ left: pct(timeline.nowMinute) }} />}
              </div>
            </div>
          );
        })}
      </div>
      {offTimeline.length > 0 && (
        <div className="sh-filter" style={{ alignItems: 'center' }}>
          <span className="sh-hint">表にない予定</span>
          {offTimeline.map((entry) => (
            <button
              key={entry.scheduleId}
              type="button"
              className="sh-pill"
              style={{ height: 24 }}
              aria-pressed={selectedScheduleId === entry.scheduleId}
              onClick={() => onSelectSchedule(entry.scheduleId)}
            >
              {entry.name}（{entry.reason}）
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
