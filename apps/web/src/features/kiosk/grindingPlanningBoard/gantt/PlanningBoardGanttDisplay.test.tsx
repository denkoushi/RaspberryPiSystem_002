import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { productionFixture } from '../__perf__/fixture';
import { PlanningBoardPageView } from '../PlanningBoardPageView';
import { isPlanningBoardUnitSplitEnabled } from '../planningBoardUnitSplitPolicy';

import { PlanningBoardGanttDisplay } from './PlanningBoardGanttDisplay';
import { buildPlanningBoardGanttLayout } from './planningBoardGanttLayout';
import { PlanningBoardGanttView } from './PlanningBoardGanttView';
import { buildSingleResourceWindows } from './planningBoardSingleResourceWindows';
import { usePersistedPlanningBoardSingleResource } from './usePersistedPlanningBoardSingleResource';
import { usePlanningBoardGantt } from './usePlanningBoardGantt';

import type { PlanningBoardGanttHandle, PlanningBoardGanttProps } from './planningBoardGanttViewTypes';
import type { GrindingPlanningBoardResponse, GrindingPlanningBoardTestBar } from '@raspi-system/shared-types';

vi.mock('../../../../api/hooks/machine-signal', () => ({ useMachineSignalResourceUptime: () => ({ data: undefined }) }));
const capacityState = vi.hoisted(() => ({
  data: undefined as undefined | { dailyHoursByResource: Record<string, 8>; unitSplitEnabledByResource?: Record<string, boolean> }
}));
vi.mock('../../../../api/hooks', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../api/hooks')>(),
  useKioskGrindingPlanningBoardResourceMinutes: () => ({ data: undefined }),
  useUpdateKioskGrindingPlanningBoardResourceMinutesSource: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useKioskGrindingPlanningBoardResourceCapacity: () => ({ data: capacityState.data }),
  useUpdateKioskGrindingPlanningBoardResourceCapacity: () => ({ mutate: vi.fn(), isPending: false, isError: false })
}));
afterEach(() => { vi.restoreAllMocks(); capacityState.data = undefined; });

function props(mode: 'forward' | 'backward', empty = false): PlanningBoardGanttProps {
  const fixture = productionFixture(3, 1);
  const items = fixture.items.filter((_, i) => !empty || i === 0).map((item, i) => ({ ...item,
    originalResourceCd: i === 1 ? '022' : '021', specialDue: null, requiredMinutes: 60, orderPinned: false
  }));
  const layout = buildPlanningBoardGanttLayout({ ...fixture.options, items, resources: ['021'], mode });
  for (const group of layout.groups) for (const row of group.rows) {
    row.flagged = true;
    for (const bar of row.bars) bar.tone = 'late';
  }
  return { layout, resourceLanes: ['021', '022'], singleResourceCd: '021+022', scale: 14, dailyHoursByResource: {}, resourceNameMap: {},
    capacityPending: false, capacityError: false, onCapacityChange: vi.fn(), onToggleItem: vi.fn(), onDueDrop: vi.fn(),
    disabled: false, dragDisabled: false, selectedItemIds: new Set(), resourceView: true,
    focusedSeiban: null, onFocusedSeibanChange: vi.fn() };
}

it.each(['021', '022'])('clears both panes from blank space in %s', resource => {
  class Pointer extends MouseEvent { readonly pointerId = 1; }
  vi.stubGlobal('PointerEvent', Pointer);
  try {
    const values = props('forward');
    const clear = vi.fn();
    function Board() {
      const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
      return <PlanningBoardGanttDisplay {...values} selectedItemIds={selected}
        onToggleItem={(item) => setSelected(new Set([item.itemId]))}
        onClearSelection={() => { clear(); setSelected(new Set()); }} />;
    }
    render(<Board />);
    const upper = within(screen.getByRole('region', { name: '021' }));
    const bar = upper.getByTestId('planning-gantt-bar-item-0000');
    fireEvent.click(bar);
    expect(bar).toHaveClass('outline-emerald-300');
    expect(screen.getByTestId('planning-gantt-chain-strip')).toBeInTheDocument();
    const blank = within(screen.getByRole('region', { name: resource })).getByLabelText('ガントの日付と工程');
    fireEvent.pointerDown(blank, { button: 0, clientX: 100, clientY: 20 });
    fireEvent.pointerUp(blank, { button: 0, clientX: 100, clientY: 20 });
    expect(clear).toHaveBeenCalledOnce();
    expect(bar).not.toHaveClass('outline-emerald-300');
    expect(screen.queryByTestId('planning-gantt-chain-strip')).not.toBeInTheDocument();
    screen.getAllByTestId(/^planning-gantt-bar-/).forEach(item => expect(item).not.toHaveClass('outline-white'));
    // A new focus must not revive the cleared upper pane.
    fireEvent.click(within(screen.getByRole('region', { name: '022' })).getAllByTestId(/^planning-gantt-bar-/)[0]!);
    expect(screen.getAllByTestId('planning-gantt-chain-strip')).toHaveLength(1);
  } finally { vi.unstubAllGlobals(); }
});

it.each(['forward', 'backward'] as const)('keeps 022 empty with its resource header (%s)', mode => {
  render(<PlanningBoardGanttDisplay {...props(mode, true)} />);
  const upper = within(screen.getByRole('region', { name: '021' }));
  const lower = within(screen.getByRole('region', { name: '022' }));
  expect(upper.getByTestId('planning-gantt-bar-item-0000')).toBeInTheDocument();
  expect(lower.queryByTestId('planning-gantt-bar-item-0000')).not.toBeInTheDocument();
  expect(lower.queryAllByTestId(/^planning-gantt-bar-/)).toHaveLength(0);
  expect(screen.getAllByTestId('planning-single-resource-head')).toHaveLength(1);
  expect(within(screen.getByTestId('planning-single-resource-head')).getByRole('group', { name: '021の1日の稼働時間' })).toBeInTheDocument();
});

it.each(['forward', 'backward'] as const)('renders each resource only in its own pane (%s)', mode => {
  render(<PlanningBoardGanttDisplay {...props(mode)} />);
  const upper = within(screen.getByRole('region', { name: '021' }));
  const lower = within(screen.getByRole('region', { name: '022' }));
  expect(upper.getByTestId('planning-gantt-bar-item-0000')).toBeInTheDocument();
  expect(upper.queryByTestId('planning-gantt-bar-item-0001')).not.toBeInTheDocument();
  expect(lower.getByTestId('planning-gantt-bar-item-0001')).toBeInTheDocument();
  expect(lower.queryByTestId('planning-gantt-bar-item-0000')).not.toBeInTheDocument();
});

it('opens the upper machine value sheet at the bottom of the shared Gantt container', () => {
  const values = { ...props('forward'), colorBySeiban: true };
  const onSource = vi.fn(); const onBreaks = vi.fn();
  function Board() {
    const [resource, setResource] = useState<string | null>(null);
    return <PlanningBoardGanttDisplay {...values} onMinutesSourceChange={onSource} onBreaksChange={onBreaks} valueSheetResource={resource}
      onToggleValueSheet={(next) => setResource(current => current === next ? null : next ?? null)} />;
  }
  render(<QueryClientProvider client={new QueryClient()}><Board /></QueryClientProvider>);
  expect(screen.getAllByTestId('planning-single-resource-head')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '8H', exact: true }));
  expect(values.onCapacityChange).toHaveBeenCalledWith('021', 8);
  fireEvent.click(screen.getByRole('button', { name: '休憩', exact: true }));
  expect(onBreaks).toHaveBeenCalledWith('021', true);
  fireEvent.click(screen.getByRole('button', { name: /独自の値/ }));
  expect(onSource.mock.calls).toEqual([[[{ resourceCd: '021', source: 'own' }, { resourceCd: '022', source: 'own' }]]]);
  fireEvent.click(screen.getByRole('button', { name: /品番の値/ }));
  const sheet = screen.getByRole('region', { name: '品番の値' });
  expect(sheet.parentElement!.parentElement).toBe(screen.getByTestId('planning-two-machine'));
  const legend = screen.getByRole('group', { name: '製番の色分け凡例' });
  expect(sheet.parentElement).not.toContainElement(legend);
  expect(screen.getByTestId('planning-two-machine').lastElementChild).toBe(legend);
  expect(sheet.parentElement).toHaveClass('flex-1', 'min-h-0', 'flex-col');
  expect(sheet.parentElement).toHaveClass('relative');
  expect(sheet).toHaveClass('absolute', 'inset-x-0', 'bottom-0');
  expect(sheet).toHaveStyle({ height: 'min(80%, 760px)' });
  expect(within(screen.getByRole('region', { name: '021' })).queryByRole('region', { name: '品番の値' })).toBeNull();
  expect(within(within(sheet).getByText('021').parentElement!).getByText(values.layout.groups[0]!.rows[0]!.bars[0]!.item.fhincd)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /品番の値/ }));
  expect(screen.queryByRole('region', { name: '品番の値' })).not.toBeInTheDocument();
});

it.each([['021', '022'], ['022', '021']])('keeps only the latest pane chain open: %s then %s', (first, second) => {
  const values = props('forward');
  function Board() {
    const [resource, setResource] = useState<string | null>(null);
    return <PlanningBoardGanttDisplay {...values} valueSheetResource={resource}
      onToggleValueSheet={() => setResource(current => current ? null : '021')} />;
  }
  render(<Board />, { wrapper: ({ children }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider> });
  const openChain = (resource: string) => fireEvent.click(within(screen.getByRole('region', { name: resource })).getAllByTestId(/^planning-gantt-bar-/)[0]!);
  openChain(first);
  const previous = screen.getByRole('region', { name: '工程のつながり' });
  openChain(second);
  expect(previous).not.toBeInTheDocument();
  expect(screen.getAllByRole('region', { name: '工程のつながり' })).toHaveLength(1);
  const strip = screen.getByRole('region', { name: '工程のつながり' });
  expect(within(strip).getAllByRole('button', { name: new RegExp(`工順.*${second}`) }).length).toBeGreaterThan(0);
  expect(within(screen.getByRole('region', { name: first })).queryByTestId(/^planning-gantt-chain-badge-/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /品番の値/ }));
  expect(screen.getAllByRole('region', { name: '工程のつながり' })).toHaveLength(1);
  expect(strip.parentElement!.parentElement).toBe(screen.getByTestId('planning-two-machine'));
  fireEvent.click(screen.getByRole('button', { name: '工程のつながりを閉じる' }));
  expect(screen.queryByRole('region', { name: '工程のつながり' })).toBeNull();
  openChain(first);
  expect(screen.getByRole('region', { name: '工程のつながり' })).toBeInTheDocument();
});

