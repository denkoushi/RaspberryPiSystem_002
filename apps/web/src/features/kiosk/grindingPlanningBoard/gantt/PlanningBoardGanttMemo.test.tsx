import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { PlanningBoardPlacementContext, PlanningBoardProcessChipsContext } from '../planningBoardProcessChips';

import { buildPlanningBoardGanttLayout, planningBoardPartKey } from './planningBoardGanttLayout';
import { PlanningBoardGanttView } from './PlanningBoardGanttView';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import type { ComponentProps } from 'react';

const uptimeQuery = vi.hoisted(() => vi.fn(() => ({ data: { resources: [{ resourceCd: '305', averageRunSeconds: 28080 }] } })));
vi.mock('../../../../api/hooks/machine-signal', () => ({ useMachineSignalResourceUptime: uptimeQuery }));

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
  originalRank: 1, alternateRank: 1, plannedQuantity: 1, requiredMinutes: 60, lslhSurface: false, requiredMinutesKnown: true,
  isCompleted: false, progress: { completed: 0, total: 1, quantityKnown: true }
});

it('skips acknowledged rows with fresh equal contexts and uses the latest callback and item revisions', async () => {
  const items = [item('a', '305'), item('b', '306')];
  const props = { scale: 2, dailyHoursByResource: {}, resourceNameMap: {}, capacityPending: false, capacityError: false,
    onCapacityChange: vi.fn(), onToggleItem: vi.fn(), onDueDrop: vi.fn(), disabled: false, dragDisabled: false,
    selectedItemIds: new Set<string>(), resourceView: true, focusedSeiban: null, onFocusedSeibanChange: vi.fn(), colorBySeiban: true, pinMode: true };
  const draw = (items: GrindingPlanningBoardItem[], toggle: ReturnType<typeof vi.fn>, selectedItemIds = new Set<string>()) => <PlanningBoardProcessChipsContext.Provider
    value={new Map([[planningBoardPartKey(items[0]!), [{ rowId: 'a', resourceCd: '305', isCompleted: false }]]])}>
    <PlanningBoardPlacementContext.Provider value={new Map([[planningBoardPartKey(items[0]!), { shelves: [{ shelfCodeRaw: 'A', label: '棚A', placedAt: '2026-11-01' }] }]])}>
      <PlanningBoardGanttView {...props} selectedItemIds={selectedItemIds} onTogglePin={toggle} layout={buildPlanningBoardGanttLayout({ items, resources: ['305', '306'],
        allocation: 'alternate', view: 'resource', dailyHoursByResource: {}, seibanOrder: [], today: '2026-11-05',
        now: new Date('2026-11-05T08:00:00+09:00'), scale: 2, mode: 'forward' })} />
    </PlanningBoardPlacementContext.Provider>
  </PlanningBoardProcessChipsContext.Provider>;
  const oldToggle = vi.fn();
  const newToggle = vi.fn();
  const { rerender } = render(draw(items, oldToggle));
  renders.length = 0;
  const viewport = screen.getByLabelText('ガントの日付と工程');
  await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
  renders.length = 0;
  viewport.scrollLeft = 1000;
  fireEvent.scroll(viewport);
  fireEvent.scroll(viewport);
  await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
  expect(renders).toEqual([]);
  const saved = items.map((item) => ({ ...item, version: 2, itemRevision: 'r2' }));
  rerender(draw(saved, newToggle));
  expect(renders).toEqual([]);
  fireEvent.click(screen.getByTestId('planning-gantt-bar-a'));
  expect(oldToggle).not.toHaveBeenCalled();
  expect(newToggle).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'a', version: 2, itemRevision: 'r2' }));
  const changed = saved.map((item) => item.itemId === 'a' ? { ...item, fhinmei: '変更後', orderPinned: true } : item);
  rerender(draw(changed, newToggle));
  expect(renders).toEqual(['305']);
  renders.length = 0;
  uptimeQuery.mockReturnValue({ data: { resources: [{ resourceCd: '305', averageRunSeconds: 28080 }] } });
  rerender(draw(changed, newToggle));
  expect(renders).toEqual([]);
  rerender(draw(changed, newToggle, new Set(['a'])));
  expect(renders).toEqual(['305']);
  expect(screen.getByTestId('planning-gantt-bar-a')).toHaveClass('outline-emerald-300');
  expect(screen.getByTestId('planning-gantt-due-a')).toHaveTextContent('▲');
  renders.length = 0;
  rerender(draw(changed, newToggle, new Set(['a', 'outside-this-board'])));
  expect(renders).toEqual([]);
  uptimeQuery.mockReturnValue({ data: { resources: [{ resourceCd: '305', averageRunSeconds: 14400 }] } });
  rerender(draw(changed, newToggle, new Set(['a'])));
  expect(screen.getByText('4.0h')).toBeInTheDocument();
  expect(screen.getByTestId('planning-gantt-bar-a')).toHaveAttribute('aria-label', expect.stringContaining('変更後'));
});

it('renders only the source and lanes whose insertion marker changes during a drag', () => {
  class TestPointerEvent extends MouseEvent {
    readonly pointerId = 1;
  }
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  const originalHitTest = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
  let hit: Element[] = [];
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => hit });
  try {
    const items = [item('a', '305'), item('b', '306'), item('c', '307')];
    render(<PlanningBoardGanttView layout={buildPlanningBoardGanttLayout({ items, resources: ['305', '306', '307'],
      allocation: 'alternate', view: 'resource', dailyHoursByResource: {}, seibanOrder: [], today: '2026-11-05',
      now: new Date('2026-11-05T08:00:00+09:00'), scale: 2, mode: 'forward' })}
      scale={2} dailyHoursByResource={{}} resourceNameMap={{}} capacityPending={false} capacityError={false}
      onCapacityChange={vi.fn()} onToggleItem={vi.fn()} onDueDrop={vi.fn()} disabled={false} dragDisabled={false}
      selectedItemIds={new Set()} resourceView focusedSeiban={null} onFocusedSeibanChange={vi.fn()} canMoveResource={() => true} />);
    const source = screen.getByTestId('planning-gantt-bar-a');
    hit = [screen.getByTestId('planning-gantt-bar-b')];
    renders.length = 0;
    fireEvent.pointerDown(source, { button: 0, clientX: 100, clientY: 10 });
    fireEvent.pointerMove(source, { clientX: 120, clientY: 30 });
    expect(renders).toEqual(['305', '306']);
    expect(source).toHaveStyle({ opacity: '0.3', outline: '3px solid rgb(251 191 36)', zIndex: '9' });
    renders.length = 0;
    fireEvent.pointerMove(source, { clientX: 121, clientY: 31 });
    expect(renders).toEqual([]);
    hit = [screen.getByTestId('planning-gantt-bar-c')];
    fireEvent.pointerMove(source, { clientX: 122, clientY: 32 });
    expect(renders).toEqual(['306', '307']);
    expect(screen.getAllByTestId('planning-gantt-insertion')).toHaveLength(1);
    expect(screen.getByTestId('planning-forward-lane-307')).toContainElement(screen.getByTestId('planning-gantt-insertion'));
    renders.length = 0;
    fireEvent.pointerCancel(source);
    expect(renders).toEqual(['305', '307']);
    expect(source.style.opacity).toBe('');
    expect(screen.queryByTestId('planning-gantt-insertion')).not.toBeInTheDocument();
  } finally {
    vi.unstubAllGlobals();
    if (originalHitTest) Object.defineProperty(document, 'elementsFromPoint', originalHitTest);
    else Reflect.deleteProperty(document, 'elementsFromPoint');
  }
});
