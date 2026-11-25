import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { PlanningBoardToolbar } from '../PlanningBoardToolbar';
import { PIECE_LINKS_STORAGE_KEY } from '../usePersistedPlanningBoardPieceLinks';

import { PlanningBoardGanttDisplay } from './PlanningBoardGanttDisplay';
import { buildPlanningBoardGanttLayout } from './planningBoardGanttLayout';

import type { GrindingPlanningBoardItem, GrindingPlanningBoardTestBar } from '@raspi-system/shared-types';

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
const arrival = vi.fn();
const firstArrival = vi.fn();
const clear = vi.fn();
let hit: Element[] = [];
let originalHit: PropertyDescriptor | undefined;
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  arrival.mockReset().mockResolvedValue(true);
  firstArrival.mockReset().mockResolvedValue(true);
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

const testBar: GrindingPlanningBoardTestBar = { kind: 'test', itemId: 'test:shelf', itemRevision: 'r1', version: 1,
  sequence: 1, name: 'テスト1', resourceCd: '305', minutes: 30, alternateRank: 0, isCompleted: false, completedAt: null, deletedAt: null };

function Board({ pair = false, disabled = false, outside = true, noop = false, refresh = false, withTest = false,
  all = false, category = 'cutting', extraPieces = false, toolbar = false, pending = category === 'grinding',
  arrivalFilterEnabled = false, twoPending = false }:
  { pair?: boolean; disabled?: boolean; outside?: boolean; noop?: boolean; refresh?: boolean; withTest?: boolean;
    all?: boolean; category?: 'grinding' | 'cutting' | 'all'; extraPieces?: boolean; toolbar?: boolean;
    pending?: boolean; arrivalFilterEnabled?: boolean; twoPending?: boolean }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [items, setItems] = useState(() => [
    { ...source('a', outside ? '503' : '305', 1), arrived: !pending },
    { ...source('b', outside ? '503' : '305', 2), arrived: !twoPending, isFirstProcess: twoPending }, source('anchor', pair ? '306' : '305', 3),
    ...(extraPieces ? [
      { ...source('c', '305', 4), fhincd: 'P2' }, { ...source('d', '305', 5), fhincd: 'P2' },
      { ...source('single', '305', 6), fseiban: 'S2' }, { ...source('other-part', '305', 7), fhincd: 'P3' }
    ] : [])
  ]);
  const layout = useMemo(() => buildPlanningBoardGanttLayout({ items, testBars: withTest ? [testBar] : [], resources: ['305', '306', '503'], allocation: 'alternate', view: 'resource',
    dailyHoursByResource: {}, seibanOrder: ['S1'], today: '2026-11-05', now: new Date('2026-11-05T08:00:00+09:00'), scale: 2, mode: 'forward', arrivalFilterEnabled }), [items, withTest, arrivalFilterEnabled]);
  const update = (id: string, resource: string, target: string | null, placement: 'before' | 'after') => setItems(current => {
    const order = current.filter(item => item.itemId !== id && (item.effectiveResourceCd ?? item.originalResourceCd) === resource)
      .sort((a, b) => a.alternateRank! - b.alternateRank!).map(item => item.itemId);
    const at = target ? order.indexOf(target) + (placement === 'after' ? 1 : 0) : order.length;
    order.splice(at, 0, id);
    return current.map(item => order.includes(item.itemId) ? { ...item, effectiveResourceCd: resource, alternateRank: order.indexOf(item.itemId) + 1,
      version: item.version + 1 } : item);
  });
  const record = async (item: GrindingPlanningBoardItem, save: () => Promise<boolean>) => {
    if (!await save()) return false;
    setItems(current => current.map(candidate => candidate.itemId === item.itemId ? { ...candidate, arrived: true } : candidate));
    return true;
  };
  const capacity = { dailyHoursByResource: {}, capacityPending: false, capacityError: false, onCapacityChange: vi.fn() };
  return <>
    {toolbar && <PlanningBoardToolbar category={category} view="resource" status="incomplete" allocation="alternate"
      ganttEnabled ganttMode="forward" selectedCount={0} registeredCount={2} onOpenDrawer={vi.fn()} onCategoryChange={vi.fn()}
      onViewChange={vi.fn()} onStatusChange={vi.fn()} onAllocationChange={vi.fn()} onOpenDueEditor={vi.fn()} />}
    <PlanningBoardGanttDisplay category={category} layout={layout} minutes={{ resourceMinutesItems: refresh ? items.map(item => ({ ...item })) : items }} scale={2} capacity={capacity} resourceNameMap={{}}
    onToggleItem={(item, checked) => setSelected(current => { const next = new Set(current); if (checked) next.add(item.itemId); else next.delete(item.itemId); return next; })} onDueDrop={vi.fn()}
    disabled={disabled} dragDisabled={false} selectedItemIds={selected} onClearSelection={clear} resourceView focusedSeiban={null} onFocusedSeibanChange={vi.fn()}
    onArrivalChange={(item, recorded) => record(item, () => arrival(item.itemId, recorded))}
    onFirstProcessArrivalChange={(item, state) => record(item, () => firstArrival(item.itemId, state))}
    colorBySeiban resourceMove={{ canMoveResource: (_item, resource) => resource !== '306' || pair,
      onResourceMove: (item, resource, target, placement) => { moves(item.itemId, resource, target?.itemId, placement); if (!noop) update(item.itemId, resource, target?.itemId ?? null, placement); },
      onResourceReorder: (item, target, placement) => { reorders(item.itemId, target.itemId, placement); if (!noop) update(item.itemId, target.kind === 'test' ? target.resourceCd : target.effectiveResourceCd ?? target.originalResourceCd!, target.itemId, placement); } }}
    singleResourceCd={all ? null : pair ? '305+306' : '305'} resourceLanes={['305', '306', '503']}
    unitSplitEnabledByResource={{ '305': true, '306': true, '503': true }} /></>;
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
  expect(screen.getByText('1件')).toBeInTheDocument();
  blank(pair);
  expect(moves.mock.calls).toEqual([['a', pair ? '306' : '305', 'anchor', 'before']]);
  expect(screen.queryByText('1件')).not.toBeInTheDocument();
  expect(clear).not.toHaveBeenCalled();
});

