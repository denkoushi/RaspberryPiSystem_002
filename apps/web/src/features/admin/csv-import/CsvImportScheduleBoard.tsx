import clsx from 'clsx';
import { useRef } from 'react';

import {
  AFTER_LONG_GUARD_MINUTES,
  ALL_DAYS,
  DAY_LABELS,
  LONG_RUN_MINUTES,
  countConflictPairs,
  firesOn,
  formatClock,
  formatTimingShort,
  involves,
  moveMarker,
  pad2,
  worstLevel,
  type ConflictLevel,
  type TimelineEntry
} from './scheduleTimeline';

import type { CsvImportScheduleBoardController } from './useCsvImportScheduleBoard';
import type { ReactNode } from 'react';

export const boardButtonClassName =
  'inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-800 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-45';

export function WarnIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M8 1.8 15 14H1L8 1.8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8 6.4v3.4M8 11.6v.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
      <path d="m3 8.5 3.2 3.2L13 4.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const levelText: Record<ConflictLevel, string> = { hard: 'text-red-600', soft: 'text-amber-600' };
const levelFill: Record<ConflictLevel, string> = { hard: 'bg-red-600', soft: 'bg-amber-600' };
const hatch =
  'repeating-linear-gradient(135deg, rgb(254 226 226) 0 4px, transparent 4px 7px)';
const percent = (minutes: number) => `${(minutes / 60) * 100}%`;

type CsvImportScheduleBoardProps = {
  board: CsvImportScheduleBoardController;
  actions: ReactNode;
  inspector: ReactNode;
};

