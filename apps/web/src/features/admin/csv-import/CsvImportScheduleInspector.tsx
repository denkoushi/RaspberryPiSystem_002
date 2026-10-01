import clsx from 'clsx';

import { formatCsvImportError } from './csvImportError';
import { CheckIcon, WarnIcon, boardButtonClassName } from './CsvImportScheduleBoard';
import {
  ALL_DAYS,
  DAY_LABELS,
  INTERVAL_CHOICES,
  formatClock,
  formatDuration,
  formatTimingShort,
  intervalOf,
  pad2,
  toDaily,
  toHourly,
  withInterval,
  type ConflictLevel
} from './scheduleTimeline';

import type { CsvImportScheduleBoardController } from './useCsvImportScheduleBoard';
import type { ReactNode } from 'react';

type CsvImportScheduleInspectorProps = {
  board: CsvImportScheduleBoardController;
  scheduleId: string;
  cron: string;
  isRunning: boolean;
  runDisabled: boolean;
  runMessage?: string;
  runError?: unknown;
  onRun: () => void;
  onOpenDetail: () => void;
};

type ConflictGroup = { otherId: string; phrase: string; level: ConflictLevel; times: Set<number> };

const segmentClassName = 'inline-flex gap-0.5 justify-self-start rounded-lg bg-slate-100 p-[3px]';
const segmentButton = (isActive: boolean, className?: string) =>
  clsx(
    'h-[26px] rounded-md font-semibold',
    isActive ? 'bg-white text-slate-900 shadow' : 'text-slate-600',
    className
  );

function Stepper({ label, value, onStep }: { label: string; value: string; onStep: (direction: -1 | 1) => void }) {
  return (
    <div className="inline-flex items-center justify-self-start overflow-hidden rounded-lg border border-slate-300">
      <button type="button" aria-label={`${label}を1つ早く`} onClick={() => onStep(-1)} className="h-7 w-7 text-base text-slate-600 hover:bg-slate-100">
        −
      </button>
      <output className="min-w-[44px] text-center font-mono text-[13px] font-semibold">{value}</output>
      <button type="button" aria-label={`${label}を1つ遅く`} onClick={() => onStep(1)} className="h-7 w-7 text-base text-slate-600 hover:bg-slate-100">
        +
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      {children}
    </>
  );
}

