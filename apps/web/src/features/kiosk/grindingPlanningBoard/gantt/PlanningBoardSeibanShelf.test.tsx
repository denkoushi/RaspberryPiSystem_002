import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { PlanningBoardSeibanShelf } from './PlanningBoardSeibanShelf';
import { buildPlanningBoardSeibanShelf } from './planningBoardSeibanShelfData';
import { SEIBAN_SHELF_STORAGE_KEY, usePersistedPlanningBoardShelf } from './usePersistedPlanningBoardShelf';

import type { GanttBar } from './planningBoardGanttLayout';
import type { SeibanShelfHandle } from './usePlanningBoardShelfInteraction';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import type { ComponentProps } from 'react';

const columnRenders = vi.hoisted(() => [] as string[]);
vi.mock('./PlanningBoardSeibanShelfColumn', async importOriginal => {
  const actual = await importOriginal<typeof import('./PlanningBoardSeibanShelfColumn')>();
  const { memo } = await import('react');
  return { PlanningBoardSeibanShelfColumn: memo(function CountedColumn(props: ComponentProps<typeof actual.PlanningBoardSeibanShelfColumn>) {
    columnRenders.push(props.column.seiban);
    return <actual.PlanningBoardSeibanShelfColumn {...props} />;
  }) };
});

const items = ['a', 'b', 'c'].map((itemId, index) => ({ itemId, kind: 'piece', fseiban: 'S1', fhincd: 'P1',
  fhinmei: 'フランジ', machineName: 'MX-520', productNo: '1', processOrder: '10', parentPlannedQuantity: 2,
  pieceId: index < 2 ? 'u1' : 'u2', piecePosition: index < 2 ? 1 : 2,
  opRange: index < 2 ? { fromOpNo: index + 1, toOpNo: index + 1 } : null,
  originalResourceCd: index === 0 ? '021' : index === 1 ? '503' : null, effectiveResourceCd: null,
  originalDueDate: '2026-11-13', effectiveDueDate: null
} as GrindingPlanningBoardItem));
const colors = new Map([['S1', 'bg-sky-400']]);
const columns = buildPlanningBoardSeibanShelf(items, [{ item: items[1], tone: 'late' }] as GanttBar[], ['021'], colors);
const props = { columns, seibanColors: colors, focusedSeiban: null, highlightedItemId: null,
  onFocusedSeibanChange: vi.fn(), onFocusSeiban: vi.fn() };
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); columnRenders.length = 0; });
afterEach(() => vi.restoreAllMocks());

it('renders model, due, counts, linked operation tiles, resources, and lateness', () => {
  render(<PlanningBoardSeibanShelf {...props} />);
  expect(screen.getByRole('button', { name: 'S1' })).toHaveTextContent('S11/3MX-52011/13');
  expect(screen.getByText('×2')).toBeInTheDocument();
  const first = screen.getByTestId('planning-shelf-tile-a');
  const last = screen.getByTestId('planning-shelf-tile-b');
  expect(first.parentElement).toBe(last.parentElement);
  expect(first).toHaveStyle({ background: '#38bdf8', color: '#020617' });
  expect(last).toHaveClass('border-dashed');
  expect(last).toHaveStyle({ color: '#fb7185' });
  expect(screen.getByTestId('planning-shelf-tile-c')).toHaveTextContent('—');
});

it('toggles selection, selects remaining part tiles, filters only unplaced tiles, and clears selection', () => {
  render(<PlanningBoardSeibanShelf {...props} />);
  fireEvent.click(screen.getByTestId('planning-shelf-tile-a'));
  expect(screen.getByText('1件')).toBeInTheDocument();
  fireEvent.click(screen.getByTestId('planning-shelf-tile-a'));
  expect(screen.queryByText('1件')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'フランジ P1 ×2' }));
  expect(screen.getByText('2件')).toBeInTheDocument();
  expect(screen.getByTestId('planning-shelf-tile-a')).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('button', { name: '残り', exact: true }));
  expect(screen.queryByTestId('planning-shelf-tile-a')).not.toBeInTheDocument();
  expect(screen.getByTestId('planning-shelf-tile-b')).toBeVisible();
  expect(screen.getByText('2件')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '選択を外す' }));
  expect(screen.queryByText('2件')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'すべて', exact: true }));
  expect(screen.getByTestId('planning-shelf-tile-a')).toBeVisible();
});

