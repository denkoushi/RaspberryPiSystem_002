import clsx from 'clsx';

import { KioskPencilGlyph } from '../../../components/kiosk/KioskPencilGlyph';
import { KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS } from '../manualOrder/manualOrderOverviewTypography';
import { formatDueDate } from '../productionSchedule/formatDueDate';
import { isManualDueDateSet } from '../productionSchedule/plannedDueDisplay';

import { LeaderOrderRowClusterLine } from './LeaderOrderRowClusterLine';
import { LeaderOrderRowOrderSelect } from './LeaderOrderRowOrderSelect';
import { presentLeaderOrderRow } from './leaderOrderRowPresentation';

import type { LeaderBoardRow } from './types';

type Props = {
  /** interactive: キオスク順位ボード（既定）。signage: 操作系UIなしの閲覧専用 */
  variant?: 'interactive' | 'signage';
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
  orderUsageByResourceCd: Record<string, number[]> | undefined;
  onOrderChange: (row: LeaderBoardRow, nextValue: string) => void;
  onCompleteRow: (rowId: string) => void;
  completePending: boolean;
  orderPending: boolean;
  /** 備考の追加・編集。空行はグレー鉛筆、内容ありは色付き鉛筆（親がモーダルを開く） */
  onOpenNote?: (row: LeaderBoardRow) => void;
  notePending?: boolean;
};

/**
 * 資源CD単位カード。グリッド行の高さに合わせて本文を伸ばし、一覧は縦スクロール。
 */
export function LeaderOrderResourceCard({
  variant = 'interactive',
  resourceCd,
  resourceJapaneseNames,
  rows,
  selected,
  dimmed,
  onSelect,
  onOpenDueDatePicker,
  dueDatePending,
  orderUsageByResourceCd,
  onOrderChange,
  onCompleteRow,
  completePending,
  orderPending,
  onOpenNote,
  notePending
}: Props) {
  const jp = resourceJapaneseNames?.trim() ?? '';
  const isSignage = variant === 'signage';

  return (
    <div
      role={isSignage ? undefined : 'group'}
      tabIndex={isSignage ? undefined : 0}
      onClick={isSignage ? undefined : onSelect}
      onKeyDown={
        isSignage
          ? undefined
          : (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect();
              }
            }
      }
      className={clsx(
        'flex h-full min-h-[12rem] flex-col rounded-lg border bg-slate-900/60 p-2.5 transition-all outline-none',
        !isSignage && 'cursor-pointer focus-visible:ring-2 focus-visible:ring-cyan-400/60',
        isSignage && 'cursor-default',
        KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS,
        selected ? 'border-cyan-300/70 shadow-[0_0_0_1px_rgba(34,211,238,0.3)]' : 'border-white/10',
        dimmed ? 'opacity-[0.52]' : 'opacity-100'
      )}
      aria-label={
        isSignage
          ? `資源 ${resourceCd}${jp ? ` ${jp}` : ''}（閲覧）`
          : selected
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
        className="min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden pr-0.5"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {rows.length === 0 ? (
          <p className="rounded bg-slate-800/80 px-2 py-2 text-xs text-white/45">行なし</p>
        ) : (
          rows.map((row) => {
            const manual = isManualDueDateSet(row.dueDate);
            const dueLabel = formatDueDate(row.displayDue) || '—';
            const pres = presentLeaderOrderRow(row);
            const hasNote = Boolean(row.note && row.note.trim().length > 0);
            return (
              <div
                key={row.id}
                className={clsx(
                  'rounded bg-slate-800/80 px-2 py-1 text-[11px]',
                  row.isCompleted && 'opacity-50 grayscale'
                )}
              >
                <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                  {isSignage ? null : (
                    <button
                      type="button"
                      className={clsx(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] shadow hover:bg-white/5 disabled:opacity-60',
                        row.isCompleted
                          ? 'border-slate-400 bg-slate-800 text-white/80'
                          : 'border-white/80 bg-slate-900 text-white'
                      )}
                      aria-label={row.isCompleted ? '未完了に戻す' : '完了にする'}
                      disabled={completePending}
                      onClick={(e) => {
                        e.stopPropagation();
                        onCompleteRow(row.id);
                      }}
                    >
                      ✓
                    </button>
                  )}
                  {isSignage ? null : (
                    <LeaderOrderRowOrderSelect
                      resourceCd={resourceCd}
                      currentOrder={row.processingOrder}
                      usageByResourceCd={orderUsageByResourceCd}
                      disabled={
                        completePending || row.isCompleted || orderPending || Boolean(dueDatePending)
                      }
                      onChange={(nextValue) => onOrderChange(row, nextValue)}
                    />
                  )}
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="min-w-0 truncate font-mono text-[11px] text-white/88" title={row.fkojun.trim() || undefined}>
                      {row.fkojun.trim() || '—'}
                    </span>
                  </div>
                  {isSignage ? (
                    <span
                      className={clsx(
                        'shrink-0 font-mono text-[10px]',
                        manual ? 'font-medium text-amber-200' : 'text-cyan-300/90'
                      )}
                    >
                      {dueLabel}
                    </span>
                  ) : (
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
                  )}
                  {isSignage || !onOpenNote ? null : (
                    <button
                      type="button"
                      disabled={notePending}
                      title={hasNote ? row.note ?? undefined : '備考を追加（タップで編集）'}
                      aria-label={hasNote ? '備考を編集。ホバーで全文を表示' : '備考を追加'}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenNote(row);
                      }}
                      className={clsx(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded border transition-colors disabled:opacity-50',
                        hasNote
                          ? 'border-2 border-yellow-400 bg-gradient-to-br from-yellow-500/55 via-amber-600/45 to-amber-800/40 text-amber-50 shadow-[0_0_0_1px_rgba(253,224,71,0.5),0_0_14px_rgba(250,204,21,0.35),inset_0_1px_0_rgba(255,255,255,0.15)] hover:from-yellow-500/65 hover:to-amber-800/50 [&_svg]:drop-shadow-[0_0_3px_rgba(254,252,232,0.5)]'
                          : 'border-white/20 bg-white/[0.07] text-white/40 hover:bg-white/15 hover:text-white/55'
                      )}
                    >
                      <KioskPencilGlyph />
                    </button>
                  )}
                </div>
                {pres.clusterSegments.length > 0 || pres.quantityInlineJa ? (
                  <LeaderOrderRowClusterLine
                    segments={pres.clusterSegments}
                    quantityInlineJa={pres.quantityInlineJa}
                  />
                ) : null}
                {pres.partNameLine.length > 0 ? (
                  <div className="text-white/60">{pres.partNameLine}</div>
                ) : null}
                {pres.machineTypeNameLine.length > 0 ? (
                  <div className="min-w-0 break-words text-[11px] text-white/80">{pres.machineTypeNameLine}</div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
