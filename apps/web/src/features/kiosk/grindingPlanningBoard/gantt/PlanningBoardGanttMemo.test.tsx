import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { PlanningBoardPlacementContext, PlanningBoardProcessChipsContext } from '../planningBoardProcessChips';

import { PlanningBoardGanttDisplay } from './PlanningBoardGanttDisplay';
import { buildPlanningBoardGanttLayout, planningBoardPartKey } from './planningBoardGanttLayout';
import { PlanningBoardGanttView } from './PlanningBoardGanttView';
import { usePlanningBoardDragPreview } from './usePlanningBoardSharedDrag';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import type { ComponentProps, ReactNode } from 'react';

const uptimeQuery = vi.hoisted(() => vi.fn(() => ({ data: { resources: [{ resourceCd: '305', medianRunSeconds: 28080 }] } })));
vi.mock('../../../../api/hooks/machine-signal', () => ({ useMachineSignalResourceUptime: uptimeQuery }));

const shelfRenders = vi.hoisted(() => [] as number[]);
vi.mock('./PlanningBoardSeibanShelf', async importOriginal => {
  const actual = await importOriginal<typeof import('./PlanningBoardSeibanShelf')>();
  const { memo, forwardRef } = await import('react');
  return { ...actual, PlanningBoardSeibanShelf: memo(forwardRef<HTMLDivElement, ComponentProps<typeof actual.PlanningBoardSeibanShelf>>(function CountedShelf(props, ref) {
    shelfRenders.push(1);
    return <actual.PlanningBoardSeibanShelf {...props} ref={ref} />;
  })) };
});

const shelfColumnRenders = vi.hoisted(() => [] as string[]);
vi.mock('./PlanningBoardSeibanShelfColumn', async importOriginal => {
  const actual = await importOriginal<typeof import('./PlanningBoardSeibanShelfColumn')>();
  const { memo } = await import('react');
  return { ...actual, PlanningBoardSeibanShelfColumn: memo(function CountedColumn(props: ComponentProps<typeof actual.PlanningBoardSeibanShelfColumn>) {
    shelfColumnRenders.push(props.column.seiban);
    return <actual.PlanningBoardSeibanShelfColumn {...props} />;
  }) };
});

const shelfBuilds = vi.hoisted(() => vi.fn());
vi.mock('./planningBoardSeibanShelfData', async importOriginal => {
  const actual = await importOriginal<typeof import('./planningBoardSeibanShelfData')>();
  return { ...actual, buildPlanningBoardSeibanShelf: (...args: Parameters<typeof actual.buildPlanningBoardSeibanShelf>) => {
    shelfBuilds(args[2]);
    return actual.buildPlanningBoardSeibanShelf(...args);
  } };
});

