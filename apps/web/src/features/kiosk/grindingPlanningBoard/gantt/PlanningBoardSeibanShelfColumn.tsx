import clsx from 'clsx';
import { memo } from 'react';

import { dayLabel, dateToDay } from './planningBoardGanttLayout';
import { operationSplitColor } from './planningBoardSeibanColor';

import type { SeibanShelfColumn } from './planningBoardSeibanShelfData';
import type { PointerEvent } from 'react';

type Props = {
  column: SeibanShelfColumn;
  remaining: boolean;
  focused: boolean;
  highlightedItemId: string | null;
  selected: ReadonlySet<string>;
  onFocus: (seiban: string, focused: boolean) => void;
  toggle: (ids: readonly string[]) => void;
  clickTile: (id: string) => void;
  startDrag: (event: PointerEvent<HTMLButtonElement>, id: string) => void;
  moveDrag: (event: PointerEvent<HTMLButtonElement>) => void;
  endDrag: (event: PointerEvent<HTMLButtonElement>) => void;
  clearDrag: () => void;
  cancelDrag: () => void;
};

export const PlanningBoardSeibanShelfColumn = memo(function PlanningBoardSeibanShelfColumn({
  column, remaining, focused, highlightedItemId, selected, onFocus, toggle, clickTile, startDrag, moveDrag, endDrag, clearDrag, cancelDrag
}: Props) {
  return <div data-shelf-unfocused={!focused ? '' : undefined}
    className="flex w-56 shrink-0 flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
    <button type="button" aria-label={column.seiban} aria-pressed={focused}
      onClick={() => onFocus(column.seiban, focused)}
      className={clsx('grid shrink-0 grid-cols-[1fr_auto] gap-x-1.5 rounded-t-[7px] px-2 py-1.5 text-left text-slate-950', column.color,
        focused && 'ring-inset ring-2 ring-white')}>
      <b className="font-mono text-lg font-extrabold">{column.seiban}</b><span className="self-center font-mono text-sm font-extrabold">{column.placed}/{column.total}</span>
      <span className="truncate text-xs font-bold">{column.model}</span><span className={clsx('text-right font-mono text-xs font-bold', column.late && 'rounded bg-rose-400 px-1 text-white')}>{column.due ? dayLabel(dateToDay(column.due)) : ''}</span>
    </button>
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1.5 pb-2 pt-1">
      {column.parts.map(part => {
        const units = part.units.map(connected => ({ connected, visible: remaining ? connected.filter(tile => !tile.placed) : connected })).filter(unit => unit.visible.length);
        if (!units.length) return null;
        return <div key={part.key} className="flex flex-col gap-[3px]">
          <button type="button" onClick={() => toggle(part.units.flat().filter(tile => !tile.placed).map(tile => tile.item.itemId))}
            className="flex items-baseline gap-1.5 py-0.5 text-left text-slate-200">
            <b className="max-w-28 truncate text-sm">{part.name}</b><span className="font-mono text-xs text-slate-400">{part.code}</span>
            <span className="ml-auto font-mono text-xs font-bold text-slate-400">×{part.quantity ?? '—'}</span>
          </button>
          <div className="flex flex-wrap gap-1">
            {units.map(({ visible, connected }) => <div key={connected[0]!.item.itemId} className="flex gap-px">
              {visible.map(tile => {
                const index = connected.indexOf(tile);
                const color = operationSplitColor(column.color, index);
                return <button key={tile.item.itemId} type="button" data-testid={`planning-shelf-tile-${tile.item.itemId}`}
                  aria-label={`${part.name || part.code} ${tile.item.itemId} ${tile.resource ?? '—'}`} aria-pressed={selected.has(tile.item.itemId)}
                  data-highlighted={highlightedItemId === tile.item.itemId ? '' : undefined}
                  onPointerDown={event => startDrag(event, tile.item.itemId)} onPointerMove={moveDrag} onPointerUp={endDrag}
                  onPointerCancel={cancelDrag} onLostPointerCapture={clearDrag}
                  onContextMenu={event => event.preventDefault()}
                  onClick={() => clickTile(tile.item.itemId)}
                  className={clsx('relative grid h-9 shrink-0 touch-none select-none place-items-center rounded-[5px] font-mono text-xs font-extrabold',
                    connected.length > 1 ? 'w-[30px]' : 'w-11', visible.length > 1 && 'first:rounded-r-none last:rounded-l-none [&:not(:first-child):not(:last-child)]:rounded-none',
                    !tile.placed && 'border-2 border-dashed', selected.has(tile.item.itemId) && 'z-[1] ring-[3px] ring-white',
                    highlightedItemId === tile.item.itemId && 'after:pointer-events-none after:absolute after:-inset-[5px] after:rounded-[7px] after:border-2 after:border-white')}
                  style={{ background: tile.placed ? tile.late ? '#fb7185' : color : 'transparent',
                    borderColor: color, color: tile.late ? tile.placed ? '#fff' : '#fb7185' : tile.placed ? '#020617' : color }}>{tile.resource ?? '—'}</button>;
              })}
            </div>)}
          </div>
        </div>;
      })}
    </div>
  </div>;
});
