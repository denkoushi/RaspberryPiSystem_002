import { useState } from 'react';

import { tagDesk } from './tagDeskTheme';

import type { PositionRankRow } from './positionRankModel';
import type { KnowledgePositionRank } from '@raspi-system/shared-types';
import type { RefCallback } from 'react';

type Props = {
  rank: KnowledgePositionRank | null;
  label: string;
  rows: PositionRankRow[];
  picked: string | null;
  changed: string[];
  busy: boolean;
  onPick: (name: string) => void;
  onMove: (name: string, rank: KnowledgePositionRank) => void;
  onArrow: (row: PositionRankRow, key: 'ArrowUp' | 'ArrowDown') => void;
  chipRef: (name: string) => RefCallback<HTMLButtonElement>;
};

export function PositionRankRung({ rank, label, rows, picked, changed, busy, onPick, onMove, onArrow, chipRef }: Props) {
  const [over, setOver] = useState(false);
  const can = rank !== null && rank !== 'general';
  const target = !busy && rank !== null;
  return (
    <div
      role="group" aria-label={label}
      className={`relative grid min-h-[64px] grid-cols-[150px_minmax(0,1fr)_64px] items-center gap-3 border-t border-[#223043] px-3 py-2 ${rank === null ? 'rounded-xl border border-dashed border-[#ffb547] bg-[#3a2a12]' : ''} ${over || (picked && target) ? 'rounded-xl hover:bg-[#173847]' : ''} ${over ? 'ring-2 ring-[#4cc9f0]' : ''}`}
      onClick={() => { if (picked && target) onMove(picked, rank); }}
      onDragOver={event => { if (target) { event.preventDefault(); setOver(true); } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false); }}
      onDrop={event => { event.preventDefault(); setOver(false); if (target) onMove(event.dataTransfer.getData('text/plain'), rank); }}
    >
      {rank !== null ? <span aria-hidden className={`absolute bottom-0 left-[21px] top-0 w-0.5 ${can ? 'bg-[#24634e]' : 'bg-[#223043]'}`} /> : null}
      <button type="button" disabled={!picked || !target} aria-label={`${label}に置く`}
        className={`relative flex h-11 items-center gap-3 rounded-lg text-left font-bold disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4cc9f0] ${can ? 'text-[#34d399]' : rank === null ? 'text-[#ffb547]' : 'text-white'}`}>
        {rank !== null ? <span className={`h-[14px] w-[14px] flex-none rounded-full border-[3px] ${can ? 'border-[#34d399] bg-[#34d399]' : 'border-[#5c6d83] bg-[#0e1520]'}`} /> : null}
        {label}
      </button>
      <div className="flex min-w-0 flex-wrap gap-2">
        {rows.length === 0 ? <span className={`text-sm ${tagDesk.faint}`}>なし</span> : rows.map(row => (
          <button key={row.positionName} ref={chipRef(row.positionName)} type="button" draggable={!busy} disabled={busy}
            aria-label={`${row.positionName} ${row.employeeCount}人`} aria-pressed={picked === row.positionName}
            className={`relative inline-flex h-10 touch-manipulation select-none items-center gap-2 rounded-[10px] border px-3 text-base font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4cc9f0] ${picked === row.positionName ? 'border-[#4cc9f0] bg-[#173847] ring-2 ring-[#4cc9f0]/30' : can ? 'border-[#24634e] bg-[#10352a]' : rank === null ? 'border-[#765423] bg-[#3a2a12]' : 'border-[#223043] bg-[#131c29]'}`}
            onClick={event => { event.stopPropagation(); onPick(row.positionName); }}
            onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); onArrow(row, event.key); } }}
            onDragStart={event => { event.dataTransfer.setData('text/plain', row.positionName); event.dataTransfer.effectAllowed = 'move'; }}>
            {row.positionName}<small className={`text-xs font-medium tabular-nums ${tagDesk.mute}`}>{row.employeeCount}人</small>
            {changed.includes(row.positionName) ? <span aria-label="変更あり" className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-[#0e1520] bg-[#4cc9f0]" /> : null}
          </button>
        ))}
      </div>
      <span className={`text-right text-sm tabular-nums ${tagDesk.mute}`}>{rows.reduce((sum, row) => sum + row.employeeCount, 0)}人</span>
    </div>
  );
}
