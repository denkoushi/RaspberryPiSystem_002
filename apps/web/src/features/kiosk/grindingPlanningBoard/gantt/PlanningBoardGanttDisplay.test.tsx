import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { productionFixture } from '../__perf__/fixture';
import { isPlanningBoardUnitSplitEnabled } from '../planningBoardUnitSplitPolicy';

import { PlanningBoardGanttDisplay } from './PlanningBoardGanttDisplay';
import { buildPlanningBoardGanttLayout } from './planningBoardGanttLayout';
import { buildSingleResourceWindows } from './planningBoardSingleResourceWindows';

import type { PlanningBoardGanttHandle, PlanningBoardGanttProps } from './planningBoardGanttViewTypes';

vi.mock('../../../../api/hooks/machine-signal', () => ({ useMachineSignalResourceUptime: () => ({ data: undefined }) }));
afterEach(() => vi.restoreAllMocks());

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
  return { layout, singleResourceCd: '021+022', scale: 14, dailyHoursByResource: {}, resourceNameMap: {},
    capacityPending: false, capacityError: false, onCapacityChange: vi.fn(), onToggleItem: vi.fn(), onDueDrop: vi.fn(),
    disabled: false, dragDisabled: false, selectedItemIds: new Set(), resourceView: true,
    focusedSeiban: null, onFocusedSeibanChange: vi.fn() };
}

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

it('uses one shared settings row for the upper machine and opens its value sheet', () => {
  const values = props('forward');
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
  expect(onSource).toHaveBeenCalledWith({ resourceCd: '021', source: 'own' });
  fireEvent.click(screen.getByRole('button', { name: /品番の値/ }));
  expect(within(screen.getByRole('region', { name: '021' })).getByRole('region', { name: '品番の値' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /品番の値/ }));
  expect(screen.queryByRole('region', { name: '品番の値' })).not.toBeInTheDocument();
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
  return <PlanningBoardGanttDisplay {...props('forward')} singleResourceCd={selection} resourceLanes={lanes}
    unitSplitEnabledByResource={flags} onSingleResourceChange={next => setSelection(next ?? '')} selectedItemIds={selected} />;
}

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
  render(<PlanningBoardGanttDisplay {...values} layout={layout} singleResourceCd="306+305" resourceLanes={['305', '306']}
    unitSplitEnabledByResource={{ '305': true, '306': true }} />);
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