it('uses the legend focus behavior and highlights only the selected bar item', () => {
  const { rerender } = render(<PlanningBoardSeibanShelf {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'S1' }));
  expect(props.onFocusSeiban).toHaveBeenCalledWith('S1');
  rerender(<PlanningBoardSeibanShelf {...props} focusedSeiban="S1" highlightedItemId="b" />);
  fireEvent.click(screen.getByRole('button', { name: 'S1' }));
  expect(props.onFocusedSeibanChange).toHaveBeenCalledWith(null);
  expect(screen.getByTestId('planning-shelf-tile-b')).toHaveAttribute('data-highlighted');
  expect(screen.getByTestId('planning-shelf-tile-a')).not.toHaveAttribute('data-highlighted');
});

it('collapses to the unchanged legend and persists across remounts, then opens', () => {
  const view = render(<PlanningBoardSeibanShelf {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '製番の棚を畳む' }));
  expect(screen.queryByRole('group', { name: '製番の棚' })).not.toBeInTheDocument();
  expect(within(screen.getByRole('group', { name: '製番の色分け凡例' })).getByRole('button', { name: 'S1' })).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(SEIBAN_SHELF_STORAGE_KEY)!)).toEqual({ schemaVersion: 1, open: false });
  view.unmount(); render(<PlanningBoardSeibanShelf {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '製番の棚を開く' }));
  expect(screen.getByRole('group', { name: '製番の棚' })).toBeVisible();
});

it.each(['{', 'null', '{"schemaVersion":2,"open":false}', '{"schemaVersion":1,"open":"false"}'])('opens on invalid saved state: %s', saved => {
  localStorage.setItem(SEIBAN_SHELF_STORAGE_KEY, saved);
  expect(renderHook(usePersistedPlanningBoardShelf).result.current.open).toBe(true);
});

it('keeps working when storage reads and writes fail', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  const { result } = renderHook(usePersistedPlanningBoardShelf);
  expect(result.current.open).toBe(true);
  act(() => result.current.changeOpen(false));
  expect(result.current.open).toBe(false);
});

it.each([false, true])('waits for the existing write queue and retains unsaved selection on failure (failed=%s)', failed => {
  const interactionRef = createRef<SeibanShelfHandle>();
  const move = vi.fn();
  const actions = { move, reorder: vi.fn(), canMove: () => true };
  const getDrop = () => ({ resource: '021', bar: { item: items[0] } as GanttBar, placement: 'before' as const, left: 0 });
  const draw = (members: GrindingPlanningBoardItem[], writePending = false) => <PlanningBoardSeibanShelf {...props}
    columns={buildPlanningBoardSeibanShelf(members, [], ['021'], colors)} interactionRef={interactionRef} getDrop={getDrop}
    actions={actions} resources={['021']} writePending={writePending} />;
  const { rerender } = render(draw(items));
  fireEvent.click(screen.getByRole('button', { name: 'フランジ P1 ×2' }));
  act(() => { expect(interactionRef.current!.placeAt(10, 10)).toBe(true); });
  expect(move).toHaveBeenCalledTimes(1);
  // An optimistic resource/rank change is not a save acknowledgement.
  const optimistic = items.map(item => item.itemId === 'b' ? { ...item, effectiveResourceCd: '021', alternateRank: 1 } : item);
  rerender(draw(optimistic, true));
  expect(move).toHaveBeenCalledTimes(1);
  expect(screen.getByText('2件')).toBeInTheDocument();
  const saved = items.map(item => item.itemId === 'b' ? { ...item, effectiveResourceCd: '021', itemRevision: 'saved', version: 2 } : item);
  rerender(draw(failed ? items : saved));
  expect(move).toHaveBeenCalledTimes(failed ? 1 : 2);
  expect(screen.getByText(failed ? '2件' : '1件')).toBeInTheDocument();
  if (failed) {
    act(() => { expect(interactionRef.current!.placeAt(10, 10)).toBe(true); });
    expect(move).toHaveBeenCalledTimes(2);
  }
});

