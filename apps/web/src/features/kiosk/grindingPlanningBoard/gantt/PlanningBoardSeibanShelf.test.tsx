import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { PlanningBoardSeibanShelf } from './PlanningBoardSeibanShelf';
import { buildPlanningBoardSeibanShelf } from './planningBoardSeibanShelfData';
import { SEIBAN_SHELF_STORAGE_KEY, usePersistedPlanningBoardShelf } from './usePersistedPlanningBoardShelf';
import { SHELF_COLUMN_STRIDE } from './usePlanningBoardShelfWindow';

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
const searchableItems = [
  ...items,
  { ...items[0]!, itemId: 'd', fseiban: 'S21', machineName: 'MX-12' },
  { ...items[2]!, itemId: 'e', fseiban: 'S30', machineName: 'ＭＸ－１Ａ２' }
];
const searchableColors = new Map(searchableItems.map(item => [item.fseiban, 'bg-sky-400']));
const searchProps = { ...props, seibanColors: searchableColors,
  columns: buildPlanningBoardSeibanShelf(searchableItems, [], ['021'], searchableColors) };
const pressShelfDigits = (...digits: string[]) => {
  const tenkey = within(screen.getByRole('group', { name: '数字テンキー' }));
  for (const digit of digits) fireEvent.click(tenkey.getByRole('button', { name: digit, exact: true }));
};
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

it('selects only the first unplaced tile from a part header, then deselects it, and filters only unplaced tiles', () => {
  render(<PlanningBoardSeibanShelf {...props} />);
  fireEvent.click(screen.getByTestId('planning-shelf-tile-a'));
  fireEvent.click(screen.getByRole('button', { name: 'フランジ P1 ×2' }));
  expect(screen.getByText('1件')).toBeInTheDocument();
  expect(screen.getByTestId('planning-shelf-tile-a')).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByTestId('planning-shelf-tile-b')).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'フランジ P1 ×2' }));
  expect(screen.queryByText('1件')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'フランジ P1 ×2' }));
  fireEvent.click(screen.getByRole('button', { name: '残り', exact: true }));
  expect(screen.queryByTestId('planning-shelf-tile-a')).not.toBeInTheDocument();
  expect(screen.getByTestId('planning-shelf-tile-b')).toBeVisible();
  expect(screen.getByText('1件')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '選択を外す' }));
  expect(screen.queryByText('1件')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'すべて', exact: true }));
  expect(screen.getByTestId('planning-shelf-tile-a')).toBeVisible();
});

it('filters by a substring of the seiban and retains a hidden selection', () => {
  render(<PlanningBoardSeibanShelf {...searchProps} />);
  fireEvent.click(screen.getByTestId('planning-shelf-tile-e'));
  expect(screen.getByRole('button', { name: '製番', exact: true })).toHaveAttribute('aria-pressed', 'true');
  pressShelfDigits('1');
  expect(screen.getByRole('button', { name: 'S1', exact: true })).toBeVisible();
  expect(screen.getByRole('button', { name: 'S21', exact: true })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'S30', exact: true })).not.toBeInTheDocument();
  expect(screen.getByText('1件')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '↺' }));
  expect(screen.getByTestId('planning-shelf-tile-e')).toHaveAttribute('aria-pressed', 'true');
});

it('matches only the digits from the normalized model name', () => {
  render(<PlanningBoardSeibanShelf {...searchProps} />);
  fireEvent.click(screen.getByRole('button', { name: '機種名', exact: true }));
  pressShelfDigits('1', '2');
  expect(screen.getByRole('button', { name: 'S21', exact: true })).toBeVisible();
  expect(screen.getByRole('button', { name: 'S30', exact: true })).toHaveTextContent('MX-1A2');
  expect(screen.queryByRole('button', { name: 'S1', exact: true })).not.toBeInTheDocument();
});

it('matches digits beyond the displayed model name length', () => {
  const longItems = [{ ...items[0]!, itemId: 'long', fseiban: 'S40', machineName: `${'Ａ'.repeat(40)}９８７` }];
  const longColors = new Map([['S40', 'bg-sky-400']]);
  render(<PlanningBoardSeibanShelf {...props} seibanColors={longColors} columns={buildPlanningBoardSeibanShelf(longItems, [], ['021'], longColors)} />);
  fireEvent.click(screen.getByRole('button', { name: '機種名', exact: true }));
  pressShelfDigits('9', '8', '7');
  expect(screen.getByRole('button', { name: 'S40', exact: true })).toBeVisible();
});

