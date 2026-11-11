import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { productionFixture } from './__perf__/fixture';
import { planningBoardAutoOrder, planningBoardLaneOrder } from './gantt/planningBoardAutoOrder';
import { findForwardDrop } from './gantt/planningBoardForwardDrop';
import { canReorderForwardBars } from './gantt/planningBoardForwardQueue';
import { PlanningBoardGanttDisplay } from './gantt/PlanningBoardGanttDisplay';
import { buildPlanningBoardGanttLayout, planningBoardVisibleBars } from './gantt/planningBoardGanttLayout';
import { PlanningBoardSingleResourceHead } from './gantt/PlanningBoardSingleResourceHead';
import { mergeVisibleResourceOrder } from './mergeVisibleResourceOrder';
import { PlanningBoardTestBarDialog } from './PlanningBoardTestBarDialog';
import { PlanningBoardTestBarStrip } from './PlanningBoardTestBarStrip';
import { usePlanningBoardTestBars } from './usePlanningBoardTestBars';
import { usePlanningBoardWriteQueue } from './usePlanningBoardWriteQueue';

import type { PlanningBoardTestBarControls } from './usePlanningBoardTestBars';
import type { PlanningBoardWrite } from './usePlanningBoardWriteQueue';
import type { GrindingPlanningBoardResponse, GrindingPlanningBoardTestBar } from '@raspi-system/shared-types';

const api = vi.hoisted(() => ({ create: vi.fn(), mutate: vi.fn() }));
vi.mock('../../../api/domains/production-schedule/grinding-planning-board', () => ({ createKioskGrindingPlanningBoardTestBar: api.create, mutateKioskGrindingPlanningBoardTestBar: api.mutate }));
vi.mock('../../../api/hooks/machine-signal', () => ({ useMachineSignalResourceUptime: () => ({ data: undefined }) }));
vi.mock('../../../api/hooks', () => ({ useKioskGrindingPlanningBoardProcessChips: () => ({ data: undefined }) }));
const testBar = (overrides: Partial<GrindingPlanningBoardTestBar> = {}): GrindingPlanningBoardTestBar => ({
  kind: 'test', itemId: 'test:22a2ef84-772f-4822-b4e3-bc1c930a9c83', itemRevision: 'test:r1', version: 1,
  sequence: 4, name: 'テスト4', resourceCd: '300', minutes: 30, alternateRank: 2, isCompleted: false, completedAt: null, deletedAt: null, ...overrides
});
const fixture = () => {
  const f = productionFixture(2, 1);
  const items = f.items.map((item, i) => ({ ...item, fseiban: `S${i}`, fhincd: `H${i}`, specialDue: null,
    alternateRank: i ? 3 : 1, requiredMinutes: 60, originalRequiredMinutes: 60, ownRequiredMinutes: 60, isFirstProcess: false }));
  return { ...f, items, options: { ...f.options, items, testBars: [testBar()] } };
};
const controls = (overrides: Partial<PlanningBoardTestBarControls> = {}): PlanningBoardTestBarControls => ({
  bars: [testBar()], nextSequence: 5, selectedId: null, selectedBar: null, disabled: false,
  select: vi.fn(), create: vi.fn(async () => true), remove: vi.fn(), complete: vi.fn(), accept: vi.fn(), undo: vi.fn(), ...overrides
});
function ganttProps(mode: 'forward' | 'backward' = 'forward', singleResourceCd: string | null = '300') {
  const f = fixture();
  return { layout: buildPlanningBoardGanttLayout({ ...f.options, mode }), resourceMinutesItems: f.items, resourceLanes: ['300', '301'], singleResourceCd,
    scale: 1, dailyHoursByResource: {}, resourceNameMap: {}, capacityPending: false, capacityError: false,
    onCapacityChange: vi.fn(), onToggleItem: vi.fn(), onDueDrop: vi.fn(), disabled: false, dragDisabled: false,
    selectedItemIds: new Set<string>(), resourceView: true, focusedSeiban: null, onFocusedSeibanChange: vi.fn(), testBarCreationEnabled: true, testBarControls: controls() };
}
afterEach(() => { vi.clearAllMocks(); Reflect.deleteProperty(document, 'elementsFromPoint'); });