const manyItems = Array.from({ length: 12 }, (_, index) => ({ ...items[0]!, itemId: `item-${index}`, fseiban: `S${index}`, originalResourceCd: null }));
const manyColors = new Map(manyItems.map(item => [item.fseiban, 'bg-sky-400']));
const manyColumns = buildPlanningBoardSeibanShelf(manyItems, [], ['021'], manyColors);
const manyProps = { ...props, columns: manyColumns, seibanColors: manyColors };
const nextFrame = () => act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
const measureShelf = () => vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
  return this.getAttribute('aria-label') === '製番の棚' ? 464 : 0;
});

it('mounts only visible columns plus two on each side and batches passive scroll events in one frame', async () => {
  measureShelf();
  const addListener = vi.spyOn(HTMLElement.prototype, 'addEventListener');
  render(<PlanningBoardSeibanShelf {...manyProps} />);
  expect(addListener).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
  expect(columnRenders.slice(-4)).toEqual(['S0', 'S1', 'S2', 'S3']);
  expect(screen.queryByRole('button', { name: 'S4', exact: true })).not.toBeInTheDocument();
  const strip = screen.getByRole('group', { name: '製番の棚' });
  const raf = vi.spyOn(window, 'requestAnimationFrame');
  // The previous column ends exactly here; its trailing gap is not a visible column.
  strip.scrollLeft = 5 * 232;
  fireEvent.scroll(strip);
  fireEvent.scroll(strip);
  expect(raf).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('planning-shelf-tile-item-5')).not.toBeInTheDocument();
  await nextFrame();
  expect(screen.queryByTestId('planning-shelf-tile-item-2')).not.toBeInTheDocument();
  expect(screen.getByTestId('planning-shelf-tile-item-3')).toBeInTheDocument();
  expect(screen.getByTestId('planning-shelf-tile-item-8')).toBeInTheDocument();
  expect(screen.queryByTestId('planning-shelf-tile-item-9')).not.toBeInTheDocument();
  expect(strip.firstElementChild).toHaveStyle({ width: `${3 * 232 - 8}px` });
  expect(strip.lastElementChild).toHaveStyle({ width: `${3 * 232 - 8}px` });
});

it('reveals an offscreen focused seiban or highlighted bar, and leaves manual scrolling alone', async () => {
  measureShelf();
  const { rerender } = render(<PlanningBoardSeibanShelf {...manyProps} />);
  const strip = screen.getByRole('group', { name: '製番の棚' });
  rerender(<PlanningBoardSeibanShelf {...manyProps} focusedSeiban="S10" />);
  expect(strip.scrollLeft).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'S10', exact: true })).toHaveAttribute('aria-pressed', 'true');
  strip.scrollLeft = 0;
  fireEvent.scroll(strip);
  await nextFrame();
  expect(strip.scrollLeft).toBe(0);
  expect(screen.queryByRole('button', { name: 'S10', exact: true })).not.toBeInTheDocument();
  rerender(<PlanningBoardSeibanShelf {...manyProps} focusedSeiban="S10" highlightedItemId="item-11" />);
  expect(strip.scrollLeft).toBeGreaterThan(0);
  expect(screen.getByTestId('planning-shelf-tile-item-11')).toHaveAttribute('data-highlighted');
  rerender(<PlanningBoardSeibanShelf {...manyProps} highlightedItemId="item-0" />);
  expect(strip.scrollLeft).toBe(0);
  expect(screen.getByTestId('planning-shelf-tile-item-0')).toHaveAttribute('data-highlighted');
});

