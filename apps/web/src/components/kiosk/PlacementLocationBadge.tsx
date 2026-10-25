import clsx from 'clsx';
import { useId, useRef, useState } from 'react';

import { formatKioskActiveLoanBorrowedAt } from '../../features/kiosk/formatKioskActiveLoanBorrowedAt';

import { AnchoredDropdownPortal } from './AnchoredDropdownPortal';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

type Props = { placement: NonNullable<GrindingPlanningBoardItem['placement']>; className?: string };
const formatPlacedAt = (value: string) => formatKioskActiveLoanBorrowedAt(new Date(value)).replace(/^\d{4}\//, '');

export function PlacementLocationBadge({ placement, className }: Props) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const [first, ...rest] = placement.shelves;
  if (!first) return null;
  const tone = 'border-sky-400/70 bg-sky-500/20 text-sky-100';
  const body = <>
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-2.5 w-2.5 shrink-0 fill-current"><path d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5c0 3.2 4.5 8.5 4.5 8.5s4.5-5.3 4.5-8.5A4.5 4.5 0 0 0 8 1.5Zm0 6.2A1.7 1.7 0 1 1 8 4.3a1.7 1.7 0 0 1 0 3.4Z" /></svg>
    <span>{first.label}</span>
    {rest.length > 0 ? <span className="font-bold">+{rest.length}</span> : null}
  </>;
  const base = 'inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded border px-1 py-0.5 text-[10px] leading-none';
  const title = `${first.label} ${formatPlacedAt(first.placedAt)}`;
  if (rest.length === 0) return <span className={clsx('pointer-events-auto', base, tone, className)} title={title}
    onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>{body}</span>;
  return (
    <details className={clsx('pointer-events-auto relative inline-block shrink-0', className)}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <summary ref={anchorRef} title={title} aria-controls={panelId}
        className={clsx(base, tone, 'cursor-pointer list-none [&::-webkit-details-marker]:hidden')}>{body}</summary>
      <AnchoredDropdownPortal isOpen={open} id={panelId} ariaLabel={placement.shelves.map((shelf) => shelf.label).join('、')}
        anchorRef={anchorRef} panelRef={panelRef} offsetY={4}
        className="pointer-events-auto min-w-max rounded-md border border-slate-600 bg-slate-900 p-1 shadow-lg">
        {placement.shelves.map((shelf) => (
          <div key={shelf.shelfCodeRaw} className="flex items-center justify-between gap-3 rounded px-2 py-1 text-[11px] text-slate-100">
            <span className="font-semibold">{shelf.label}</span>
            <time dateTime={shelf.placedAt} className="font-mono text-slate-400">{formatPlacedAt(shelf.placedAt)}</time>
          </div>
        ))}
      </AnchoredDropdownPortal>
    </details>
  );
}
