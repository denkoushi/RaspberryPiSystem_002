import { useLayoutEffect, useMemo, useRef } from 'react';

import type { GanttRow } from './planningBoardGanttLayout';

/** Give each rendered row its own selected-id set and keep it identical while that row's selection is unchanged. */
export function usePlanningBoardRowSelections(groups: readonly { rows: readonly GanttRow[] }[], selectedItemIds: ReadonlySet<string>, empty: ReadonlySet<string>) {
  const previousRowSelections = useRef(new Map<string, ReadonlySet<string>>());
  const rowSelections = useMemo(() => new Map(groups.flatMap((group) => group.rows.map((row) => {
    const next = new Set(row.bars.filter((bar) => selectedItemIds.has(bar.item.itemId)).map((bar) => bar.item.itemId));
    const previous = previousRowSelections.current.get(row.key);
    const selected = next.size === 0 ? empty
      : previous && next.size === previous.size && [...next].every((id) => previous.has(id)) ? previous : next;
    return [row.key, selected] as const;
  }))), [groups, selectedItemIds, empty]);
  useLayoutEffect(() => { previousRowSelections.current = rowSelections; }, [rowSelections]);
  return rowSelections;
}
