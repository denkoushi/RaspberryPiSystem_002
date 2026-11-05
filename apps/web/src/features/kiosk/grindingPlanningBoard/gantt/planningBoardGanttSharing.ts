import type { GanttLayout, GanttRow } from './planningBoardGanttLayout';

// Only the view reuses these rows. Write actions receive the current item via the view's event bridge.
// Acknowledgement metadata does not change any pixels or hit targets.
function rowSignature(row: GanttRow): string {
  return JSON.stringify({ ...row, bars: row.bars.map((bar) => {
    const item = { ...bar.item, version: undefined, itemRevision: undefined };
    return { ...bar, item };
  }) });
}

export function sharePlanningBoardGanttLayout(previous: GanttLayout | null, next: GanttLayout): GanttLayout {
  if (!previous || previous === next) return next;
  const oldGroups = new Map(previous.groups.map((group) => [group.key, group]));
  const groups = next.groups.map((group) => {
    const old = oldGroups.get(group.key);
    if (!old) return group;
    const oldRows = new Map(old.rows.map((row) => [row.key, row]));
    const rows = group.rows.map((row) => {
      const before = oldRows.get(row.key);
      return before && (before === row || rowSignature(before) === rowSignature(row)) ? before : row;
    });
    return old.label === group.label && old.resource === group.resource && old.category === group.category &&
      old.rows.length === rows.length && rows.every((row, index) => row === old.rows[index]) ? old : { ...group, rows };
  });
  return previous.start === next.start && previous.end === next.end && previous.today === next.today &&
    previous.now === next.now && previous.mode === next.mode && previous.overlapCount === next.overlapCount &&
    previous.lateCount === next.lateCount && previous.completedOnly === next.completedOnly &&
    groups.length === previous.groups.length && groups.every((group, index) => group === previous.groups[index])
    ? previous : { ...next, groups };
}