export function CsvImportScheduleBoard({ board, actions, inspector }: CsvImportScheduleBoardProps) {
  const { entries, day, hour, selected, conflictsByDay } = board;
  const conflicts = conflictsByDay[day];
  const pairs = countConflictPairs(conflicts);
  const hourStart = hour * 60;

  // ドラッグ中は再描画をまたぐので、最新の board を ref で参照する
  const boardRef = useRef(board);
  boardRef.current = board;
  const trackRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const draggedRef = useRef(false);

  const flags = new Map<string, ConflictLevel>();
  const flag = (key: string, level: ConflictLevel) => {
    if (flags.get(key) !== 'hard') flags.set(key, level);
  };
  for (const c of conflicts) {
    flag(`${c.victimId}@${c.at}`, c.level);
    flag(`${c.causeId}@${c.causeAt}`, c.level);
  }

  const guideLines = new Map<number, ConflictLevel>();
  for (const c of conflicts) {
    if (c.at >= hourStart && c.at < hourStart + 60 && guideLines.get(c.at) !== 'hard') guideLines.set(c.at, c.level);
  }

  const minuteAt = (id: string, clientX: number) => {
    const rect = trackRefs.current[id]?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.max(0, Math.min(59, Math.round(((clientX - rect.left) / rect.width) * 60)));
  };

  const startDrag = (entry: TimelineEntry, minute: number, event: React.PointerEvent) => {
    if (entry.id !== selected?.id || !entry.editable) return;
    event.preventDefault();
    let from = minute;
    draggedRef.current = false;
    const onMove = (moveEvent: PointerEvent) => {
      const to = minuteAt(entry.id, moveEvent.clientX);
      if (to === from) return;
      const origin = from;
      boardRef.current.patch(entry.id, (current) => moveMarker(current, origin, to));
      from = to;
      draggedRef.current = true;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const clickTrack = (entry: TimelineEntry, event: React.MouseEvent) => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    if (entry.id !== selected?.id) {
      board.select(entry.id);
      return;
    }
    if (!entry.editable || (event.target as HTMLElement).closest('[data-marker]')) return;
    const inHour = firesOn(entry, day).filter((t) => t >= hourStart && t < hourStart + 60);
    if (inHour.length === 0) return;
    const to = minuteAt(entry.id, event.clientX);
    const nearest = inHour.map((t) => t % 60).sort((a, b) => Math.abs(a - to) - Math.abs(b - to))[0];
    board.patch(entry.id, (current) => moveMarker(current, nearest, to));
  };

  return (
    <div className="flex flex-col gap-2.5 text-[13px] text-slate-900">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="mr-auto text-lg font-bold">取込スケジュール</h2>
        <div className="flex gap-0.5 rounded-lg bg-slate-100 p-[3px]" role="group" aria-label="曜日">
          {ALL_DAYS.map((d) => {
            const level = worstLevel(conflictsByDay[d]);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={d === day}
                onClick={() => board.setDay(d)}
                className={clsx(
                  'relative h-7 w-8 rounded-md font-semibold',
                  d === day ? 'bg-white text-slate-900 shadow' : 'text-slate-600'
                )}
              >
                {DAY_LABELS[d]}
                {level && <i className={clsx('absolute right-1 top-[3px] h-[5px] w-[5px] rounded-full', levelFill[level])} />}
              </button>
            );
          })}
        </div>
        {pairs.hard > 0 && (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-red-50 px-3 font-bold text-red-600">
            <WarnIcon />
            重なり {pairs.hard}
          </span>
        )}
        {pairs.soft > 0 && (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-amber-50 px-3 font-bold text-amber-600">
            <WarnIcon />
            直後 {pairs.soft}
          </span>
        )}
        {pairs.hard === 0 && pairs.soft === 0 && (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-emerald-50 px-3 font-bold text-emerald-700">
            <CheckIcon />
            重なりなし
          </span>
        )}
        {actions}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-300 bg-white">
        <div className="grid min-w-[720px] grid-cols-[repeat(24,minmax(30px,1fr))]" role="group" aria-label="時間帯">
          {Array.from({ length: 24 }, (_, h) => {
            const level = worstLevel(conflicts.filter((c) => Math.floor(c.at / 60) === h));
            const isActive = h === hour;
            return (
              <button
                key={h}
                type="button"
                aria-pressed={isActive}
                aria-label={`${h}時${level ? ' 重なりあり' : ''}`}
                onClick={() => board.setHour(h)}
                className={clsx(
                  'relative h-[50px] border-r border-slate-200 pl-1.5 pt-1 text-left last:border-r-0',
                  isActive ? 'bg-slate-900' : 'hover:bg-slate-100'
                )}
              >
                <b className={clsx('font-mono text-[11px] font-semibold', isActive ? 'text-white' : 'text-slate-500')}>
                  {pad2(h)}
                </b>
                {entries
                  .filter((entry) => entry.hours !== null)
                  .flatMap((entry) =>
                    firesOn(entry, day)
                      .filter((t) => Math.floor(t / 60) === h)
                      .map((t) => {
                        const tickLevel = flags.get(`${entry.id}@${t}`);
                        return (
                          <span
                            key={`${entry.id}@${t}`}
                            className={clsx(
                              'absolute bottom-[9px] h-3.5 -translate-x-px rounded-[1px]',
                              tickLevel ? `w-[3px] ${levelFill[tickLevel]}` : isActive ? 'w-0.5 bg-white' : 'w-0.5 bg-slate-700'
                            )}
                            style={{ left: percent(t % 60) }}
                          />
                        );
                      })
                  )}
                {level && <span className={clsx('absolute inset-x-0 bottom-0 h-1', levelFill[level])} />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid items-stretch gap-2.5 lg:grid-cols-[minmax(0,1fr)_336px]">
        <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-300 bg-white">
          <div className="grid h-[30px] grid-cols-[150px_minmax(0,1fr)] items-center border-b border-slate-200 lg:grid-cols-[272px_minmax(0,1fr)]">
            <div className="pl-3.5 font-bold">
              <span className="font-mono text-[15px]">{pad2(hour)}:00</span> の1時間
            </div>
            <div className="relative ml-2.5 mr-6 h-full">
              {Array.from({ length: 13 }, (_, i) => (
                <span
                  key={i}
                  className={clsx(
                    'absolute top-2 -translate-x-1/2 font-mono text-[10.5px] font-medium text-slate-500',
                    i % 2 === 1 && 'hidden lg:inline'
                  )}
                  style={{ left: percent(i * 5) }}
                >
                  :{pad2((i * 5) % 60)}
                </span>
              ))}
            </div>
          </div>

          <div>
            {entries.map((entry) => {
              const isSelected = entry.id === selected?.id;
              const inHour = firesOn(entry, day).filter((t) => t >= hourStart && t < hourStart + 60);
              const rowLevel = worstLevel(conflicts.filter((c) => involves(c, entry.id)));
              const saved = board.savedEntries.find((e) => e.id === entry.id);
              const isDirty = board.dirtyIds.includes(entry.id);
              return (
                <div
                  key={entry.id}
                  className={clsx(
                    'grid h-10 cursor-pointer grid-cols-[150px_minmax(0,1fr)] items-center border-b border-slate-200 last:border-b-0 lg:grid-cols-[272px_minmax(0,1fr)]',
                    isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => board.select(entry.id)}
                    className="flex h-full w-full min-w-0 items-center gap-2 pl-3.5 pr-2.5 text-left"
                  >
                    <span
                      className={clsx(
                        'h-[7px] w-[7px] shrink-0 rounded-full',
                        entry.enabled ? 'bg-emerald-600' : 'border-[1.5px] border-slate-400'
                      )}
                    />
                    <span
                      className={clsx(
                        'min-w-0 flex-1 truncate',
                        inHour.length > 0 ? 'font-semibold' : 'font-medium text-slate-600'
                      )}
                    >
                      {entry.name}
                    </span>
                    {!entry.gated && (
                      <span
                        className="hidden shrink-0 rounded border border-slate-300 px-1 text-[10.5px] font-semibold leading-[15px] text-slate-500 lg:inline"
                        title="Gmail取込の順番待ちに入らない"
                      >
                        別枠
                      </span>
                    )}
                    {rowLevel && (
                      <span className={levelText[rowLevel]}>
                        <WarnIcon />
                      </span>
                    )}
                    <span className="hidden shrink-0 font-mono text-[11.5px] font-medium text-slate-600 lg:inline">
                      {entry.editable ? formatTimingShort(entry) : 'cron'}
                    </span>
                  </button>

                  <div
                    ref={(node) => {
                      trackRefs.current[entry.id] = node;
                    }}
                    onClick={(event) => clickTrack(entry, event)}
                    className={clsx(
                      'relative ml-2.5 mr-6 h-full border-r border-slate-200',
                      isSelected && entry.editable && 'cursor-crosshair',
                      inHour.length === 0 && 'opacity-50'
                    )}
                    style={{
                      backgroundImage: 'linear-gradient(to right, rgb(226 232 240) 1px, transparent 1px)',
                      backgroundSize: 'calc(100% / 12) 100%'
                    }}
                  >
                    {entry.gated &&
                      [...guideLines].map(([t, level]) => (
                        <span
                          key={t}
                          className={clsx(
                            'pointer-events-none absolute bottom-0 top-0 border-l-[1.5px] border-dashed opacity-55',
                            level === 'hard' ? 'border-red-600' : 'border-amber-600'
                          )}
                          style={{ left: percent(t - hourStart) }}
                        />
                      ))}

                    {isSelected &&
                      entry.gated &&
                      entries
                        .filter((other) => other.gated && other.id !== entry.id)
                        .flatMap((other) =>
                          firesOn(other, day).map((otherStart) => {
                            const blockedFrom = otherStart - entry.durationSec / 60;
                            const otherEnd = otherStart + other.durationSec / 60;
                            const isLong = other.durationSec / 60 >= LONG_RUN_MINUTES;
                            const guardEnd = isLong ? otherEnd + AFTER_LONG_GUARD_MINUTES : otherEnd;
                            if (guardEnd < hourStart || blockedFrom > hourStart + 60) return null;
                            const left = Math.max(blockedFrom, hourStart);
                            const right = Math.min(otherEnd, hourStart + 60);
                            const softRight = Math.min(guardEnd, hourStart + 60);
                            return (
                              <span key={`${other.id}@${otherStart}`} className="pointer-events-none">
                                {softRight > right && (
                                  <span
                                    className="absolute bottom-[5px] top-[5px] rounded-[3px] bg-amber-100"
                                    style={{ left: percent(right - hourStart), width: percent(softRight - right) }}
                                  />
                                )}
                                {right > left && (
                                  <span
                                    className="absolute bottom-[5px] top-[5px] rounded-[3px] outline outline-1 outline-red-200"
                                    style={{ left: percent(left - hourStart), width: percent(right - left), backgroundImage: hatch }}
                                  />
                                )}
                              </span>
                            );
                          })
                        )}

                    {isSelected &&
                      isDirty &&
                      saved &&
                      firesOn(saved, day)
                        .filter((t) => t >= hourStart && t < hourStart + 60)
                        .map((t) => (
                          <span
                            key={`ghost@${t}`}
                            className="pointer-events-none absolute top-1/2 h-3.5 w-[9px] -translate-y-1/2 rounded border-[1.5px] border-dashed border-slate-400"
                            style={{ left: percent(t - hourStart) }}
                          />
                        ))}

                    {inHour.map((t, index) => {
                      const level = entry.gated ? flags.get(`${entry.id}@${t}`) : undefined;
                      return (
                        <button
                          key={index}
                          type="button"
                          data-marker
                          aria-label={`${entry.name} ${formatClock(t)}${level ? ' 重なり' : ''}`}
                          onPointerDown={(event) => startDrag(entry, t % 60, event)}
                          onKeyDown={(event) => {
                            if (!isSelected || !entry.editable) return;
                            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                            event.preventDefault();
                            board.nudge(entry.id, event.key === 'ArrowLeft' ? -1 : 1);
                          }}
                          className={clsx(
                            'absolute top-1/2 min-w-[9px] -translate-y-1/2 touch-none rounded',
                            isSelected ? 'h-5 ring-[1.5px] ring-slate-900 ring-offset-[3px]' : 'h-3.5',
                            isSelected && entry.editable && 'cursor-grab active:cursor-grabbing',
                            !entry.gated
                              ? 'border-[1.5px] border-slate-400 bg-transparent'
                              : level
                                ? levelFill[level]
                                : isSelected
                                  ? 'bg-emerald-600'
                                  : 'bg-slate-700'
                          )}
                          style={{ left: percent(t - hourStart), width: percent(entry.durationSec / 60) }}
                        >
                          <em
                            className={clsx(
                              'pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap font-mono not-italic',
                              isSelected ? 'left-[calc(100%+7px)] text-[11.5px] font-bold' : 'left-[calc(100%+3px)] hidden text-[10.5px] font-medium lg:inline',
                              level ? `font-bold ${levelText[level]}` : isSelected ? 'text-slate-900' : 'text-slate-500'
                            )}
                          >
                            :{pad2(t % 60)}
                          </em>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-200 px-3.5 py-2 text-[11.5px] text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2.5 w-4 rounded-[3px] bg-slate-700" />
              実行中の長さ
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2.5 w-4 rounded-[3px] bg-red-600" />
              重なり（スキップ）
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2.5 w-4 rounded-[3px] bg-amber-600" />
              長い取込の直後
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2.5 w-4 rounded-[3px] outline outline-1 outline-red-200" style={{ backgroundImage: hatch }} />
              置けない場所
            </span>
          </div>
        </section>

        {inspector}
      </div>
    </div>
  );
}