it('reverses dispatch after the anchor so the final order follows the shelf', () => {
  render(<Board />);
  fireEvent.click(screen.getByRole('button', { name: 'フランジ P1 ×3' }));
  blank(false, 10000);
  expect(moves.mock.calls.map(call => [call[0], call[3]])).toEqual([['a', 'after']]);
});

it('uses the existing reorder action for a tile already on the displayed machine', () => {
  render(<Board outside={false} />);
  fireEvent.click(screen.getByTestId('planning-shelf-tile-a'));
  blank(false, 10000);
  expect(reorders).toHaveBeenCalledWith('a', 'anchor', 'after');
  expect(moves).not.toHaveBeenCalled();
});

it.each([true, false])('unlocks placement and dragging after an action returns without writing (move=%s)', async outside => {
  render(<Board outside={outside} noop />);
  fireEvent.click(screen.getByTestId('planning-shelf-tile-a'));
  blank(false, 10000);
  const action = outside ? moves : reorders;
  expect(action).toHaveBeenCalledTimes(1);
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  blank(false, 10000);
  expect(action).toHaveBeenCalledTimes(2);
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  const tile = screen.getByTestId('planning-shelf-tile-a');
  fireEvent.pointerDown(tile, { button: 0, clientX: 100, clientY: 400 });
  fireEvent.pointerMove(tile, { clientX: 10000, clientY: 10 });
  expect(screen.getByTestId('planning-gantt-insertion')).toBeInTheDocument();
  fireEvent.pointerUp(tile, { button: 0, clientX: 10000, clientY: 10 });
  expect(action).toHaveBeenCalledTimes(3);
  expect(screen.getByText('1件')).toBeInTheDocument();
});

