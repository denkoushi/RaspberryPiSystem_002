import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

export type KioskMonthPickerModalProps = {
  isOpen: boolean;
  /** `YYYY-MM` */
  value: string;
  onCancel: () => void;
  onCommit: (nextYm: string) => void;
  overlayZIndex?: number;
  /** 集計画面などダークテーマ向け */
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

function toYm(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function KioskMonthPickerModal({
  isOpen,
  value,
  onCancel,
  onCommit,
  overlayZIndex,
  variant = 'default',
}: KioskMonthPickerModalProps) {
  const parsed = useMemo(() => parseYm(value), [value]);
  const today = useMemo(() => new Date(), []);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [year, setYear] = useState(() => parsed?.year ?? today.getFullYear());

  useEffect(() => {
    if (!isOpen) return;
    const p = parseYm(value);
    setYear(p?.year ?? today.getFullYear());
  }, [isOpen, value, today]);

  const selectedMonth = parsed?.month ?? today.getMonth() + 1;
  const currentYm = toYm(today.getFullYear(), today.getMonth() + 1);

  const isAnalytics = variant === 'analytics';

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

  const handleMonthClick = (m: number) => {
    onCommit(toYm(year, m));
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onCancel}
      ariaLabel="対象月"
      size="md"
      initialFocusRef={closeButtonRef}
      overlayZIndex={overlayZIndex}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2
          className={isAnalytics ? 'text-sm font-bold' : 'text-lg font-bold text-slate-900'}
          style={isAnalytics ? { color: 'var(--color-neutral-white)' } : undefined}
        >
          対象月
        </h2>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onCancel}
          aria-label="閉じる"
          title="閉じる"
          className={isAnalytics ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-700'}
        >
          ✕
        </button>
      </div>

      <div
        className={isAnalytics ? 'rounded-lg border px-3 py-3' : ''}
        style={
          isAnalytics
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
            className={isAnalytics ? 'text-xs' : 'text-sm text-slate-600'}
            style={isAnalytics ? { color: 'var(--color-neutral-solid-gray-300)' } : undefined}
          >
            年
          </label>
          <select
            className={
              isAnalytics
                ? 'rounded border px-2 py-1 text-sm font-semibold'
                : 'rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900'
            }
            style={
              isAnalytics
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
          style={isAnalytics ? { color: 'var(--color-neutral-solid-gray-400)' } : { color: '#475569' }}
        >
          月を選択
        </div>
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
          {MONTHS.map((m) => {
            const ym = toYm(year, m);
            const isSelected = selectedMonth === m && parsed && parsed.year === year;
            const isThisMonth = ym === currentYm;
            return (
              <button
                key={m}
                type="button"
                className={
                  isAnalytics
                    ? 'rounded px-2 py-1.5 text-xs font-semibold transition-colors'
                    : [
                        'rounded px-2 py-2 text-sm font-semibold transition-colors',
                        isSelected ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-900 hover:bg-slate-200',
                        isThisMonth && !isSelected ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-white' : '',
                      ].join(' ')
                }
                style={
                  isAnalytics
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
                onClick={() => handleMonthClick(m)}
                aria-label={`${year}年${m}月`}
                aria-pressed={isSelected}
              >
                {m}月
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {isAnalytics ? (
          <>
            <Button type="button" variant="ghost" onClick={() => onCommit(currentYm)} className="text-xs">
              今月
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
