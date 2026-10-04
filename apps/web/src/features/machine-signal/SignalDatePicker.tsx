import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';

import { Segmented } from '../part-measurement/selfInspectionReduction/reductionUi';

import {
  buildSignalMonthCells,
  buildSignalPresetRange,
  isSignalRangeAllowed,
  moveSignalMonth,
  normalizeSignalRange,
  signalRangeSelection
} from './signalDatePickerModel';

import type { SignalDatePreset, SignalDateSelection } from './signalDatePickerModel';

const MODES = [{ value: 'day', label: '1日' }, { value: 'range', label: '期間' }] as const;
const PRESETS: Array<{ value: SignalDatePreset; label: string }> = [
  { value: '7', label: '直近7日' }, { value: '30', label: '直近30日' },
  { value: 'month', label: '今月' }, { value: 'last', label: '先月' }
];

export function SignalDatePicker({ dates, selection, onSelect, onClose }: {
  dates: string[];
  selection: SignalDateSelection;
  onSelect: (selection: SignalDateSelection) => void;
  onClose: () => void;
}) {
  const latest = dates[dates.length - 1];
  const initial = selection.mode === 'day' ? selection.date : selection.mode === 'range' ? selection.to : latest;
  const [month, setMonth] = useState(initial ? `${initial.slice(0, 7)}-01` : new Date().toISOString().slice(0, 7) + '-01');
  const [mode, setMode] = useState<'day' | 'range'>(selection.mode === 'range' ? 'range' : 'day');
  const [pending, setPending] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const reports = new Set(dates);
  const from = pending ?? (selection.mode === 'range' ? selection.from : selection.mode === 'day' ? selection.date : latest);
  const to = pending ? null : selection.mode === 'range' ? selection.to : from;

  useEffect(() => {
    const previousFocus = document.activeElement;
    dialog.current?.focus();
    const closeOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !dialog.current?.parentElement?.contains(event.target)) onClose();
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [onClose]);

  const choose = (date: string) => {
    if (mode === 'day') onSelect({ mode: 'day', date });
    else if (!pending) setPending(date);
    else onSelect(signalRangeSelection(normalizeSignalRange(pending, date)));
  };

  return (
    <div ref={dialog} tabIndex={-1} role="dialog" aria-label="日付を選ぶ" className="absolute left-0 top-[52px] z-20 flex w-[340px] max-w-[calc(100vw-32px)] flex-col gap-2.5 rounded-xl border border-[#4b8fd6] bg-[#141e2b] p-3 shadow-[0_16px_44px_rgba(0,0,0,0.5)]">
      <div className="self-start">
        <Segmented label="選び方" value={mode} options={MODES} onChange={(value) => { setMode(value); setPending(null); }} />
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label="前の月" onClick={() => setMonth(moveSignalMonth(month, -1))} className="h-10 w-10 rounded-lg border border-[#243347]">‹</button>
        <b className="flex-1 text-center font-mono text-[17px]">{month.slice(0, 4)}年{Number(month.slice(5, 7))}月</b>
        <button type="button" aria-label="次の月" onClick={() => setMonth(moveSignalMonth(month, 1))} className="h-10 w-10 rounded-lg border border-[#243347]">›</button>
      </div>
      <div className="grid grid-cols-7 gap-[3px]">
        {[...'日月火水木金土'].map((weekday) => <span key={weekday} className="pb-0.5 text-center text-xs text-[#5d6e84]">{weekday}</span>)}
        {buildSignalMonthCells(month).map((date, index) => {
          if (!date) return <span key={`empty-${index}`} />;
          const hasReport = reports.has(date);
          const disabled = !hasReport || (pending !== null && !isSignalRangeAllowed(pending, date));
          const endpoint = date === from || date === to;
          const inside = from && to && date > from && date < to;
          return (
            <button key={date} type="button" disabled={disabled} aria-label={`${Number(date.slice(5, 7))}月${Number(date.slice(8))}日${hasReport ? '' : '（日報なし）'}`} aria-pressed={endpoint} onClick={() => choose(date)} className={clsx(
              'relative h-10 font-mono text-[15px]',
              endpoint ? 'rounded-lg bg-[#4b8fd6] text-white' : inside ? 'bg-[#1b3350] text-[#e6edf5]' : disabled ? 'rounded-lg text-[#5d6e84]' : 'rounded-lg text-[#e6edf5] hover:bg-[#1f2c3c]',
              disabled && 'opacity-40'
            )}>
              {Number(date.slice(8))}
              {hasReport ? <i className={clsx('absolute bottom-[5px] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full', endpoint ? 'bg-white' : 'bg-[#35b37e]')} /> : null}
            </button>
          );
        })}
      </div>
      <p className="min-h-4 text-xs text-[#8b9cb2]">{mode === 'range' ? pending ? '終わりの日を選ぶ' : '始まりの日を選ぶ' : ''}</p>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((preset) => <button key={preset.value} type="button" disabled={!latest} onClick={() => latest && onSelect(signalRangeSelection(buildSignalPresetRange(latest, preset.value)))} className="h-[34px] rounded-full border border-[#243347] px-3 text-[13px] text-[#8b9cb2] hover:border-[#46607f] disabled:opacity-40">{preset.label}</button>)}
      </div>
    </div>
  );
}