it.each([false, true])('continues a shelf drag across refreshed column data (pair=%s)', pair => {
  const { rerender } = render(<Board pair={pair} />);
  const target = screen.getByTestId('planning-gantt-bar-anchor').closest('[data-gantt-lane]')!;
  hit = [target.querySelector('[data-gantt-track]')!, target];
  const tile = screen.getByTestId('planning-shelf-tile-a');
  fireEvent.pointerDown(tile, { button: 0, clientX: 100, clientY: 400 });
  fireEvent.pointerMove(tile, { clientX: 0, clientY: 10 });
  rerender(<Board pair={pair} refresh />);
  expect(screen.getByTestId('planning-gantt-insertion')).toBeInTheDocument();
  expect(screen.getByTestId('planning-gantt-drag-ghost')).toBeInTheDocument();
  fireEvent.pointerMove(tile, { clientX: 10, clientY: 10 });
  fireEvent.pointerUp(tile, { button: 0, clientX: 10, clientY: 10 });
  expect(moves).toHaveBeenCalledWith('a', pair ? '306' : '305', 'anchor', 'before');
  expect(screen.queryByTestId('planning-gantt-drag-ghost')).not.toBeInTheDocument();
});

it('rejects test-bar targets for shelf drops while retaining Gantt bar reordering', () => {
  render(<Board outside={false} withTest />);
  const target = screen.getByTestId('planning-gantt-bar-test:shelf').closest('[data-gantt-lane]')!;
  const track = target.querySelector('[data-gantt-track]')!;
  hit = [track, target];
  const tile = screen.getByTestId('planning-shelf-tile-a');
  fireEvent.pointerDown(tile, { button: 0, clientX: 100, clientY: 400 });
  fireEvent.pointerMove(tile, { clientX: -10000, clientY: 10 });
  expect(screen.getByTestId('planning-gantt-drag-ghost')).toBeInTheDocument();
  expect(screen.queryByTestId('planning-gantt-insertion')).not.toBeInTheDocument();
  fireEvent.pointerUp(tile, { button: 0, clientX: -10000, clientY: 10 });
  expect(reorders).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'フランジ P1 ×3' }));
  fireEvent.pointerDown(track, { button: 0, clientX: -10000, clientY: 10 });
  fireEvent.pointerUp(track, { button: 0, clientX: -10000, clientY: 10 });
  expect(reorders).not.toHaveBeenCalled();
  const bar = screen.getByTestId('planning-gantt-bar-a');
  fireEvent.pointerDown(bar, { button: 0, clientX: 100, clientY: 10 });
  fireEvent.pointerMove(bar, { clientX: -10000, clientY: 10 });
  expect(screen.getByTestId('planning-gantt-insertion')).toBeInTheDocument();
  fireEvent.pointerUp(bar, { button: 0, clientX: -10000, clientY: 10 });
  expect(reorders).toHaveBeenCalledWith('a', 'test:shelf', 'before');
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
  const selectionMarker = screen.getByTestId('planning-gantt-insertion');
  fireEvent.pointerMove(tile, { pointerType, clientX: 102, clientY: 402 });
  expect(screen.getByTestId('planning-gantt-insertion')).toBe(selectionMarker);
  expect(screen.queryByTestId('planning-gantt-drag-ghost')).not.toBeInTheDocument();
  fireEvent.pointerMove(tile, { pointerType, clientX: 0, clientY: 10 });
  expect(target).toContainElement(screen.getByTestId('planning-gantt-insertion'));
  expect(screen.getAllByTestId('planning-gantt-drag-ghost')).toHaveLength(1);
  for (let i = 0; i < 10; i++) fireEvent.pointerMove(tile, { pointerType, clientX: i, clientY: 10 });
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  fireEvent.pointerUp(tile, { button: 0, pointerType, clientX: 0, clientY: 10 });
  expect(moves.mock.calls.map(call => call[0])).toEqual(['a']);
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
  expect(screen.getByTestId('planning-gantt-insertion')).toBeInTheDocument();
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


