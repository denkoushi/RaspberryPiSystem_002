import clsx from 'clsx';
import { memo } from 'react';

import { KioskPencilGlyph } from '../../../components/kiosk/KioskPencilGlyph';
import {
  KioskResourceProcessChips,
  type KioskResourceProgressProcessChip
} from '../../../components/kiosk/resourceProgress/KioskResourceProcessChips';
import { formatDueDate } from '../productionSchedule/formatDueDate';
import { isManualDueDateSet } from '../productionSchedule/plannedDueDisplay';

import { formatLeaderBoardRequiredMinutesLabel } from './formatLeaderBoardRequiredMinutesLabel';
import { LeaderOrderRowClusterLine } from './LeaderOrderRowClusterLine';
import { LeaderOrderRowOrderSelect } from './LeaderOrderRowOrderSelect';
import { presentLeaderOrderRow } from './leaderOrderRowPresentation';

import type { LeaderBoardRow } from './types';
import type { KioskProductionScheduleCompletionIntent } from '../../../api/client';

export type LeaderOrderResourceRowProps = {
  variant?: 'interactive' | 'signage';
  resourceCd: string;
  row: LeaderBoardRow;
  /** ガント ON 時の行 min-height（px） */
  rowMinHeightPx?: number;
  /** 製番 OR フィルタ時の左縁アクセント（Tailwind リテラル） */
  seibanAccentRowClass?: string;
  orderUsageNumbers: readonly number[] | undefined;
  onOrderChange: (row: LeaderBoardRow, nextValue: string) => void;
  onCompleteRow: (rowId: string, intent: KioskProductionScheduleCompletionIntent) => void;
  completePending: boolean;
  orderPending: boolean;
  onOpenDueDatePicker?: (row: LeaderBoardRow) => void;
  dueDatePending?: boolean;
  onOpenNote?: (row: LeaderBoardRow) => void;
  notePending?: boolean;
  onOpenInspectionWorkflow?: (row: LeaderBoardRow) => void;
  onOpenSplitModal?: (row: LeaderBoardRow) => void;
  splitFeatureEnabled?: boolean;
  footerResourceChips?: readonly KioskResourceProgressProcessChip[];
};

/**
 * 資源カード内の1行。仮想リストでもメモ化しやすいよう props を明示的に分割。
 */
