import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildPlanningBoardGanttLayout } from '../gantt/planningBoardGanttLayout';
import { PlanningBoardGanttView } from '../gantt/PlanningBoardGanttView';
import { PlanningBoardBulkEditDialog } from '../PlanningBoardBulkEditDialog';
import { PlanningBoardItemTable } from '../PlanningBoardItemTable';
import { formatPlanningBoardItemMinutes, formatPlanningBoardLoadSummary } from '../planningBoardLoad';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

vi.mock('../../../../api/hooks/machine-signal', () => ({ useMachineSignalResourceUptime: () => ({ data: undefined }) }));

const item = (kind: GrindingPlanningBoardItem['kind'], requiredMinutes: number): GrindingPlanningBoardItem => ({
  itemId: 'a', kind, itemRevision: 'r1', version: 1, sourceRowId: 'a', parentItemId: kind === 'piece' ? 'parent' : undefined,
  fseiban: '26-1001', fhincd: 'P1', fhinmei: '部品', machineName: '機種', productNo: '1', processOrder: '10',
  originalResourceCd: '305', effectiveResourceCd: null, originalDueDate: '2026-10-16', effectiveDueDate: null,
  originalRank: null, alternateRank: null, plannedQuantity: 1, requiredMinutes, lslhSurface: false, requiredMinutesKnown: true,
  isCompleted: false, progress: { completed: 0, total: 1, quantityKnown: true }
});

describe('planning board required minutes display', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([[120, '120分'], [0, '0分'], [133.33333333333334, '133.3分'], [133.36, '133.4分'], [133.01, '133.0分']])('formats aggregate load %s without changing integer labels', (minutes, label) => {
    expect(formatPlanningBoardLoadSummary(Number(minutes), 0)).toBe(label);
    expect(formatPlanningBoardLoadSummary(Number(minutes), 2)).toBe(`${label} + 不明2件`);
  });

  it.each([
    ['row', 120, '120分'],
    ['row', 33.333333333333336, '33.333333333333336分'],
    ['piece', 120, '120分'],
    ['piece', 0, '0分'],
    ['piece', 33.333333333333336, '33.3分']
  ] as const)('formats %s %s only for display', (kind, minutes, label) => {
    const value = item(kind, minutes);
    expect(formatPlanningBoardItemMinutes(value)).toBe(label);
    render(<PlanningBoardItemTable items={[value]} allocation="alternate" selectedItemIds={new Set()}
      onToggleItem={vi.fn()} onResourceClick={vi.fn()} tableLabel="工程" />);
    expect(screen.getByTestId('planning-board-item-a')).toHaveTextContent(label);
    expect(value.requiredMinutes).toBe(minutes);
  });

  it.each([
    ['row', '133.3分'],
    ['piece', '133.3分']
  ] as const)('formats projected bulk load for %s without rounding stored minutes', (kind, label) => {
    const value = item(kind, 100 / 3);
    render(<PlanningBoardBulkEditDialog editorOpen editorPending={false} setEditorOpen={vi.fn()}
      editorItems={[value]} editorError={null} editorConflict={false} refreshAfterConflict={vi.fn()}
      allocation="alternate" writeBlocked={false} editorSnapshot={{ resources: ['305', '584'] }} canMoveResource={() => true}
      data={{ resourceCategories: { '305': 'cutting', '584': 'cutting' } }} resourceChoice="584" setResourceChoice={vi.fn()}
      loadQuery={{ data: { load: [{ resourceCd: '584', originalItemCount: 1, alternateItemCount: 1,
        originalRequiredMinutes: 100, alternateRequiredMinutes: 100, requiredMinutes: 100, unfinishedItemCount: 1,
        unknownItemCount: 0, originalUnknownItemCount: 0, alternateUnknownItemCount: 0 }], unknownRequiredMinutesCount: 0 } }}
      dueMode="none" setDueMode={vi.fn()} dueDate="" setDueDate={vi.fn()} offsetDays="1" setOffsetDays={vi.fn()} applyEditor={vi.fn()} />);
    expect(screen.getByText(`移動後負荷: ${label}`)).toBeInTheDocument();
    expect(value.requiredMinutes).toBe(100 / 3);
  });
  it.each([
    ['row', '333.3333333333333分'],
    ['piece', '333.3分']
  ] as const)('uses the same %s label in the forward bar and queue', (kind, label) => {
    class MousePointerEvent extends MouseEvent { readonly pointerType = 'mouse'; }
    vi.stubGlobal('PointerEvent', MousePointerEvent);
    const value = item(kind, 333.3333333333333);
    const layout = buildPlanningBoardGanttLayout({ items: [value], mode: 'forward', allocation: 'alternate', view: 'resource',
      seibanOrder: [], resources: ['305'], dailyHoursByResource: {}, runsThroughBreaks: new Set(['305']), today: '2026-10-14',
      now: new Date('2026-10-14T08:00:00+09:00'), scale: 4 });
    render(<PlanningBoardGanttView layout={layout} scale={4} dailyHoursByResource={{}} resourceNameMap={{}}
      capacityPending={false} capacityError={false} onCapacityChange={vi.fn()} onBreaksChange={vi.fn()}
      onToggleItem={vi.fn()} onDueDrop={vi.fn()} disabled={false} dragDisabled={false}
      selectedItemIds={new Set()} resourceView focusedSeiban={null} onFocusedSeibanChange={vi.fn()} />);
    const bar = screen.getByTestId('planning-gantt-bar-a');
    expect(bar).toHaveTextContent(label);
    fireEvent.pointerEnter(bar);
    expect(screen.getByTestId('planning-forward-queue-card-a')).toHaveTextContent(label);
    expect(value.requiredMinutes).toBe(333.3333333333333);
  });
});