it('shows arrival status on the grinding all-machine shelf and saves arrival before a shelf drag writes placement', async () => {
  render(<Board all category="grinding" />);
  const shelf = screen.getByRole('group', { name: '製番の棚' });
  const pending = within(shelf).getByTestId('planning-shelf-tile-a');
  expect(pending).toHaveClass('border-dashed');
  expect(within(shelf).getByTestId('planning-shelf-tile-b')).not.toHaveClass('border-dashed');
  fireEvent.click(screen.getByRole('button', { name: '残り' }));
  expect(pending).toBeVisible();
  expect(within(shelf).queryByTestId('planning-shelf-tile-b')).not.toBeInTheDocument();
  const target = screen.getByTestId('planning-gantt-bar-anchor').closest('[data-gantt-lane]')!;
  hit = [target.querySelector('[data-gantt-track]')!, target];
  fireEvent.pointerDown(pending, { button: 0, clientX: 100, clientY: 400 });
  fireEvent.pointerMove(pending, { clientX: 0, clientY: 10 });
  expect(target).toContainElement(screen.getByTestId('planning-gantt-insertion'));
  fireEvent.pointerUp(pending, { clientX: 0, clientY: 10 });
  await waitFor(() => expect(moves).toHaveBeenCalledWith('a', '305', 'anchor', 'before'));
  expect(arrival).toHaveBeenCalledExactlyOnceWith('a', true);
  expect(arrival.mock.invocationCallOrder[0]!).toBeLessThan(moves.mock.invocationCallOrder[0]!);
  fireEvent.click(screen.getByRole('button', { name: '製番の棚を畳む' }));
  expect(screen.getByRole('group', { name: '製番の色分け凡例' })).toBeVisible();
});

it.each(['grinding', 'cutting'] as const)('reuses drag feedback on tile selection and clears it (%s)', category => {
  render(<Board all category={category} />);
  const tile = screen.getByTestId('planning-shelf-tile-a');
  const sourceLane = screen.getByTestId('planning-gantt-bar-a').closest<HTMLElement>('[data-gantt-lane]')!;
  const otherLane = screen.getByTestId('planning-gantt-bar-anchor').closest<HTMLElement>('[data-gantt-lane]')!;
  const otherTile = screen.getByTestId('planning-shelf-tile-b');
  fireEvent.click(otherTile);
  fireEvent.click(tile);
  const marker = screen.getByTestId('planning-gantt-insertion');
  expect(sourceLane).toContainElement(marker);
  expect(sourceLane.style.outline).toBe('');
  expect(otherLane.style.outline).toBe('');
  const blockedLane = document.querySelector('[data-gantt-lane-resource="306"]');
  expect(blockedLane).toHaveStyle({ opacity: '0.3' });
  expect(screen.getByTestId('planning-gantt-drag-arrow')).toBeInTheDocument();
  expect(screen.queryByTestId('planning-gantt-drag-ghost')).not.toBeInTheDocument();
  hit = [sourceLane.querySelector('[data-gantt-track]')!, sourceLane];
  fireEvent.pointerDown(tile, { button: 0, clientX: 100, clientY: 400 });
  fireEvent.pointerMove(tile, { clientX: 0, clientY: 10 });
  expect(screen.getByTestId('planning-gantt-insertion')).toBe(marker);
  expect(screen.getByTestId('planning-gantt-drag-arrow')).toBeInTheDocument();
  fireEvent.pointerCancel(tile);
  fireEvent.click(screen.getByRole('button', { name: '選択を外す' }));
  expect(screen.queryByTestId('planning-gantt-insertion')).not.toBeInTheDocument();
  expect(screen.queryByTestId('planning-gantt-drag-arrow')).not.toBeInTheDocument();
  expect(blockedLane).toHaveStyle({ opacity: '' });
});