it.each(['021', '022'])('reserves only overlapping chain space in each pane (owner %s)', owner => {
  const rect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.parentElement?.dataset.testid === 'planning-two-machine') return { top: 0, bottom: 600, height: 600 } as DOMRect;
    if (this.getAttribute('aria-label') === 'ガントの日付と工程') {
      return this.closest('section[aria-label="021"]')
        ? { top: 40, bottom: 300, height: 260 } as DOMRect : { top: 300, bottom: 600, height: 300 } as DOMRect;
    }
    return rect.call(this);
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function () {
    return this.parentElement?.dataset.testid === 'planning-two-machine' ? 600 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
    return this.dataset.testid === 'planning-gantt-chain-strip' ? 60 : 0;
  });
  const values = props('forward');
  const view = render(<PlanningBoardGanttDisplay {...values} />, { wrapper: ({ children }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider> });
  fireEvent.click(within(screen.getByRole('region', { name: owner })).getAllByTestId(/^planning-gantt-bar-/)[0]!);
  const upper = within(screen.getByRole('region', { name: '021' })).getByLabelText('ガントの日付と工程');
  const lower = within(screen.getByRole('region', { name: '022' })).getByLabelText('ガントの日付と工程');
  expect(upper.style.scrollPaddingBottom).toBe(owner === '021' ? '60px' : '0px');
  expect(lower.style.scrollPaddingBottom).toBe(owner === '021' ? '0px' : '60px');
  expect(lower.firstElementChild).toHaveStyle({ paddingBottom: owner === '021' ? '0px' : '60px' });
  view.rerender(<PlanningBoardGanttDisplay {...values} valueSheetResource="021" />);
  expect(parseFloat(screen.getByRole('region', { name: '工程のつながり' }).style.bottom)).toBeCloseTo(480);
  expect(parseFloat(upper.style.scrollPaddingBottom)).toBeCloseTo(240);
  expect(parseFloat(lower.style.scrollPaddingBottom)).toBeCloseTo(300);
  fireEvent.click(screen.getByRole('button', { name: '工程のつながりを閉じる' }));
  expect(parseFloat(upper.style.scrollPaddingBottom)).toBeCloseTo(180);
});

it.each(['scrollToNextOverlap', 'scrollToNextLate'] as const)('moves one pane per %s and restarts on layout change', method => {
  const values = props(method === 'scrollToNextLate' ? 'forward' : 'backward');
  const ref = createRef<PlanningBoardGanttHandle>();
  const view = render(<PlanningBoardGanttDisplay {...values} ref={ref} />);
  const upper = within(screen.getByRole('region', { name: '021' })).getByLabelText('ガントの日付と工程');
  const lower = within(screen.getByRole('region', { name: '022' })).getByLabelText('ガントの日付と工程');
  const upperScroll = vi.fn();
  const lowerScroll = vi.fn();
  Object.defineProperty(upper, 'scrollTo', { value: upperScroll, configurable: true });
  Object.defineProperty(lower, 'scrollTo', { value: lowerScroll, configurable: true });
  const resources = ['021', '021', '022', '021'];
  for (const resource of resources) {
    upperScroll.mockClear(); lowerScroll.mockClear();
    act(() => ref.current![method]());
    expect(upperScroll).toHaveBeenCalledTimes(resource === '021' ? 1 : 0);
    expect(lowerScroll).toHaveBeenCalledTimes(resource === '022' ? 1 : 0);
  }
  act(() => ref.current![method]());
  view.rerender(<PlanningBoardGanttDisplay {...values} layout={{ ...values.layout }} ref={ref} />);
  upperScroll.mockClear(); lowerScroll.mockClear();
  act(() => ref.current![method]());
  expect(upperScroll).toHaveBeenCalledTimes(1);
  expect(lowerScroll).not.toHaveBeenCalled();
});

function elapsedRowProps(scale = 1) {
  const values = props('forward');
  const windows = buildSingleResourceWindows(values.layout.today, values.layout.end, scale, 8);
  const groups = values.layout.groups.map(group => {
    const row = group.rows[0]!;
    const template = row.bars[0]!;
    return { ...group, rows: [{ ...row, bars: ['hidden', 'visible'].map((kind) => {
      const start = windows[0]!.start;
      const end = windows[kind === 'hidden' ? 0 : 1]!.end;
      return { ...template, item: { ...template.item, itemId: `${kind}-${group.resource}` },
        start, end, segments: [{ start, end }], tone: 'late' as const };
    }) }] };
  });
  return { values: { ...values, scale, layout: { ...values.layout, groups, lateCount: 4 } }, windows };
}

