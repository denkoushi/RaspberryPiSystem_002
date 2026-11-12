import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { pageZoom } from './pageZoom';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import type { RefObject } from 'react';

export function usePlanningBoardTableVirtualizer(
  rootRef: RefObject<HTMLDivElement | null>,
  items: readonly GrindingPlanningBoardItem[],
  enabled: boolean,
  focusedSeiban: string | null,
  scanFocusKey: number,
  draggedItemId?: string | null
) {
  const [printing, setPrinting] = useState(() => window.matchMedia?.('print').matches ?? false);
  useEffect(() => {
    if (!enabled) return;
    const media = window.matchMedia?.('print');
    const before = () => flushSync(() => setPrinting(true));
    const after = () => flushSync(() => setPrinting(false));
    const change = () => setPrinting(media?.matches ?? false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    media?.addEventListener('change', change);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
      media?.removeEventListener('change', change);
    };
  }, [enabled]);
  const active = enabled && !printing;
  const draggedIndex = draggedItemId ? items.findIndex((item) => item.itemId === draggedItemId) : -1;
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: items.length,
    enabled: active,
    getScrollElement: () => rootRef.current?.closest<HTMLDivElement>('[data-resource-scroll]') ?? null,
    getItemKey: (index) => items[index].itemId,
    estimateSize: () => 45,
    overscan: 3,
    measureElement: (element) => element.getBoundingClientRect().height / pageZoom(),
    rangeExtractor: (range) => [...new Set([
      ...Array.from({ length: Math.min(7, items.length) }, (_, index) => index),
      ...defaultRangeExtractor(range),
      ...(draggedIndex >= 0 ? [draggedIndex] : [])
    ])].sort((a, b) => a - b)
  });
  // Rows read their index from the DOM so a reorder does not re-render unrelated memoized rows.
  const indexById = useMemo(() => new Map(items.map((item, index) => [item.itemId, index])), [items]);
  const indexByIdRef = useRef(indexById);
  indexByIdRef.current = indexById;
  const { measureElement } = virtualizer;
  const measureRow = useCallback((element: HTMLTableRowElement | null) => {
    const index = element ? indexByIdRef.current.get(element.dataset.planningBoardItemId ?? '') : undefined;
    if (element && index !== undefined) element.dataset.index = String(index);
    measureElement(element);
  }, [measureElement]);
  useLayoutEffect(() => {
    if (!active) return;
    rootRef.current?.querySelectorAll<HTMLTableRowElement>('tr[data-planning-board-item-id]').forEach((row) => {
      const index = indexById.get(row.dataset.planningBoardItemId ?? '');
      if (index !== undefined) row.dataset.index = String(index);
    });
  });
  useLayoutEffect(() => {
    if (!enabled || !focusedSeiban) return;
    const scroll = rootRef.current?.closest<HTMLElement>('[data-resource-scroll]');
    const row = rootRef.current?.querySelector<HTMLElement>('[data-seiban-focused="true"]');
    // A rendered row keeps the original measured scroll; offscreen rows need the virtualizer first.
    if (scroll && row) scroll.scrollTop += (row.getBoundingClientRect().top - scroll.getBoundingClientRect().top) / pageZoom();
    else {
      const index = items.findIndex((item) => item.fseiban === focusedSeiban);
      if (index >= 0) virtualizer.scrollToIndex(index, { align: 'start' });
    }
    // A refresh must not move a pane the user has scrolled manually.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanFocusKey]);
  if (!active) return { rows: items.map((_, index) => ({ index, paddingBefore: 0 })), bottomPadding: 0, measureRow: undefined };
  let end = 0;
  const rows = virtualizer.getVirtualItems().map((row) => {
    const paddingBefore = Math.max(0, row.start - end);
    end = row.end;
    return { index: row.index, paddingBefore };
  });
  // Keep the initial seven real rows available even before the scroll element is attached.
  if (!rows.length) return {
    rows: items.slice(0, 7).map((_, index) => ({ index, paddingBefore: 0 })),
    bottomPadding: Math.max(0, items.length - 7) * 45,
    measureRow
  };
  return { rows, bottomPadding: Math.max(0, virtualizer.getTotalSize() - end), measureRow };
}
