import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { PlanningBoardGanttDisplay } from './PlanningBoardGanttDisplay';
import { buildPlanningBoardGanttLayout } from './planningBoardGanttLayout';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

vi.mock('../../../../api/hooks/machine-signal', () => ({ useMachineSignalResourceUptime: () => ({ data: undefined }) }));
const source = (itemId: string, resource: string, rank: number): GrindingPlanningBoardItem => ({
  itemId, kind: 'piece', itemRevision: 'r1', version: 1, sourceRowId: itemId, pieceId: itemId, piecePosition: rank,
  fseiban: 'S1', fhincd: 'P1', fhinmei: 'フランジ', machineName: 'MX-520', productNo: itemId, processOrder: '10',
  originalResourceCd: resource, effectiveResourceCd: null, originalDueDate: '2026-11-13', effectiveDueDate: null,
  originalRank: rank, alternateRank: rank, plannedQuantity: 1, parentPlannedQuantity: 3, quantity: 1,
  requiredMinutes: 30, unitRequiredMinutes: 30, lslhSurface: false, requiredMinutesKnown: true, isCompleted: false,
  progress: { completed: 0, total: 1, quantityKnown: true }
} as GrindingPlanningBoardItem);
const moves = vi.fn();
const reorders = vi.fn();
const clear = vi.fn();
let hit: Element[] = [];
let originalHit: PropertyDescriptor | undefined;
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  class TestPointerEvent extends MouseEvent {
    readonly pointerId = 1; readonly pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerType = init.pointerType ?? 'mouse'; }
  }
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  originalHit = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => hit });
});
afterEach(() => {
  if (originalHit) Object.defineProperty(document, 'elementsFromPoint', originalHit); else Reflect.deleteProperty(document, 'elementsFromPoint');
  vi.unstubAllGlobals();
});

function Board({ pair = false, disabled = false, outside = true }: { pair?: boolean; disabled?: boolean; outside?: boolean }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [items, setItems] = useState(() => [source('a', outside ? '503' : '305', 1), source('b', outside ? '503' : '305', 2), source('anchor', pair ? '306' : '305', 3)]);
  const layout = useMemo(() => buildPlanningBoardGanttLayout({ items, resources: ['305', '306', '503'], allocation: 'alternate', view: 'resource',
    dailyHoursByResource: {}, seibanOrder: ['S1'], today: '2026-11-05', now: new Date('2026-11-05T08:00:00+09:00'), scale: 2, mode: 'forward' }), [items]);
  const update = (id: string, resource: string, target: string | null, placement: 'before' | 'after') => setItems(current => {
    const order = current.filter(item => item.itemId !== id && (item.effectiveResourceCd ?? item.originalResourceCd) === resource)
      .sort((a, b) => a.alternateRank! - b.alternateRank!).map(item => item.itemId);
    const at = target ? order.indexOf(target) + (placement === 'after' ? 1 : 0) : order.length;
    order.splice(at, 0, id);
    return current.map(item => order.includes(item.itemId) ? { ...item, effectiveResourceCd: resource, alternateRank: order.indexOf(item.itemId) + 1,
      version: item.version + 1 } : item);
  });
  return <PlanningBoardGanttDisplay layout={layout} resourceMinutesItems={items} scale={2} dailyHoursByResource={{}} resourceNameMap={{}}
    capacityPending={false} capacityError={false} onCapacityChange={vi.fn()} onToggleItem={(item, checked) => setSelected(current => { const next = new Set(current); if (checked) next.add(item.itemId); else next.delete(item.itemId); return next; })} onDueDrop={vi.fn()}
    disabled={disabled} dragDisabled={false} selectedItemIds={selected} onClearSelection={clear} resourceView focusedSeiban={null} onFocusedSeibanChange={vi.fn()}
    colorBySeiban canMoveResource={() => true} singleResourceCd={pair ? '305+306' : '305'} resourceLanes={['305', '306', '503']}
    unitSplitEnabledByResource={{ '305': true, '306': true, '503': true }}
    onResourceMove={(item, resource, target, placement) => { moves(item.itemId, resource, target?.itemId, placement); update(item.itemId, resource, target?.itemId ?? null, placement); }}
    onResourceReorder={(item, target, placement) => { reorders(item.itemId, target.itemId, placement); update(item.itemId, target.kind === 'test' ? target.resourceCd : target.effectiveResourceCd ?? target.originalResourceCd!, target.itemId, placement); }} />;
}

function blank(pair: boolean, x = 0) {
  const region = pair ? within(screen.getByRole('region', { name: '306' })) : screen;
  const viewport = region.getByLabelText('ガントの日付と工程');
  const lane = region.getByTestId('planning-gantt-bar-anchor').closest<HTMLElement>('[data-gantt-lane]')!;
  const track = lane.querySelector('[data-gantt-track]')!;
  hit = [track, lane];
  fireEvent.pointerDown(track, { button: 0, clientX: x, clientY: 10 });
  fireEvent.pointerUp(track, { button: 0, clientX: x, clientY: 10 });
  return { viewport, track, lane };
}