it.each(['grinding', 'cutting'] as const)('draws only repeated parts in distinct colors and persists the toolbar toggle (%s)', category => {
  const first = render(<Board all category={category} extraPieces toolbar />);
  const button = screen.getByRole('button', { name: '同じ部品の片を線でつなぐ' });
  expect(button).toHaveAttribute('aria-pressed', 'true');
  const paths = screen.getAllByTestId('planning-gantt-normal-piece-link');
  expect(paths.map(path => path.getAttribute('data-from-to'))).toEqual(['anchor->a', 'a->b', 'c->d']);
  expect(paths[0]).toHaveAttribute('stroke', paths[1]!.getAttribute('stroke'));
  expect(paths[0]!.getAttribute('stroke')).not.toBe(paths[2]!.getAttribute('stroke'));
  const stripes = screen.getAllByTestId('planning-gantt-piece-end-stripe');
  expect(stripes.map(stripe => stripe.getAttribute('fill'))).toEqual(paths.slice(1).flatMap(path => [path.getAttribute('stroke'), path.getAttribute('stroke')]));
  fireEvent.click(button);
  expect(screen.queryByTestId('planning-gantt-piece-end-stripe')).not.toBeInTheDocument();
  expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByTestId('planning-gantt-normal-piece-link')).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(PIECE_LINKS_STORAGE_KEY)!)).toEqual({ schemaVersion: 1, enabled: false });
  first.unmount();
  render(<Board all category={category} extraPieces toolbar />);
  const restored = screen.getByRole('button', { name: '同じ部品の片を線でつなぐ' });
  expect(restored).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByTestId('planning-gantt-normal-piece-link')).not.toBeInTheDocument();
  fireEvent.click(restored);
  expect(screen.getAllByTestId('planning-gantt-normal-piece-link')).toHaveLength(3);
});

it.each([false, true])('places the selection at the arrow target with the symbol button (pair=%s)', pair => {
  render(<Board pair={pair} />);
  expect(screen.queryByTestId('planning-shelf-place-button')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'フランジ P1 ×3' }));
  expect(screen.getByTestId('planning-gantt-drag-arrow')).toBeInTheDocument();
  const button = screen.getByTestId('planning-shelf-place-button');
  expect(button).toHaveAccessibleName('選んだ片を矢印の先へ置く');
  expect(button).toHaveTextContent('');
  expect(button.parentElement).toBe(screen.getByTestId('planning-shelf-tile-a').parentElement?.parentElement);
  expect(screen.getAllByTestId('planning-shelf-place-button')).toHaveLength(1);
  fireEvent.click(button);
  // Two-machine mode points at the first pane's (empty) lane; one machine at the head of the anchor's lane.
  expect(moves.mock.calls).toEqual(pair ? [['a', '305', undefined, 'after']]
    : [['a', '305', 'anchor', 'before']]);
  expect(screen.queryByTestId('planning-shelf-place-button')).not.toBeInTheDocument();
});

it('uses the reorder action from the button and hides it when the piece is already at the target', () => {
  render(<Board outside={false} />);
  // The arrow points before the head piece, which 'a' already occupies.
  fireEvent.click(screen.getByTestId('planning-shelf-tile-a'));
  expect(screen.getByTestId('planning-gantt-drag-arrow')).toBeInTheDocument();
  expect(screen.queryByTestId('planning-shelf-place-button')).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId('planning-shelf-tile-a'));
  fireEvent.click(screen.getByTestId('planning-shelf-tile-b'));
  fireEvent.click(screen.getByTestId('planning-shelf-place-button'));
  expect(reorders).toHaveBeenCalledWith('b', 'a', 'before');
  expect(moves).not.toHaveBeenCalled();
  expect(screen.queryByTestId('planning-shelf-place-button')).not.toBeInTheDocument();
});

it('hides the button while controls are disabled or nothing is selected', () => {
  render(<Board disabled />);
  fireEvent.click(screen.getByTestId('planning-shelf-tile-a'));
  expect(screen.queryByTestId('planning-shelf-place-button')).not.toBeInTheDocument();
});