const renders = vi.hoisted(() => [] as string[]);
vi.mock('./PlanningBoardForwardGanttRow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PlanningBoardForwardGanttRow')>();
  const { memo } = await import('react');
  return { ...actual, PlanningBoardForwardGanttRow: memo(function CountedRow(props: ComponentProps<typeof actual.PlanningBoardForwardGanttRow>) {
    renders.push(props.row.key);
    return <actual.PlanningBoardForwardGanttRow {...props} />;
  }) };
});
const backwardRenders = vi.hoisted(() => [] as string[]);
vi.mock('./PlanningBoardGanttRow', async importOriginal => {
  const actual = await importOriginal<typeof import('./PlanningBoardGanttRow')>();
  const { memo } = await import('react');
  type Props = ComponentProps<typeof actual.PlanningBoardGanttRow>;
  // 行の本体の中で数える(Context による描き直しも入る)。memo の比較は本物を使う。
  const row = actual.PlanningBoardGanttRow as unknown as { type: (props: Props) => ReactNode; compare: ((a: Props, b: Props) => boolean) | null };
  return { ...actual, PlanningBoardGanttRow: memo(function CountedBackwardRow(props: Props) {
    backwardRenders.push(props.row.key);
    return row.type(props);
  }, row.compare ?? undefined) };
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
  const props = { scale: 2, capacity: { dailyHoursByResource: {}, capacityPending: false, capacityError: false, onCapacityChange: vi.fn() }, resourceNameMap: {},
    onToggleItem: vi.fn(), onDueDrop: vi.fn(), disabled: false, dragDisabled: false,
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
  uptimeQuery.mockReturnValue({ data: { resources: [{ resourceCd: '305', medianRunSeconds: 28080 }] } });
  rerender(draw(changed, newToggle));
  expect(renders).toEqual([]);
  rerender(draw(changed, newToggle, new Set(['a'])));
  expect(renders).toEqual(['305']);
  expect(screen.getByTestId('planning-gantt-bar-a')).toHaveClass('outline-emerald-300');
  expect(screen.getByTestId('planning-gantt-due-a')).toHaveTextContent('▲');
  renders.length = 0;
  rerender(draw(changed, newToggle, new Set(['a', 'outside-this-board'])));
  expect(renders).toEqual([]);
  uptimeQuery.mockReturnValue({ data: { resources: [{ resourceCd: '305', medianRunSeconds: 14400 }] } });
  rerender(draw(changed, newToggle, new Set(['a'])));
  expect(screen.getByText('4.0h')).toBeInTheDocument();
  expect(screen.getByTestId('planning-gantt-bar-a')).toHaveAttribute('aria-label', expect.stringContaining('変更後'));
});

it('renders only the source and lanes whose insertion marker changes during a drag', async () => {
  class TestPointerEvent extends MouseEvent {
    readonly pointerId = 1;
  }
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  const originalHitTest = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
  let hit: Element[] = [];
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => hit });
  try {
    const items = [item('a', '305'), item('b', '306'), item('c', '307')];
    const capacity = { dailyHoursByResource: {}, capacityPending: false, capacityError: false, onCapacityChange: vi.fn() };
    render(<PlanningBoardGanttView layout={buildPlanningBoardGanttLayout({ items, resources: ['305', '306', '307'],
      allocation: 'alternate', view: 'resource', dailyHoursByResource: {}, seibanOrder: [], today: '2026-11-05',
      now: new Date('2026-11-05T08:00:00+09:00'), scale: 2, mode: 'forward' })}
      scale={2} capacity={capacity} resourceNameMap={{}}
      onToggleItem={vi.fn()} onDueDrop={vi.fn()} disabled={false} dragDisabled={false}
      selectedItemIds={new Set()} resourceView focusedSeiban={null} onFocusedSeibanChange={vi.fn()} resourceMove={{ canMoveResource: () => true }} />);
    const source = screen.getByTestId('planning-gantt-bar-a');
    hit = [screen.getByTestId('planning-gantt-bar-b')];
    renders.length = 0;
    fireEvent.pointerDown(source, { button: 0, clientX: 100, clientY: 10 });
    fireEvent.pointerMove(source, { clientX: 120, clientY: 30 });
    expect(renders).toEqual(['305', '306']);
    expect(source).toHaveStyle({ outline: '3px dashed rgb(251 191 36)', zIndex: '9' });
    renders.length = 0;
    for (let i = 0; i < 20; i++) fireEvent.pointerMove(source, { clientX: 121 + i, clientY: 31 + i });
    await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
    expect(renders).toEqual([]);
    expect(screen.getByTestId('planning-gantt-drag-ghost').style.transform).toBe('translate3d(152px, 62px, 0) scale(1.05)');
    hit = [screen.getByTestId('planning-gantt-bar-c')];
    fireEvent.pointerMove(source, { clientX: 122, clientY: 32 });
    await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
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


it('keeps folded rows without the selected item memoized, including equal refreshes', () => {
  const items = [item('first', '305'), { ...item('later', '305'), requiredMinutes: 6000 }];
  const props = { scale: 2, capacity: { dailyHoursByResource: {}, capacityPending: false, capacityError: false, onCapacityChange: vi.fn() }, resourceNameMap: {},
    onToggleItem: vi.fn(), onDueDrop: vi.fn(), disabled: false, dragDisabled: false,
    resourceView: true, focusedSeiban: null, onFocusedSeibanChange: vi.fn(), colorBySeiban: true, singleResourceCd: '305' };
  const layout = buildPlanningBoardGanttLayout({ items, resources: ['305'], allocation: 'alternate', view: 'resource',
    dailyHoursByResource: {}, seibanOrder: [], today: '2026-11-05', now: new Date('2026-11-05T08:00:00+09:00'), scale: 2, mode: 'forward' });
  const draw = (selectedItemIds: ReadonlySet<string>, currentLayout = layout) => <PlanningBoardGanttView {...props} layout={currentLayout} selectedItemIds={selectedItemIds} />;
  const { rerender } = render(draw(new Set()));
  renders.length = 0;
  rerender(draw(new Set(['first'])));
  expect(renders).toHaveLength(1);
  expect(screen.getByTestId('planning-gantt-bar-first')).toHaveAttribute('aria-pressed', 'true');
  expect(renders[0]).toContain(':single:');
  renders.length = 0;
  rerender(draw(new Set(['first', 'elsewhere'])));
  expect(renders).toEqual([]);
  rerender(draw(new Set(['first']), { ...layout, groups: layout.groups.map(group => ({ ...group, rows: group.rows.map(row => ({ ...row, bars: row.bars.map(bar => ({ ...bar, item: { ...bar.item, itemRevision: 'new' } })) })) })) }));
  expect(renders).toEqual([]);
  rerender(draw(new Set()));
  expect(renders).toHaveLength(1);
});


it.each([false, true])('only rerenders rows containing the legend seiban (folded=%s)', folded => {
  const items = [item('a', '305'), { ...item('b', '306'), fseiban: '26-1002' }];
  const props = { scale: 2, capacity: { dailyHoursByResource: {}, capacityPending: false, capacityError: false, onCapacityChange: vi.fn() }, resourceNameMap: {},
    onToggleItem: vi.fn(), onDueDrop: vi.fn(), disabled: false, dragDisabled: false,
    resourceView: true, onFocusedSeibanChange: vi.fn(), colorBySeiban: true, selectedItemIds: new Set<string>(),
    singleResourceCd: folded ? '305' : null };
  const layout = buildPlanningBoardGanttLayout({ items, resources: ['305', '306'], allocation: 'alternate', view: 'resource',
    dailyHoursByResource: {}, seibanOrder: [], today: '2026-11-05', now: new Date('2026-11-05T08:00:00+09:00'), scale: 2, mode: 'forward' });
  const draw = (focusedSeiban: string | null) => <PlanningBoardGanttView {...props} layout={layout} focusedSeiban={focusedSeiban} />;
  const { rerender } = render(draw(null));
  renders.length = 0;
  rerender(draw('26-1001'));
  expect(renders).toHaveLength(1);
  expect(renders[0]).toContain('305');
  expect(screen.getByTestId('planning-gantt-bar-a')).toHaveClass('ring-[3px]', 'ring-white');
  expect(screen.getByTestId('planning-board-gantt')).toHaveAttribute('data-seiban-focus');
  if (!folded) expect(screen.getByTestId('planning-gantt-bar-b')).toHaveAttribute('data-seiban-unfocused', 'bar');
  renders.length = 0;
  rerender(draw('outside-this-board'));
  expect(renders).toHaveLength(1);
  expect(renders[0]).toContain('305');
  renders.length = 0;
  rerender(draw(null));
  expect(renders).toEqual([]);
  expect(screen.getByTestId('planning-board-gantt')).not.toHaveAttribute('data-seiban-focus');
});


it('keeps the partner pane and unrelated date rows memoized on selection and equal refresh', () => {
  const items = [item('a', '305'), { ...item('b', '306'), fseiban: '26-1002' }];
  const props = { scale: 2, capacity: { dailyHoursByResource: {}, capacityPending: false, capacityError: false, onCapacityChange: vi.fn() }, resourceNameMap: {},
    onToggleItem: vi.fn(), onDueDrop: vi.fn(), disabled: false, dragDisabled: false,
    resourceView: true, focusedSeiban: null, onFocusedSeibanChange: vi.fn(), colorBySeiban: true,
    singleResourceCd: '305+306', resourceLanes: ['305', '306'], unitSplitEnabledByResource: { '305': true, '306': true } };
  const build = (items: GrindingPlanningBoardItem[]) => buildPlanningBoardGanttLayout({ items, resources: ['305', '306'],
    allocation: 'alternate', view: 'resource', dailyHoursByResource: {}, seibanOrder: [], today: '2026-11-05',
    now: new Date('2026-11-05T08:00:00+09:00'), scale: 2, mode: 'forward' });
  const layout = build(items);
  const draw = (selectedItemIds: ReadonlySet<string>, currentLayout = layout, focusedSeiban: string | null = null) => <PlanningBoardGanttDisplay {...props} layout={currentLayout} selectedItemIds={selectedItemIds} focusedSeiban={focusedSeiban} />;
  const { rerender } = render(draw(new Set()));
  renders.length = 0;
  rerender(draw(new Set(['a'])));
  expect(renders).toHaveLength(1);
  expect(renders[0]).toContain('305:single:');
  renders.length = 0;
  const acknowledged = build(items.map(item => ({ ...item, itemRevision: 'r2', version: 2 })));
  rerender(draw(new Set(['a']), acknowledged));
  expect(renders).toEqual([]);
  rerender(draw(new Set(['a']), acknowledged, '26-1001'));
  expect(renders).toHaveLength(1);
  expect(renders[0]).toContain('305:single:');
  renders.length = 0;
  rerender(draw(new Set(['a']), acknowledged));
  expect(renders).toHaveLength(1);
  expect(renders[0]).toContain('305:single:');
});

it('batches move previews and publishes only a changed insertion target, cancelling pending moves on end', async () => {
  const layout = buildPlanningBoardGanttLayout({ items: [item('a', '305'), item('b', '306')], resources: ['305', '306'],
    allocation: 'alternate', view: 'resource', dailyHoursByResource: {}, seibanOrder: [], today: '2026-11-05', scale: 2, mode: 'forward' });
  const bar = layout.groups[0]!.rows[0]!.bars[0]!;
  const target = layout.groups[1]!.rows[0]!.bars[0]!;
  let renderCount = 0;
  const hook = renderHook(() => { renderCount++; return usePlanningBoardDragPreview(); });
  const setPreview = hook.result.current[1];
  let notified = 0;
  hook.result.current[4].subscribe(() => { notified++; });
  const preview = { bar, x: 100, y: 100, allowed: new Set(['305', '306']),
    drop: { resource: '306', bar: target, placement: 'before' as const, left: 10 } };
  act(() => setPreview(preview));
  const started = renderCount;
  for (let i = 0; i < 20; i++) act(() => setPreview({ ...preview, x: i, y: i }));
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  expect(renderCount).toBe(started);
  for (let i = 0; i < 20; i++) act(() => setPreview({ ...preview, drop: { ...preview.drop, left: 20 + i } }));
  expect(renderCount).toBe(started);
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  // A changed drop target reaches rows through the store; the host never re-renders for it.
  expect(renderCount).toBe(started);
  expect(hook.result.current[4].get()?.drop?.left).toBe(39);
  expect(notified).toBeGreaterThan(0);
  act(() => { setPreview(preview); setPreview(null); });
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  expect(hook.result.current[0]).toBeNull();
});


it.each([false, true])('updates only the affected Gantt row for shelf selection and clear (pair=%s)', pair => {
  localStorage.clear();
  const items = [item('a', '305'), item('b', '306')];
  const layout = buildPlanningBoardGanttLayout({ items, resources: ['305', '306'], allocation: 'alternate', view: 'resource',
    dailyHoursByResource: {}, seibanOrder: [], today: '2026-11-05', now: new Date('2026-11-05T08:00:00+09:00'), scale: 2, mode: 'forward' });
  const toggle = vi.fn();
  const capacity = { dailyHoursByResource: {}, capacityPending: false, capacityError: false, onCapacityChange: vi.fn() };
  render(<PlanningBoardGanttDisplay layout={layout} minutes={{ resourceMinutesItems: items }} scale={2} capacity={capacity} resourceNameMap={{}}
    onToggleItem={toggle} onDueDrop={vi.fn()}
    disabled={false} dragDisabled={false} selectedItemIds={new Set()} resourceView focusedSeiban={null} onFocusedSeibanChange={vi.fn()}
    colorBySeiban singleResourceCd={pair ? '305+306' : '305'} resourceLanes={['305', '306']} unitSplitEnabledByResource={{ '305': true, '306': true }} />);
  renders.length = 0;
  const row = screen.getByTestId('planning-gantt-bar-a').closest<HTMLElement>('[data-gantt-window-row]')!;
  fireEvent.click(screen.getByTestId('planning-shelf-tile-a'));
  expect(renders).toEqual([row.dataset.ganttWindowRow]);
  expect(screen.getByText('1件')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '残り', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'すべて', exact: true }));
  expect(renders).toEqual([row.dataset.ganttWindowRow]);
  fireEvent.click(screen.getByRole('button', { name: '選択を外す' }));
  expect(renders).toEqual([row.dataset.ganttWindowRow, row.dataset.ganttWindowRow]);
  expect(toggle).not.toHaveBeenCalled();
});

