import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { productionFixture } from '../__perf__/fixture';
import { isPlanningBoardUnitSplitEnabled } from '../planningBoardUnitSplitPolicy';

import { PlanningBoardGanttDisplay } from './PlanningBoardGanttDisplay';
import { buildPlanningBoardGanttLayout } from './planningBoardGanttLayout';
import { PlanningBoardGanttView } from './PlanningBoardGanttView';
import { buildSingleResourceWindows } from './planningBoardSingleResourceWindows';
import { usePersistedPlanningBoardSingleResource } from './usePersistedPlanningBoardSingleResource';
import { usePlanningBoardGantt } from './usePlanningBoardGantt';

import type { PlanningBoardGanttHandle, PlanningBoardGanttProps } from './planningBoardGanttViewTypes';

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
  const sheet = screen.getByRole('region', { name: '品番の値' });
  expect(sheet.parentElement).toBe(screen.getByTestId('planning-two-machine'));
  expect(sheet.parentElement).toHaveClass('relative');
  expect(sheet).toHaveClass('absolute', 'inset-x-0', 'bottom-0');
  expect(sheet).toHaveStyle({ height: 'min(56%, 520px)' });
  expect(within(screen.getByRole('region', { name: '021' })).queryByRole('region', { name: '品番の値' })).toBeNull();
  expect(within(sheet).getByText(values.layout.groups[0]!.rows[0]!.bars[0]!.item.fhincd)).toBeInTheDocument();
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
  const values = props('forward');
  const layout = { ...values.layout, groups: lanes.map(resource => values.layout.groups.find(group => group.resource === resource) ?? { key: resource, label: resource, resource, rows: [] }) };
  return <PlanningBoardGanttDisplay {...values} layout={layout} singleResourceCd={selection} resourceLanes={lanes}
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