export function CsvImportScheduleInspector({
  board,
  scheduleId,
  cron,
  isRunning,
  runDisabled,
  runMessage,
  runError,
  onRun,
  onOpenDetail
}: CsvImportScheduleInspectorProps) {
  const entry = board.selected;
  const saved = board.savedSelected;
  if (!entry || !saved || entry.id !== scheduleId) return null;

  const isDirty = board.dirtyIds.includes(entry.id);
  const dirtyCount = board.dirtyIds.length;
  const isHourly = entry.hours === null;
  const isSingleTime = entry.hours?.length === 1 && entry.minutes.length === 1;
  const interval = intervalOf(entry);
  const nameOf = (id: string) => board.entries.find((e) => e.id === id)?.name ?? id;

  const groups = new Map<string, ConflictGroup>();
  for (const conflict of board.conflictsByDay.flat()) {
    const isVictim = conflict.victimId === entry.id;
    if (!isVictim && conflict.causeId !== entry.id) continue;
    const otherId = isVictim ? conflict.causeId : conflict.victimId;
    const phrase =
      conflict.level === 'hard'
        ? conflict.same
          ? 'と同時'
          : isVictim
            ? 'の実行中'
            : 'が実行中に来る'
        : isVictim
          ? 'の直後'
          : 'が直後に来る';
    const key = `${otherId}:${phrase}`;
    const group = groups.get(key) ?? { otherId, phrase, level: conflict.level, times: new Set<number>() };
    group.times.add(isVictim ? conflict.at : conflict.causeAt);
    groups.set(key, group);
  }
  const conflictGroups = [...groups.values()].sort((a, b) => (a.level === 'hard' ? 0 : 1) - (b.level === 'hard' ? 0 : 1));
  const worst: ConflictLevel | null = conflictGroups.some((g) => g.level === 'hard')
    ? 'hard'
    : conflictGroups.length > 0
      ? 'soft'
      : null;

  const describeTimes = (times: Set<number>) => {
    const sorted = [...times].sort((a, b) => a - b);
    if (sorted.length > 6) {
      const minutes = [...new Set(sorted.map((t) => t % 60))].sort((a, b) => a - b);
      return `毎時 ${minutes.map((m) => `:${pad2(m)}`).join(' ')}`;
    }
    return sorted.map(formatClock).join(' ');
  };

  const toggleDay = (day: number) => {
    const days = entry.days.includes(day) ? entry.days.filter((d) => d !== day) : [...entry.days, day].sort();
    if (days.length > 0) board.patch(entry.id, () => ({ days }));
  };

  const heroTimes = isHourly
    ? entry.minutes.map((m) => `:${pad2(m)}`)
    : entry.hours!.flatMap((h) => entry.minutes.map((m) => `${pad2(h)}:${pad2(m)}`));

  return (
    <aside className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-300 bg-white p-3.5 text-[13px] text-slate-900">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-bold">{entry.name}</h3>
          <small className="mt-0.5 block break-all font-mono text-[10.5px] font-medium text-slate-500">{entry.id}</small>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={entry.enabled}
          aria-label="有効"
          onClick={() => board.patch(entry.id, (current) => ({ enabled: !current.enabled }))}
          className={clsx('relative h-[22px] w-[38px] shrink-0 rounded-full', entry.enabled ? 'bg-emerald-600' : 'bg-slate-300')}
        >
          <span
            className={clsx(
              'absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow',
              entry.enabled ? 'left-[18px]' : 'left-0.5'
            )}
          />
        </button>
      </div>

      {entry.editable ? (
        <>
          <div>
            <div
              className={clsx(
                'flex flex-wrap gap-x-3 font-mono font-semibold tabular-nums tracking-tight',
                heroTimes.length > 4 ? 'text-xl leading-snug' : 'text-[34px] leading-none'
              )}
            >
              {heroTimes.map((time) => (
                <span key={time}>{time}</span>
              ))}
            </div>
            {isDirty && formatTimingShort(saved) !== formatTimingShort(entry) && (
              <div className="mt-1 font-mono text-[11.5px] font-medium text-slate-500">
                <s>{formatTimingShort(saved)}</s> から変更
              </div>
            )}
          </div>

          <div className="grid grid-cols-[44px_1fr] items-center gap-x-2.5 gap-y-2">
            <Field label="周期">
              <div className={segmentClassName}>
                <button
                  type="button"
                  aria-pressed={isHourly}
                  onClick={() => !isHourly && board.patch(entry.id, toHourly)}
                  className={segmentButton(isHourly, 'px-2.5')}
                >
                  毎時
                </button>
                <button
                  type="button"
                  aria-pressed={!isHourly}
                  onClick={() => isHourly && board.patch(entry.id, (current) => toDaily(current, board.hour))}
                  className={segmentButton(!isHourly, 'px-2.5')}
                >
                  1日1回
                </button>
              </div>
            </Field>

            {isHourly && (
              <>
                <Field label="間隔">
                  <div className={segmentClassName} role="group" aria-label="間隔（分）">
                    {INTERVAL_CHOICES.map((choice) => (
                      <button
                        key={choice}
                        type="button"
                        aria-pressed={interval === choice}
                        onClick={() => interval !== choice && board.patch(entry.id, (current) => withInterval(current, choice))}
                        className={segmentButton(interval === choice, 'min-w-[30px] px-1.5 font-mono')}
                      >
                        {choice}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="開始">
                  <Stepper label="開始の分" value={`:${pad2(entry.minutes[0])}`} onStep={(direction) => board.nudge(entry.id, direction)} />
                </Field>
              </>
            )}

            {!isHourly && (
              <Field label="時刻">
                <div className="flex items-center gap-2">
                  {isSingleTime && (
                    <Stepper label="時" value={`${pad2(entry.hours![0])}時`} onStep={(direction) => board.nudge(entry.id, direction * 60)} />
                  )}
                  <Stepper label="分" value={`${pad2(entry.minutes[0])}分`} onStep={(direction) => board.nudge(entry.id, direction)} />
                </div>
              </Field>
            )}

            <Field label="所要">
              <div>
                <span className="font-mono">{formatDuration(entry.durationSec)}</span>{' '}
                <span className="text-[11.5px] text-slate-500">{board.hasHistory(entry.id) ? '直近の最長' : '実績なし（仮）'}</span>
              </div>
            </Field>

            <Field label="曜日">
              <div className={segmentClassName} role="group" aria-label="曜日">
                {ALL_DAYS.map((day) => {
                  const isOn = entry.days.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={isOn}
                      onClick={() => toggleDay(day)}
                      className={clsx('h-[26px] w-[30px] rounded-md font-semibold', isOn ? 'bg-slate-900 text-white' : 'text-slate-600')}
                    >
                      {DAY_LABELS[day]}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
        </>
      ) : (
        <div className="rounded-lg bg-slate-100 px-3 py-2">
          <div className="font-mono text-sm font-semibold">{cron}</div>
          <div className="mt-1 text-xs text-slate-600">この形式は画面で変更できません</div>
        </div>
      )}

      {!entry.gated ? (
        <div className="rounded-[10px] bg-slate-100 px-3 py-2 font-bold text-slate-600">別枠で動くため重なりません</div>
      ) : !worst ? (
        <div className="flex items-center gap-1.5 rounded-[10px] bg-emerald-50 px-3 py-2 font-bold text-emerald-700">
          <CheckIcon />
          重なりなし
        </div>
      ) : (
        <>
          <div className={clsx('flex flex-col gap-1.5 rounded-[10px] px-3 py-2', worst === 'hard' ? 'bg-red-50' : 'bg-amber-50')}>
            {conflictGroups.slice(0, 4).map((group) => (
              <div
                key={`${group.otherId}:${group.phrase}`}
                className={clsx('flex items-center gap-1.5 font-semibold', group.level === 'hard' ? 'text-red-600' : 'text-amber-600')}
              >
                <WarnIcon />
                <span className="min-w-0 truncate">
                  {nameOf(group.otherId)} {group.phrase}
                </span>
                <span className="ml-auto whitespace-nowrap font-mono text-[11.5px] font-medium">{describeTimes(group.times)}</span>
              </div>
            ))}
            {conflictGroups.length > 4 && (
              <div className={clsx('font-semibold', worst === 'hard' ? 'text-red-600' : 'text-amber-600')}>
                ほか {conflictGroups.length - 4}
              </div>
            )}
          </div>
          {entry.editable && (
            <div>
              <button type="button" className={boardButtonClassName} onClick={() => board.moveToRoom(entry.id)}>
                空きへ移動
              </button>
            </div>
          )}
        </>
      )}

      <div className="mt-auto flex flex-col gap-2">
        {board.saveError != null && (
          <div role="alert" className="rounded-md border border-red-600 bg-red-50 px-2 py-1 text-xs text-red-700">
            {formatCsvImportError(board.saveError)}
          </div>
        )}
        {runError != null && (
          <div role="alert" className="rounded-md border border-red-600 bg-red-50 px-2 py-1 text-xs text-red-700">
            実行エラー: {formatCsvImportError(runError)}
          </div>
        )}
        {(board.notice || runMessage) && (
          <div role="status" className="text-xs font-semibold text-emerald-700">
            {board.notice ?? runMessage}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={boardButtonClassName} onClick={onRun} disabled={runDisabled}>
            {isRunning ? '実行中' : '実行'}
          </button>
          <button type="button" className={boardButtonClassName} onClick={onOpenDetail}>
            詳細
          </button>
          <span className="flex-1" />
          <button type="button" className={boardButtonClassName} onClick={() => board.revert(entry.id)} disabled={!isDirty || board.isSaving}>
            戻す
          </button>
          <button
            type="button"
            onClick={board.save}
            disabled={dirtyCount === 0 || board.isSaving}
            className={clsx(
              'inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45',
              board.dirtyHasConflict ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
            )}
          >
            {board.isSaving
              ? '保存中'
              : board.dirtyHasConflict
                ? board.confirmArmed
                  ? 'このまま保存する'
                  : '重なりあり・保存'
                : dirtyCount > 1
                  ? `保存 ${dirtyCount}`
                  : '保存'}
          </button>
        </div>
      </div>
    </aside>
  );
}