it.each([false, true])('does not render the shelf when drag previews change (pair=%s)', async pair => {
  localStorage.clear();
  class TestPointerEvent extends MouseEvent { readonly pointerId = 1; }
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  const original = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
  let hit: Element[] = [];
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => hit });
  try {
    const items = [item('a', '305'), item('b', '306')];
    const layout = buildPlanningBoardGanttLayout({ items, resources: ['305', '306'], allocation: 'alternate', view: 'resource',
      dailyHoursByResource: {}, seibanOrder: [], today: '2026-11-05', now: new Date('2026-11-05T08:00:00+09:00'), scale: 2, mode: 'forward' });
    const capacity = { dailyHoursByResource: {}, capacityPending: false, capacityError: false, onCapacityChange: vi.fn() };
    render(<PlanningBoardGanttDisplay layout={layout} minutes={{ resourceMinutesItems: items }} scale={2} capacity={capacity} resourceNameMap={{}}
      onToggleItem={vi.fn()} onDueDrop={vi.fn()}
      disabled={false} dragDisabled={false} selectedItemIds={new Set()} resourceView focusedSeiban={null} onFocusedSeibanChange={vi.fn()}
      colorBySeiban resourceMove={{ canMoveResource: () => true }} singleResourceCd={pair ? '305+306' : '305'} resourceLanes={['305', '306']}
      unitSplitEnabledByResource={{ '305': true, '306': true }} />);
    const source = screen.getByTestId('planning-gantt-bar-a');
    hit = [pair ? screen.getByTestId('planning-gantt-bar-b') : source];
    shelfRenders.length = 0;
    shelfColumnRenders.length = 0;
    shelfBuilds.mockClear();
    fireEvent.pointerDown(source, { button: 0, clientX: 100, clientY: 10 });
    fireEvent.pointerMove(source, { clientX: 120, clientY: 30 });
    expect(screen.getByTestId('planning-gantt-drag-ghost')).toBeInTheDocument();
    expect(shelfRenders).toEqual([]);
    expect(shelfColumnRenders).toEqual([]);
    expect(shelfBuilds).not.toHaveBeenCalled();
    hit = [source];
    for (let i = 0; i < 20; i++) fireEvent.pointerMove(source, { clientX: 121 + i, clientY: 31 + i });
    await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
    expect(shelfRenders).toEqual([]);
    expect(shelfColumnRenders).toEqual([]);
    expect(shelfBuilds).not.toHaveBeenCalled();
    fireEvent.pointerCancel(source);
    expect(shelfRenders).toEqual([]);
    expect(shelfColumnRenders).toEqual([]);
    expect(shelfBuilds).not.toHaveBeenCalled();
  } finally {
    if (original) Object.defineProperty(document, 'elementsFromPoint', original); else Reflect.deleteProperty(document, 'elementsFromPoint');
    vi.unstubAllGlobals();
  }
});

