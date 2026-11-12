import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef, memo, useContext } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { productionFixture } from '../__perf__/fixture';
import { PlanningBoardProcessChipsContext } from '../planningBoardProcessChips';

import { buildPlanningBoardGanttLayout, dayToDate } from './planningBoardGanttLayout';
import { PlanningBoardGanttView } from './PlanningBoardGanttView';
import { PlanningBoardUnitOpContext } from './PlanningBoardUnitOpEditor';

import type { GanttLayout } from './planningBoardGanttLayout';
import type { PlanningBoardGanttHandle } from './PlanningBoardGanttView';
import type { ComponentProps } from 'react';

vi.mock('../../../../api/hooks/machine-signal', () => ({ useMachineSignalResourceUptime: () => ({ data: undefined }) }));
const renders = vi.hoisted(() => [] as string[]);
const contextValues = vi.hoisted(() => [] as unknown[]);
const UnitOpProbe = memo(function UnitOpProbe() {
  contextValues.push(useContext(PlanningBoardUnitOpContext));
  return null;
});
vi.mock('./PlanningBoardForwardGanttRow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PlanningBoardForwardGanttRow')>();
  return { ...actual, PlanningBoardForwardGanttRow: memo(function CountedRow(props: ComponentProps<typeof actual.PlanningBoardForwardGanttRow>) {
    renders.push(props.row.key);
    return <><UnitOpProbe /><actual.PlanningBoardForwardGanttRow {...props} /></>;
  }) };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(document, 'elementsFromPoint'); });
const frame = () => act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });

function setup(mode: 'forward' | 'backward' = 'forward', measured = true, configure?: (layout: GanttLayout, dayWidth: number) => void, selectedItemIds: ReadonlySet<string> = new Set()) {
  if (measured) vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('aria-label') === 'ガントの日付と工程' ? 1000 : 0;
  });
  const fixture = productionFixture(4, 1);
  fixture.items = fixture.items.map((item, i) => ({ ...item, fseiban: `SEIBAN-${i}`, fhincd: `PART-${i}`, requiredMinutes: 60, isCompleted: false, specialDue: null, orderPinned: false }));
  const layout = buildPlanningBoardGanttLayout({ ...fixture.options, items: fixture.items, mode, scale: 2 });
  const labelWidth = mode === 'forward' ? 168 : 320;
  const dayWidth = (1000 - labelWidth) / 2;
  const bars = layout.groups.flatMap(group => group.rows.flatMap(row => row.bars));
  for (const bar of bars) {
    const i = fixture.items.findIndex(item => item.itemId === bar.item.itemId);
    const x = [100, 2200, 4000, 8000][i]!;
    bar.start = layout.start + x / dayWidth;
    bar.end = layout.start + (x + 100) / dayWidth;
    bar.unknown = false;
    bar.segments = [{ start: bar.start, end: bar.end }];
    bar.tone = 'late';
  }
  layout.end = layout.start + 40;
  configure?.(layout, dayWidth);
  const chips = new Map(bars.map(bar => [bar.partKey, [{ rowId: bar.item.itemId, resourceCd: 'TEST-CHIP', isCompleted: false }]]));
  const ref = createRef<PlanningBoardGanttHandle>();
  render(<PlanningBoardProcessChipsContext.Provider value={chips}>
    <PlanningBoardGanttView ref={ref} layout={layout} scale={2} dailyHoursByResource={{}} resourceNameMap={{}}
      capacityPending={false} capacityError={false} onCapacityChange={vi.fn()} onToggleItem={vi.fn()} onDueDrop={vi.fn()}
      disabled={false} dragDisabled={false} selectedItemIds={selectedItemIds} resourceView focusedSeiban={null}
      onFocusedSeibanChange={vi.fn()} colorBySeiban />
  </PlanningBoardProcessChipsContext.Provider>);
  const viewport = screen.getByLabelText('ガントの日付と工程');
  const scroll = async (left: number) => { viewport.scrollLeft = left; fireEvent.scroll(viewport); await frame(); };
  return { viewport, scroll, bars, ref, layout, labelWidth };
}