it.each([
  { elapsed: false, name: 'scrolls to a visible partner chain step without switching to one machine' },
  { elapsed: true, name: 'keeps two-machine mode without scrolling for an elapsed partner chain step' }
])('$name', ({ elapsed }) => {
  const { values, windows } = elapsedRowProps();
  const upperGroup = values.layout.groups.find(group => group.resource === '021')!;
  const lowerGroup = values.layout.groups.find(group => group.resource === '022')!;
  const upperTemplate = upperGroup.rows[0]!.bars.find(bar => bar.item.itemId === 'visible-021')!;
  const upperBar = { ...upperTemplate, start: windows[1]!.start,
    segments: [{ start: windows[1]!.start, end: windows[1]!.end }] };
  const lowerBar = lowerGroup.rows[0]!.bars.find(bar => bar.item.itemId === 'hidden-022')!;
  expect(lowerBar.item.fseiban).toBe(upperBar.item.fseiban);
  expect(lowerBar.item.fhincd).toBe(upperBar.item.fhincd);
  const layout = { ...values.layout, now: windows[0]!.end - (elapsed ? 0 : 1 / 86400), groups: [
    // Each pane receives only its resource group; include the partner step in the upper chain's source data.
    { ...upperGroup, rows: [{ ...upperGroup.rows[0]!, bars: [upperBar, lowerBar] }] },
    { ...lowerGroup, rows: [{ ...lowerGroup.rows[0]!, bars: [lowerBar] }] }
  ] };
  const onSingleResourceChange = vi.fn();
  function Board() {
    const [selection, setSelection] = useState(values.singleResourceCd);
    return <PlanningBoardGanttDisplay {...values} layout={layout} singleResourceCd={selection}
      onSingleResourceChange={next => { onSingleResourceChange(next); setSelection(next); }} />;
  }
  render(<Board />, { wrapper: ({ children }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider> });
  const upper = within(screen.getByRole('region', { name: '021' }));
  const lower = within(screen.getByRole('region', { name: '022' }));
  const upperScroll = vi.fn();
  const lowerScroll = vi.fn();
  Object.defineProperty(upper.getByLabelText('ガントの日付と工程'), 'scrollTo', { value: upperScroll, configurable: true });
  Object.defineProperty(lower.getByLabelText('ガントの日付と工程'), 'scrollTo', { value: lowerScroll, configurable: true });
  expect(lower.queryByTestId('planning-gantt-bar-hidden-022') !== null).toBe(!elapsed);
  fireEvent.click(upper.getByTestId('planning-gantt-bar-visible-021'));
  const strip = within(screen.getByRole('region', { name: '工程のつながり' }));
  fireEvent.click(strip.getByRole('button', { name: /工順.*022/ }));
  expect(onSingleResourceChange).not.toHaveBeenCalled();
  expect(screen.getByTestId('planning-two-machine')).toBeInTheDocument();
  if (elapsed) {
    expect(upperScroll).not.toHaveBeenCalled();
    expect(lowerScroll).not.toHaveBeenCalled();
  } else {
    expect(lowerScroll).toHaveBeenCalledTimes(1);
    expect(lowerScroll).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
  }
});

it.each([1, 2])('removes elapsed rows in both panes while retaining the row containing now (scale %s)', scale => {
  const { values, windows } = elapsedRowProps(scale);
  const draw = (now: number) => <PlanningBoardGanttDisplay {...values} layout={{ ...values.layout, now }} />;
  const { rerender } = render(draw(windows[0]!.end - 1 / 86400));
  const rows = (resource: string) => [...screen.getByRole('region', { name: resource })
    .querySelectorAll<HTMLElement>('[data-gantt-window-row]')].map(row => row.dataset.ganttWindowRow);
  const before = ['021', '022'].map(rows);
  for (const keys of before) expect(keys[0]).toContain(`:single:${windows[0]!.key}`);

  rerender(draw(windows[0]!.end));
  for (const [index, resource] of ['021', '022'].entries()) {
    expect(rows(resource)).toEqual(before[index]!.slice(1));
    expect(screen.queryByTestId(`planning-gantt-bar-hidden-${resource}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`planning-gantt-bar-visible-${resource}`)).toBeInTheDocument();
  }

  rerender(draw(windows[1]!.end - 1 / 86400));
  for (const resource of ['021', '022']) expect(rows(resource)[0]).toContain(`:single:${windows[1]!.key}`);
  expect(values.layout.lateCount).toBe(4);
});

it('cycles only remaining late bars across both panes and refreshes the targets when time advances', () => {
  const { values, windows } = elapsedRowProps();
  const ref = createRef<PlanningBoardGanttHandle>();
  const draw = (now: number) => <PlanningBoardGanttDisplay {...values} ref={ref} layout={{ ...values.layout, now }} />;
  const { rerender } = render(draw(windows[0]!.end - 1 / 86400));
  const scrolls = ['021', '022'].map(resource => {
    const viewport = within(screen.getByRole('region', { name: resource })).getByLabelText('ガントの日付と工程');
    const scroll = vi.fn();
    Object.defineProperty(viewport, 'scrollTo', { value: scroll, configurable: true });
    return scroll;
  });
  act(() => ref.current!.scrollToNextLate());
  expect(scrolls[0]).toHaveBeenCalledTimes(1);
  rerender(draw(windows[0]!.end));
  for (const index of [0, 1, 0, 1, 0]) {
    scrolls.forEach(scroll => scroll.mockClear());
    act(() => ref.current!.scrollToNextLate());
    expect(scrolls[index]).toHaveBeenCalledTimes(1);
    expect(scrolls[1 - index]).not.toHaveBeenCalled();
  }
  rerender(draw(windows[1]!.end));
  scrolls.forEach(scroll => scroll.mockClear());
  act(() => ref.current!.scrollToNextLate());
  act(() => ref.current!.scrollToNextLate());
  scrolls.forEach(scroll => expect(scroll).not.toHaveBeenCalled());
  expect(values.layout.lateCount).toBe(4);
});

it.each(['021', '022'])('does not scroll to a hidden item in %s, but scrolls to its first remaining segment', resource => {
  const { values, windows } = elapsedRowProps();
  const ref = createRef<PlanningBoardGanttHandle>();
  render(<PlanningBoardGanttDisplay {...values} ref={ref} layout={{ ...values.layout, now: windows[0]!.end }} />);
  const pane = screen.getByRole('region', { name: resource });
  const viewport = within(pane).getByLabelText('ガントの日付と工程');
  const scroll = vi.fn();
  Object.defineProperty(viewport, 'clientHeight', { value: 200, configurable: true });
  Object.defineProperty(viewport, 'scrollTo', { value: scroll, configurable: true });
  const targetRow = within(pane).getByTestId(`planning-gantt-bar-visible-${resource}`).closest('[data-gantt-window-row]')!;
  vi.spyOn(targetRow, 'getBoundingClientRect').mockReturnValue({ top: 300 } as DOMRect);
  let moved: boolean | undefined;
  act(() => { moved = ref.current!.scrollToItem(`hidden-${resource}`); });
  expect(moved).toBe(false);
  expect(scroll).not.toHaveBeenCalled();
  act(() => { moved = ref.current!.scrollToItem(`visible-${resource}`); });
  expect(moved).toBe(true);
  expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ top: 300 + 22 - 36, behavior: 'smooth' }));
});

function InteractiveBoard({ start = '021', lanes = ['021', '022', '023', '024'], flags = { '021': true, '022': true, '023': true, '024': false }, selected = new Set<string>() }: {
  start?: string; lanes?: string[]; flags?: Record<string, boolean>; selected?: Set<string>;
}) {
  const [selection, setSelection] = useState(start);
  const values = props('forward');
  const layout = { ...values.layout, groups: lanes.map(resource => values.layout.groups.find(group => group.resource === resource) ?? { key: resource, label: resource, resource, rows: [] }) };
  return <PlanningBoardGanttDisplay {...values} layout={layout} singleResourceCd={selection} resourceLanes={lanes}
    unitSplitEnabledByResource={flags} onSingleResourceChange={next => setSelection(next ?? '')} selectedItemIds={selected} />;
}

it('restores focus to the activated machine count button after keyboard switching in both directions', () => {
  localStorage.clear();
  render(<InteractiveBoard />);
  for (const name of ['2台', '1台']) {
    const button = screen.getByRole('button', { name, exact: true });
    button.focus();
    // Native keyboard activation dispatches a click with no pointer click count.
    fireEvent.click(button, { detail: 0 });
    const next = screen.getByRole('button', { name, exact: true });
    expect(button).not.toBeInTheDocument();
    expect(next).toHaveAttribute('aria-pressed', 'true');
    expect(next).toHaveFocus();
  }
});

it('switches to the next ON machine, swaps from a lane label, and restores the previous partner after remount', () => {
  localStorage.clear();
  const view = render(<InteractiveBoard />);
  expect(screen.getByRole('button', { name: '1台', exact: true })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '2台', exact: true }));
  expect(screen.getByRole('region', { name: '022' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '022の機械を選ぶ' }));
  let picker = within(screen.getByRole('group', { name: '1台の資源CD' }));
  expect(picker.getByRole('button', { name: '024' })).toBeDisabled();
  fireEvent.click(picker.getByRole('button', { name: '024' }));
  expect(screen.getByRole('region', { name: '022' })).toBeInTheDocument();
  fireEvent.click(picker.getByRole('button', { name: '021' }));
  expect(screen.getAllByRole('region').filter(node => ['021', '022'].includes(node.getAttribute('aria-label') ?? '')).map(node => node.getAttribute('aria-label'))).toEqual(['022', '021']);
  fireEvent.click(screen.getByRole('button', { name: '1台', exact: true }));
  expect(screen.getByRole('group', { name: '022の1日の稼働時間' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '2台', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '021の機械を選ぶ' }));
  picker = within(screen.getByRole('group', { name: '1台の資源CD' }));
  fireEvent.click(picker.getByRole('button', { name: '023' }));
  view.unmount();
  render(<InteractiveBoard start="022" />);
  fireEvent.click(screen.getByRole('button', { name: '2台', exact: true }));
  expect(screen.getByRole('region', { name: '023' })).toBeInTheDocument();
});

it.each([{ '021': false, '022': true }, { '021': true, '022': false }])('disables two machines when current is OFF or no other is ON: %j', flags => {
  render(<InteractiveBoard flags={flags} lanes={['021', '022']} />);
  expect(screen.getByRole('button', { name: '2台', exact: true })).toBeDisabled();
});

it('wraps the next ON machine to the first resource code', () => {
  localStorage.clear();
  render(<InteractiveBoard start="022" lanes={['022', '021']} />);
  fireEvent.click(screen.getByRole('button', { name: '2台', exact: true }));
  expect(screen.getByRole('region', { name: '021' })).toBeInTheDocument();
});

it('returns to the selected bar machine instead of the upper machine', () => {
  render(<InteractiveBoard start="021+022" selected={new Set(['item-0001'])} />);
  fireEvent.click(screen.getByRole('button', { name: '1台', exact: true }));
  expect(screen.getByRole('group', { name: '022の1日の稼働時間' })).toBeInTheDocument();
});

it('splits bars for an arbitrary enabled pair and excludes other resources', () => {
  const values = props('forward');
  const remap = (resource: string) => resource === '021' ? '305' : '306';
  const layout = { ...values.layout, groups: values.layout.groups.map(group => ({ ...group, resource: remap(group.resource!),
    rows: group.rows.map(row => ({ ...row, bars: row.bars.map(bar => ({ ...bar, resource: remap(bar.resource) })) })) })) };
  layout.groups.push({ ...layout.groups[0]!, key: '307', resource: '307', rows: layout.groups[0]!.rows.map(row => ({ ...row, bars: row.bars.map(bar => ({ ...bar, resource: '307', item: { ...bar.item, itemId: 'third-resource' } })) })) });
  render(<PlanningBoardGanttDisplay {...values} layout={layout} singleResourceCd="306+305" resourceLanes={['305', '306', '307']}
    unitSplitEnabledByResource={{ '305': true, '306': true }} />);
  expect(screen.queryByTestId('planning-gantt-bar-third-resource')).toBeNull();
  expect(screen.queryByRole('region', { name: '307' })).toBeNull();
  expect(within(screen.getByRole('region', { name: '306' })).getByTestId('planning-gantt-bar-item-0001')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: '306' })).queryByTestId('planning-gantt-bar-item-0000')).toBeNull();
  expect(within(screen.getByRole('region', { name: '305' })).getByTestId('planning-gantt-bar-item-0000')).toBeInTheDocument();
});

it('ignores a previous partner that is now OFF', () => {
  localStorage.clear();
  localStorage.setItem('kiosk.planning-board.machine-partners:default', JSON.stringify({ '021': '024' }));
  render(<InteractiveBoard />);
  fireEvent.click(screen.getByRole('button', { name: '2台', exact: true }));
  expect(screen.getByRole('region', { name: '022' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '024' })).toBeNull();
});

it('uses explicit unit-split flags and defaults only the legacy machines to ON', () => {
  expect(isPlanningBoardUnitSplitEnabled('021')).toBe(true);
  expect(isPlanningBoardUnitSplitEnabled('022')).toBe(true);
  expect(isPlanningBoardUnitSplitEnabled('305')).toBe(false);
  expect(isPlanningBoardUnitSplitEnabled('021', { '021': false })).toBe(false);
  expect(isPlanningBoardUnitSplitEnabled('305', { '305': true })).toBe(true);
  expect(isPlanningBoardUnitSplitEnabled('305', Object.create({ '305': true }))).toBe(false);
});

it.each([0, 1])('changes pane %s from its label and keeps capacity controls on the upper resource', index => {
  const values = props('forward');
  function Board() {
    const [selection, setSelection] = useState('021+022');
    return <PlanningBoardGanttDisplay {...values} singleResourceCd={selection} resourceLanes={['021', '022', '023']}
      unitSplitEnabledByResource={{ '023': true }} onSingleResourceChange={next => setSelection(next!)} />;
  }
  render(<Board />);
  fireEvent.click(screen.getByRole('button', { name: `${index === 0 ? '021' : '022'}の機械を選ぶ` }));
  fireEvent.click(within(screen.getByRole('group', { name: '1台の資源CD' })).getByRole('button', { name: '023' }));
  expect(screen.getByRole('region', { name: '023' })).toBeInTheDocument();
  expect(screen.getAllByTestId('planning-single-resource-head')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '8H', exact: true }));
  expect(values.onCapacityChange).toHaveBeenCalledWith(index === 0 ? '023' : '021', 8);
});


it.each(['021+022', '305+306'])('waits for capacity before validating a saved pair %s, then revalidates changes', start => {
  localStorage.clear();
  const lanes = start.split('+');
  localStorage.setItem('kiosk.planning-board.single-resource:review', JSON.stringify({ schemaVersion: 1, resourceCd: start }));
  function Board({ loaded, flags }: { loaded: boolean; flags?: Record<string, boolean> }) {
    const { resourceCd, changeResource } = usePersistedPlanningBoardSingleResource('review', lanes);
    const values = props('forward');
    const layout = { ...values.layout, groups: lanes.map(resource => ({ ...values.layout.groups[0]!, resource })) };
    return <PlanningBoardGanttDisplay {...values} layout={layout} singleResourceCd={resourceCd} resourceLanes={lanes}
      capacityLoaded={loaded} unitSplitEnabledByResource={flags} onSingleResourceChange={changeResource} />;
  }
  const flags = { [lanes[0]!]: false, [lanes[1]!]: true };
  const view = render(<Board loaded={false} flags={flags} />);
  expect(screen.getByTestId('planning-two-machine')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '2台', exact: true })).toBeEnabled();
  view.rerender(<Board loaded flags={{ [lanes[0]!]: true, [lanes[1]!]: true }} />);
  expect(screen.getByTestId('planning-two-machine')).toBeInTheDocument();
  view.rerender(<Board loaded flags={flags} />);
  expect(screen.queryByTestId('planning-two-machine')).toBeNull();
  expect(screen.getByRole('group', { name: `${lanes[0]}の1日の稼働時間` })).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('kiosk.planning-board.single-resource:review')!).resourceCd).toBe(lanes[0]);
});

it('validates an OFF legacy pair immediately after the first capacity response, including no explicit settings', () => {
  const values = props('forward');
  const change = vi.fn();
  const view = render(<PlanningBoardGanttDisplay {...values} resourceLanes={['021', '022']} capacityLoaded={false} onSingleResourceChange={change} />);
  expect(change).not.toHaveBeenCalled();
  view.rerender(<PlanningBoardGanttDisplay {...values} resourceLanes={['021', '022']} capacityLoaded onSingleResourceChange={change} />);
  expect(change).not.toHaveBeenCalled();
  view.rerender(<PlanningBoardGanttDisplay {...values} resourceLanes={['021', '022']} capacityLoaded unitSplitEnabledByResource={{ '021': false }} onSingleResourceChange={change} />);
  expect(change).toHaveBeenCalledWith('021');
});

it('treats a literal resource code containing + as one machine even if both parts also exist', () => {
  render(<InteractiveBoard start="021+022" lanes={['021+022', '021', '022']} flags={{ '021+022': true, '021': true, '022': true }} />);
  expect(screen.queryByTestId('planning-two-machine')).toBeNull();
  expect(screen.getByRole('button', { name: '1台', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('group', { name: '021+022の1日の稼働時間' })).toBeInTheDocument();
});

it('shows the pair and 2台 on the common machine button while saving settings to the upper resource', () => {
  const values = props('forward');
  render(<PlanningBoardGanttDisplay {...values} />);
  const machine = screen.getByRole('button', { name: '1台の資源CDを選ぶ' });
  expect(machine).toHaveTextContent('021+022');
  expect(machine).toHaveTextContent('2台');
  fireEvent.click(screen.getByRole('button', { name: '10H' }));
  expect(values.onCapacityChange).toHaveBeenCalledWith('021', 10);
});

it('toggles the pane picker and focuses the selected enabled machine or the first enabled machine', () => {
  const values = props('forward');
  const view = render(<PlanningBoardGanttDisplay {...values} resourceLanes={['024', '021', '022']} unitSplitEnabledByResource={{ '024': false }} />);
  const label = screen.getByRole('button', { name: '021の機械を選ぶ' });
  vi.spyOn(label, 'getBoundingClientRect').mockReturnValue({ top: 100, right: 50 } as DOMRect);
  fireEvent.click(label);
  expect(screen.getByRole('group', { name: '1台の資源CD' })).toHaveStyle({ left: '56px', top: '100px' });
  expect(within(screen.getByRole('group', { name: '1台の資源CD' })).getByRole('button', { name: '021' })).toHaveFocus();
  fireEvent.click(label);
  expect(screen.queryByRole('group', { name: '1台の資源CD' })).toBeNull();
  expect(label).toHaveFocus();
  view.rerender(<PlanningBoardGanttDisplay {...values} resourceLanes={['024', '021', '022']} unitSplitEnabledByResource={{ '024': false, '021': false }} />);
  fireEvent.click(label);
  expect(within(screen.getByRole('group', { name: '1台の資源CD' })).getByRole('button', { name: '022' })).toHaveFocus();
});

it.each(['021', '021+022'])('locks the common machine button, mode and pane labels during an order preview (%s)', selection => {
  const values = props('forward');
  const change = vi.fn();
  const openPicker = vi.fn();
  const view = render(<PlanningBoardGanttDisplay {...values} onOpenSingleResourcePicker={openPicker} singleResourceCd={selection} onSingleResourceChange={change} />);
  if (selection.includes('+')) fireEvent.click(screen.getByRole('button', { name: '021の機械を選ぶ' }));
  view.rerender(<PlanningBoardGanttDisplay {...values} singleResourceCd={selection} machineSelectionLocked onOpenSingleResourcePicker={openPicker} onSingleResourceChange={change} />);
  expect(screen.queryByRole('group', { name: '1台の資源CD' })).toBeNull();
  for (const button of [screen.getByRole('button', { name: '1台の資源CDを選ぶ' }), screen.getByRole('button', { name: '1台', exact: true }), screen.getByRole('button', { name: '2台', exact: true }), ...screen.queryAllByRole('button', { name: /の機械を選ぶ/ })]) {
    expect(button).toBeDisabled();
    fireEvent.click(button);
    // Invoke the React handler too, bypassing the native disabled button guard.
    const propsKey = Object.keys(button).find(key => key.startsWith('__reactProps'))!;
    (button as unknown as Record<string, { onClick: (event: { currentTarget: HTMLElement }) => void }>)[propsKey]!.onClick({ currentTarget: button });
  }
  expect(change).not.toHaveBeenCalled();
  expect(screen.queryByRole('group', { name: '1台の資源CD' })).toBeNull();
  expect(openPicker).not.toHaveBeenCalled();
  expect(Boolean(screen.queryByTestId('planning-two-machine'))).toBe(selection.includes('+'));
});

it.each([['021', '022'], ['022', '021']])('uses the last clicked bar resource after selecting both panes: %s then %s', (first, last) => {
  const values = props('forward');
  // The item resource fields differ from the actual bar lane, as with split assignments.
  const layout = { ...values.layout, groups: values.layout.groups.map(group => ({ ...group, rows: group.rows.map(row => ({ ...row,
    bars: row.bars.map(bar => ({ ...bar, item: { ...bar.item, originalResourceCd: 'wrong', effectiveResourceCd: 'wrong' } }))
  })) })) };
  function Board() {
    const [selection, setSelection] = useState('021+022');
    const [selected, setSelected] = useState(new Set<string>());
    return <PlanningBoardGanttDisplay {...values} layout={layout} singleResourceCd={selection} selectedItemIds={selected}
      onSingleResourceChange={next => setSelection(next!)} onToggleItem={(item, on) => setSelected(current => {
        const next = new Set(current); if (on) next.add(item.itemId); else next.delete(item.itemId); return next;
      })} />;
  }
  render(<Board />);
  for (const resource of [first, last]) fireEvent.click(within(screen.getByRole('region', { name: resource })).getAllByTestId(/^planning-gantt-bar-/)[0]!);
  fireEvent.click(screen.getByRole('button', { name: '1台', exact: true }));
  expect(screen.getByRole('group', { name: `${last}の1日の稼働時間` })).toBeInTheDocument();
});

it('excludes enabled resource codes containing + from new and saved partners and disables their picker entries', () => {
  localStorage.clear();
  localStorage.setItem('kiosk.planning-board.machine-partners:default', JSON.stringify({ '021': '021+020' }));
  render(<InteractiveBoard lanes={['021', '021+020', '022', '024']}
    flags={{ '021': true, '021+020': true, '022': true, '024': false }} />);
  fireEvent.click(screen.getByRole('button', { name: '2台', exact: true }));
  expect(screen.getByRole('region', { name: '022' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '022の機械を選ぶ' }));
  const picker = within(screen.getByRole('group', { name: '1台の資源CD' }));
  const combined = picker.getByRole('button', { name: '021+020' });
  const off = picker.getByRole('button', { name: '024' });
  expect(combined).toBeDisabled();
  expect(combined.className).toBe(off.className);
  fireEvent.click(combined);
  expect(screen.getByRole('region', { name: '022' })).toBeInTheDocument();
});

it('disables 2台 for an enabled current resource containing +', () => {
  render(<InteractiveBoard start="021+020" lanes={['021+020', '021', '022']}
    flags={{ '021+020': true, '021': true, '022': true }} />);
  expect(screen.getByRole('button', { name: '2台', exact: true })).toBeDisabled();
  expect(screen.queryByTestId('planning-two-machine')).toBeNull();
});

it('keeps a saved pair through optimistic hours before capacity flags load', () => {
  localStorage.clear();
  localStorage.setItem('kiosk.planning-board.single-resource:capacity-loading', JSON.stringify({ schemaVersion: 1, resourceCd: '305+306' }));
  const fixture = productionFixture(0, 2);
  const options = { ...fixture.options, resources: ['305', '306'], enabled: true, preferenceScope: 'capacity-loading' };
  function Board() {
    const gantt = usePlanningBoardGantt(options);
    return <PlanningBoardGanttDisplay {...props('forward')} layout={gantt.layout}
      singleResourceCd={gantt.singleResourceCd} resourceLanes={gantt.singleResourceLanes}
      dailyHoursByResource={gantt.dailyHoursByResource} capacityLoaded={gantt.capacityLoaded}
      unitSplitEnabledByResource={gantt.unitSplitEnabledByResource} onSingleResourceChange={gantt.changeSingleResource} />;
  }
  const view = render(<Board />);
  expect(screen.getByTestId('planning-two-machine')).toBeInTheDocument();
  capacityState.data = { dailyHoursByResource: { '305': 8 } };
  view.rerender(<Board />);
  expect(screen.getByTestId('planning-two-machine')).toBeInTheDocument();
  capacityState.data = { ...capacityState.data, unitSplitEnabledByResource: { '305': true, '306': true } };
  view.rerender(<Board />);
  expect(screen.getByTestId('planning-two-machine')).toBeInTheDocument();
  capacityState.data = { ...capacityState.data, unitSplitEnabledByResource: { '305': true, '306': false } };
  view.rerender(<Board />);
  expect(screen.queryByTestId('planning-two-machine')).toBeNull();
});

it('defers returning an OFF pair to one machine until the order preview ends', () => {
  const values = props('forward');
  function Board({ locked }: { locked: boolean }) {
    const [selection, setSelection] = useState('021+022');
    return <PlanningBoardGanttDisplay {...values} singleResourceCd={selection} capacityLoaded
      unitSplitEnabledByResource={{ '021': true, '022': false }} machineSelectionLocked={locked}
      onSingleResourceChange={next => setSelection(next!)} />;
  }
  const view = render(<Board locked />);
  expect(screen.getByTestId('planning-two-machine')).toBeInTheDocument();
  view.rerender(<Board locked={false} />);
  expect(screen.queryByTestId('planning-two-machine')).toBeNull();
  expect(screen.getByRole('group', { name: '021の1日の稼働時間' })).toBeInTheDocument();
});

it('prefers the upper selected pane when layout groups list the lower pane first', () => {
  const values = props('forward');
  const change = vi.fn();
  render(<PlanningBoardGanttDisplay {...values} layout={{ ...values.layout, groups: [...values.layout.groups].reverse() }}
    selectedItemIds={new Set(['item-0000', 'item-0001'])} onSingleResourceChange={change} />);
  fireEvent.click(screen.getByRole('button', { name: '1台', exact: true }));
  expect(change).toHaveBeenCalledWith('021');
});

it('keeps the pane picker closed after the order preview ends', () => {
  const values = props('forward');
  const view = render(<PlanningBoardGanttDisplay {...values} />);
  fireEvent.click(screen.getByRole('button', { name: '021の機械を選ぶ' }));
  expect(screen.getByRole('group', { name: '1台の資源CD' })).toBeInTheDocument();
  view.rerender(<PlanningBoardGanttDisplay {...values} machineSelectionLocked />);
  view.rerender(<PlanningBoardGanttDisplay {...values} machineSelectionLocked={false} />);
  expect(screen.queryByRole('group', { name: '1台の資源CD' })).toBeNull();
  expect(screen.getByRole('button', { name: '021の機械を選ぶ' })).toHaveAttribute('aria-expanded', 'false');
});

it('waits for the shared head container before rendering the upper pane settings row', () => {
  const values = { ...props('forward'), singleResourceCd: '021', machineMode: 2 as const };
  const view = render(<PlanningBoardGanttView {...values} resourceHeadContainer={null} />);
  expect(screen.queryByTestId('planning-single-resource-head')).toBeNull();
  const target = document.createElement('div');
  view.container.append(target);
  view.rerender(<PlanningBoardGanttView {...values} resourceHeadContainer={target} />);
  expect(within(target).getByTestId('planning-single-resource-head')).toBeInTheDocument();
  expect(within(screen.getByTestId('planning-board-gantt')).queryByTestId('planning-single-resource-head')).toBeNull();
});

it('rejects pair selections colliding with a real resource code', () => {
  localStorage.clear();
  const view = render(<InteractiveBoard lanes={['021', '022', '021+022']} />);
  expect(screen.getByRole('button', { name: '2台', exact: true })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '2台', exact: true }));
  expect(screen.queryByTestId('planning-two-machine')).toBeNull();
  view.rerender(<InteractiveBoard start="021+022" lanes={['021', '022', '023', '021+023', '022+021']} />);
  // Start a valid pair, then block both a replacement and a swap that collide.
  fireEvent.click(screen.getByRole('button', { name: '2台', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '021の機械を選ぶ' }));
  const picker = within(screen.getByRole('group', { name: '1台の資源CD' }));
  expect(picker.getByRole('button', { name: '022', exact: true })).toBeDisabled();
  fireEvent.click(picker.getByRole('button', { name: '022', exact: true }));
  expect(screen.getByRole('region', { name: '021' })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '022の機械を選ぶ' }));
  expect(within(screen.getByRole('group', { name: '1台の資源CD' })).getByRole('button', { name: '023', exact: true })).toBeDisabled();
});

function seibanLegendBoard(mode: 'forward' | 'backward') {
  const fixture = productionFixture(4, 1);
  const seibans = ['26-1201', '26-1202', '26-1203', '26-1203'];
  const items = fixture.items.map((item, i) => ({ ...item, originalResourceCd: i % 2 ? '022' : '021', fseiban: seibans[i]!,
    specialDue: null, requiredMinutes: 60, orderPinned: false }));
  const layout = buildPlanningBoardGanttLayout({ ...fixture.options, items, resources: ['021', '022'], seibanOrder: ['26-1203', '26-1202', '26-1201'], mode });
  const values = { ...props(mode), layout, colorBySeiban: true, seibanOrder: ['26-1203', '26-1202', '26-1201'] };
  function Board() {
    const [focusedSeiban, setFocusedSeiban] = useState<string | null>(null);
    return <PlanningBoardGanttDisplay {...values} focusedSeiban={focusedSeiban} onFocusedSeibanChange={setFocusedSeiban} />;
  }
  return Board;
}

it.each(['forward', 'backward'] as const)('shows one seiban legend below the lower pane with both panes\' seibans (%s)', mode => {
  const Board = seibanLegendBoard(mode);
  render(<Board />);
  const legends = screen.getAllByRole('group', { name: '製番の色分け凡例' });
  expect(legends).toHaveLength(1);
  const legend = legends[0]!;
  const upper = screen.getByRole('region', { name: '021' });
  const lower = screen.getByRole('region', { name: '022' });
  expect(upper).not.toContainElement(legend);
  expect(lower).not.toContainElement(legend);
  expect(lower.compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(legend).getAllByRole('button').map(chip => chip.textContent)).toEqual(['26-1203', '26-1202', '26-1201']);
});

it.each(['forward', 'backward'] as const)('keeps the seiban focus on both panes when the seiban is only in one pane (%s)', mode => {
  const Board = seibanLegendBoard(mode);
  render(<Board />);
  const legend = () => within(screen.getAllByRole('group', { name: '製番の色分け凡例' })[0]!);
  const surfaces = (id: string) => screen.getAllByTestId(new RegExp(`^planning-gantt-bar-${id}(-segment-\\d+)?$`))
    .map(bar => mode === 'backward' ? bar.firstElementChild! : bar);
  const focused = (id: string) => surfaces(id).forEach(surface => expect(surface).toHaveClass('ring-2', 'ring-white'));
  const dimmed = (id: string) => surfaces(id).forEach(surface => expect(surface).toHaveClass('opacity-20'));
  const clear = (id: string) => surfaces(id).forEach(surface => { expect(surface).not.toHaveClass('ring-2'); expect(surface).not.toHaveClass('opacity-20'); });

  fireEvent.click(legend().getByRole('button', { name: '26-1201' }));
  expect(legend().getByRole('button', { name: '26-1201' })).toHaveAttribute('aria-pressed', 'true');
  focused('item-0000');
  for (const id of ['item-0001', 'item-0002', 'item-0003']) dimmed(id);

  fireEvent.click(legend().getByRole('button', { name: '26-1202' }));
  expect(legend().getByRole('button', { name: '26-1202' })).toHaveAttribute('aria-pressed', 'true');
  focused('item-0001');
  for (const id of ['item-0000', 'item-0002', 'item-0003']) dimmed(id);

  fireEvent.click(legend().getByRole('button', { name: '26-1203' }));
  focused('item-0002');
  focused('item-0003');
  for (const id of ['item-0000', 'item-0001']) dimmed(id);

  fireEvent.click(legend().getByRole('button', { name: '26-1203' }));
  expect(legend().getByRole('button', { name: '26-1203' })).toHaveAttribute('aria-pressed', 'false');
  for (const id of ['item-0000', 'item-0001', 'item-0002', 'item-0003']) clear(id);

  fireEvent.click(legend().getByRole('button', { name: '26-1201' }));
  fireEvent.click(legend().getByRole('button', { name: 'すべて表示' }));
  for (const id of ['item-0000', 'item-0001', 'item-0002', 'item-0003']) clear(id);
  fireEvent.click(legend().getByRole('button', { name: '26-1202' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  for (const id of ['item-0000', 'item-0001', 'item-0002', 'item-0003']) clear(id);
});


it.each(['forward', 'backward'] as const)('scrolls each pane containing the selected legend seiban (%s)', mode => {
  const Board = seibanLegendBoard(mode);
  render(<Board />);
  const scrolls = ['021', '022'].map(resource => {
    const viewport = within(screen.getByRole('region', { name: resource })).getByLabelText('ガントの日付と工程');
    const scroll = vi.fn();
    Object.defineProperty(viewport, 'scrollTo', { value: scroll, configurable: true });
    return scroll;
  });
  const legend = within(screen.getByRole('group', { name: '製番の色分け凡例' }));
  for (const [seiban, counts] of [['26-1201', [1, 0]], ['26-1202', [0, 1]], ['26-1203', [1, 1]]] as const) {
    scrolls.forEach(scroll => scroll.mockClear());
    fireEvent.click(legend.getByRole('button', { name: seiban }));
    scrolls.forEach((scroll, index) => expect(scroll).toHaveBeenCalledTimes(counts[index]!));
    scrolls.forEach(scroll => scroll.mockClear());
    fireEvent.click(legend.getByRole('button', { name: seiban }));
    scrolls.forEach(scroll => expect(scroll).not.toHaveBeenCalled());
  }
});

it.each([[[]], [['021']], [['022']], [['021', '022']]])('reflects both machines minutes sources: %j', (ownSourceResourceCds) => {
  const onSource = vi.fn();
  render(<PlanningBoardGanttDisplay {...props('forward')} resourceMinutes={{ ownSourceResourceCds, values: [] }} onMinutesSourceChange={onSource} />);
  const original = screen.getByRole('button', { name: /元の値/ });
  const own = screen.getByRole('button', { name: /独自の値/ });
  expect(original).toHaveAttribute('aria-pressed', String(ownSourceResourceCds.length === 0));
  expect(own).toHaveAttribute('aria-pressed', String(ownSourceResourceCds.length === 2));
  for (const button of [original, own]) {
    expect(button.classList.contains('bg-amber-400')).toBe(button.getAttribute('aria-pressed') === 'true');
  }
  fireEvent.click(own);
  const ownChanges = ['021', '022'].filter(resourceCd => !ownSourceResourceCds.includes(resourceCd)).map(resourceCd => ({ resourceCd, source: 'own' }));
  expect(onSource.mock.calls).toEqual(ownChanges.length ? [[ownChanges]] : []);
  onSource.mockClear();
  fireEvent.click(original);
  const originalChanges = ['021', '022'].filter(resourceCd => ownSourceResourceCds.includes(resourceCd)).map(resourceCd => ({ resourceCd, source: 'original' }));
  expect(onSource.mock.calls).toEqual(originalChanges.length ? [[originalChanges]] : []);
});

it('totals both machines and groups their parts in pane order, excluding other resources', () => {
  const values = props('forward');
  const base = values.layout.groups[0]!.rows[0]!.bars[0]!.item;
  const items = ['022', '021', '023'].map((resourceCd, index) => ({ ...base, itemId: `minutes-${resourceCd}`, fhincd: `PART-${resourceCd}`,
    originalResourceCd: resourceCd, effectiveResourceCd: resourceCd, originalRequiredMinutes: (index + 1) * 60, ownRequiredMinutes: (index + 1) * 120 }));
  const minutes = { ownSourceResourceCds: [], values: items.map(item => ({ resourceCd: item.originalResourceCd, fhincd: item.fhincd, perUnitMinutes: 5, setupMinutes: 0 })) };
  render(<QueryClientProvider client={new QueryClient()}><PlanningBoardGanttDisplay {...values} resourceMinutesItems={[...items, items[0]!]} resourceMinutes={minutes}
    resourceNameMap={{ '021': ['上段機'], '022': ['下段機'] }} valueSheetResource="021" /></QueryClientProvider>);
  expect(screen.getByRole('button', { name: /元の値/ })).toHaveTextContent('3.0h');
  expect(screen.getByRole('button', { name: /独自の値/ })).toHaveTextContent('6.0h');
  expect(screen.getByRole('button', { name: /品番の値/ })).toHaveTextContent('品番の値 2');
  const sheet = within(screen.getByRole('region', { name: '品番の値' }));
  const upper = sheet.getByText('021 上段機');
  const lower = sheet.getByText('022 下段機');
  expect(within(upper.parentElement!).getByText('PART-021')).toBeInTheDocument();
  expect(within(lower.parentElement!).getByText('PART-022')).toBeInTheDocument();
  expect(upper.compareDocumentPosition(lower) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(sheet.queryByText('PART-023')).toBeNull();
});

it('keeps minutes controls and the ungrouped sheet scoped to one machine', () => {
  const values = props('forward');
  const onSource = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}><PlanningBoardGanttDisplay {...values} singleResourceCd="021" valueSheetOpen
    resourceMinutes={{ ownSourceResourceCds: ['022'], values: [] }} onMinutesSourceChange={onSource} /></QueryClientProvider>);
  expect(screen.getByRole('button', { name: /元の値/ })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: /独自の値/ }));
  expect(onSource.mock.calls).toEqual([[[{ resourceCd: '021', source: 'own' }]]]);
  const sheet = screen.getByRole('region', { name: '品番の値' });
  expect(within(sheet).getAllByRole('table')).toHaveLength(1);
  expect(within(sheet).queryByText('021')).toBeNull();
});

it('passes unit split controls through the display and view in single and two-machine modes', () => {
  const onUnitSplitChange = vi.fn();
  const values = { ...props('forward'), unitSplitAvailable: (resource: string) => resource === '021', onUnitSplitChange,
    unitSplitEnabledByResource: { '021': false } };
  const view = render(<PlanningBoardGanttDisplay {...values} singleResourceCd="021" />);
  const button = screen.getByRole('button', { name: '1台ずつ' });
  expect(button).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(button); expect(onUnitSplitChange).toHaveBeenCalledWith('021', true);
  view.rerender(<PlanningBoardGanttDisplay {...values} singleResourceCd="021+022" />);
  expect(screen.getByRole('button', { name: '1台ずつ' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: '1台ずつ' })).toBeDisabled();
  view.rerender(<PlanningBoardGanttDisplay {...values} singleResourceCd="022" />);
  expect(screen.queryByRole('button', { name: '1台ずつ' })).not.toBeInTheDocument();
});


describe('two-machine chain links', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(260);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const viewport = this.closest<HTMLElement>('[data-gantt-viewport]');
      const top = this.closest('section[aria-label="022"]') ? 400 : 100;
      return new DOMRect(100, top - (viewport && viewport !== this ? viewport.scrollTop : 0), 1000, 260);
    });
  });
  afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

  function pieces(resources = ['021', '022']) {
    const fixture = productionFixture(1, 1);
    const items = resources.map((resource, index) => ({ ...fixture.items[0]!,
      kind: 'piece' as const, itemId: `piece:p${index}`, pieceId: `p${index}`, parentItemId: 'parent',
      piecePosition: index + 1, quantity: 1, plannedQuantity: 1, parentPlannedQuantity: resources.length,
      originalResourceCd: resource, requiredMinutes: 60, specialDue: null, alternateRank: index + 1 }));
    return { ...props('forward'), layout: buildPlanningBoardGanttLayout({ ...fixture.options, items, resources: ['021', '022'] }) };
  }
  const bar = (index: number) => screen.getAllByTestId(`planning-gantt-bar-piece:p${index}`)[0]!;

  it.each([0, 1])('links pieces across panes and highlights the partner when selecting piece %s', selected => {
    render(<PlanningBoardGanttDisplay {...pieces()} />);
    fireEvent.click(bar(selected));
    const link = screen.getByTestId('planning-gantt-piece-link');
    expect(link).toHaveAttribute('data-from-to', 'piece:p0->piece:p1');
    expect(link).toHaveAttribute('stroke', 'white');
    expect(link).toHaveAttribute('stroke-width', '2');
    expect(link).not.toHaveAttribute('stroke-dasharray');
    const overlay = screen.getByTestId('planning-gantt-cross-pane-links');
    expect(overlay).toContainElement(link);
    expect(overlay).toHaveClass('pointer-events-none');
    expect(overlay.querySelectorAll('clipPath rect')).toHaveLength(2);
    expect(bar(1 - selected)).toHaveClass('outline-white');
    expect(screen.getAllByRole('region', { name: '工程のつながり' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '工程のつながりを閉じる' }));
    expect(screen.queryByTestId('planning-gantt-piece-link')).toBeNull();
    expect(bar(1 - selected)).not.toHaveClass('outline-white');
  });

  const controls = (): NonNullable<PlanningBoardGanttProps['testBarControls']> => ({
    bars: [], nextSequence: 1, selectedId: null, selectedBar: null, disabled: false,
    select: vi.fn(), create: vi.fn(async () => true), remove: vi.fn(), complete: vi.fn(), accept: vi.fn(), undo: vi.fn()
  });
  const expectCleared = () => {
    expect(screen.queryByRole('region', { name: '工程のつながり' })).toBeNull();
    expect(screen.queryByTestId('planning-gantt-piece-link')).toBeNull();
    expect(screen.queryByTestId('planning-gantt-chain-link')).toBeNull();
    for (const element of screen.getAllByTestId(/^planning-gantt-bar-piece:/)) expect(element).not.toHaveClass('outline-white');
  };

  it.each([0, 1])('clears focus after the last owner bar moves away (owner %s)', owner => {
    const values = pieces();
    const view = render(<PlanningBoardGanttDisplay {...values} />);
    fireEvent.click(bar(owner));
    expect(screen.getByTestId('planning-gantt-piece-link')).toBeInTheDocument();
    const partner = owner === 0 ? '022' : '021';
    view.rerender(<PlanningBoardGanttDisplay {...pieces([partner, partner])} />);
    expectCleared();
    view.rerender(<PlanningBoardGanttDisplay {...values} />);
    expectCleared();
  });

  it.each([0, 1])('clears focus after replacing the owner machine (owner %s)', owner => {
    const values = { ...pieces(), resourceLanes: ['021', '022', '023'] };
    const view = render(<PlanningBoardGanttDisplay {...values} />);
    fireEvent.click(bar(owner));
    expect(screen.getByTestId('planning-gantt-piece-link')).toBeInTheDocument();
    view.rerender(<PlanningBoardGanttDisplay {...values} singleResourceCd={owner === 0 ? '023+022' : '021+023'} />);
    expectCleared();
    view.rerender(<PlanningBoardGanttDisplay {...values} />);
    expectCleared();
  });

  it.each([0, 1])('clears shared outlines and links on a non-owner blank tap (owner %s)', owner => {
    class Pointer extends MouseEvent { readonly pointerId = 1; }
    vi.stubGlobal('PointerEvent', Pointer);
    try {
      render(<PlanningBoardGanttDisplay {...pieces()} />);
      fireEvent.click(bar(owner));
      expect(bar(0)).toHaveClass('outline-white');
      expect(bar(1)).toHaveClass('outline-white');
      expect(screen.getByTestId('planning-gantt-piece-link')).toBeInTheDocument();
      const blank = within(screen.getByRole('region', { name: owner === 0 ? '022' : '021' })).getByLabelText('ガントの日付と工程');
      fireEvent.pointerDown(blank, { button: 0, clientX: 500, clientY: 420 });
      fireEvent.pointerUp(blank, { button: 0, clientX: 500, clientY: 420 });
      expectCleared();
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([0, 1])('keeps the insertion anchor when transferring the same part (owner %s)', async owner => {
    const testControls = controls();
    render(<PlanningBoardGanttDisplay {...pieces()} testBarCreationEnabled testBarControls={testControls} />);
    fireEvent.click(bar(owner));
    fireEvent.click(bar(1 - owner));
    expect(screen.getByRole('region', { name: '工程のつながり' })).toBeInTheDocument();
    expect(screen.getByTestId('planning-gantt-piece-link')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: owner === 0 ? '021' : '022' })).queryByTestId(/^planning-gantt-chain-badge-/)).toBeNull();
    expect(within(screen.getByRole('region', { name: owner === 0 ? '022' : '021' })).getByTestId(/^planning-gantt-chain-badge-/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '棒を差し込む' }));
    const dialog = screen.getByRole('dialog', { name: 'テスト加工' });
    expect(within(dialog).getByRole('button', { name: owner === 0 ? '022' : '021', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '差し込む' })); });
    expect(testControls.create).toHaveBeenCalledExactlyOnceWith(owner === 0 ? '022' : '021', 30, expect.objectContaining({ itemId: `piece:p${1 - owner}` }));
    fireEvent.click(screen.getByRole('button', { name: '工程のつながりを閉じる' }));
    expectCleared();
  });

  it('clears shared outlines and links when selecting a test bar', () => {
    const values = pieces();
    const test: GrindingPlanningBoardTestBar = { kind: 'test', itemId: 'test:focus', itemRevision: 'test:r1', version: 1,
      sequence: 1, name: 'テスト1', resourceCd: '022', minutes: 30, alternateRank: 2, isCompleted: false, completedAt: null, deletedAt: null };
    const items = values.layout.groups.flatMap(group => group.rows.flatMap(row => row.bars.map(entry => entry.item))).filter(item => item.kind !== 'test');
    values.layout = buildPlanningBoardGanttLayout({ ...productionFixture().options, items, resources: ['021', '022'], testBars: [test] });
    const testControls = { ...controls(), bars: [test] };
    render(<PlanningBoardGanttDisplay {...values} testBarControls={testControls} />);
    fireEvent.click(bar(0));
    expect(bar(1)).toHaveClass('outline-white');
    expect(screen.getByTestId('planning-gantt-piece-link')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('planning-gantt-bar-test:focus'));
    expect(testControls.select).toHaveBeenCalledWith(test, true);
    expectCleared();
  });

  it('clears shared focus when entering pin mode without restoring it on exit', () => {
    const values = pieces();
    const view = render(<PlanningBoardGanttDisplay {...values} />);
    fireEvent.click(bar(0));
    expect(screen.getByTestId('planning-gantt-piece-link')).toBeInTheDocument();
    view.rerender(<PlanningBoardGanttDisplay {...values} pinMode />);
    expect(screen.queryByTestId('planning-gantt-piece-link')).toBeNull();
    view.rerender(<PlanningBoardGanttDisplay {...values} pinMode={false} />);
    expect(screen.queryByTestId('planning-gantt-piece-link')).toBeNull();
    expect(bar(1)).not.toHaveClass('outline-white');
  });

  it('keeps same-pane piece links single and inside that pane', () => {
    render(<PlanningBoardGanttDisplay {...pieces(['021', '021'])} />);
    fireEvent.click(bar(0));
    expect(screen.getAllByTestId('planning-gantt-piece-link')).toHaveLength(1);
    expect(screen.getByRole('region', { name: '021' })).toContainElement(screen.getByTestId('planning-gantt-piece-link'));
    expect(within(screen.getByTestId('planning-gantt-cross-pane-links')).queryByTestId('planning-gantt-piece-link')).toBeNull();
  });

  it('also draws the unselected pane internal pair using the combined order', () => {
    render(<PlanningBoardGanttDisplay {...pieces(['022', '022', '021'])} />);
    fireEvent.click(bar(2));
    expect(screen.getAllByTestId('planning-gantt-piece-link')).toHaveLength(2);
    expect(within(screen.getByRole('region', { name: '022' })).getByTestId('planning-gantt-piece-link'))
      .toHaveAttribute('data-from-to', 'piece:p0->piece:p1');
    expect(within(screen.getByTestId('planning-gantt-cross-pane-links')).getByTestId('planning-gantt-piece-link'))
      .toHaveAttribute('data-from-to', 'piece:p1->piece:p2');
  });

  it('does not connect same-pane pieces across an intervening partner piece', () => {
    render(<PlanningBoardGanttDisplay {...pieces(['021', '022', '021'])} />);
    fireEvent.click(bar(0));
    expect(screen.getAllByTestId('planning-gantt-piece-link')).toHaveLength(2);
    expect(within(screen.getByRole('region', { name: '021' })).queryByTestId('planning-gantt-piece-link')).toBeNull();
  });

  it('updates endpoints on scroll and resize, coalescing scroll measurements', () => {
    render(<PlanningBoardGanttDisplay {...pieces()} />);
    fireEvent.click(bar(0));
    const link = () => screen.getByTestId('planning-gantt-piece-link').getAttribute('d');
    const initial = link();
    const viewport = bar(1).closest<HTMLElement>('[data-gantt-viewport]')!;
    const rect = vi.fn(() => new DOMRect(100, 100, 1000, 600));
    Object.defineProperty(screen.getByTestId('planning-two-machine'), 'getBoundingClientRect', { configurable: true, value: rect });
    viewport.scrollTop = 80;
    fireEvent.scroll(viewport);
    fireEvent.scroll(viewport);
    expect(link()).toBe(initial);
    act(() => vi.advanceTimersByTime(20));
    expect(link()).not.toBe(initial);
    expect(rect).toHaveBeenCalledTimes(1);
    viewport.scrollTop = 120;
    fireEvent(window, new Event('resize'));
    act(() => vi.advanceTimersByTime(20));
    expect(link()).not.toBe(initial);
    const clips = screen.getByTestId('planning-gantt-cross-pane-links').querySelectorAll('clipPath rect');
    expect(clips[0]).toHaveAttribute('width', '832');
    expect(clips[1]).toHaveAttribute('height', '260');
  });

  it('includes the thick pane divider in the clip without covering labels', () => {
    render(<PlanningBoardGanttDisplay {...pieces()} />);
    const viewport = bar(1).closest<HTMLElement>('[data-gantt-viewport]')!;
    Object.defineProperty(viewport, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(100, 364, 1000, 260) });
    fireEvent.click(bar(0));
    const clips = screen.getByTestId('planning-gantt-cross-pane-links').querySelectorAll('clipPath rect');
    expect(clips).toHaveLength(3);
    expect(clips[2]).toHaveAttribute('y', '260');
    expect(clips[2]).toHaveAttribute('height', '4');
    expect(clips[2]).toHaveAttribute('x', '168');
    expect(clips[2]).toHaveAttribute('width', '832');
  });

  it('uses process dashes and a circle across panes after the last interval of a piece', () => {
    const values = pieces(['021', '022', '022']);
    const original = values.layout.groups.flatMap(group => group.rows.flatMap(row => row.bars)).map(bar => bar.item).filter(item => item.kind !== 'test');
    const items = original.map(item => ({ ...item,
      parentItemId: item.itemId === 'piece:p2' ? 'next' : 'parent', pieceId: item.itemId === 'piece:p2' ? 'next' : 'p',
      opRange: { fromOpNo: item.itemId === 'piece:p0' ? 10 : 20, toOpNo: item.itemId === 'piece:p0' ? 19 : 30 },
      processOrder: item.itemId === 'piece:p2' ? '20' : '10',
      originalResourceCd: item.itemId === 'piece:p1' ? '021' : '022' }));
    const fixture = productionFixture(1, 1);
    values.layout = buildPlanningBoardGanttLayout({ ...fixture.options, items, resources: ['021', '022'] });
    render(<PlanningBoardGanttDisplay {...values} />);
    fireEvent.click(bar(0));
    fireEvent.click(screen.getByRole('button', { name: '線の表示を切り替える(今は分割)' }));
    const link = screen.getByTestId('planning-gantt-chain-link');
    expect(link).toHaveAttribute('data-from-to', 'piece:p1->piece:p2');
    expect(link).toHaveAttribute('stroke-dasharray', '6 4');
    expect(link.parentElement?.querySelector('circle')).toHaveAttribute('fill', 'white');
    expect(screen.queryByTestId('planning-gantt-piece-link')).toBeNull();
  });
});

describe('two-machine forward dragging', () => {
  class TestPointerEvent extends MouseEvent {
    readonly pointerId = 1;
    readonly pointerType = 'mouse';
  }
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: vi.fn(() => []) });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const lower = this.closest('section[aria-label="022"]');
      return new DOMRect(100, lower ? 400 : 100, 1000, 60);
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(document, 'elementsFromPoint');
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
  });
  const bar = (id: string) => screen.getAllByTestId(`planning-gantt-bar-${id}`)[0]!;
  const pointAt = (target: HTMLElement) => vi.mocked(document.elementsFromPoint).mockReturnValue([target]);
  const begin = (source: HTMLElement, target: HTMLElement, x = 100) => {
    pointAt(target);
    fireEvent.pointerDown(source, { button: 0, clientX: 150, clientY: 120 });
    fireEvent.pointerMove(source, { clientX: x, clientY: 420 });
  };
  const end = (source: HTMLElement, x = 100) => fireEvent.pointerUp(source, { clientX: x, clientY: 420 });

  it.each([
    ['item-0000', 'item-0001', '022'],
    ['item-0001', 'item-0000', '021']
  ])('moves %s across panes before %s on %s, showing one arrow and ghost', (sourceId, targetId, resource) => {
    const values = props('forward');
    // Row keys can collide between panes; resource must also identify the lane and arrow origin.
    values.layout.groups[1]!.rows[0]!.key = values.layout.groups[0]!.rows[0]!.key;
    const onResourceMove = vi.fn();
    const onResourceReorder = vi.fn();
    render(<PlanningBoardGanttDisplay {...values} onResourceMove={onResourceMove} onResourceReorder={onResourceReorder} canMoveResource={() => true} />);
    const source = bar(sourceId); const target = bar(targetId);
    begin(source, target);
    const insertion = screen.getByTestId('planning-gantt-insertion');
    expect(insertion.closest('[data-gantt-window-row]')).toBe(target.closest('[data-gantt-window-row]'));
    expect(insertion.style.left).toBe(target.style.left);
    expect(target.closest('[data-gantt-lane-resource]')).toHaveStyle({ outline: '3px solid rgb(110 231 183)' });
    const arrow = screen.getByTestId('planning-gantt-drag-arrow').querySelector('path[stroke]')!;
    expect(arrow).toHaveAttribute('stroke', 'rgb(52 211 153)');
    expect(arrow).toHaveAttribute('stroke-width', '3');
    expect(arrow).toHaveAttribute('d', resource === '022' ? 'M600 130 Q600 95 600 430' : 'M600 430 Q600 95 600 130');
    expect(screen.getAllByTestId('planning-gantt-drag-ghost')).toHaveLength(1);
    end(source);
    expect(onResourceMove).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ itemId: sourceId }), resource,
      expect.objectContaining({ itemId: targetId }), 'before');
    expect(onResourceReorder).not.toHaveBeenCalled();
    expect(screen.queryByTestId('planning-gantt-insertion')).toBeNull();
    expect(screen.queryByTestId('planning-gantt-drag-arrow')).toBeNull();
    expect(screen.queryByTestId('planning-gantt-drag-ghost')).toBeNull();
  });

  it('does not remeasure chain links for shared drag previews', () => {
    render(<PlanningBoardGanttDisplay {...props('forward')} onResourceMove={vi.fn()} canMoveResource={() => true} />);
    const source = bar('item-0000');
    fireEvent.click(source);
    const measure = vi.fn(() => new DOMRect(100, 100, 1000, 600));
    Object.defineProperty(screen.getByTestId('planning-two-machine'), 'getBoundingClientRect', { configurable: true, value: measure });
    begin(source, bar('item-0001'));
    fireEvent.pointerMove(source, { clientX: 200, clientY: 430 });
    expect(screen.getByTestId('planning-gantt-drag-ghost')).toBeInTheDocument();
    expect(measure).not.toHaveBeenCalled();
    fireEvent.pointerCancel(source);
  });

  it('keeps the source pane still while dragging over the other pane, but scrolls it near its own edge', () => {
    render(<PlanningBoardGanttDisplay {...props('forward')} onResourceMove={vi.fn()} canMoveResource={() => true} />);
    const source = bar('item-0000');
    const upper = source.closest<HTMLElement>('[data-gantt-viewport]')!;
    upper.scrollTop = 0;
    begin(source, bar('item-0001'));
    act(() => { vi.advanceTimersByTime(200); });
    expect(upper.scrollTop).toBe(0);
    pointAt(source);
    fireEvent.pointerMove(source, { clientX: 100, clientY: 150 });
    act(() => { vi.advanceTimersByTime(200); });
    expect(upper.scrollTop).toBeGreaterThan(0);
    end(source);
  });

  it('moves after a bar using the destination working window start', () => {
    const fixture = productionFixture(2, 1);
    const items = fixture.items.map((item, i) => ({ ...item, originalResourceCd: i ? '022' : '021', requiredMinutes: 60, specialDue: null }));
    const dailyHoursByResource = { '021': 8, '022': 24 } as const;
    const layout = buildPlanningBoardGanttLayout({ ...fixture.options, items, resources: ['021', '022'], scale: 1, dailyHoursByResource });
    const onResourceMove = vi.fn();
    render(<PlanningBoardGanttDisplay {...props('forward')} layout={layout} scale={1} dailyHoursByResource={dailyHoursByResource}
      onResourceMove={onResourceMove} canMoveResource={() => true} />);
    const source = bar(items[0]!.itemId); const target = bar(items[1]!.itemId);
    begin(source, target, 10000);
    const insertion = screen.getByTestId('planning-gantt-insertion');
    expect(insertion.closest('[data-gantt-window-row]')).toBe(target.closest('[data-gantt-window-row]'));
    expect(parseFloat(insertion.style.left)).toBeCloseTo(parseFloat(target.style.left) + parseFloat(target.style.width) + 2);
    end(source, 10000);
    expect(onResourceMove).toHaveBeenCalledExactlyOnceWith(items[0], '022', items[1], 'after');
  });

  it('moves to an empty partner pane', () => {
    const onResourceMove = vi.fn();
    render(<PlanningBoardGanttDisplay {...props('forward', true)} onResourceMove={onResourceMove} canMoveResource={() => true} />);
    const source = bar('item-0000');
    const lane = screen.getByRole('region', { name: '022' }).querySelector<HTMLElement>('[data-gantt-window-row]')!;
    begin(source, lane);
    expect(screen.getByTestId('planning-gantt-insertion').closest('[data-gantt-window-row]')).toBe(lane);
    end(source);
    expect(onResourceMove).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ itemId: 'item-0000' }), '022', null, 'after');
  });

  it('keeps a test bar in its original pane', () => {
    const values = props('forward');
    const test: GrindingPlanningBoardTestBar = { kind: 'test', itemId: 'test:drag', itemRevision: 'test:r1', version: 1,
      sequence: 1, name: 'テスト1', resourceCd: '021', minutes: 30, alternateRank: 1, isCompleted: false, completedAt: null, deletedAt: null };
    values.layout = buildPlanningBoardGanttLayout({ ...productionFixture().options,
      items: values.layout.groups.flatMap(group => group.rows.flatMap(row => row.bars.map(entry => entry.item))).filter(item => item.kind !== 'test'),
      resources: ['021', '022'], testBars: [test] });
    const onResourceMove = vi.fn(); const onResourceReorder = vi.fn();
    render(<PlanningBoardGanttDisplay {...values} onResourceMove={onResourceMove} onResourceReorder={onResourceReorder} canMoveResource={() => true} />);
    const source = bar(test.itemId);
    begin(source, bar('item-0001'));
    expect(screen.queryByTestId('planning-gantt-insertion')).toBeNull();
    expect(screen.queryByTestId('planning-gantt-drag-arrow')).toBeNull();
    end(source);
    expect(onResourceMove).not.toHaveBeenCalled();
    expect(onResourceReorder).not.toHaveBeenCalled();
  });

  it.each([
    ['pieceops:u:20', 'item-b', '022'],
    ['item-b', 'pieceops:u:20', '021'],
    ['piece:u', 'item-b', '022']
  ])('moves operation interval bars across panes (%s before %s on %s)', (sourceId, targetId, resource) => {
    const fixture = productionFixture(2, 1);
    const pieceBase = { ...fixture.items[0]!, kind: 'piece' as const, pieceId: 'u', parentItemId: 'parent', piecePosition: 1,
      quantity: 1, plannedQuantity: 1, parentPlannedQuantity: 1, originalResourceCd: '021', requiredMinutes: 60, specialDue: null };
    // The suffix interval is placed first so it is the nearest drop target in its lane.
    const items = [
      { ...pieceBase, itemId: 'piece:u', opRange: { fromOpNo: 10, toOpNo: 19 }, alternateRank: 2 },
      { ...pieceBase, itemId: 'pieceops:u:20', opRange: { fromOpNo: 20, toOpNo: 30 }, alternateRank: 1 },
      { ...fixture.items[1]!, itemId: 'item-b', originalResourceCd: '022', requiredMinutes: 60, specialDue: null }
    ];
    const layout = buildPlanningBoardGanttLayout({ ...fixture.options, items, resources: ['021', '022'] });
    const onResourceMove = vi.fn(); const onResourceReorder = vi.fn();
    render(<PlanningBoardGanttDisplay {...props('forward')} layout={layout} onResourceMove={onResourceMove}
      onResourceReorder={onResourceReorder} canMoveResource={() => true} />);
    const source = bar(sourceId); const target = bar(targetId);
    begin(source, target);
    expect(screen.getByTestId('planning-gantt-insertion').closest('[data-gantt-window-row]')).toBe(target.closest('[data-gantt-window-row]'));
    expect(screen.getAllByTestId('planning-gantt-drag-ghost')).toHaveLength(1);
    end(source);
    expect(onResourceMove).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ itemId: sourceId }), resource,
      expect.objectContaining({ itemId: targetId }), 'before');
    expect(onResourceReorder).not.toHaveBeenCalled();
  });

  it('does not insert a bar next to a test bar in the other pane', () => {
    const values = props('forward');
    const test: GrindingPlanningBoardTestBar = { kind: 'test', itemId: 'test:target', itemRevision: 'test:r1', version: 1,
      sequence: 1, name: 'テスト1', resourceCd: '022', minutes: 30, alternateRank: 1, isCompleted: false, completedAt: null, deletedAt: null };
    values.layout = buildPlanningBoardGanttLayout({ ...productionFixture().options,
      items: values.layout.groups.flatMap(group => group.rows.flatMap(row => row.bars.map(entry => entry.item))).filter(item => item.kind !== 'test'),
      resources: ['021', '022'], testBars: [test] });
    const onResourceMove = vi.fn();
    render(<PlanningBoardGanttDisplay {...values} onResourceMove={onResourceMove} canMoveResource={() => true} />);
    const source = bar('item-0000');
    begin(source, bar(test.itemId));
    expect(screen.queryByTestId('planning-gantt-insertion')).toBeNull();
    end(source);
    expect(onResourceMove).not.toHaveBeenCalled();
  });

  it.each([true, false])('uses the existing resource guard for only the dragged unit piece (allowed=%s)', allowed => {
    const fixture = productionFixture(3, 1);
    const items = fixture.items.map((item, i) => ({ ...item, itemId: `piece:unit-${i}`, kind: 'piece' as const,
      parentItemId: 'parent', pieceId: `unit-${i}`, piecePosition: i + 1, quantity: 1, plannedQuantity: 1, parentPlannedQuantity: 3,
      originalResourceCd: i === 1 ? '022' : '021', requiredMinutes: 60, specialDue: null }));
    const layout = buildPlanningBoardGanttLayout({ ...fixture.options, items, resources: ['021', '022'] });
    const canMoveResource = vi.fn((item, resource) => allowed && item.itemId === items[0]!.itemId && resource === '022');
    const onResourceMove = vi.fn();
    render(<PlanningBoardGanttDisplay {...props('forward')} layout={layout} canMoveResource={canMoveResource} onResourceMove={onResourceMove} />);
    const source = bar(items[0]!.itemId);
    begin(source, bar(items[1]!.itemId)); end(source);
    expect(canMoveResource).toHaveBeenCalledWith(items[0], '022');
    if (allowed) expect(onResourceMove).toHaveBeenCalledExactlyOnceWith(items[0], '022', items[1], 'before');
    else expect(onResourceMove).not.toHaveBeenCalled();
  });

  it.each(['021+022', '021'])('preserves same-pane reordering in %s mode', selection => {
    const values = props('forward');
    const onResourceReorder = vi.fn(); const onResourceMove = vi.fn();
    render(<PlanningBoardGanttDisplay {...values} singleResourceCd={selection} onResourceReorder={onResourceReorder} onResourceMove={onResourceMove} canMoveResource={() => true} />);
    const source = bar('item-0000');
    begin(source, bar('item-0002'));
    expect(screen.getByTestId('planning-gantt-insertion').closest('[data-gantt-window-row]')).toBe(bar('item-0002').closest('[data-gantt-window-row]'));
    expect(screen.getByTestId('planning-gantt-drag-arrow')).toBeInTheDocument();
    end(source);
    expect(onResourceReorder).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ itemId: 'item-0000' }), expect.objectContaining({ itemId: 'item-0002' }), 'before');
    expect(onResourceMove).not.toHaveBeenCalled();
  });

  it('starts at 8px and keeps a stationary 500ms long press as selection', () => {
    const values = props('forward'); const onResourceMove = vi.fn();
    render(<PlanningBoardGanttDisplay {...values} onResourceMove={onResourceMove} canMoveResource={() => true} />);
    const source = bar('item-0000'); pointAt(bar('item-0001'));
    fireEvent.pointerDown(source, { button: 0, clientX: 100, clientY: 100 });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerUp(source, { clientX: 100, clientY: 100 });
    expect(values.onToggleItem).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'item-0000' }), true);
    expect(onResourceMove).not.toHaveBeenCalled();
    fireEvent.pointerDown(source, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(source, { clientX: 107, clientY: 100 });
    expect(screen.queryByTestId('planning-gantt-drag-ghost')).toBeNull();
    fireEvent.pointerMove(source, { clientX: 108, clientY: 100 });
    expect(screen.getByTestId('planning-gantt-drag-ghost')).toBeInTheDocument();
    fireEvent.pointerCancel(source);
    expect(screen.queryByTestId('planning-gantt-insertion')).toBeNull();
    expect(screen.queryByTestId('planning-gantt-drag-arrow')).toBeNull();
    expect(onResourceMove).not.toHaveBeenCalled();
  });

  it('moves a queue card across panes with the same insertion and arrow', () => {
    const onResourceMove = vi.fn();
    render(<PlanningBoardGanttDisplay {...props('forward')} onResourceMove={onResourceMove} canMoveResource={() => true} />);
    fireEvent.pointerEnter(bar('item-0000'));
    const source = screen.getByTestId('planning-forward-queue-card-item-0000');
    begin(source, bar('item-0001'), 0);
    expect(screen.getByTestId('planning-gantt-insertion').closest('[data-resource-code]')).toHaveAttribute('data-resource-code', '022');
    expect(screen.getByTestId('planning-gantt-drag-arrow')).toBeInTheDocument();
    expect(screen.getAllByTestId('planning-gantt-drag-ghost')).toHaveLength(1);
    end(source, 0);
    expect(onResourceMove).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ itemId: 'item-0000' }), '022', expect.objectContaining({ itemId: 'item-0001' }), 'before');
  });

  it.each(['alternate', 'original'] as const)('honors the page allocation guard (%s)', allocation => {
    const values = props('forward');
    const items = values.layout.groups.flatMap(group => group.rows.flatMap(row => row.bars.map(entry => entry.item))).filter(item => item.kind !== 'test');
    const data: GrindingPlanningBoardResponse = { siteKey: 'site', category: 'cutting', view: 'resource', sourceRevision: 'r1', boardVersion: 1,
      registeredFseibans: [], uncheckedFseibans: [], seibanOrder: [], resources: ['021', '022'], items, load: [],
      unknownRequiredMinutesCount: 0, seibanProgress: {}, snapshotId: 'snapshot', nextCursor: null };
    localStorage.setItem('kiosk.planning-board.single-resource:drag-guard', JSON.stringify({ schemaVersion: 1, resourceCd: '021+022' }));
    const onResourceMove = vi.fn();
    function Page() {
      const gantt = usePlanningBoardGantt({ ...productionFixture().options, items, resources: data.resources, category: 'cutting',
        allocation, enabled: true, preferenceScope: 'drag-guard' });
      return <PlanningBoardPageView data={data} gantt={gantt} ganttLayout={gantt.layout} ganttEnabled view="resource" category="cutting"
        allocation={allocation} focusedSeiban={null} setFocusedSeiban={vi.fn()} colorBySeiban={false} registeredFseibans={[]}
        resourcesQuery={{}} pinMode={false} togglePin={vi.fn()} selectedItemIds={new Set()} toggleItem={vi.fn()}
        toggleCompletion={vi.fn()} completionPendingItemIds={new Set()} moveDueByDrag={vi.fn()} reorderResourceByDrag={vi.fn()}
        moveResourceInGantt={onResourceMove} canMoveResource={() => true} interactionLocked={false} writeQueue={{ pending: false }}
        writeBlocked={false} piecesWriting={false} rankMutationReady orderPreview={null} focusedFseiban={null} focusItems={[]}
        machineNames={new Map()} returnFromFocus={vi.fn()} toggleFocusAll={vi.fn()} openEditorForItem={vi.fn()} changeRank={vi.fn()}
        rankDisabled={() => false} bulkReady activeFseibans={new Set()} itemsBySeiban={new Map()} paneActionsBySeiban={new Map()}
        sortedItemsBySeiban={new Map()} openFseibans={new Set()} scanFocusKey={0} visibleItems={items} moveResourceByDrag={vi.fn()}
        specialDueMode={null} updateSpecialDue={vi.fn()} nowMs={0} resourceDragDisabled={false} />;
    }
    render(<QueryClientProvider client={new QueryClient()}><Page /></QueryClientProvider>);
    const source = bar('item-0000'); begin(source, bar('item-0001')); end(source);
    if (allocation === 'alternate') expect(onResourceMove).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ itemId: 'item-0000' }), '022', expect.objectContaining({ itemId: 'item-0001' }), 'before');
    else {
      expect(onResourceMove).not.toHaveBeenCalled();
      expect(screen.queryByTestId('planning-gantt-insertion')).toBeNull();
    }
  });
});