describe('テスト加工の画面', () => {
  it('places the purple ＋ at the right end of the single-resource heading with its aria name', () => {
    render(<PlanningBoardGanttDisplay {...ganttProps()} />);
    const head = screen.getByTestId('planning-single-resource-head'); const plus = within(head).getByRole('button', { name: '棒を差し込む' });
    expect(head.lastElementChild).toBe(plus); expect(plus).toHaveStyle({ borderColor: '#a78bfa', background: 'rgba(167,139,250,.15)', color: '#c4b5fd' });
    expect(plus).toHaveClass('h-8', 'w-11');
    fireEvent.click(plus); expect(screen.getByRole('dialog', { name: 'テスト加工' })).toBeInTheDocument();
  });
  it.each([['backward', '300'], ['forward', null]] as const)('hides ＋ in %s with selection %s', (mode, resource) => {
    render(<PlanningBoardGanttDisplay {...ganttProps(mode, resource)} />); expect(screen.queryByRole('button', { name: '棒を差し込む' })).not.toBeInTheDocument();
  });
  it('hides ＋ for original allocation', () => {
    render(<PlanningBoardGanttDisplay {...ganttProps()} testBarCreationEnabled={false} />); expect(screen.queryByRole('button', { name: '棒を差し込む' })).not.toBeInTheDocument();
  });
  it.each(['300', '300+301'])('disables test insertion and strip writes while blocked for %s', (resource) => {
    const complete = vi.fn(), remove = vi.fn();
    render(<PlanningBoardGanttDisplay {...ganttProps('forward', resource)} pieceDisabled
      testBarControls={controls({ disabled: true, selectedBar: testBar(), selectedId: testBar().itemId, complete, remove })} />);
    const plus = screen.getByRole('button', { name: '棒を差し込む' });
    const completion = screen.getByRole('button', { name: '完了にする' });
    const deletion = screen.getByRole('button', { name: '消す' });
    expect(plus).toBeDisabled(); expect(completion).toBeDisabled(); expect(deletion).toBeDisabled();
    fireEvent.click(plus); fireEvent.click(completion); fireEvent.click(deletion);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(complete).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it('starts at 30 minutes, steps by five, and stops at 5 and 1440', () => {
    render(<PlanningBoardTestBarDialog sequence={5} resources={['300']} initialResource="300" onInsert={vi.fn(async () => true)} onClose={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'テスト5' })).toBeInTheDocument();
    const input = screen.getByRole('spinbutton', { name: '時間(分)' }); expect(input).toHaveValue(30); expect(input).toHaveAttribute('step', '5'); expect(input).toHaveAttribute('min', '5'); expect(input).toHaveAttribute('max', '1440');
    fireEvent.click(screen.getByRole('button', { name: '時間を5分増やす' })); expect(input).toHaveValue(35);
    fireEvent.click(screen.getByRole('button', { name: '時間を5分減らす' })); expect(input).toHaveValue(30);
    fireEvent.change(input, { target: { value: '5' } }); expect(screen.getByRole('button', { name: '時間を5分減らす' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '1440' } }); expect(screen.getByRole('button', { name: '時間を5分増やす' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '5.5' } }); expect(screen.getByRole('button', { name: '差し込む' })).toBeDisabled();
    expect(screen.queryByRole('group', { name: '機械' })).not.toBeInTheDocument();
  });
  it('only shows machine switching for two machines and inserts on the chosen one', async () => {
    const insert = vi.fn(async () => true), close = vi.fn();
    render(<PlanningBoardTestBarDialog sequence={5} resources={['300', '301']} initialResource="301" onInsert={insert} onClose={close} />);
    expect(screen.getByRole('button', { name: '301' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '300' })); fireEvent.click(screen.getByRole('button', { name: '差し込む' }));
    await waitFor(() => expect(insert).toHaveBeenCalledWith('300', 30)); expect(close).toHaveBeenCalled();
  });
  it('initializes a two-machine dialog from the selected bar and otherwise from the first machine', () => {
    const props = ganttProps('forward', '300+301');
    render(<PlanningBoardGanttDisplay {...props} testBarControls={controls({ selectedBar: testBar({ resourceCd: '301' }), selectedId: testBar().itemId })} />);
    fireEvent.click(screen.getByRole('button', { name: '棒を差し込む' })); expect(screen.getByRole('button', { name: '301', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
  it('shows the test name and minutes with the approved bar colors', () => {
    render(<PlanningBoardGanttDisplay {...ganttProps()} />);
    const bar = screen.getAllByTestId(`planning-gantt-bar-${testBar().itemId}`)[0]!;
    expect(bar).toHaveStyle({ backgroundColor: '#c4b5fd', color: '#1e1b4b' });
    expect(within(bar).getByText('テスト4')).toBeInTheDocument(); expect(within(bar).getByText('30分')).toBeInTheDocument();
  });
  it('inserts after the ordinary bar opened with a normal tap', async () => {
    const props = ganttProps(); const create = vi.fn(async () => true);
    render(<PlanningBoardGanttDisplay {...props} testBarControls={controls({ create })} />);
    const first = fixture().items[0]!;
    fireEvent.click(screen.getAllByTestId(`planning-gantt-bar-${first.itemId}`)[0]!);
    fireEvent.click(screen.getByRole('button', { name: '棒を差し込む' }));
    fireEvent.click(screen.getByRole('button', { name: '差し込む' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('300', 30, expect.objectContaining({ itemId: first.itemId })));
  });
  it('opens the strip for an inserted selection in the two-machine view', () => {
    render(<PlanningBoardGanttDisplay {...ganttProps('forward', '300+301')} testBarControls={controls({ selectedBar: testBar(), selectedId: testBar().itemId })} />);
    expect(screen.getByRole('button', { name: '消す' })).toBeInTheDocument();
  });
  it('shows manual completion, delete and close in the selected test strip', () => {
    const complete = vi.fn(), remove = vi.fn(), close = vi.fn();
    const { rerender } = render(<PlanningBoardTestBarStrip item={testBar()} bottom={0} onComplete={complete} onRemove={remove} onClose={close} />);
    expect(screen.getByText('300 · 30分')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '完了にする' })); expect(complete).toHaveBeenCalledWith(testBar(), 'complete');
    rerender(<PlanningBoardTestBarStrip item={testBar({ isCompleted: true })} bottom={0} onComplete={complete} onRemove={remove} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: '未完了に戻す' })); expect(complete).toHaveBeenLastCalledWith(testBar({ isCompleted: true }), 'incomplete');
    fireEvent.click(screen.getByRole('button', { name: '消す' })); expect(remove).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '× 閉じる' })); expect(close).toHaveBeenCalled();
  });
  it('keeps a completed selection available for the second ✓ press after its bar disappears', () => {
    render(<PlanningBoardGanttDisplay {...ganttProps()} testBarControls={controls({ bars: [testBar({ isCompleted: true })], selectedBar: testBar({ isCompleted: true }), selectedId: testBar().itemId })} />);
    expect(screen.getByRole('button', { name: '未完了に戻す' })).toBeInTheDocument();
  });
  it('adds unfinished test minutes to both time sources', () => {
    const item = fixture().items[0]!;
    render(<PlanningBoardSingleResourceHead resourceCd="300" names={[]} hours={8} pausesForBreaks averageSeconds={undefined} disabled={false} pickerOpen={false}
      items={[{ ...item, originalRequiredMinutes: 15, ownRequiredMinutes: 45 }]} testMinutes={30} onCapacityChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /元の値/ })).toHaveTextContent('0.8h'); expect(screen.getByRole('button', { name: /独自の値/ })).toHaveTextContent('1.3h');
  });
});