it.each([false, true])('rerenders only the affected shelf columns for Gantt bar selection (pair=%s)', pair => {
  localStorage.clear();
  const items = [item('a', '305'), { ...item('b', '306'), fseiban: '26-1002' }, { ...item('c', '305'), fseiban: '26-1003' }, { ...item('d', '305'), fseiban: '26-1002' }];
  const layout = buildPlanningBoardGanttLayout({ items, resources: ['305', '306'], allocation: 'alternate', view: 'resource',
    dailyHoursByResource: {}, seibanOrder: [], today: '2026-11-05', now: new Date('2026-11-05T08:00:00+09:00'), scale: 2, mode: 'forward' });
  const props = { layout, minutes: { resourceMinutesItems: items }, scale: 2, capacity: { dailyHoursByResource: {}, capacityPending: false, capacityError: false, onCapacityChange: vi.fn() }, resourceNameMap: {},
    onToggleItem: vi.fn(), onDueDrop: vi.fn(),
    disabled: false, dragDisabled: false, resourceView: true, focusedSeiban: null, onFocusedSeibanChange: vi.fn(), colorBySeiban: true,
    singleResourceCd: pair ? '305+306' : '305', resourceLanes: ['305', '306'], unitSplitEnabledByResource: { '305': true, '306': true } };
  const draw = (ids: string[]) => <PlanningBoardGanttDisplay {...props} selectedItemIds={new Set(ids)} />;
  const { rerender } = render(draw([]));
  shelfColumnRenders.length = 0;
  shelfBuilds.mockClear();
  rerender(draw(['a']));
  expect(shelfColumnRenders).toEqual(['26-1001']);
  expect(screen.getByTestId('planning-shelf-tile-a')).toHaveAttribute('data-highlighted');
  expect(shelfBuilds).not.toHaveBeenCalled();
  shelfColumnRenders.length = 0;
  rerender(draw(['a', 'b']));
  expect(shelfColumnRenders).toEqual(['26-1001', '26-1002']);
  expect(screen.getByTestId('planning-shelf-tile-b')).toHaveAttribute('data-highlighted');
  expect(screen.getByTestId('planning-shelf-tile-a')).not.toHaveAttribute('data-highlighted');
  shelfColumnRenders.length = 0;
  rerender(draw(['a', 'b', 'outside']));
  expect(shelfColumnRenders).toEqual(['26-1002']);
  shelfColumnRenders.length = 0;
  rerender(draw(['a', 'b', 'another-outside']));
  expect(shelfColumnRenders).toEqual([]);
  expect(shelfBuilds).not.toHaveBeenCalled();
});