it('keeps the entered digits when switching the search mode in either direction', () => {
  render(<PlanningBoardSeibanShelf {...searchProps} />);
  pressShelfDigits('2', '1');
  expect(screen.getByRole('button', { name: 'S21', exact: true })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '機種名', exact: true }));
  expect(screen.getByText('21', { exact: true })).toBeVisible();
  expect(screen.getByRole('group', { name: '製番の棚' })).toBeEmptyDOMElement();
  fireEvent.click(screen.getByRole('button', { name: '製番', exact: true }));
  expect(screen.getByText('21', { exact: true })).toBeVisible();
  expect(screen.getByRole('button', { name: 'S21', exact: true })).toBeVisible();
});

it('deletes the last digit and resets the search', () => {
  render(<PlanningBoardSeibanShelf {...searchProps} />);
  const backspace = screen.getByRole('button', { name: '1文字消す' });
  const reset = screen.getByRole('button', { name: '↺' });
  pressShelfDigits('1', '2');
  expect(screen.getByRole('group', { name: '製番の棚' })).toBeEmptyDOMElement();
  fireEvent.click(backspace);
  expect(screen.getByRole('button', { name: 'S1', exact: true })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'S30', exact: true })).not.toBeInTheDocument();
  fireEvent.click(reset);
  expect(backspace).toBeDisabled();
  expect(reset).toBeDisabled();
  expect(screen.getByRole('button', { name: 'S30', exact: true })).toBeVisible();
});

it('shows only columns that match both the search and the remaining filter', () => {
  render(<PlanningBoardSeibanShelf {...searchProps} />);
  pressShelfDigits('1');
  expect(screen.getByRole('button', { name: 'S21', exact: true })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '残り', exact: true }));
  expect(screen.getByRole('button', { name: 'S1', exact: true })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'S21', exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'S30', exact: true })).not.toBeInTheDocument();
});

it('keeps only one tile selected: a second tile replaces the first and a pressed tile deselects', () => {
  render(<PlanningBoardSeibanShelf {...props} />);
  fireEvent.click(screen.getByTestId('planning-shelf-tile-a'));
  fireEvent.click(screen.getByTestId('planning-shelf-tile-b'));
  expect(screen.getByTestId('planning-shelf-tile-a')).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByTestId('planning-shelf-tile-b')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('1件')).toBeInTheDocument();
  fireEvent.click(screen.getByTestId('planning-shelf-tile-b'));
  expect(screen.queryByText('1件')).not.toBeInTheDocument();
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
  expect(screen.getByText('1件')).toBeInTheDocument();
  const saved = items.map(item => item.itemId === 'b' ? { ...item, effectiveResourceCd: '021', itemRevision: 'saved', version: 2 } : item);
  rerender(draw(failed ? items : saved));
  expect(move).toHaveBeenCalledTimes(1);
  if (failed) {
    expect(screen.getByText('1件')).toBeInTheDocument();
    act(() => { expect(interactionRef.current!.placeAt(10, 10)).toBe(true); });
    expect(move).toHaveBeenCalledTimes(2);
  }
});