it.each(['forward', 'backward'] as const)('renders every bar when clientWidth is zero (%s)', mode => {
  setup(mode, false);
  for (let i = 0; i < 4; i++) expect(screen.getByTestId(`planning-gantt-bar-item-000${i}`)).toBeInTheDocument();
});

it('windows bars and chips, preserves lane height, and never rerenders rows within a chunk', async () => {
  const { scroll } = setup();
  await scroll(0);
  const lane = screen.getAllByTestId(/^planning-forward-lane-/)[0]!;
  const height = lane.style.minHeight;
  expect(screen.getByTestId('planning-gantt-bar-item-0000')).toBeInTheDocument();
  expect(screen.getByTestId('planning-gantt-bar-item-0001')).toBeInTheDocument();
  expect(screen.queryByTestId('planning-gantt-bar-item-0002')).not.toBeInTheDocument();
  expect(screen.getByTestId('planning-gantt-chips-item-0000')).toBeInTheDocument();
  expect(screen.queryByTestId('planning-gantt-chips-item-0002')).not.toBeInTheDocument();
  renders.length = 0;
  await scroll(100);
  await scroll(831);
  expect(renders).toEqual([]);
  await scroll(4000);
  expect(renders.length).toBeGreaterThan(0);
  expect(screen.queryByTestId('planning-gantt-bar-item-0000')).not.toBeInTheDocument();
  expect(screen.getByTestId('planning-gantt-bar-item-0002')).toBeInTheDocument();
  expect(screen.getByTestId('planning-gantt-chips-item-0002')).toBeInTheDocument();
  expect(lane.style.minHeight).toBe(height);
});

it.each(['forward', 'backward'] as const)('keeps the captured source mounted outside the window until cancellation (%s)', async mode => {
  class Pointer extends MouseEvent { readonly pointerId = 1; }
  vi.stubGlobal('PointerEvent', Pointer);
  const { scroll } = setup(mode);
  await scroll(0);
  const source = screen.getByTestId('planning-gantt-bar-item-0000');
  const capture = vi.fn();
  Object.defineProperty(source, 'setPointerCapture', { value: capture });
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [source.closest('[data-gantt-lane]')] });
  fireEvent.pointerDown(source, { button: 0, clientX: 200, clientY: 100 });
  fireEvent.pointerMove(source, { clientX: 220, clientY: 110 });
  await scroll(8000);
  expect(capture).toHaveBeenCalledWith(1);
  expect(screen.getByTestId('planning-gantt-bar-item-0000')).toBe(source);
  if (mode === 'forward') {
    expect(screen.getByTestId('planning-gantt-drag-ghost')).toBeInTheDocument();
    expect(screen.getByTestId('planning-gantt-insertion')).toBeInTheDocument();
  }
  fireEvent.pointerCancel(source);
  expect(screen.queryByTestId('planning-gantt-bar-item-0000')).not.toBeInTheDocument();
});

it.each(['forward', 'backward'] as const)('scrolls to an unmounted seiban bar using layout coordinates (%s)', async mode => {
  const { viewport, scroll, labelWidth } = setup(mode);
  await scroll(0);
  expect(screen.queryByTestId('planning-gantt-bar-item-0002')).not.toBeInTheDocument();
  const scrollTo = vi.fn(({ left, top }: { left: number; top: number }) => { viewport.scrollLeft = left; viewport.scrollTop = top; });
  Object.defineProperty(viewport, 'scrollTo', { value: scrollTo, configurable: true });
  const legend = screen.getByRole('group', { name: '製番の色分け凡例' });
  fireEvent.click(within(legend).getByRole('button', { name: 'SEIBAN-2' }));
  expect(scrollTo).toHaveBeenCalledWith({ left: expect.closeTo(4000 + 50 - (1000 - labelWidth) / 2 - (mode === 'forward' ? 1 : 0)), top: 0, behavior: 'smooth' });
  fireEvent.scroll(viewport);
  await frame();
  expect(screen.getByTestId('planning-gantt-bar-item-0002')).toBeInTheDocument();
});

