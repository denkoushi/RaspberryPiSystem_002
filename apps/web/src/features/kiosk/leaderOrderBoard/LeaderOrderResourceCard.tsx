import clsx from 'clsx';

import { KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS } from '../manualOrder/manualOrderOverviewTypography';
import { formatDueDate } from '../productionSchedule/formatDueDate';
import { isManualDueDateSet } from '../productionSchedule/plannedDueDisplay';

import { presentLeaderOrderRow } from './leaderOrderRowPresentation';

import type { LeaderBoardRow } from './types';

type Props = {
  resourceCd: string;
  /** resourceNameMap の names 部分のみ（横並び表示）。空なら非表示 */
  resourceJapaneseNames?: string;
  rows: LeaderBoardRow[];
  selected: boolean;
  dimmed: boolean;
  onSelect: () => void;
  /** 行納期編集（生産スケジュールと同契約の API へ） */
  onOpenDueDatePicker?: (row: LeaderBoardRow) => void;
  dueDatePending?: boolean;
};

/**
 * 資源CD単位カード。グリッド行の高さに合わせて本文を伸ばし、一覧は縦スクロール。
 */
export function LeaderOrderResourceCard({
  resourceCd,
  resourceJapaneseNames,
  rows,
  selected,
  dimmed,
  onSelect,
  onOpenDueDatePicker,
  dueDatePending
}: Props) {
  const jp = resourceJapaneseNames?.trim() ?? '';

  return (
    <div
      role="group"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={clsx(
        'flex h-full min-h-[14rem] cursor-pointer flex-col rounded-lg border bg-slate-900/60 p-2.5 transition-all outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60',
        KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS,
        selected ? 'border-cyan-300/70 shadow-[0_0_0_1px_rgba(34,211,238,0.3)]' : 'border-white/10',
        dimmed ? 'opacity-[0.52]' : 'opacity-100'
      )}
      aria-label={
        selected
          ? `資源 ${resourceCd}${jp ? ` ${jp}` : ''}（選択中）`
          : `資源 ${resourceCd}${jp ? ` ${jp}` : ''}。Enter か Space で選択`
      }
    >
      <div className="mb-1.5 flex shrink-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 px-0.5">
        <span className="font-mono text-[15px] font-medium tracking-tight text-white/95">{resourceCd}</span>
        {jp.length > 0 ? (
          <span className="min-w-0 break-words text-[12px] leading-snug text-white/78">{jp}</span>
        ) : null}
      </div>
      <div
        className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overflow-x-hidden pr-0.5"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {rows.length === 0 ? (
          <p className="rounded bg-slate-800/80 px-2 py-2 text-xs text-white/45">行なし</p>
        ) : (
          rows.map((row) => {
            const manual = isManualDueDateSet(row.dueDate);
            const dueLabel = formatDueDate(row.displayDue) || '—';
            const pres = presentLeaderOrderRow(row);
            return (
              <div key={row.id} className="rounded bg-slate-800/80 px-2 py-1.5 text-[11px]">
                <div className="mb-0.5 flex justify-between gap-1.5">
                  <span className="font-mono text-[11px] text-white/88">{row.fseiban || '—'}</span>
                  <button
                    type="button"
                    disabled={!onOpenDueDatePicker || dueDatePending}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDueDatePicker?.(row);
                    }}
                    className={clsx(
                      'shrink-0 rounded px-1 py-0 font-mono text-[10px] transition-colors',
                      manual ? 'font-medium text-amber-200' : 'text-cyan-300/90',
                      onOpenDueDatePicker && !dueDatePending ? 'hover:bg-white/10' : 'cursor-default opacity-70'
                    )}
                    title={manual ? '手動納期（タップで変更）' : '表示納期（タップで変更）'}
                  >
                    {dueLabel}
                  </button>
                </div>
                {pres.machinePartLine.length > 0 ? (
                  <div className="text-white/80">{pres.machinePartLine}</div>
                ) : null}
                {pres.processPartNameLine.length > 0 ? (
                  <div className="text-white/60">{pres.processPartNameLine}</div>
                ) : null}
                <div className="mt-0.5 text-white/50">個数 {pres.quantityLabel}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
