import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';

import { KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS } from '../manualOrder/manualOrderOverviewTypography';

import { buildLeaderBoardPartResourceProcessKey } from './buildLeaderBoardPartResourceProcessKey';
import {
  GANTT_FALLBACK_AVAILABLE_WORK_HEIGHT_PX,
  GANTT_RULER_GUTTER_WIDTH_PX,
  GANTT_VIRTUAL_OVERSCAN
} from './gantt/leaderBoardGanttConstants';
import { computeGanttSlotLayout, normalizeRulerSegmentsForRenderHeight } from './gantt/leaderBoardGanttLayout';
import { LeaderBoardGanttTickGutter } from './gantt/LeaderBoardGanttTickGutter';
import { useLeaderBoardGanttBodyHeight } from './gantt/useLeaderBoardGanttBodyHeight';
import { LeaderOrderResourceRow } from './LeaderOrderResourceRow';
import { LEADER_BOARD_ROW_ESTIMATE_PX, LEADER_BOARD_VIRTUAL_ROW_THRESHOLD } from './performance/leaderBoardRefetchPolicy';
import { resolveSeibanAccentRowClass } from './seibanAccentPalette';

import type { LeaderBoardRow } from './types';
import type { KioskProductionScheduleCompletionIntent } from '../../../api/client';
import type { KioskResourceProgressProcessChip } from '../../../components/kiosk/resourceProgress/KioskResourceProcessChips';

type Props = {
  /** interactive: キオスク順位ボード（既定）。signage: 操作系UIなしの閲覧専用 */
  variant?: 'interactive' | 'signage';
  /** ガント表示（所要量比例の行高・左 8H 目盛） */
  ganttEnabled?: boolean;
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
  orderUsageNumbers: readonly number[] | undefined;
  onOrderChange: (row: LeaderBoardRow, nextValue: string) => void;
  onCompleteRow: (rowId: string, intent: KioskProductionScheduleCompletionIntent) => void;
  completePending: boolean;
  orderPending: boolean;
  /** 備考の追加・編集。空行はグレー鉛筆、内容ありは色付き鉛筆（親がモーダルを開く） */
  onOpenNote?: (row: LeaderBoardRow) => void;
  notePending?: boolean;
  /** 製番 OR フィルタ選択時のみ行左縁に識別色（全件表示時は無色） */
  activeSeibanFilters?: readonly string[];
  footerResourceChipsByPartKey: ReadonlyMap<string, readonly KioskResourceProgressProcessChip[]>;
  /** 製番順評価 ON 時: スロットタイトルに順位自動付与ボタン */
  seibanEvalEnabled?: boolean;
  autoRankDisabled?: boolean;
  autoRankPending?: boolean;
  onAutoRank?: (resourceCd: string) => void;
};