it('hides the button when the selection has no valid arrow target', () => {
  render(<Board outside={false} withTest />);
  fireEvent.click(screen.getByTestId('planning-shelf-tile-a'));
  fireEvent.click(screen.getByTestId('planning-shelf-tile-a'));
  expect(screen.queryByTestId('planning-shelf-place-button')).not.toBeInTheDocument();
});

it.each([false, true])('selects a grinding pending chip and saves arrival before placing via the arrow button (pair=%s)', async pair => {
  render(<Board category="grinding" pair={pair} arrivalFilterEnabled />);
  const tile = screen.getByTestId('planning-shelf-tile-a');
  expect(tile).toHaveClass('border-dashed');
  fireEvent.click(tile);
  expect(tile).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('planning-gantt-drag-arrow')).toBeInTheDocument();
  fireEvent.click(screen.getByTestId('planning-shelf-place-button'));
  expect(moves).not.toHaveBeenCalled();
  await waitFor(() => expect(moves).toHaveBeenCalledTimes(1));
  expect(arrival).toHaveBeenCalledExactlyOnceWith('a', true);
  expect(arrival.mock.invocationCallOrder[0]!).toBeLessThan(moves.mock.invocationCallOrder[0]!);
  expect(tile).not.toHaveClass('border-dashed');
});

it('saves arrival before placing in the same machine via a Gantt tap', async () => {
  render(<Board category="grinding" outside={false} arrivalFilterEnabled />);
  fireEvent.click(screen.getByTestId('planning-shelf-tile-a'));
  blank(false, 10000);
  await waitFor(() => expect(reorders).toHaveBeenCalledWith('a', 'anchor', 'after'));
  expect(arrival).toHaveBeenCalledExactlyOnceWith('a', true);
  expect(arrival.mock.invocationCallOrder[0]!).toBeLessThan(reorders.mock.invocationCallOrder[0]!);
});

it.each([true, false])('saves the first-process arrival before placing and stops when saving fails (%s)', async success => {
  let finish!: (saved: boolean) => void;
  firstArrival.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; }));
  render(<Board category="grinding" twoPending arrivalFilterEnabled />);
  fireEvent.click(screen.getByRole('button', { name: 'フランジ P1 ×3' }));
  expect(screen.getByTestId('planning-shelf-tile-a')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('planning-shelf-tile-b')).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByTestId('planning-shelf-tile-a'));
  fireEvent.click(screen.getByTestId('planning-shelf-tile-b'));
  fireEvent.click(screen.getByTestId('planning-shelf-place-button'));
  expect(firstArrival).toHaveBeenCalledExactlyOnceWith('b', 'arrived');
  expect(arrival).not.toHaveBeenCalled();
  expect(moves).not.toHaveBeenCalled();
  await act(async () => { finish(success); });
  if (success) {
    await waitFor(() => expect(moves.mock.calls.map(call => call[0])).toEqual(['b']));
    expect(firstArrival.mock.invocationCallOrder[0]!).toBeLessThan(moves.mock.invocationCallOrder[0]!);
  } else {
    expect(moves).not.toHaveBeenCalled();
    expect(reorders).not.toHaveBeenCalled();
    expect(screen.getByTestId('planning-shelf-tile-b')).toHaveClass('border-dashed');
  }
});

it.each(['cutting', 'all'] as const)('keeps arrival-pending shelf placement blocked in %s', category => {
  render(<Board category={category} pending arrivalFilterEnabled />);
  const tile = screen.getByTestId('planning-shelf-tile-a');
  expect(tile).toHaveClass('border-dashed');
  fireEvent.click(tile);
  expect(screen.queryByTestId('planning-gantt-drag-arrow')).not.toBeInTheDocument();
  expect(screen.queryByTestId('planning-shelf-place-button')).not.toBeInTheDocument();
  blank(false);
  expect(arrival).not.toHaveBeenCalled();
  expect(moves).not.toHaveBeenCalled();
});
