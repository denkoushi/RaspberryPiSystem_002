import { useEffect, useMemo, useState } from 'react';

import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

type KioskDatePickerModalProps = {
  isOpen: boolean;
  value: string;
  onCancel: () => void;
  onCommit: (next: string) => void;
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

const toYmd = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseYmd = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getMonthStart = (base: Date) => new Date(base.getFullYear(), base.getMonth(), 1);

const addMonths = (base: Date, delta: number) => new Date(base.getFullYear(), base.getMonth() + delta, 1);

export function KioskDatePickerModal({
  isOpen,
  value,
  onCancel,
  onCommit
}: KioskDatePickerModalProps) {
  const today = useMemo(() => new Date(), []);
  const todayKey = toYmd(today);
  const selectedDate = useMemo(() => parseYmd(value), [value]);
  const [displayMonth, setDisplayMonth] = useState<Date>(
    () => getMonthStart(selectedDate ?? today)
  );

  useEffect(() => {
    if (!isOpen) return;
    setDisplayMonth(getMonthStart(selectedDate ?? today));
  }, [isOpen, selectedDate, today]);

  if (!isOpen) return null;

  const daysInMonth = new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 0).getDate();
  const leadingBlanks = new Date(displayMonth.getFullYear(), displayMonth.getMonth(), 1).getDay();
  const totalCells = leadingBlanks + daysInMonth;
  const trailingBlanks = (7 - (totalCells % 7)) % 7;

  const monthLabel = `${displayMonth.getFullYear()}年${displayMonth.getMonth() + 1}月`;

  const handleCommitDate = (date: Date) => {
    onCommit(toYmd(date));
  };

  const renderDayCell = (day: number) => {
    const date = new Date(displayMonth.getFullYear(), displayMonth.getMonth(), day);
    const dateKey = toYmd(date);
    const isToday = dateKey === todayKey;
    const isSelected = value === dateKey;
    return (
      <button
        key={dateKey}
        type="button"
        onClick={() => handleCommitDate(date)}
        className={[
          'flex h-10 w-10 items-center justify-center rounded text-sm font-semibold transition-colors',
          isSelected ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-900 hover:bg-slate-200',
          isToday ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-white' : ''
        ].join(' ')}
        aria-label={`${displayMonth.getMonth() + 1}月${day}日`}
      >
        {day}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">納期日</h2>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-700">
            ✕
          </button>
        </div>
        <div className="mb-4">
          <div className="mb-3 flex items-center justify-between">
            <Button type="button" variant="ghost" onClick={() => setDisplayMonth(addMonths(displayMonth, -1))}>
              前月
            </Button>
            <div className="text-base font-semibold text-slate-900">{monthLabel}</div>
            <Button type="button" variant="ghost" onClick={() => setDisplayMonth(addMonths(displayMonth, 1))}>
              次月
            </Button>
          </div>
          <div className="mb-2 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-600">
            {WEEKDAYS.map((weekday) => (
              <div key={weekday}>{weekday}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: leadingBlanks }).map((_, index) => (
              <div key={`blank-start-${index}`} className="h-10 w-10" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, index) => renderDayCell(index + 1))}
            {Array.from({ length: trailingBlanks }).map((_, index) => (
              <div key={`blank-end-${index}`} className="h-10 w-10" />
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => onCommit(todayKey)}>
            今日
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onCommit(toYmd(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)))}
          >
            明日
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onCommit(toYmd(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2)))}
          >
            明後日
          </Button>
          <div className="flex-1" />
          <Button type="button" variant="ghost" onClick={() => onCommit('')}>
            クリア
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            キャンセル
          </Button>
        </div>
      </Card>
    </div>
  );
}
