import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { PlanningBoardPlacementContext, PlanningBoardProcessChipsContext } from '../planningBoardProcessChips';

import { buildPlanningBoardGanttLayout, planningBoardPartKey } from './planningBoardGanttLayout';
import { PlanningBoardGanttView } from './PlanningBoardGanttView';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import type { ComponentProps } from 'react';

const renders = vi.hoisted(() => [] as string[]);
vi.mock('./PlanningBoardForwardGanttRow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PlanningBoardForwardGanttRow')>();
  const { memo } = await import('react');
  return { ...actual, PlanningBoardForwardGanttRow: memo(function CountedRow(props: ComponentProps<typeof actual.PlanningBoardForwardGanttRow>) {
    renders.push(props.row.key);
    return <actual.PlanningBoardForwardGanttRow {...props} />;
  }) };
});
const item = (itemId: string, resource: string): GrindingPlanningBoardItem => ({
  itemId, kind: 'row', itemRevision: 'r1', version: 1, sourceRowId: itemId,
  fseiban: '26-1001', fhincd: itemId, fhinmei: itemId, machineName: '機種', productNo: itemId, processOrder: '10',
  originalResourceCd: resource, effectiveResourceCd: null, originalDueDate: '2026-11-10', effectiveDueDate: null,
  originalRank: 1, alternateRank: 1, plannedQuantity: 1, requiredMinutes: 60, requiredMinutesKnown: true,
  isCompleted: false, progress: { completed: 0, total: 1, quantityKnown: true }
});

it('skips acknowledged rows with fresh equal contexts and uses the latest callback and item revisions', () => {
  const items = [item('a', '305'), item('b', '306')];
  const props = { scale: 2, dailyHoursByResource: {}, resourceNameMap: {}, capacityPending: false, capacityError: false,
    onCapacityChange: vi.fn(), onToggleItem: vi.fn(), onDueDrop: vi.fn(), disabled: false, dragDisabled: false,
    selectedItemIds: new Set<string>(), resourceView: true, focusedSeiban: null, onFocusedSeibanChange: vi.fn(), colorBySeiban: true, pinMode: true };
  const draw = (items: GrindingPlanningBoardItem[], toggle: ReturnType<typeof vi.fn>) => <PlanningBoardProcessChipsContext.Provider
    value={new Map([[planningBoardPartKey(items[0]!), [{ rowId: 'a', resourceCd: '305', isCompleted: false }]]])}>
    <PlanningBoardPlacementContext.Provider value={new Map([[planningBoardPartKey(items[0]!), { shelves: [{ shelfCodeRaw: 'A', label: '棚A', placedAt: '2026-11-01' }] }]])}>
      <PlanningBoardGanttView {...props} onTogglePin={toggle} layout={buildPlanningBoardGanttLayout({ items, resources: ['305', '306'],
        allocation: 'alternate', view: 'resource', dailyHoursByResource: {}, seibanOrder: [], today: '2026-11-05',
        now: new Date('2026-11-05T08:00:00+09:00'), scale: 2, mode: 'forward' })} />
    </PlanningBoardPlacementContext.Provider>
  </PlanningBoardProcessChipsContext.Provider>;
  const oldToggle = vi.fn();
  const newToggle = vi.fn();
  const { rerender } = render(draw(items, oldToggle));
  renders.length = 0;
  const saved = items.map((item) => ({ ...item, version: 2, itemRevision: 'r2' }));
  rerender(draw(saved, newToggle));
  expect(renders).toEqual([]);
  fireEvent.click(screen.getByTestId('planning-gantt-bar-a'));
  expect(oldToggle).not.toHaveBeenCalled();
  expect(newToggle).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'a', version: 2, itemRevision: 'r2' }));
  const changed = saved.map((item) => item.itemId === 'a' ? { ...item, fhinmei: '変更後', orderPinned: true } : item);
  rerender(draw(changed, newToggle));
  expect(renders).toEqual(['305']);
  expect(screen.getByTestId('planning-gantt-bar-a')).toHaveAttribute('aria-label', expect.stringContaining('変更後'));
});