it('builds one shelf projection per machine mode, without building unused pane shelves', () => {
  localStorage.clear();
  const items = [item('a', '305'), item('b', '306')];
  const layout = buildPlanningBoardGanttLayout({ items, resources: ['305', '306'], allocation: 'alternate', view: 'resource',
    dailyHoursByResource: {}, seibanOrder: [], today: '2026-11-05', now: new Date('2026-11-05T08:00:00+09:00'), scale: 2, mode: 'forward' });
  const props = { layout, minutes: { resourceMinutesItems: items }, scale: 2, capacity: { dailyHoursByResource: {}, capacityPending: false, capacityError: false, onCapacityChange: vi.fn() }, resourceNameMap: {},
    onToggleItem: vi.fn(), onDueDrop: vi.fn(),
    disabled: false, dragDisabled: false, resourceView: true, focusedSeiban: null, onFocusedSeibanChange: vi.fn(),
    resourceLanes: ['305', '306'], unitSplitEnabledByResource: { '305': true, '306': true }, selectedItemIds: new Set<string>() };
  const draw = (singleResourceCd: string, colorBySeiban: boolean | undefined = true) => <PlanningBoardGanttDisplay {...props}
    singleResourceCd={singleResourceCd} colorBySeiban={colorBySeiban} />;
  shelfBuilds.mockClear();
  const { rerender } = render(draw('305'));
  expect(shelfBuilds.mock.calls).toEqual([[['305']]]);
  shelfBuilds.mockClear();
  rerender(draw('305+306'));
  expect(shelfBuilds.mock.calls).toEqual([[['305', '306']]]);
  shelfBuilds.mockClear();
  rerender(draw('305'));
  expect(shelfBuilds.mock.calls).toEqual([[['305']]]);
  shelfBuilds.mockClear();
  rerender(<PlanningBoardGanttDisplay {...props} singleResourceCd="305+306" />);
  expect(shelfBuilds).not.toHaveBeenCalled();
});

