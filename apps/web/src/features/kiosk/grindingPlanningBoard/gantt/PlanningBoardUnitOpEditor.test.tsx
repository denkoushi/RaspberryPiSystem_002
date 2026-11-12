import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlanningBoardPiecePopover, PlanningBoardPiecesContext, usePlanningBoardPieceActions } from '../PlanningBoardPiecePopover';

import { planningBoardChainPairs } from './PlanningBoardChainLinks';
import { ganttBarGeometry } from './planningBoardGanttGeometry';
import { buildPlanningBoardGanttLayout, isNormalGanttBar } from './planningBoardGanttLayout';
import { PlanningBoardUnitOpContext, unitOpDraft, unitOpGhost } from './PlanningBoardUnitOpEditor';

import type { GrindingPlanningBoardItem, GrindingPlanningBoardResourceMinutesResponse } from '@raspi-system/shared-types';

const mutation = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('../../../../api/hooks/production-schedule/grinding-planning-board', () => ({
  useConfigureKioskSessakuPieceOps: () => ({ mutateAsync: mutation, isPending: false })
}));
const item = { itemId: 'piece:a', kind: 'piece', pieceId: 'a', piecePosition: 1, parentItemId: 'row:p',
  originalResourceCd: '021', effectiveResourceCd: '021', productNo: '1', fhincd: 'PART', fhinmei: 'フランジ', fseiban: 'S',
  itemRevision: 'revision', pieceSetVersion: 1, quantity: 1, plannedQuantity: 1, parentPlannedQuantity: 5,
  unitRequiredMinutes: 30, requiredMinutes: 50, setupMinutes: 20, isCompleted: false,
  processOrder: '10', effectiveDueDate: '2026-11-12', originalDueDate: '2026-11-12' } as GrindingPlanningBoardItem;
