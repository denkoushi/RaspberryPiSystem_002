import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import { memo, useRef } from 'react';

import { KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS } from '../manualOrder/manualOrderOverviewTypography';

import { LeaderOrderResourceRow } from './LeaderOrderResourceRow';
import { LEADER_BOARD_ROW_ESTIMATE_PX, LEADER_BOARD_VIRTUAL_ROW_THRESHOLD } from './performance/leaderBoardRefetchPolicy';

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
  orderUsageNumbers: readonly number[] | undefined;
  onOrderChange: (row: LeaderBoardRow, nextValue: string) => void;
  onCompleteRow: (rowId: string) => void;
  completePending: boolean;
  orderPending: boolean;
  /** 備考の追加・編集。空行はグレー鉛筆、内容ありは色付き鉛筆（親がモーダルを開く） */
  onOpenNote?: (row: LeaderBoardRow) => void;
  notePending?: boolean;
};

function LeaderOrderResourceCardInner({
  variant = 'interactive',
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
  notePending
}: Props) {
  const jp = resourceJapaneseNames?.trim() ?? '';
  const isSignage = variant === 'signage';
  const scrollParentRef = useRef<HTMLDivElement | null>(null);

  const useVirtual = rows.length > LEADER_BOARD_VIRTUAL_ROW_THRESHOLD;

  const rowVirtualizer = useVirtualizer({
    count: useVirtual ? rows.length : 0,
    getScrollElement: () => scrollParentRef.current,
    getItemKey: (index) => rows[index]?.id ?? index,
    estimateSize: () => LEADER_BOARD_ROW_ESTIMATE_PX,
    overscan: 3,
    measureElement: (el) => el.getBoundingClientRect().height
  });

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
        'flex h-full min-h-[12rem] flex-col rounded-lg border bg-slate-900/60 p-2.5 transition-[border-color,box-shadow,opacity] outline-none',
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
        ref={scrollParentRef}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden pr-0.5"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {rows.length === 0 ? (
          <p className="rounded bg-slate-800/80 px-2 py-2 text-xs text-white/45">行なし</p>
        ) : useVirtual ? (
          <div
            className="relative w-full"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const row = rows[vi.index];
              return (
                <div
                  key={row.id}
                  data-index={vi.index}
                  ref={rowVirtualizer.measureElement}
                  className="absolute left-0 top-0 w-full pb-1"
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  <LeaderOrderResourceRow
                    variant={variant}
                    resourceCd={resourceCd}
                    row={row}
                    orderUsageNumbers={orderUsageNumbers}
                    onOrderChange={onOrderChange}
                    onCompleteRow={onCompleteRow}
                    completePending={completePending}
                    orderPending={orderPending}
                    onOpenDueDatePicker={onOpenDueDatePicker}
                    dueDatePending={dueDatePending}
                    onOpenNote={onOpenNote}
                    notePending={notePending}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="pb-1">
              <LeaderOrderResourceRow
                variant={variant}
                resourceCd={resourceCd}
                row={row}
                orderUsageNumbers={orderUsageNumbers}
                onOrderChange={onOrderChange}
                onCompleteRow={onCompleteRow}
                completePending={completePending}
                orderPending={orderPending}
                onOpenDueDatePicker={onOpenDueDatePicker}
                dueDatePending={dueDatePending}
                onOpenNote={onOpenNote}
                notePending={notePending}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export const LeaderOrderResourceCard = memo(LeaderOrderResourceCardInner);