it('fixes backward row render counts for unrelated props and selection in another row', () => {
  const items = [item('a', '305'), { ...item('b', '306'), fseiban: '26-1002' }];
  const layout = buildPlanningBoardGanttLayout({ items, resources: ['305', '306'], allocation: 'alternate', view: 'resource',
    dailyHoursByResource: {}, seibanOrder: [], today: '2026-11-05', scale: 2, mode: 'backward' });
  const props = { layout, scale: 2, capacity: { dailyHoursByResource: {}, capacityPending: false, capacityError: false, onCapacityChange: vi.fn() }, resourceNameMap: {},
    onToggleItem: vi.fn(), onDueDrop: vi.fn(), disabled: false, dragDisabled: false,
    resourceView: true, focusedSeiban: null, onFocusedSeibanChange: vi.fn() };
  const empty = new Set<string>();
  const selected = new Set(['a']);
  const rowKeys = layout.groups.flatMap(group => group.rows.map(row => row.key));
  const pendingCapacity = { ...props.capacity, capacityPending: true };
  const draw = (ids: ReadonlySet<string>, capacityPending = false) => <PlanningBoardGanttView {...props} selectedItemIds={ids} capacity={capacityPending ? pendingCapacity : props.capacity} />;
  backwardRenders.length = 0;
  const { rerender } = render(draw(empty));
  expect(backwardRenders).toEqual(expect.arrayContaining(rowKeys));
  backwardRenders.length = 0;
  rerender(draw(empty, true));
  expect(backwardRenders).toEqual([]);
  rerender(draw(selected, true));
  // 今の回数を固定：別の行を含め両行が1回ずつ再描画される。
  expect(backwardRenders).toEqual(rowKeys);
  expect(screen.getByTestId('planning-gantt-bar-a')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('planning-gantt-bar-b')).toHaveAttribute('aria-pressed', 'false');
  backwardRenders.length = 0;
  rerender(draw(new Set(['a', 'outside-this-board']), true));
  expect(backwardRenders).toEqual(rowKeys);
});