describe('テスト加工の順番と選択', () => {
  it('preserves ordinary original-allocation order and inserts tests in their saved slots', () => {
    const f = fixture(); const items = f.items.map((item, index) => ({ ...item, alternateRank: index ? 1 : 3 }));
    const bars = planningBoardVisibleBars(buildPlanningBoardGanttLayout({ ...f.options, items, allocation: 'original' })).sort((a, b) => a.start! - b.start!);
    expect(bars.map((bar) => bar.item.itemId)).toEqual([items[0]!.itemId, testBar().itemId, items[1]!.itemId]);
  });
  it('pushes following bars by the test duration and ignores seiban/arrival membership', () => {
    const f = fixture(); const layout = buildPlanningBoardGanttLayout({ ...f.options, arrivalFilterEnabled: true });
    const bars = planningBoardVisibleBars(layout).sort((a, b) => a.start! - b.start!);
    expect(bars.map((bar) => bar.item.itemId)).toEqual([f.items[0]!.itemId, testBar().itemId, f.items[1]!.itemId]);
    expect((bars[1]!.end! - bars[1]!.start!) * 1440).toBeCloseTo(30);
    expect(bars[2]!.start).toBeCloseTo(bars[1]!.end!);
    const testsOnly = buildPlanningBoardGanttLayout({ ...f.options, items: [] });
    expect(planningBoardVisibleBars(testsOnly).map((bar) => bar.item.itemId)).toEqual([testBar().itemId]);
  });
  it('breaks same-part setup continuity across a test', () => {
    const f = fixture(); const items = f.items.map((item, i) => ({ ...item, kind: 'piece' as const, itemId: `piece:${i}`, parentItemId: 'parent', piecePosition: i + 1,
      fhincd: 'H', fseiban: 'S', unitRequiredMinutes: 10, setupMinutes: 5, ops: [{ opNo: 1, minutes: 10 }] }));
    const options = { ...f.options, items, resourceMinutes: { ownSourceResourceCds: ['300'], values: [{ resourceCd: '300', fhincd: 'H', perUnitMinutes: 10, setupMinutes: 5 }] } };
    const bars = planningBoardVisibleBars(buildPlanningBoardGanttLayout(options));
    expect(bars.filter((bar) => bar.item.kind === 'piece').every((bar) => (bar.setupSegments?.length ?? 0) > 0)).toBe(true);
    expect(bars.find((bar) => bar.item.kind === 'test')?.setupSegments).toBeUndefined();
  });
  it('keeps test slots in automatic and due ordering while ordinary bars move', () => {
    const f = fixture(); const items = f.items.map((item, i) => ({ ...item, originalDueDate: i ? '2026-11-05' : '2026-11-20' }));
    const options = { ...f.options, items };
    expect(planningBoardLaneOrder(options)['300']).toEqual([items[0]!.itemId, testBar().itemId, items[1]!.itemId]);
    const proposal = planningBoardAutoOrder(options, new Set());
    expect(proposal['300']).toEqual([items[1]!.itemId, testBar().itemId, items[0]!.itemId]);
    expect(mergeVisibleResourceOrder(planningBoardLaneOrder(options)['300']!, [items[1]!.itemId, items[0]!.itemId])).toEqual([items[1]!.itemId, testBar().itemId, items[0]!.itemId]);
  });
  it('permits test reordering only within the unbanded lane and rejects another machine', () => {
    const f = fixture(); const bars = planningBoardVisibleBars(buildPlanningBoardGanttLayout(f.options)); const test = bars.find((bar) => bar.item.kind === 'test')!;
    const normal = bars.find((bar) => bar.item.kind !== 'test')!;
    const special = { ...normal, item: { ...f.items[0]!, specialDue: { kind: 'today' as const, expiresAt: '2099-01-01' } } };
    expect(canReorderForwardBars(test, special)).toBe(false);
    expect(canReorderForwardBars(special, test)).toBe(false);
    expect(canReorderForwardBars(test, normal)).toBe(true);
    expect(canReorderForwardBars(normal, test)).toBe(true);
    expect(canReorderForwardBars(test, { ...test, item: testBar({ itemId: 'test:33a2ef84-772f-4822-b4e3-bc1c930a9c83' }) })).toBe(true);
    expect(canReorderForwardBars(test, { ...normal, resource: '301' })).toBe(false);
    const board = document.createElement('div'), lane = document.createElement('div'); lane.dataset.ganttLane = ''; lane.dataset.resourceCode = '301'; board.append(lane);
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [lane] });
    expect(findForwardDrop(0, 0, test, new Set(['300', '301']), board, [], f.options.today.length, 100)).toBeNull();
  });
  it('selects the server-assigned test after insertion and keeps create/delete undo actions', async () => {
    const made = testBar(); const response = { sourceRevision: 'r2', testBar: made, testBars: [made], nextTestBarSequence: 5, items: [] };
    api.create.mockResolvedValue(response); api.mutate.mockResolvedValue({ ...response, sourceRevision: 'r3', testBar: { ...made, version: 2, deletedAt: '2026-11-05' }, testBars: [] });
    const remember = vi.fn(); const writes: PlanningBoardWrite[] = [];
    const enqueue = (write: PlanningBoardWrite) => { writes.push(write); void write.save({ sourceRevision: 'r1', item: (item) => item }).then(write.onSaved); return true; };
    const data = { siteKey: 'site', sourceRevision: 'r1', testBars: [], nextTestBarSequence: 4 } as unknown as GrindingPlanningBoardResponse;
    const { result } = renderHook(() => usePlanningBoardTestBars({ data, enqueue, remember, disabled: false }));
    await act(async () => { expect(await result.current.create('300', 30)).toBe(true); });
    expect(result.current.selectedId).toBe(made.itemId); expect(remember).toHaveBeenLastCalledWith(made, 'delete');
    await act(async () => result.current.remove(made)); await waitFor(() => expect(remember).toHaveBeenLastCalledWith(expect.objectContaining({ version: 2 }), 'restore', null));
    expect(result.current.selectedId).toBeNull(); expect(writes.every((write) => write.order)).toBe(true);
    const done = vi.fn(); api.mutate.mockResolvedValue({ ...response, sourceRevision: 'r4', testBar: { ...made, version: 3 } });
    await act(async () => result.current.undo({ id: 1, scope: 'site', orders: [], testBarUndo: { item: { ...made, version: 2 }, action: 'restore' } }, done));
    await waitFor(() => expect(done).toHaveBeenCalled()); expect(api.mutate).toHaveBeenLastCalledWith(made.itemId, 'restore', expect.objectContaining({ expectedVersion: 2 }));
  });
  it.each(['normal', 'head', 'test', 'band'] as const)('keeps the %s predecessor through queued delete and undo', async (scenario) => {
    const made = testBar({ alternateRank: scenario === 'head' || scenario === 'band' ? 1 : 2 });
    const { data } = optimisticBoard([made]);
    data.items = data.items.map((item, index) => ({ ...item, alternateRank: index ? 3 : 1,
      ...(scenario === 'band' && !index ? { specialDue: { kind: 'today' as const, expiresAt: '2099-01-01' } } : {}) }));
    const predecessor = testBar({ itemId: 'test:predecessor', alternateRank: 1 });
    if (scenario === 'test') { data.testBars = [predecessor, made]; data.items = []; }
    if (scenario === 'head') data.items = data.items.map((item) => ({ ...item, alternateRank: 3 }));
    const expected = scenario === 'normal' ? data.items[0]!.itemId : scenario === 'test' ? predecessor.itemId : null;
    const remember = vi.fn(); const writes: PlanningBoardWrite[] = [];
    const enqueue = (write: PlanningBoardWrite) => { writes.push(write); return true; };
    const { result } = renderHook(() => usePlanningBoardTestBars({ data, enqueue, remember, disabled: false }));
    act(() => result.current.remove(made));
    const deleted = { ...made, version: 2, deletedAt: '2026-11-05' };
    api.mutate.mockResolvedValueOnce({ sourceRevision: 'r2', testBar: deleted, testBars: [] });
    await act(async () => { const saved = await writes[0]!.save({ sourceRevision: 'r1', item: (item) => item }); writes[0]!.onSaved?.(saved); });
    expect(remember).toHaveBeenCalledWith(deleted, 'restore', expected);
    const [item, action, restoreAfterItemId] = remember.mock.calls[0]!;
    act(() => { result.current.undo({ id: 1, scope: 'site', orders: [], testBarUndo: { item, action, restoreAfterItemId } }, vi.fn()); });
    // The queue retains the captured anchor until save is run later with a fresh revision.
    api.mutate.mockResolvedValueOnce({});
    await writes[1]!.save({ sourceRevision: 'r3', item: (item) => item });
    expect(api.mutate).toHaveBeenLastCalledWith(made.itemId, 'restore', expect.objectContaining({ sourceRevision: 'r3', restoreAfterItemId: expected }));
  });
  it.each(['complete', 'delete', 'create'] as const)('uses the refreshed version for %s after an overlay is superseded', async (action) => {
    const original = testBar();
    const saved = testBar({ version: 2, itemRevision: 'test:r2' });
    const fresh = testBar({ version: 3, itemRevision: 'test:r3' });
    const { data } = optimisticBoard([original]);
    const writes: PlanningBoardWrite[] = [];
    const enqueue = (write: PlanningBoardWrite) => { writes.push(write); return true; };
    const { result, rerender } = renderHook(({ board }) => usePlanningBoardTestBars({ data: board, enqueue, remember: vi.fn(), disabled: false }), { initialProps: { board: data } });
    act(() => result.current.accept({ sourceRevision: 'r2', testBars: [saved], nextTestBarSequence: 5 }));
    expect(result.current.bars).toEqual([saved]);
    rerender({ board: { ...data, sourceRevision: 'r3', testBars: [fresh] } });
    expect(result.current.bars).toEqual([fresh]);
    act(() => {
      if (action === 'create') void result.current.create('300', 30, fresh);
      else if (action === 'delete') result.current.remove(fresh);
      else result.current.complete(fresh, 'complete');
    });
    api.create.mockResolvedValue({}); api.mutate.mockResolvedValue({});
    await writes[0]!.save({ sourceRevision: 'r3', item: (item) => item });
    if (action === 'create') expect(api.create).toHaveBeenCalledWith(expect.objectContaining({
      afterItem: { itemId: fresh.itemId, itemRevision: fresh.itemRevision, overrideVersion: 3 }
    }));
    else expect(api.mutate).toHaveBeenCalledWith(fresh.itemId, action, expect.objectContaining({ expectedVersion: 3 }));
  });
  it('keeps cached test data isolated by site and blocks writes while offline', async () => {
    const data = { siteKey: 'A', sourceRevision: 'r1', testBars: [testBar()], nextTestBarSequence: 5 } as unknown as GrindingPlanningBoardResponse;
    const enqueue = vi.fn(); const remember = vi.fn();
    const { result, rerender } = renderHook(({ board, disabled }) => usePlanningBoardTestBars({ data: board, enqueue, remember, disabled }), { initialProps: { board: data, disabled: true } });
    await act(async () => { expect(await result.current.create('300', 30)).toBe(false); }); expect(enqueue).not.toHaveBeenCalled();
    rerender({ board: { ...data, siteKey: 'B', testBars: [] }, disabled: false }); expect(result.current.bars).toEqual([]);
  });
});