function LeaderOrderResourceCardInner({
  variant = 'interactive',
  ganttEnabled = false,
  resourceCd,
  resourceJapaneseNames,
  rows,
  selected,
  dimmed,
  onSelect,
  onOpenDueDatePicker,
  dueDatePending,
  orderUsageNumbers,
  onOrderChange,
  onCompleteRow,
  completePending,
  orderPending,
  onOpenNote,
  notePending,
  activeSeibanFilters,
  footerResourceChipsByPartKey,
  seibanEvalEnabled = false,
  autoRankDisabled = false,
  autoRankPending = false,
  onAutoRank
}: Props) {
  const jp = resourceJapaneseNames?.trim() ?? '';
  const isSignage = variant === 'signage';
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const bodyHeightPx = useLeaderBoardGanttBodyHeight(scrollParentRef, ganttEnabled);

  const rowsWithFooter = useMemo(
    () =>
      rows.map((row) => ({
        row,
        footerChips:
          footerResourceChipsByPartKey.get(
            buildLeaderBoardPartResourceProcessKey({
              seibanJoinKey: row.seibanJoinKey,
              productNo: row.productNo,
              fhincd: row.fhincd
            })
          ) ?? []
      })),
    [rows, footerResourceChipsByPartKey]
  );

  const slotLayout = useMemo(() => {
    if (!ganttEnabled) return null;
    const availableWorkHeightPx =
      bodyHeightPx > 0 ? bodyHeightPx : GANTT_FALLBACK_AVAILABLE_WORK_HEIGHT_PX;
    return computeGanttSlotLayout({
      rows: rowsWithFooter.map(({ row, footerChips }) => ({
        requiredMinutes: row.requiredMinutes,
        hasFooterChips: footerChips.length > 0
      })),
      availableWorkHeightPx
    });
  }, [ganttEnabled, rowsWithFooter, bodyHeightPx]);

  const useVirtual = rowsWithFooter.length > LEADER_BOARD_VIRTUAL_ROW_THRESHOLD;

  const estimateSize = useCallback(
    (index: number) => {
      if (ganttEnabled && slotLayout) {
        return slotLayout.rowLayouts[index]?.estimateHeightPx ?? LEADER_BOARD_ROW_ESTIMATE_PX;
      }
      return LEADER_BOARD_ROW_ESTIMATE_PX;
    },
    [ganttEnabled, slotLayout]
  );

  const rowVirtualizer = useVirtualizer({
    count: useVirtual ? rowsWithFooter.length : 0,
    getScrollElement: () => scrollParentRef.current,
    getItemKey: (index) => rowsWithFooter[index]?.row.id ?? index,
    estimateSize,
    overscan: ganttEnabled ? GANTT_VIRTUAL_OVERSCAN : 3,
    measureElement: (el) => el.getBoundingClientRect().height
  });

  useEffect(() => {
    if (!ganttEnabled || !slotLayout || !useVirtual) return;
    rowVirtualizer.measure();
  }, [ganttEnabled, slotLayout, useVirtual, rowVirtualizer]);

  const containerMinHeightPx = ganttEnabled && slotLayout ? slotLayout.containerMinHeightPx : 0;
  const bodyTotalHeightPx = useVirtual
    ? Math.max(rowVirtualizer.getTotalSize(), containerMinHeightPx)
    : containerMinHeightPx;

  const bodyPaddingLeft = ganttEnabled ? GANTT_RULER_GUTTER_WIDTH_PX + 4 : 0;

  const rulerSegments = useMemo(() => {
    if (!ganttEnabled || !slotLayout) return [];
    const renderHeightPx = Math.max(bodyTotalHeightPx, slotLayout.rulerHeightPx);
    return normalizeRulerSegmentsForRenderHeight(slotLayout.rulerSegments, renderHeightPx);
  }, [ganttEnabled, slotLayout, bodyTotalHeightPx]);

  const renderRow = (
    row: LeaderBoardRow,
    footerChips: readonly KioskResourceProgressProcessChip[],
    index: number
  ) => (
    <LeaderOrderResourceRow
      variant={variant}
      resourceCd={resourceCd}
      row={row}
      rowMinHeightPx={
        ganttEnabled && slotLayout ? slotLayout.rowLayouts[index]?.visualMinHeightPx : undefined
      }
      seibanAccentRowClass={resolveSeibanAccentRowClass(row.fseiban, activeSeibanFilters ?? [])}
      orderUsageNumbers={orderUsageNumbers}
      onOrderChange={onOrderChange}
      onCompleteRow={onCompleteRow}
      completePending={completePending}
      orderPending={orderPending}
      onOpenDueDatePicker={onOpenDueDatePicker}
      dueDatePending={dueDatePending}
      onOpenNote={onOpenNote}
      notePending={notePending}
      footerResourceChips={footerChips}
    />
  );

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
        'flex min-h-[12rem] h-full flex-col rounded-lg border bg-slate-900/60 p-2.5 transition-[border-color,box-shadow,opacity] outline-none',
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
      <div className="mb-1.5 flex shrink-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 px-0.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-mono text-[15px] font-medium tracking-tight text-white/95">{resourceCd}</span>
          {jp.length > 0 ? (
            <span className="min-w-0 break-words text-[12px] leading-snug text-white/78">{jp}</span>
          ) : null}
        </div>
        {!isSignage && seibanEvalEnabled && onAutoRank ? (
          <button
            type="button"
            disabled={autoRankDisabled || autoRankPending}
            aria-label="順位を自動付与"
            onClick={(e) => {
              e.stopPropagation();
              onAutoRank(resourceCd);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={clsx(
              'shrink-0 rounded border px-2 py-0.5 text-[10px] font-semibold tabular-nums',
              autoRankDisabled || autoRankPending
                ? 'cursor-not-allowed border-white/15 bg-slate-900/50 text-white/40'
                : 'border-violet-300/50 bg-violet-500/25 text-violet-50 hover:bg-violet-500/40'
            )}
          >
            順位
          </button>
        ) : null}
      </div>
      <div
        ref={scrollParentRef}
        data-testid="leader-order-resource-card-body"
        className={clsx(
          'relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-0.5',
          ganttEnabled ? 'space-y-0' : 'space-y-1'
        )}
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {rowsWithFooter.length === 0 ? (
          <p className="rounded bg-slate-800/80 px-2 py-2 text-xs text-white/45">行なし</p>
        ) : useVirtual ? (
          <div
            className="relative w-full"
            style={{ minHeight: ganttEnabled ? `${bodyTotalHeightPx}px` : undefined, height: `${bodyTotalHeightPx}px` }}
          >
            {ganttEnabled && slotLayout ? (
              <LeaderBoardGanttTickGutter
                totalHeightPx={Math.max(bodyTotalHeightPx, slotLayout.rulerHeightPx)}
                rulerSegments={rulerSegments}
              />
            ) : null}
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const { row, footerChips } = rowsWithFooter[vi.index];
              return (
                <div
                  key={row.id}
                  data-index={vi.index}
                  data-testid={ganttEnabled ? 'leader-order-resource-card-virtual-row' : undefined}
                  ref={rowVirtualizer.measureElement}
                  className="absolute top-0 pb-1"
                  style={{
                    transform: `translateY(${vi.start}px)`,
                    left: ganttEnabled ? bodyPaddingLeft : 0,
                    width: ganttEnabled ? `calc(100% - ${bodyPaddingLeft}px)` : '100%'
                  }}
                >
                  {renderRow(row, footerChips, vi.index)}
                </div>
              );
            })}
          </div>
        ) : ganttEnabled && slotLayout ? (
          <div
            className="relative w-full"
            style={{
              minHeight: `${bodyTotalHeightPx}px`,
              paddingLeft: bodyPaddingLeft
            }}
          >
            <LeaderBoardGanttTickGutter
              totalHeightPx={Math.max(bodyTotalHeightPx, slotLayout.rulerHeightPx)}
              rulerSegments={rulerSegments}
            />
            {rowsWithFooter.map(({ row, footerChips }, index) => (
              <div key={row.id} className="pb-1">
                {renderRow(row, footerChips, index)}
              </div>
            ))}
          </div>
        ) : (
          rowsWithFooter.map(({ row, footerChips }, index) => (
            <div key={row.id} className="pb-1">
              {renderRow(row, footerChips, index)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export const LeaderOrderResourceCard = memo(LeaderOrderResourceCardInner);