it.each([false, true])('places a remaining part selection at a blank Gantt time, preserving shelf order (pair=%s)', pair => {
  render(<Board pair={pair} />);
  fireEvent.click(screen.getByRole('button', { name: 'フランジ P1 ×3' }));
  expect(screen.getByText('2件')).toBeInTheDocument();
  blank(pair);
  expect(moves.mock.calls).toEqual([['a', pair ? '306' : '305', 'anchor', 'before'], ['b', pair ? '306' : '305', 'anchor', 'before']]);
  expect(screen.queryByText('2件')).not.toBeInTheDocument();
  expect(screen.queryByText('1件')).not.toBeInTheDocument();
  expect(clear).not.toHaveBeenCalled();
});

it('reverses dispatch after the anchor so the final order follows the shelf', () => {
  render(<Board />);
  fireEvent.click(screen.getByRole('button', { name: 'フランジ P1 ×3' }));
  blank(false, 10000);
  expect(moves.mock.calls.map(call => [call[0], call[3]])).toEqual([['b', 'after'], ['a', 'after']]);
});

it('uses the existing reorder action for a tile already on the displayed machine', () => {
  render(<Board outside={false} />);
  fireEvent.click(screen.getByTestId('planning-shelf-tile-a'));
  blank(false, 10000);
  expect(reorders).toHaveBeenCalledWith('a', 'anchor', 'after');
  expect(moves).not.toHaveBeenCalled();
});

it('retains selection without writing while controls are disabled', () => {
  render(<Board disabled />);
  fireEvent.click(screen.getByTestId('planning-shelf-tile-a'));
  blank(false);
  expect(moves).not.toHaveBeenCalled();
  expect(screen.getByText('1件')).toBeInTheDocument();
});


it.each([{ pair: false, pointerType: 'mouse' }, { pair: true, pointerType: 'touch' }])('drags selected shelf tiles onto the Gantt using shared insertion feedback ($pointerType, pair=$pair)', async ({ pair, pointerType }) => {
  render(<Board pair={pair} />);
  fireEvent.click(screen.getByRole('button', { name: 'フランジ P1 ×3' }));
  const target = screen.getByTestId('planning-gantt-bar-anchor').closest('[data-gantt-lane]')!;
  hit = [target.querySelector('[data-gantt-track]')!, target];
  const tile = screen.getByTestId('planning-shelf-tile-a');
  fireEvent.pointerDown(tile, { button: 0, pointerType, clientX: 100, clientY: 400 });
  fireEvent.pointerMove(tile, { pointerType, clientX: 102, clientY: 402 });
  expect(screen.queryByTestId('planning-gantt-insertion')).not.toBeInTheDocument();
  fireEvent.pointerMove(tile, { pointerType, clientX: 0, clientY: 10 });
  expect(target).toContainElement(screen.getByTestId('planning-gantt-insertion'));
  expect(screen.getAllByTestId('planning-gantt-drag-ghost')).toHaveLength(1);
  for (let i = 0; i < 10; i++) fireEvent.pointerMove(tile, { pointerType, clientX: i, clientY: 10 });
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  fireEvent.pointerUp(tile, { button: 0, pointerType, clientX: 0, clientY: 10 });
  expect(moves.mock.calls.map(call => call[0])).toEqual(['a', 'b']);
  expect(screen.queryByTestId('planning-gantt-insertion')).not.toBeInTheDocument();
  expect(screen.queryByTestId('planning-gantt-drag-ghost')).not.toBeInTheDocument();
  fireEvent.click(tile);
  expect(screen.queryByText('1件')).not.toBeInTheDocument();
});

it.each(['cancel', 'outside', 'blur'] as const)('cancels a shelf drag without writing or losing its selection: %s', kind => {
  render(<Board pair />);
  fireEvent.click(screen.getByTestId('planning-shelf-tile-a'));
  const target = screen.getByTestId('planning-gantt-bar-anchor').closest('[data-gantt-lane]')!;
  hit = [target.querySelector('[data-gantt-track]')!, target];
  const tile = screen.getByTestId('planning-shelf-tile-a');
  fireEvent.pointerDown(tile, { button: 0, clientX: 100, clientY: 400 });
  fireEvent.pointerMove(tile, { clientX: 0, clientY: 10 });
  expect(screen.getByTestId('planning-gantt-insertion')).toBeInTheDocument();
  if (kind === 'cancel') fireEvent.pointerCancel(tile);
  else if (kind === 'blur') fireEvent(window, new Event('blur'));
  else { hit = []; fireEvent.pointerUp(tile, { button: 0, clientX: 0, clientY: 10 }); }
  expect(moves).not.toHaveBeenCalled();
  expect(screen.getByText('1件')).toBeInTheDocument();
  expect(screen.queryByTestId('planning-gantt-insertion')).not.toBeInTheDocument();
  expect(screen.queryByTestId('planning-gantt-drag-ghost')).not.toBeInTheDocument();
});


it.each([false, true])('highlights the matching shelf tile when the existing bar selection changes (pair=%s)', pair => {
  render(<Board pair={pair} />);
  fireEvent.click(screen.getByTestId('planning-gantt-bar-anchor'));
  expect(screen.getByTestId('planning-shelf-tile-anchor')).toHaveAttribute('data-highlighted');
  expect(screen.queryByText('1件')).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId('planning-gantt-bar-anchor'));
  expect(screen.getByTestId('planning-shelf-tile-anchor')).not.toHaveAttribute('data-highlighted');
});