it('rerenders only columns whose local selection, bar highlight or focus changes', () => {
  measureShelf();
  const { rerender } = render(<PlanningBoardSeibanShelf {...manyProps} />);
  columnRenders.length = 0;
  fireEvent.click(screen.getByTestId('planning-shelf-tile-item-0'));
  expect(columnRenders).toEqual(['S0']);
  columnRenders.length = 0;
  fireEvent.click(screen.getByTestId('planning-shelf-tile-item-1'));
  expect(columnRenders).toEqual(['S1']);
  columnRenders.length = 0;
  rerender(<PlanningBoardSeibanShelf {...manyProps} highlightedItemId="item-0" />);
  expect(columnRenders).toEqual(['S0']);
  columnRenders.length = 0;
  rerender(<PlanningBoardSeibanShelf {...manyProps} highlightedItemId="item-1" />);
  expect(columnRenders).toEqual(['S0', 'S1']);
  columnRenders.length = 0;
  rerender(<PlanningBoardSeibanShelf {...manyProps} highlightedItemId="item-1" focusedSeiban="S1" />);
  expect(columnRenders).toEqual(['S1']);
  columnRenders.length = 0;
  fireEvent.click(screen.getByRole('button', { name: '選択を外す' }));
  expect(columnRenders).toEqual(['S0', 'S1']);
});

it('retains offscreen tile selections across window unmounts and reopening', async () => {
  measureShelf();
  render(<PlanningBoardSeibanShelf {...manyProps} />);
  fireEvent.click(screen.getByTestId('planning-shelf-tile-item-0'));
  const strip = screen.getByRole('group', { name: '製番の棚' });
  strip.scrollLeft = 8 + 8 * 232;
  fireEvent.scroll(strip);
  await nextFrame();
  expect(screen.queryByTestId('planning-shelf-tile-item-0')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '製番の棚を畳む' }));
  fireEvent.click(screen.getByRole('button', { name: '製番の棚を開く' }));
  expect(screen.getByTestId('planning-shelf-tile-item-0')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('1件')).toBeInTheDocument();
});

it('reveals a pressed overscan header and adjusts the window on resize and filtering near the end', async () => {
  const width = measureShelf();
  const partlyPlaced = manyItems.map((item, index) => index < 10 ? { ...item, originalResourceCd: '021' } : item);
  const columns = buildPlanningBoardSeibanShelf(partlyPlaced, [], ['021'], manyColors);
  render(<PlanningBoardSeibanShelf {...manyProps} columns={columns} />);
  const strip = screen.getByRole('group', { name: '製番の棚' });
  fireEvent.click(screen.getByRole('button', { name: 'S3', exact: true }));
  expect(props.onFocusSeiban).toHaveBeenCalledWith('S3');
  expect(strip.scrollLeft).toBeGreaterThan(0);
  strip.scrollLeft = 8 + 10 * 232;
  fireEvent.scroll(strip);
  await nextFrame();
  expect(screen.queryByTestId('planning-shelf-tile-item-0')).not.toBeInTheDocument();
  width.mockImplementation(function (this: HTMLElement) { return this === strip ? 12 * 232 + 8 : 0; });
  fireEvent(window, new Event('resize'));
  await nextFrame();
  expect(strip.scrollLeft).toBe(0);
  expect(screen.getByTestId('planning-shelf-tile-item-0')).toBeInTheDocument();
  width.mockImplementation(function (this: HTMLElement) { return this === strip ? 464 : 0; });
  strip.scrollLeft = 8 + 10 * 232;
  fireEvent.scroll(strip);
  await nextFrame();
  fireEvent.click(screen.getByRole('button', { name: '残り', exact: true }));
  expect(strip.scrollLeft).toBe(8);
  expect(screen.getByTestId('planning-shelf-tile-item-10')).toBeInTheDocument();
  expect(screen.getByTestId('planning-shelf-tile-item-11')).toBeInTheDocument();
  expect(screen.queryByTestId('planning-shelf-tile-item-0')).not.toBeInTheDocument();
});