export const LeaderOrderResourceRow = memo(function LeaderOrderResourceRow({
  variant = 'interactive',
  resourceCd,
  row,
  rowMinHeightPx,
  seibanAccentRowClass,
  orderUsageNumbers,
  onOrderChange,
  onCompleteRow,
  completePending,
  orderPending,
  onOpenDueDatePicker,
  dueDatePending,
  onOpenNote,
  notePending,
  onOpenInspectionWorkflow,
  onOpenSplitModal,
  splitFeatureEnabled = false,
  footerResourceChips = []
}: LeaderOrderResourceRowProps) {
  const isSignage = variant === 'signage';
  const manual = isManualDueDateSet(row.dueDate);
  const dueLabel = formatDueDate(row.displayDue) || '—';
  const pres = presentLeaderOrderRow(row);
  const hasClusterTail = pres.clusterTailSegments.length > 0 || pres.quantityInlineJa != null;
  const hasCustomer = pres.customerLine.length > 0;
  const hasClusterCustomerRow = hasClusterTail || hasCustomer;
  const hasPart = pres.partNameLine.length > 0;
  const hasFseiban = pres.fseibanLine.length > 0;
  const hasPartFseibanRow = hasPart || hasFseiban;
  const pairLeftColumnClass = (hasRight: boolean) =>
    hasRight ? 'min-w-0 max-w-[50%] flex-[0_0_50%]' : 'min-w-0 flex-1';
  const hasNote = Boolean(row.note && row.note.trim().length > 0);
  const canOpenSelfInspectionWorkflow =
    !row.isSplit &&
    row.hasSelfInspectionDrawing &&
    (Boolean(row.selfInspectionEntryPath?.trim()) || Boolean(row.selfInspectionTemplateId?.trim()));
  const selfInspectionStatusClass =
    row.selfInspectionStatus === 'completed'
      ? 'border-sky-300 bg-sky-500 text-slate-950'
      : row.selfInspectionStatus === 'in_progress'
        ? 'border-yellow-300 bg-yellow-400 text-slate-950'
        : 'border-white/70 bg-white text-slate-950';
  const dueDateClass = clsx(
    'shrink-0 font-mono text-[20px] leading-tight',
    manual ? 'font-medium text-amber-200' : 'text-cyan-300/90'
  );

  return (
    <div
      className={clsx(
        'rounded bg-slate-800/80 py-1 text-[11px]',
        seibanAccentRowClass ? clsx('pl-2 pr-2', seibanAccentRowClass) : 'px-2',
        row.isCompleted && 'opacity-50 grayscale'
      )}
      style={rowMinHeightPx != null ? { minHeight: rowMinHeightPx } : undefined}
    >
      <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
        {isSignage || row.isSplit ? null : (
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
              onCompleteRow(row.sourceRowId, row.isCompleted ? 'incomplete' : 'complete');
            }}
          >
            ✓
          </button>
        )}
        {isSignage ? null : (
          <LeaderOrderRowOrderSelect
            resourceCd={resourceCd}
            currentOrder={row.processingOrder}
            usageNumbers={orderUsageNumbers}
            disabled={completePending || row.isCompleted || orderPending || Boolean(dueDatePending)}
            onChange={(nextValue) => onOrderChange(row, nextValue)}
          />
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="min-w-0 truncate font-mono text-[11px] text-white/88" title={row.fkojun.trim() || undefined}>
            {row.fkojun.trim() || '—'}
          </span>
          <span
            className="shrink-0 font-mono text-[10px] tabular-nums text-white/55"
            title="表示所要時間（分）"
          >
            {formatLeaderBoardRequiredMinutesLabel(row.requiredMinutes)}
          </span>
        </div>
        {isSignage ? (
          <span className={dueDateClass}>{dueLabel}</span>
        ) : (
          <button
            type="button"
            disabled={!onOpenDueDatePicker || dueDatePending}
            onClick={(e) => {
              e.stopPropagation();
              onOpenDueDatePicker?.(row);
            }}
            className={clsx(
              dueDateClass,
              'rounded px-1 py-0 transition-colors',
              onOpenDueDatePicker && !dueDatePending ? 'hover:bg-white/10' : 'cursor-default opacity-70'
            )}
            title={manual ? '手動納期（タップで変更）' : '表示納期（タップで変更）'}
          >
            {dueLabel}
          </button>
        )}
        {isSignage || !onOpenNote || row.isSplit ? null : (
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
        {isSignage || !canOpenSelfInspectionWorkflow ? null : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenInspectionWorkflow?.(row);
            }}
            className={clsx(
              'flex h-7 min-w-7 shrink-0 items-center justify-center rounded border px-2 text-[10px] font-bold transition-colors',
              selfInspectionStatusClass
            )}
            aria-label="検査方法を選択"
            title="検査方法を選択"
          >
            検
          </button>
        )}
        {isSignage || !splitFeatureEnabled || !onOpenSplitModal ? null : (
          <button
            type="button"
            disabled={row.isCompleted}
            title={row.isSplit ? '分割編集' : '指示数を分割'}
            aria-label={row.isSplit ? '分割編集' : '指示数を分割'}
            onClick={(e) => {
              e.stopPropagation();
              onOpenSplitModal(row);
            }}
            className="shrink-0 rounded border border-violet-300/50 px-1.5 py-0.5 text-[10px] text-violet-100 hover:bg-violet-500/20 disabled:opacity-50"
          >
            分割
          </button>
        )}
      </div>
      {hasClusterCustomerRow ? (
        <div className="flex w-full items-baseline gap-1.5">
          {hasClusterTail ? (
            <div className={pairLeftColumnClass(hasCustomer)}>
              <LeaderOrderRowClusterLine
                segments={pres.clusterTailSegments}
                quantityInlineJa={pres.quantityInlineJa}
              />
            </div>
          ) : null}
          {hasCustomer ? (
            <div className="min-w-0 flex-1 truncate text-[11px] text-white/70">{pres.customerLine}</div>
          ) : null}
        </div>
      ) : null}
      {hasPartFseibanRow ? (
        <div className="flex w-full items-baseline gap-1.5">
          {hasPart ? (
            <div
              className={clsx(
                pairLeftColumnClass(hasFseiban),
                hasFseiban ? 'truncate' : 'break-words',
                'text-[16.5px] leading-tight text-white/60'
              )}
              title={pres.partNameLine}
            >
              {pres.partNameLine}
            </div>
          ) : null}
          {hasFseiban ? (
            <div
              className={clsx(
                hasPart ? 'min-w-0 flex-1 truncate' : 'min-w-0 flex-1 break-words',
                'font-mono text-[16.5px] font-semibold leading-tight text-white/85'
              )}
            >
              {pres.fseibanLine}
            </div>
          ) : null}
        </div>
      ) : null}
      {pres.machineTypeNameLine.length > 0 ? (
        <div className="min-w-0 break-words text-[16.5px] leading-tight text-white/80">
          {pres.machineTypeNameLine}
        </div>
      ) : null}
      {footerResourceChips.length > 0 ? (
        <div className="mt-1 overflow-x-auto overflow-y-hidden border-t border-white/10 pt-1">
          <KioskResourceProcessChips processes={footerResourceChips} className="flex-nowrap" />
        </div>
      ) : null}
    </div>
  );
});