function optimisticBoard(initialBars = [testBar()]) {
  const f = fixture();
  const data = { siteKey: 'site', sourceRevision: 'r1', items: f.items, seibanOrder: f.seibans,
    testBars: initialBars, nextTestBarSequence: 5 } as unknown as GrindingPlanningBoardResponse;
  return { f, data };
}
function useTestBoard(data: GrindingPlanningBoardResponse, onError = vi.fn()) {
  const queue = usePlanningBoardWriteQueue({ scope: data.siteKey, items: data.items, order: data.seibanOrder, sourceRevision: data.sourceRevision,
    refresh: async () => undefined, onStart: vi.fn(), onSuccess: vi.fn(), onError });
  const controls = usePlanningBoardTestBars({ data, items: queue.items, enqueue: queue.enqueue, remember: vi.fn(), disabled: queue.pending });
  return { controls, queue };
}

describe('テスト加工の楽観表示', () => {
  it.each(['create', 'delete', 'complete', 'incomplete'] as const)('shows %s before saving and rolls back on failure', async (action) => {
    let reject!: (error: Error) => void;
    const saving = new Promise<never>((_resolve, fail) => { reject = fail; });
    api.create.mockReturnValue(saving); api.mutate.mockReturnValue(saving);
    const original = testBar({ isCompleted: action === 'incomplete', completedAt: action === 'incomplete' ? '2026-11-05' : null });
    const { data } = optimisticBoard([original]); const onError = vi.fn();
    const { result } = renderHook(() => useTestBoard(data, onError));
    await act(async () => {
      if (action === 'create') expect(await result.current.controls.create('300', 30)).toBe(true);
      else if (action === 'delete') result.current.controls.remove(original);
      else result.current.controls.complete(original, action);
    });
    if (action === 'create') {
      const temporary = result.current.controls.bars.find((bar) => bar.itemId !== original.itemId)!;
      expect(temporary).toMatchObject({ name: 'テスト5', itemId: expect.stringMatching(/^test:pending:/) });
      act(() => { result.current.controls.select(temporary, true); result.current.controls.remove(temporary); result.current.controls.complete(temporary, 'complete'); });
      expect(result.current.controls.selectedId).toBeNull(); expect(api.mutate).not.toHaveBeenCalled();
    } else if (action === 'delete') expect(result.current.controls.bars).toEqual([]);
    else expect(result.current.controls.bars[0]!.isCompleted).toBe(action === 'complete');
    await act(async () => reject(new Error('save failed')));
    expect(result.current.controls.bars).toEqual([original]);
    expect(result.current.controls.nextSequence).toBe(5); expect(onError).toHaveBeenCalledOnce();
  });

  it.each(['head', 'normal', 'test', 'band', 'unranked'] as const)('inserts at the server position for %s while saving', async (anchor) => {
    api.create.mockReturnValue(new Promise(() => {}));
    const { data, f } = optimisticBoard();
    if (anchor === 'band') data.items[0] = { ...data.items[0]!, specialDue: { kind: 'today', expiresAt: '2099-01-01' } };
    if (anchor === 'unranked') data.items = data.items.map((item) => ({ ...item, alternateRank: null }));
    const { result } = renderHook(() => useTestBoard(data));
    const after = anchor === 'test' ? data.testBars![0] : anchor === 'head' ? undefined : data.items[0];
    await act(async () => { expect(await result.current.controls.create('300', 30, after)).toBe(true); });
    const temporary = result.current.controls.bars.find((bar) => bar.name === 'テスト5')!;
    const order = planningBoardLaneOrder({ items: result.current.queue.items, testBars: [...result.current.controls.bars], seibanOrder: f.seibans, allocation: 'alternate' })['300'];
    expect(order).toEqual(anchor === 'test' ? [data.items[0]!.itemId, testBar().itemId, temporary.itemId, data.items[1]!.itemId]
      : anchor === 'band' || anchor === 'normal' ? [data.items[0]!.itemId, temporary.itemId, testBar().itemId, data.items[1]!.itemId]
      : anchor === 'unranked' ? [testBar().itemId, data.items[0]!.itemId, temporary.itemId, data.items[1]!.itemId]
      : [temporary.itemId, data.items[0]!.itemId, testBar().itemId, data.items[1]!.itemId]);
  });

  it('closes the insertion dialog before saving and replaces the temporary id when confirmed', async () => {
    let resolve!: (result: unknown) => void;
    api.create.mockReturnValue(new Promise((done) => { resolve = done; }));
    const { data, f } = optimisticBoard([]);
    function Board() {
      const { controls, queue } = useTestBoard(data);
      return <PlanningBoardGanttDisplay {...ganttProps()} layout={buildPlanningBoardGanttLayout({ ...f.options, items: queue.items, testBars: [...controls.bars] })} testBarControls={controls} />;
    }
    render(<Board />);
    fireEvent.click(screen.getByRole('button', { name: '棒を差し込む' }));
    fireEvent.click(screen.getByRole('button', { name: '差し込む' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'テスト加工' })).not.toBeInTheDocument());
    expect(document.querySelector('[data-testid^="planning-gantt-bar-test:pending:"]')).toBeInTheDocument();
    const made = testBar({ sequence: 5, name: 'テスト5' });
    await act(async () => resolve({ sourceRevision: 'r2', testBar: made, testBars: [made], nextTestBarSequence: 6, items: data.items }));
    expect(document.querySelector('[data-testid^="planning-gantt-bar-test:pending:"]')).not.toBeInTheDocument();
    expect(screen.getByTestId(`planning-gantt-bar-${made.itemId}`)).toBeInTheDocument();
  });

  it.each(['onDiscarded', 'rejected'] as const)('removes the temporary display when the offline queue is %s', async (mode) => {
    const { data } = optimisticBoard([]); let write!: PlanningBoardWrite;
    const enqueue = vi.fn((pending: PlanningBoardWrite) => { write = pending; return mode !== 'rejected'; });
    const { result } = renderHook(() => usePlanningBoardTestBars({ data, enqueue, remember: vi.fn(), disabled: false }));
    await act(async () => { expect(await result.current.create('300', 30)).toBe(mode !== 'rejected'); });
    if (mode === 'onDiscarded') { expect(result.current.bars).toHaveLength(1); act(() => write.onDiscarded?.()); }
    expect(result.current.bars).toEqual([]); expect(result.current.nextSequence).toBe(5);
  });
});
