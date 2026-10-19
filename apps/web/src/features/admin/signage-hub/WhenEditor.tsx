import { EVERY_DAY, sameDays, WEEKDAYS } from './scheduleDraftModel';

import type { QuickWhen } from './playlistModel';

const DAY_BUTTONS: Array<{ value: number; label: string }> = [
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
  { value: 0, label: '日' },
];

/** 「いつも」か「時間を決める」か。時間を決めるときだけ、曜日と時刻を出す。 */
export function WhenEditor({ value, onChange, idPrefix }: { value: QuickWhen; onChange: (next: QuickWhen) => void; idPrefix: string }) {
  const toggleDay = (day: number) =>
    onChange({ ...value, dayOfWeek: value.dayOfWeek.includes(day) ? value.dayOfWeek.filter((d) => d !== day) : [...value.dayOfWeek, day] });
  return (
    <div className="sh-col" style={{ gap: 10 }}>
      <div className="sh-filter">
        <button type="button" className="sh-pill sh-pill-lg" aria-pressed={value.always} onClick={() => onChange({ ...value, always: true })}>
          いつも
        </button>
        <button type="button" className="sh-pill sh-pill-lg" aria-pressed={!value.always} onClick={() => onChange({ ...value, always: false })}>
          時間を決める
        </button>
      </div>
      {!value.always && (
        <>
          <div className="sh-row-between">
            <div className="sh-days" style={{ flex: 1 }}>
              {DAY_BUTTONS.map((day) => (
                <button key={day.value} type="button" className="sh-day" aria-pressed={value.dayOfWeek.includes(day.value)} aria-label={`${day.label}曜`} onClick={() => toggleDay(day.value)}>
                  {day.label}
                </button>
              ))}
            </div>
          </div>
          <div className="sh-filter">
            <button type="button" className="sh-pill sh-pill-sm" aria-pressed={sameDays(value.dayOfWeek, WEEKDAYS)} onClick={() => onChange({ ...value, dayOfWeek: WEEKDAYS })}>
              平日
            </button>
            <button type="button" className="sh-pill sh-pill-sm" aria-pressed={sameDays(value.dayOfWeek, EVERY_DAY)} onClick={() => onChange({ ...value, dayOfWeek: EVERY_DAY })}>
              毎日
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input id={`${idPrefix}-start`} type="time" className="sh-input sh-time sh-mono" aria-label="始まりの時刻" value={value.startTime} onChange={(e) => onChange({ ...value, startTime: e.target.value })} />
            <span style={{ color: 'var(--sh-faint)' }} aria-hidden="true">
              →
            </span>
            <input id={`${idPrefix}-end`} type="time" className="sh-input sh-time sh-mono" aria-label="終わりの時刻" value={value.endTime} onChange={(e) => onChange({ ...value, endTime: e.target.value })} />
          </div>
        </>
      )}
    </div>
  );
}