it.each([false, true])('settles rank-only reorders on the pending falling edge without losing failed selections (failed=%s)', async failed => {
  const interactionRef = createRef<SeibanShelfHandle>();
  const members = items.map((item, index) => ({ ...item, originalResourceCd: '021', alternateRank: index + 1, itemRevision: 'r1', version: 1 }));
  const reorder = vi.fn();
  const actions = { move: vi.fn(), reorder, canMove: () => true };
  const getDrop = () => ({ resource: '021', bar: { item: members[2] } as GanttBar, placement: 'after' as const, left: 0 });
  const draw = (order: string[], writePending = false) => <PlanningBoardSeibanShelf {...props}
    columns={buildPlanningBoardSeibanShelf(members.map(item => ({ ...item, alternateRank: order.indexOf(item.itemId) + 1 })), [], ['021'], colors)}
    interactionRef={interactionRef} getDrop={getDrop} actions={actions} resources={['021']} writePending={writePending} />;
  const { rerender } = render(draw(['a', 'b', 'c']));
  fireEvent.click(screen.getByTestId('planning-shelf-tile-b'));
  act(() => { expect(interactionRef.current!.placeAt(10, 10)).toBe(true); });
  expect(reorder).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ itemId: 'b' }), expect.objectContaining({ itemId: 'c' }), 'after');
  rerender(draw(['a', 'c', 'b'], true));
  await nextFrame();
  expect(reorder).toHaveBeenCalledTimes(1);
  expect(screen.getByText('1件')).toBeInTheDocument();
  rerender(draw(failed ? ['a', 'b', 'c'] : ['a', 'c', 'b']));
  expect(reorder).toHaveBeenCalledTimes(1);
  if (failed) {
    expect(screen.getByText('1件')).toBeInTheDocument();
    act(() => { expect(interactionRef.current!.placeAt(10, 10)).toBe(true); });
    expect(reorder).toHaveBeenCalledTimes(2);
  } else {
    expect(screen.queryByText('1件')).not.toBeInTheDocument();
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

it('scrolls by a page, updates the virtual window, and disables arrows at the edges', async () => {
  const width = measureShelf();
  const contentWidth = manyColumns.length * SHELF_COLUMN_STRIDE + 8;
  const scrollWidth = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(contentWidth);
  render(<PlanningBoardSeibanShelf {...manyProps} />);
  const strip = screen.getByRole('group', { name: '製番の棚' });
  const scrollBy = vi.fn(({ left }: ScrollToOptions) => {
    strip.scrollLeft = Math.max(0, Math.min(strip.scrollWidth - strip.clientWidth, strip.scrollLeft + (left ?? 0)));
    fireEvent.scroll(strip);
  });
  Object.defineProperty(strip, 'scrollBy', { value: scrollBy });
  const left = screen.getByRole('button', { name: '製番の棚を左へ送る' });
  const right = screen.getByRole('button', { name: '製番の棚を右へ送る' });
  expect(left).toBeDisabled();
  expect(right).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'S5', exact: true })).not.toBeInTheDocument();
  fireEvent.click(right);
  expect(scrollBy).toHaveBeenLastCalledWith({ left: 2 * SHELF_COLUMN_STRIDE, behavior: 'smooth' });
  await nextFrame();
  expect(screen.getByRole('button', { name: 'S5', exact: true })).toBeVisible();
  expect(left).toBeEnabled();

  strip.scrollLeft = contentWidth - strip.clientWidth;
  fireEvent.scroll(strip);
  await nextFrame();
  expect(right).toBeDisabled();
  fireEvent.click(left);
  expect(scrollBy).toHaveBeenLastCalledWith({ left: -2 * SHELF_COLUMN_STRIDE, behavior: 'smooth' });
  await nextFrame();
  expect(right).toBeEnabled();

  width.mockReturnValue(contentWidth);
  fireEvent(window, new Event('resize'));
  await nextFrame();
  expect(left).toBeDisabled();
  expect(right).toBeDisabled();

  width.mockReturnValue(464);
  fireEvent(window, new Event('resize'));
  await nextFrame();
  expect(right).toBeEnabled();
  scrollWidth.mockReturnValue(3 * SHELF_COLUMN_STRIDE + 8);
  pressShelfDigits('1');
  scrollWidth.mockReturnValue(SHELF_COLUMN_STRIDE + 8);
  pressShelfDigits('1');
  expect(screen.getByRole('button', { name: 'S11', exact: true })).toBeVisible();
  expect(left).toBeDisabled();
  expect(right).toBeDisabled();
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

it.each([
  { focusedSeiban: 'S10', highlightedItemId: null, shorten: false },
  { focusedSeiban: 'S10', highlightedItemId: null, shorten: true },
  { focusedSeiban: null, highlightedItemId: 'item-10', shorten: false },
  { focusedSeiban: null, highlightedItemId: 'item-10', shorten: true }
])('preserves manual horizontal scroll across column refreshes ($focusedSeiban, $highlightedItemId, shorten=$shorten)', async ({ shorten, ...focus }) => {
  measureShelf();
  const { rerender } = render(<PlanningBoardSeibanShelf {...manyProps} {...focus} />);
  const strip = screen.getByRole('group', { name: '製番の棚' });
  expect(strip.scrollLeft).toBeGreaterThan(232);
  strip.scrollLeft = 232;
  fireEvent.scroll(strip);
  await nextFrame();
  const refreshed = (shorten ? manyItems.slice(0, -1) : manyItems).map(item => ({ ...item }));
  rerender(<PlanningBoardSeibanShelf {...manyProps} {...focus} columns={buildPlanningBoardSeibanShelf(refreshed, [], ['021'], manyColors)} />);
  expect(strip.scrollLeft).toBe(232);
  expect(screen.getByTestId('planning-shelf-tile-item-1')).toBeInTheDocument();
});

it('rerenders only columns whose local selection, bar highlight or focus changes', () => {
  measureShelf();
  const { rerender } = render(<PlanningBoardSeibanShelf {...manyProps} />);
  columnRenders.length = 0;
  fireEvent.click(screen.getByTestId('planning-shelf-tile-item-0'));
  expect(columnRenders).toEqual(['S0']);
  columnRenders.length = 0;
  fireEvent.click(screen.getByTestId('planning-shelf-tile-item-1'));
  expect(columnRenders).toEqual(['S0', 'S1']);
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
  expect(columnRenders).toEqual(['S1']);
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