function setup(values: GrindingPlanningBoardResourceMinutesResponse['values'] = [], extra: Partial<GrindingPlanningBoardItem> = {}) {
  const current = { ...item, ...extra };
  const { result } = renderHook(() => usePlanningBoardPieceActions({ createEnabled: true, enabled: true,
    resourceCategories: { '021': 'cutting' }, selectedItems: [], changePieces: vi.fn() }));
  return render(<PlanningBoardUnitOpContext.Provider value={{ minutes: { ownSourceResourceCds: [], values }, items: [current], loading: false }}>
    <PlanningBoardPiecesContext.Provider value={result.current}><PlanningBoardPiecePopover item={current} variant="gantt" /></PlanningBoardPiecesContext.Provider>
  </PlanningBoardUnitOpContext.Provider>);
}
beforeEach(() => mutation.mockClear());
describe('unit operation quantity dialog', () => {
  it('opens an unregistered unit even without unit projection fields and starts with two equal operation times', () => {
    setup([], { unitRequiredMinutes: undefined });
    const quantity = screen.getByRole('button', { name: 'フランジの数量 1／5' });
    expect(quantity).toHaveTextContent('1／5 ▾'); fireEvent.click(quantity);
    expect(screen.getByRole('dialog', { name: '数量' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '工程の数' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: '1工程 1台' })).toHaveValue(15);
    expect(screen.getByRole('spinbutton', { name: '2工程 1台' })).toHaveValue(15);
    expect(screen.getByRole('button', { name: '2工程にする' })).toBeInTheDocument();
    expect(screen.queryByText('段取り')).not.toBeInTheDocument();
  });
  it('edits time and count from a completed interval and separates completion from configuration', async () => {
    const ops = [{ id: 'op-1', opNo: 1, minutes: 12, setupMinutes: 20 }, { id: 'op-2', opNo: 2, minutes: 18, setupMinutes: 0 }];
    setup([{ resourceCd: '021', fhincd: 'PART', perUnitMinutes: 30, setupMinutes: 20, ops }], {
      isCompleted: true, completedOpNos: [1], opRange: { fromOpNo: 1, toOpNo: 1 }, ops: [ops[0]]
    });
    fireEvent.click(screen.getByRole('button', { name: /の数量/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.firstElementChild).toHaveClass('!max-w-[300px]');
    const separator = screen.getByRole('separator');
    expect(separator).toHaveClass('h-px', 'bg-slate-700');
    expect(separator.previousElementSibling).toBe(screen.getByRole('button', { name: '工程1を未完了にする' }));
    expect(separator.nextElementSibling).toBe(screen.getByRole('group', { name: '工程の数' }));
    const first = screen.getByRole('spinbutton', { name: '1工程 1台' });
    await waitFor(() => expect(first).toBeEnabled());
    fireEvent.change(first, { target: { value: '14' } });
    fireEvent.click(screen.getByRole('button', { name: '2工程にする' }));
    await waitFor(() => expect(mutation).toHaveBeenCalledWith(expect.objectContaining({ minutes: [14, 18] })));
  });
  it('omits the divider when there are no operation completion buttons', () => {
    setup(); fireEvent.click(screen.getByRole('button', { name: /の数量/ }));
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });
  it('initializes from the registered snapshot when its read finishes after the dialog opens', () => {
    const { result } = renderHook(() => usePlanningBoardPieceActions({ createEnabled: true, enabled: true,
      resourceCategories: { '021': 'cutting' }, selectedItems: [], changePieces: vi.fn() }));
    const draw = (loading: boolean) => <PlanningBoardUnitOpContext.Provider value={{ loading, items: [item],
      minutes: loading ? undefined : { ownSourceResourceCds: [], values: [{ resourceCd: '021', fhincd: 'PART',
        perUnitMinutes: 30, setupMinutes: 20, ops: [{ opNo: 1, minutes: 12 }, { opNo: 2, minutes: 18 }] }] } }}>
      <PlanningBoardPiecesContext.Provider value={result.current}><PlanningBoardPiecePopover item={item} variant="gantt" /></PlanningBoardPiecesContext.Provider>
    </PlanningBoardUnitOpContext.Provider>;
    const { rerender } = render(draw(true));
    fireEvent.click(screen.getByRole('button', { name: /の数量/ }));
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    rerender(draw(false));
    expect(screen.getByRole('spinbutton', { name: '1工程 1台' })).toHaveValue(12);
    expect(screen.getByRole('spinbutton', { name: '2工程 1台' })).toHaveValue(18);
  });
  it('uses registered values and restores them when returning to their count', async () => {
    setup([{ resourceCd: '021', fhincd: 'PART', perUnitMinutes: 30, setupMinutes: 20,
      ops: [{ id: 'op-3', opNo: 3, minutes: 10, setupMinutes: 20 }, { id: 'op-7', opNo: 7, minutes: 20, setupMinutes: 0 }] }]);
    fireEvent.click(screen.getByRole('button', { name: /の数量/ }));
    const first = screen.getByRole('spinbutton', { name: '1工程 1台' });
    expect(first).toHaveValue(10); expect(screen.getByRole('spinbutton', { name: '2工程 1台' })).toHaveValue(20);
    await waitFor(() => expect(screen.getByRole('button', { name: '3工程' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '3工程' }));
    expect(screen.getByRole('spinbutton', { name: '3工程 1台' })).toHaveValue(10);
    fireEvent.click(screen.getByRole('button', { name: '2工程' }));
    expect(screen.getByRole('spinbutton', { name: '2工程 1台' })).toHaveValue(20);
    fireEvent.click(screen.getByRole('button', { name: '2工程にする' }));
    await waitFor(() => expect(mutation).toHaveBeenCalledWith(expect.objectContaining({ minutes: [10, 20], expectedOpIds: ['op-3', 'op-7'],
      expectedMinutes: { perUnitMinutes: 30, setupMinutes: 20, ops: [{ opNo: 3, minutes: 10, setupMinutes: 20 }, { opNo: 7, minutes: 20, setupMinutes: 0 }] } })));
  });
  it('submits registered decimal minutes unchanged without editing', async () => {
    const ops = [{ id: 'op-1', opNo: 1, minutes: 7.3, setupMinutes: 0 }, { id: 'op-2', opNo: 2, minutes: 2.1, setupMinutes: 0 }];
    setup([{ resourceCd: '021', fhincd: 'PART', perUnitMinutes: 9.4, setupMinutes: 0, ops }]);
    fireEvent.click(screen.getByRole('button', { name: /の数量/ }));
    expect(screen.getByRole('spinbutton', { name: '1工程 1台' })).toHaveValue(7.3);
    expect(screen.getByRole('spinbutton', { name: '2工程 1台' })).toHaveValue(2.1);
    const save = screen.getByRole('button', { name: '2工程にする' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(mutation).toHaveBeenCalledWith(expect.objectContaining({ minutes: [7.3, 2.1],
      expectedOpIds: ['op-1', 'op-2'], expectedMinutes: { perUnitMinutes: 9.4, setupMinutes: 0,
        ops: ops.map(({ opNo, minutes, setupMinutes }) => ({ opNo, minutes, setupMinutes })) } })));
    expect(ops.map((op) => op.minutes)).toEqual([7.3, 2.1]);
  });
  it.each([0.1])('keeps equal divisions positive and saves when the original time is %s', async (unitRequiredMinutes) => {
    setup([], { unitRequiredMinutes });
    fireEvent.click(screen.getByRole('button', { name: /の数量/ }));
    expect(screen.getByRole('spinbutton', { name: '1工程 1台' })).toHaveValue(0.05);
    expect(screen.getByRole('spinbutton', { name: '2工程 1台' })).toHaveValue(0.05);
    const save = screen.getByRole('button', { name: '2工程にする' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(mutation).toHaveBeenCalledWith(expect.objectContaining({ minutes: [0.05, 0.05] })));
  });
  it('keeps a small positive ghost above zero and saves it', async () => {
    setup([], { unitRequiredMinutes: 0.1 });
    fireEvent.click(screen.getByRole('button', { name: /の数量/ }));
    const first = screen.getByRole('spinbutton', { name: '1工程 1台' });
    await waitFor(() => expect(first).toBeEnabled());
    fireEvent.change(first, { target: { value: '0.05' } });
    const second = screen.getByRole('spinbutton', { name: '2工程 1台' });
    fireEvent.change(second, { target: { value: '' } });
    expect(second).toHaveAttribute('placeholder', '0.5');
    expect(screen.getByRole('button', { name: '2工程にする' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '2工程にする' }));
    await waitFor(() => expect(mutation).toHaveBeenCalledWith(expect.objectContaining({ minutes: [0.05, 0.5] })));
  });
  it('leaves unknown original minutes empty and blocks saving', async () => {
    setup([], { unitRequiredMinutes: null, requiredMinutes: null });
    fireEvent.click(screen.getByRole('button', { name: /の数量/ }));
    const first = screen.getByRole('spinbutton', { name: '1工程 1台' });
    await waitFor(() => expect(first).toBeEnabled());
    expect(first).toHaveValue(null);
    expect(first).toHaveAttribute('placeholder', '');
    expect(screen.getByRole('button', { name: '2工程にする' })).toBeDisabled();
  });
  it('shows a short local error when an excluded piece still uses a removed boundary', async () => {
    mutation.mockRejectedValueOnce({ isAxiosError: true, response: { data: { errorCode: 'OPERATION_SPLIT_IN_USE' } } });
    setup(); fireEvent.click(screen.getByRole('button', { name: /の数量/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: '2工程にする' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '2工程にする' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('別のロットや対象外の台が工程で分かれています。先にまとめてください');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('fills empty operations with the remaining original time and saves those ghost values', async () => {
    setup(); fireEvent.click(screen.getByRole('button', { name: /の数量/ }));
    const first = screen.getByRole('spinbutton', { name: '1工程 1台' });
    await waitFor(() => expect(first).toBeEnabled());
    fireEvent.change(first, { target: { value: '12' } });
    const second = screen.getByRole('spinbutton', { name: '2工程 1台' });
    fireEvent.change(second, { target: { value: '' } });
    expect(second).toHaveAttribute('placeholder', '18');
    fireEvent.click(screen.getByRole('button', { name: '2工程にする' }));
    await waitFor(() => expect(mutation).toHaveBeenCalledWith(expect.objectContaining({ minutes: [12, 18], expectedMinutes: null, expectedOpIds: [] })));
  });
  it.each(['0', '-1', '100001'])('blocks nonpositive or oversized input %s', async (raw) => {
    setup(); fireEvent.click(screen.getByRole('button', { name: /の数量/ }));
    const first = screen.getByRole('spinbutton', { name: '1工程 1台' });
    await waitFor(() => expect(first).toBeEnabled()); fireEvent.change(first, { target: { value: raw } });
    expect(screen.getByRole('button', { name: '2工程にする' })).toBeDisabled(); expect(mutation).not.toHaveBeenCalled();
  });
  it('blocks empty operations when the entered time consumes the original time', async () => {
    setup(); fireEvent.click(screen.getByRole('button', { name: /の数量/ }));
    const first = screen.getByRole('spinbutton', { name: '1工程 1台' });
    await waitFor(() => expect(first).toBeEnabled());
    fireEvent.change(first, { target: { value: '30' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: '2工程 1台' }), { target: { value: '' } });
    expect(screen.getByRole('button', { name: '2工程にする' })).toBeDisabled();
  });
});
it.each([
  { total: 1, count: 3, expected: [1 / 3, 1 / 3, 1 / 3] },
  { total: 10, count: 3, expected: [3.5, 3.5, 3] },
  { total: 7, count: 2, expected: [3.5, 3.5] }
])('preserves the total when dividing $total minutes into $count operations', ({ total, count, expected }) => {
  const draft = unitOpDraft(total, count, []);
  expect(draft).toEqual(expected);
  expect(draft.reduce<number>((sum, value) => sum + value!, 0)).toBe(total);
});
it('keeps a zero total and blocks configuration', () => {
  setup([], { unitRequiredMinutes: 0 });
  fireEvent.click(screen.getByRole('button', { name: /の数量/ }));
  expect(screen.getByRole('spinbutton', { name: '1工程 1台' })).toHaveValue(0);
  expect(screen.getByRole('spinbutton', { name: '2工程 1台' })).toHaveValue(0);
  expect(screen.getByRole('button', { name: '2工程にする' })).toBeDisabled();
});
it('rounds equal divisions to half minutes and uses the remaining original time for blanks', () => {
  expect(unitOpDraft(10, 3, [])).toEqual([3.5, 3.5, 3]);
  expect(unitOpGhost(30, [10, null, null])).toBe(10);
  expect(unitOpGhost(10, [15, null])).toBeNull();
  expect(unitOpGhost(0, [null, null])).toBeNull();
  expect(unitOpDraft(null, 2, [])).toEqual([null, null]);
  expect(unitOpGhost(null, [null, null])).toBeNull();
});
it('connects shuffled intervals in unit then operation order, and leaves gaps only after each unit', () => {
  const pieces = [2, 1].flatMap((position) => [3, 1, 2].map((opNo) => ({ ...item,
    itemId: opNo === 1 ? `piece:${position}` : `pieceops:${position}:${opNo}`, pieceId: String(position), piecePosition: position,
    opRange: { fromOpNo: opNo, toOpNo: opNo }, unitRequiredMinutes: 10, setupMinutes: position === 1 ? 5 : 0,
    ops: [{ opNo, minutes: 10, setupMinutes: position === 1 ? 5 : 0 }] })));
  const layout = buildPlanningBoardGanttLayout({ items: pieces, resources: ['021'], allocation: 'alternate', view: 'resource',
    seibanOrder: ['S'], dailyHoursByResource: {}, today: '2026-11-12', now: new Date('2026-11-12T08:00:00+09:00'), scale: 1, mode: 'forward' });
  const bars = layout.groups.flatMap((group) => group.rows.flatMap((row) => row.bars));
  expect(planningBoardChainPairs(bars.filter(isNormalGanttBar), 'pieces').map(([a, b]) => [a.item.itemId, b.item.itemId])).toEqual([
    ['piece:1', 'pieceops:1:2'], ['pieceops:1:2', 'pieceops:1:3'], ['pieceops:1:3', 'piece:2'],
    ['piece:2', 'pieceops:2:2'], ['pieceops:2:2', 'pieceops:2:3']
  ]);
  for (const bar of bars) {
    const width = (bar.segments![0].end - bar.segments![0].start) * 10000;
    expect(ganttBarGeometry(bar, layout.start, 10000, true)!.width).toBeCloseTo(width - (bar.opSplitLast ? 8 : 0));
    const setupLength = bar.setupSegments?.reduce((sum, segment) => sum + segment.end - segment.start, 0) ?? 0;
    expect(setupLength > 0).toBe(bar.item.kind !== 'test' && bar.item.piecePosition === 1);
  }
});
