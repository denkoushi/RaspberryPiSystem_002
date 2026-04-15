import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

export type KioskMonthPickerModalProps = {
  isOpen: boolean;
  /** `YYYY-MM`（月全体）または `YYYY-MM-DD`（その1日・analytics のみ） */
  value: string;
  onCancel: () => void;
  onCommit: (next: string) => void;
  overlayZIndex?: number;
  /** 集計画面などダークテーマ向け。`analytics` のとき「1日」指定が可能 */
  variant?: 'default' | 'analytics';
};

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

function parseYm(value: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  return { year, month };
}

function isValidYmd(year: number, month: number, day: number): boolean {
  const dt = new Date(year, month - 1, day);
  return dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day;
}

function parseYmd(value: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (!isValidYmd(year, month, day)) return null;
  return { year, month, day };
}

/** 月の日数（month は 1–12） */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function toYm(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function toYmd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseYearMonthFromValue(value: string): { year: number; month: number } | null {
  const ymd = parseYmd(value);
  if (ymd) return { year: ymd.year, month: ymd.month };
  return parseYm(value);
}

export function KioskMonthPickerModal({
  isOpen,
  value,
  onCancel,
  onCommit,
  overlayZIndex,
  variant = 'default',
}: KioskMonthPickerModalProps) {
  const parsedYmd = useMemo(() => parseYmd(value), [value]);
  const today = useMemo(() => new Date(), []);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [year, setYear] = useState(() => {
    const ym = parseYearMonthFromValue(value);
    return ym?.year ?? today.getFullYear();
  });

  const isAnalytics = variant === 'analytics';
  const [scope, setScope] = useState<'month' | 'day'>(() => (isAnalytics && parsedYmd ? 'day' : 'month'));
  const [pendingMonth, setPendingMonth] = useState(() => {
    const ym = parseYearMonthFromValue(value);
    return ym?.month ?? today.getMonth() + 1;
  });

  useEffect(() => {
    if (!isOpen) return;
    const ymPart = parseYearMonthFromValue(value);
    setYear(ymPart?.year ?? today.getFullYear());
    setPendingMonth(ymPart?.month ?? today.getMonth() + 1);
    if (isAnalytics) {
      setScope(parseYmd(value) ? 'day' : 'month');
    }
  }, [isOpen, value, today, isAnalytics]);

  const refYm = useMemo(() => parseYearMonthFromValue(value), [value]);
  const currentYm = toYm(today.getFullYear(), today.getMonth() + 1);
  const currentYmd = toYmd(today.getFullYear(), today.getMonth() + 1, today.getDate());

  const isAnalyticsVariant = isAnalytics;

  const yearOptions = useMemo(() => {
    const cy = today.getFullYear();
    const minYear = Math.min(cy - 5, year);
    const maxYear = Math.max(cy + 1, year);
    const list: number[] = [];
    for (let y = minYear; y <= maxYear; y += 1) {
      list.push(y);
    }
    return list;
  }, [today, year]);

  const dim = useMemo(() => daysInMonth(year, pendingMonth), [year, pendingMonth]);

  const handleMonthClickMonthScope = (m: number) => {
    onCommit(toYm(year, m));
  };

  const handleMonthClickDayScope = (m: number) => {
    setPendingMonth(m);
  };

  const handleDayClick = (d: number) => {
    onCommit(toYmd(year, pendingMonth, d));
  };

  const dialogTitle = isAnalyticsVariant ? '対象期間' : '対象月';

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onCancel}
      ariaLabel={dialogTitle}
      size="md"
      initialFocusRef={closeButtonRef}
      overlayZIndex={overlayZIndex}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2
          className={isAnalyticsVariant ? 'text-sm font-bold' : 'text-lg font-bold text-slate-900'}
          style={isAnalyticsVariant ? { color: 'var(--color-neutral-white)' } : undefined}
        >
          {dialogTitle}
        </h2>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onCancel}
          aria-label="閉じる"
          title="閉じる"
          className={
            isAnalyticsVariant ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-700'
          }
        >
          ✕
        </button>
      </div>

      {isAnalyticsVariant ? (
        <div className="mb-3 flex gap-2" role="tablist" aria-label="期間の単位">
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'month'}
            className="rounded px-3 py-1 text-xs font-semibold transition-colors"
            style={
              scope === 'month'
                ? {
                    backgroundColor: 'var(--color-primitive-blue-900)',
                    color: 'var(--color-neutral-white)',
                    border: '1px solid var(--color-neutral-solid-gray-600)',
                  }
                : {
                    backgroundColor: 'var(--color-neutral-solid-gray-900)',
                    color: 'var(--color-neutral-solid-gray-400)',
                    border: '1px solid var(--color-neutral-solid-gray-700)',
                  }
            }
            onClick={() => setScope('month')}
          >
            月
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'day'}
            className="rounded px-3 py-1 text-xs font-semibold transition-colors"
            style={
              scope === 'day'
                ? {
                    backgroundColor: 'var(--color-primitive-blue-900)',
                    color: 'var(--color-neutral-white)',
                    border: '1px solid var(--color-neutral-solid-gray-600)',
                  }
                : {
                    backgroundColor: 'var(--color-neutral-solid-gray-900)',
                    color: 'var(--color-neutral-solid-gray-400)',
                    border: '1px solid var(--color-neutral-solid-gray-700)',
                  }
            }
            onClick={() => {
              setScope('day');
              const ym = parseYm(value);
              const ymd = parseYmd(value);
              if (ym) {
                setYear(ym.year);
                setPendingMonth(ym.month);
              } else if (ymd) {
                setYear(ymd.year);
                setPendingMonth(ymd.month);
              }
            }}
          >
            1日
          </button>
        </div>
      ) : null}

      <div
        className={isAnalyticsVariant ? 'rounded-lg border px-3 py-3' : ''}
        style={
          isAnalyticsVariant
            ? {
                borderColor: 'var(--color-neutral-solid-gray-600)',
                backgroundColor: 'var(--color-neutral-solid-gray-800)',
                color: 'var(--color-neutral-white)',
              }
            : undefined
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label
            className={isAnalyticsVariant ? 'text-xs' : 'text-sm text-slate-600'}
            style={isAnalyticsVariant ? { color: 'var(--color-neutral-solid-gray-300)' } : undefined}
          >
            年
          </label>
          <select
            className={
              isAnalyticsVariant
                ? 'rounded border px-2 py-1 text-sm font-semibold'
                : 'rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900'
            }
            style={
              isAnalyticsVariant
                ? {
                    borderColor: 'var(--color-neutral-solid-gray-600)',
                    backgroundColor: 'var(--color-neutral-solid-gray-900)',
                    color: 'var(--color-neutral-white)',
                  }
                : undefined
            }
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            aria-label="年"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}年
              </option>
            ))}
          </select>
          <Button type="button" variant="ghost" onClick={() => setYear((y) => y - 1)}>
            前年
          </Button>
          <Button type="button" variant="ghost" onClick={() => setYear((y) => y + 1)}>
            翌年
          </Button>
        </div>

        <div
          className="mb-2 text-center text-xs font-semibold"
          style={isAnalyticsVariant ? { color: 'var(--color-neutral-solid-gray-400)' } : { color: '#475569' }}
        >
          月を選択
        </div>
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
          {MONTHS.map((m) => {
            const ym = toYm(year, m);
            const isSelectedMonthScope =
              (!isAnalyticsVariant || scope === 'month') &&
              Boolean(refYm && refYm.year === year && refYm.month === m);
            const isSelectedDayScope = Boolean(isAnalyticsVariant && scope === 'day' && pendingMonth === m);
            const isSelected = isAnalyticsVariant && scope === 'day' ? isSelectedDayScope : isSelectedMonthScope;
            const isThisMonth = ym === currentYm;
            return (
              <button
                key={m}
                type="button"
                className={
                  isAnalyticsVariant
                    ? 'rounded px-2 py-1.5 text-xs font-semibold transition-colors'
                    : [
                        'rounded px-2 py-2 text-sm font-semibold transition-colors',
                        isSelected ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-900 hover:bg-slate-200',
                        isThisMonth && !isSelected ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-white' : '',
                      ].join(' ')
                }
                style={
                  isAnalyticsVariant
                    ? isSelected
                      ? {
                          backgroundColor: 'var(--color-primitive-blue-900)',
                          color: 'var(--color-neutral-white)',
                          border: '1px solid var(--color-neutral-solid-gray-600)',
                        }
                      : {
                          backgroundColor: 'var(--color-neutral-solid-gray-900)',
                          color: 'var(--color-neutral-solid-gray-300)',
                          border: '1px solid var(--color-neutral-solid-gray-700)',
                          boxShadow: isThisMonth ? '0 0 0 1px rgb(56 189 248 / 0.6)' : undefined,
                        }
                    : undefined
                }
                onClick={() => {
                  if (isAnalyticsVariant && scope === 'day') {
                    handleMonthClickDayScope(m);
                  } else {
                    handleMonthClickMonthScope(m);
                  }
                }}
                aria-label={`${year}年${m}月`}
                aria-pressed={Boolean(isSelected)}
              >
                {`${m}月`}
              </button>
            );
          })}
        </div>

        {isAnalyticsVariant && scope === 'day' ? (
          <>
            <div
              className="mb-2 mt-4 text-center text-xs font-semibold"
              style={{ color: 'var(--color-neutral-solid-gray-400)' }}
            >
              日を選択（{year}年{pendingMonth}月）
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: dim }, (_, i) => i + 1).map((d) => {
                const ymdStr = toYmd(year, pendingMonth, d);
                const isDaySelected = parsedYmd && parsedYmd.year === year && parsedYmd.month === pendingMonth && parsedYmd.day === d;
                const isToday = ymdStr === currentYmd;
                return (
                  <button
                    key={d}
                    type="button"
                    className="rounded px-1 py-1 text-xs font-semibold transition-colors"
                    style={
                      isDaySelected
                        ? {
                            backgroundColor: 'var(--color-primitive-blue-900)',
                            color: 'var(--color-neutral-white)',
                            border: '1px solid var(--color-neutral-solid-gray-600)',
                          }
                        : {
                            backgroundColor: 'var(--color-neutral-solid-gray-900)',
                            color: 'var(--color-neutral-solid-gray-300)',
                            border: '1px solid var(--color-neutral-solid-gray-700)',
                            boxShadow: isToday ? '0 0 0 1px rgb(56 189 248 / 0.6)' : undefined,
                          }
                    }
                    onClick={() => handleDayClick(d)}
                    aria-label={`${year}年${pendingMonth}月${d}日`}
                    aria-pressed={Boolean(isDaySelected)}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {isAnalyticsVariant ? (
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                if (scope === 'day') {
                  onCommit(currentYmd);
                } else {
                  onCommit(currentYm);
                }
              }}
              className="text-xs"
            >
              今日
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel} className="text-xs">
              キャンセル
            </Button>
          </>
        ) : (
          <Button type="button" variant="ghost" onClick={onCancel}>
            キャンセル
          </Button>
        )}
      </div>
    </Dialog>
  );
}