it('finds late bars outside the DOM and cycles through the complete layout', async () => {
  const { ref, viewport, scroll } = setup();
  await scroll(0);
  for (let i = 0; i < 3; i++) act(() => ref.current!.scrollToNextLate());
  expect(viewport.scrollLeft).toBeCloseTo(4000 - (1000 - 168) / 2);
  await frame();
  expect(screen.getByTestId('planning-gantt-bar-item-0002')).toBeInTheDocument();
});

it('retains segmented bars crossing the window and the fixed 70px unknown marker at its edge', async () => {
  const { scroll } = setup('forward', true, (layout, dayWidth) => {
    const bars = layout.groups.flatMap(group => group.rows.flatMap(row => row.bars));
    const unknown = bars.find(bar => bar.item.itemId === 'item-0000')!;
    unknown.unknown = true;
    unknown.start = layout.start + (2496 - 60) / dayWidth;
    unknown.end = unknown.start;
    const split = bars.find(bar => bar.item.itemId === 'item-0002')!;
    split.segments = [{ start: layout.start + 1000 / dayWidth, end: layout.start + 1100 / dayWidth },
      { start: layout.start + 4000 / dayWidth, end: layout.start + 4100 / dayWidth }];
  });
  await scroll(4000);
  expect(screen.getByTestId('planning-gantt-bar-item-0000')).toHaveTextContent('所要不明');
  expect(screen.getByTestId('planning-gantt-bar-item-0002')).toBeInTheDocument();
  expect(screen.getByTestId('planning-gantt-bar-item-0002-segment-1')).toBeInTheDocument();
  expect(screen.queryByTestId('planning-gantt-bar-item-0003')).not.toBeInTheDocument();
});

it('scrolls to the first bar of an offscreen flagged row in backward mode', async () => {
  const { scroll, ref, viewport } = setup('backward', true, layout => {
    for (const group of layout.groups) for (const row of group.rows) row.flagged = row.bars.some(bar => bar.item.itemId === 'item-0002');
  });
  await scroll(0);
  expect(screen.queryByTestId('planning-gantt-bar-item-0002')).not.toBeInTheDocument();
  act(() => ref.current!.scrollToNextOverlap());
  expect(viewport.scrollLeft).toBeCloseTo(4000 - (1000 - 320) / 2);
  await frame();
  expect(screen.getByTestId('planning-gantt-bar-item-0002')).toBeInTheDocument();
});

it('keeps the due mark of a selected bar whose body is outside the window', async () => {
  const { scroll } = setup('forward', true, (layout) => {
    const bar = layout.groups.flatMap(group => group.rows.flatMap(row => row.bars)).find(bar => bar.item.itemId === 'item-0003')!;
    bar.due = dayToDate(layout.start);
  }, new Set(['item-0003']));
  await scroll(0);
  expect(screen.getByTestId('planning-gantt-due-item-0003')).toBeInTheDocument();
  expect(screen.queryByTestId('planning-gantt-bar-item-0002')).not.toBeInTheDocument();
});


it('keeps operation context stable on selection and updates its loading state', () => {
  const fixture = productionFixture(2, 1);
  const props = { layout: buildPlanningBoardGanttLayout({ ...fixture.options, mode: 'forward', scale: 2 }),
    scale: 2, dailyHoursByResource: {}, resourceNameMap: {}, resourceMinutes: { ownSourceResourceCds: [], values: [] }, capacityPending: false, capacityError: false,
    onCapacityChange: vi.fn(), onToggleItem: vi.fn(), onDueDrop: vi.fn(), disabled: false, dragDisabled: false,
    resourceView: true, focusedSeiban: null, onFocusedSeibanChange: vi.fn() };
  const draw = (selectedItemIds: ReadonlySet<string>, minutesPending = false) => <PlanningBoardGanttView {...props} selectedItemIds={selectedItemIds} minutesPending={minutesPending} />;
  const { rerender } = render(draw(new Set()));
  contextValues.length = 0;
  rerender(draw(new Set(['outside-this-board'])));
  expect(contextValues).toEqual([]);
  rerender(draw(new Set(), true));
  expect(contextValues.length).toBeGreaterThan(0);
  expect(contextValues.every(value => (value as { loading: boolean }).loading)).toBe(true);
});
