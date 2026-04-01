import clsx from 'clsx';

import { KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS } from '../manualOrder/manualOrderOverviewTypography';
import { formatDueDate } from '../productionSchedule/formatDueDate';
import { isManualDueDateSet } from '../productionSchedule/plannedDueDisplay';

import type { LeaderBoardRow } from './types';

type Props = {
  resourceCd: string;
  rows: LeaderBoardRow[];
  selected: boolean;
  dimmed: boolean;
  onSelect: () => void;
};

/**
 * 資源CD単位カード。本文は約5件ぶんの高さでスクロール。
 */
export function LeaderOrderResourceCard({ resourceCd, rows, selected, dimmed, onSelect }: Props) {
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={clsx(
        'flex cursor-pointer flex-col rounded-lg border bg-slate-900/60 p-2.5 transition-all outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60',
        KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS,
        selected ? 'border-cyan-300/70 shadow-[0_0_0_1px_rgba(34,211,238,0.3)]' : 'border-white/10',
        dimmed ? 'opacity-[0.52]' : 'opacity-100'
      )}
      aria-pressed={selected}
      aria-label={`資源 ${resourceCd}`}
    >
      <div className="mb-1.5 shrink-0 px-0.5 font-mono text-[15px] font-medium tracking-tight text-white/95">
        {resourceCd}
      </div>
      <div
        className="max-h-[268px] min-h-0 flex-1 space-y-1.5 overflow-y-auto overflow-x-hidden pr-0.5"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {rows.length === 0 ? (
          <p className="rounded bg-slate-800/80 px-2 py-2 text-xs text-white/45">行なし</p>
        ) : (
          rows.map((row) => {
            const manual = isManualDueDateSet(row.dueDate);
            const dueLabel = formatDueDate(row.displayDue) || '—';
            return (
              <div key={row.id} className="rounded bg-slate-800/80 px-2 py-1.5 text-[11px]">
                <div className="mb-0.5 flex justify-between gap-1.5">
                  <span className="font-mono text-[11px] text-white/88">{row.fseiban || '—'}</span>
                  <span
                    className={clsx(
                      'shrink-0 font-mono text-[10px]',
                      manual ? 'font-medium text-amber-200' : 'text-cyan-300/90'
                    )}
                    title={manual ? '手動納期' : 'CSV補助など'}
                  >
                    {dueLabel}
                  </span>
                </div>
                <div className="truncate text-white/55">
                  {(row.fhinmei || '—') + (row.fkojun ? ` · 工順 ${row.fkojun}` : '')}
                </div>
              </div>
            );
          })
        )}
      </div>
    </article>
  );
}
