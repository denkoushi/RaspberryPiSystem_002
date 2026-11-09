import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildPlanningBoardGanttLayout } from './planningBoardGanttLayout';
import { PlanningBoardGanttView } from './PlanningBoardGanttView';
import { PlanningBoardResourceMinutesSheet } from './PlanningBoardResourceMinutesSheet';
import { PlanningBoardSingleResourceHead } from './PlanningBoardSingleResourceHead';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const { save, rowRender } = vi.hoisted(() => ({ save: vi.fn(), rowRender: vi.fn() }));
vi.mock('../../../../api/hooks/production-schedule', () => ({ useUpdateKioskGrindingPlanningBoardResourcePartMinutes: (resource: string, part: string) => { rowRender(resource, part); return { mutateAsync: save, isError: false }; } }));
vi.mock('../../../../api/hooks/machine-signal', () => ({ useMachineSignalResourceUptime: () => ({ data: undefined }) }));
const item = (overrides: Partial<GrindingPlanningBoardItem> = {}): GrindingPlanningBoardItem => ({
  itemId: 'a', kind: 'row', itemRevision: 'r', version: 1, sourceRowId: 'a', fseiban: '26-1', fhincd: ' P1 ', fhinmei: '部品', machineName: null,
  productNo: '1', processOrder: '10', originalResourceCd: '584', effectiveResourceCd: '305', originalDueDate: '2026-11-10', effectiveDueDate: null,
  originalRank: null, alternateRank: null, plannedQuantity: 4, originalRequiredMinutes: 60, ownRequiredMinutes: 70,
  requiredMinutesSource: 'own', requiredMinutes: 70, requiredMinutesKnown: true, isCompleted: false, lslhSurface: false,
  progress: { completed: 0, total: 1, quantityKnown: true }, ...overrides
});
afterEach(() => { vi.useRealTimers(); save.mockReset(); rowRender.mockClear(); vi.restoreAllMocks(); });
describe('resource minutes UI', () => {
  it('shows summed original/own hours, selected source and saved count; switches and toggles', () => {
    const source = vi.fn(), toggle = vi.fn();
    render(<PlanningBoardSingleResourceHead resourceCd="305" names={[]} hours={8} pausesForBreaks averageSeconds={undefined} disabled={false} pickerOpen={false} onCapacityChange={vi.fn()}
      items={[item(), item({ itemId: 'b', originalRequiredMinutes: 30, ownRequiredMinutes: null })]}
      minutes={{ ownSourceResourceCds: ['305'], values: [{ resourceCd: '305', fhincd: 'P1', perUnitMinutes: 10, setupMinutes: 30 }] }} onSourceChange={source} onToggleSheet={toggle} />);
    expect(screen.getByRole('button', { name: '元の値 1.5h' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '独自の値 1.7h' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '元の値 1.5h' })); expect(source).toHaveBeenCalledWith('original');
    fireEvent.click(screen.getByRole('button', { name: /品番の値 1/ })); expect(toggle).toHaveBeenCalled();
  });
  it('groups trimmed parts, sums per-bar setup, debounces steppers and removes a cleared value', async () => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    const view = render(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item(), item({ itemId: 'b', fhincd: 'P1', quantity: 2 })]} values={[]} disabled={false} />);
    expect(screen.getAllByRole('row')).toHaveLength(2);
    const row = screen.getAllByRole('row')[1]!;
    expect(within(row).getByText('120分')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'P1 1台を増やす' }));
    fireEvent.click(screen.getByRole('button', { name: 'P1 段取りを増やす' }));
    expect(screen.getByRole('spinbutton', { name: 'P1 1台' })).toHaveValue(20);
    expect(within(row).getByText('130分')).toBeInTheDocument(); expect(save).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledTimes(1); expect(save).toHaveBeenLastCalledWith({ resourceCd: '305', fhincd: 'P1', perUnitMinutes: 20, setupMinutes: 5, expectedOpIds: [] });
    view.rerender(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item(), item({ itemId: 'b', fhincd: 'P1', quantity: 2 })]} values={[{ resourceCd: '305', fhincd: 'P1', perUnitMinutes: 20, setupMinutes: 5 }]} disabled={false} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'P1 1台' }), { target: { value: '' } });
    expect(within(row).queryByText('130分')).toBeNull();
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('spinbutton', { name: 'P1 段取り' })).toHaveValue(5);
  });
  it('flushes a pending edit when the sheet closes', () => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] }); const view = render(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item({ fhincd: 'FLUSH' })]} values={[]} disabled={false} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'FLUSH 1台' }), { target: { value: '10' } }); view.unmount();
    expect(save).toHaveBeenCalledWith({ resourceCd: '305', fhincd: 'FLUSH', perUnitMinutes: 10, setupMinutes: 0, expectedOpIds: [] });
  });
  it('keeps later edits visible and saves each row sequentially while a request is pending', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    save.mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve({ ownSourceResourceCds: [], values: [] }); })).mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    render(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item({ fhincd: 'SEQ' })]} values={[{ resourceCd: '305', fhincd: 'SEQ', perUnitMinutes: 10, setupMinutes: 30 }]} disabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'SEQ 1台を減らす' }));
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'SEQ 段取りを減らす' }));
    await act(async () => vi.advanceTimersByTime(400));
    expect(screen.getByRole('spinbutton', { name: 'SEQ 1台' })).toHaveValue(9.5);
    expect(screen.getByRole('spinbutton', { name: 'SEQ 段取り' })).toHaveValue(25);
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ resourceCd: '305', fhincd: 'SEQ', perUnitMinutes: 9.5, setupMinutes: 25, expectedOpIds: [] });
  });
  it('counts parent lots, sums quantity/original and retains setup-only drafts after reopening', async () => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    const props = { resourceCd: '305', items: [item({ fhincd: 'DRAFT', parentItemId: 'parent', quantity: 2 }), item({ fhincd: 'DRAFT', itemId: 'b', parentItemId: 'parent', quantity: 4 })], values: [], disabled: false };
    const view = render(<PlanningBoardResourceMinutesSheet {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'DRAFT 段取りを増やす' }));
    expect(screen.queryByText('2件')).toBeNull();
    expect(screen.getByRole('spinbutton', { name: 'DRAFT 1台' })).toHaveAttribute('placeholder', '19');
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).not.toHaveBeenCalled();
    view.unmount();
    render(<PlanningBoardResourceMinutesSheet {...props} />);
    expect(screen.getByRole('spinbutton', { name: 'DRAFT 段取り' })).toHaveValue(5);
    expect(screen.getByRole('spinbutton', { name: 'DRAFT 1台' })).toHaveValue(null);
    fireEvent.click(screen.getByRole('button', { name: 'DRAFT 1台を減らす' }));
    expect(screen.getByRole('spinbutton', { name: 'DRAFT 1台' })).toHaveValue(19);
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledWith({ resourceCd: '305', fhincd: 'DRAFT', setupMinutes: 5, perUnitMinutes: 19, expectedOpIds: [] });
  });
  it('adds horizontal operations, waits for every unit value, and saves operation setup totals', async () => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    render(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: 'OPS' })]} values={[]} disabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: '＋工程' }));
    expect(screen.getByText('2工程')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('spinbutton', { name: 'OPS 2工程 1台' })).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'OPS 2工程 段取りを増やす' }));
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'OPS 1工程 1台' }), { target: { value: '10' } });
    expect(screen.getByRole('spinbutton', { name: 'OPS 2工程 1台' })).toHaveAttribute('placeholder', '4');
    fireEvent.click(screen.getByRole('button', { name: 'OPS 2工程 1台を増やす' }));
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledWith({ resourceCd: '021', fhincd: 'OPS', perUnitMinutes: 14, setupMinutes: 5, expectedOpIds: [], ops: [{ opNo: 1, minutes: 10, setupMinutes: 0 }, { opNo: 2, minutes: 4, setupMinutes: 5 }] });
  });
  it('keeps a single remaining operation and adds after the greatest saved number', async () => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const view = render(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: 'FIXED' })]} values={[{ resourceCd: '021', fhincd: 'FIXED', setupMinutes: 15, perUnitMinutes: 15, ops: [{ id: 'op-1', opNo: 1, minutes: 10, setupMinutes: 5 }, { id: 'op-3', opNo: 3, minutes: 5, setupMinutes: 10 }] }]} disabled={false} />);
    expect(screen.queryByText('2工程')).toBeNull();
    fireEvent.click(screen.getByText('FIXED'));
    fireEvent.click(screen.getByRole('button', { name: 'FIXED 1工程を外す' }));
    expect(confirm).toHaveBeenCalledWith('FIXED の 1工程を外します。全ての片でこの工程の完了記録が消えます');
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenLastCalledWith({ resourceCd: '021', fhincd: 'FIXED', perUnitMinutes: 5, setupMinutes: 10, expectedOpIds: ['op-1', 'op-3'], ops: [{ opNo: 3, minutes: 5, setupMinutes: 10 }] });
    view.rerender(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: 'FIXED' })]} values={[{ resourceCd: '021', fhincd: 'FIXED', setupMinutes: 10, perUnitMinutes: 5, ops: [{ id: 'op-3', opNo: 3, minutes: 5, setupMinutes: 10 }] }]} disabled={false} />);
    expect(screen.queryByText('1工程')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '＋工程' }));
    expect(screen.getByText('4工程')).toBeInTheDocument();
    expect(screen.queryByText('2工程')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'FIXED 4工程を外す' }));
    fireEvent.click(screen.getByRole('button', { name: 'FIXED 3工程を外す' }));
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenLastCalledWith({ resourceCd: '021', fhincd: 'FIXED', perUnitMinutes: 5, setupMinutes: 10, expectedOpIds: ['op-3'], ops: [] });
  });
  it('sends the operation set saved by the previous request before the cache re-renders', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let finish!: () => void;
    save.mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve({ ownSourceResourceCds: [], savedOpIds: ['op-3'], savedOpNos: [3], values: [{ resourceCd: '021', fhincd: 'CHAIN', perUnitMinutes: 5, setupMinutes: 10, ops: [{ id: 'op-3', opNo: 3, minutes: 5, setupMinutes: 10 }] }] }); })).mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    render(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: 'CHAIN' })]} values={[{ resourceCd: '021', fhincd: 'CHAIN', setupMinutes: 15, perUnitMinutes: 15, ops: [{ id: 'op-1', opNo: 1, minutes: 10, setupMinutes: 5 }, { id: 'op-3', opNo: 3, minutes: 5, setupMinutes: 10 }] }]} disabled={false} />);
    fireEvent.click(screen.getByText('CHAIN'));
    fireEvent.click(screen.getByRole('button', { name: 'CHAIN 1工程を外す' }));
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedOpIds: ['op-1', 'op-3'] }));
    fireEvent.click(screen.getByRole('button', { name: 'CHAIN 3工程 1台を増やす' }));
    await act(async () => vi.advanceTimersByTime(400));
    await act(async () => finish());
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ resourceCd: '021', fhincd: 'CHAIN', perUnitMinutes: 5.5, setupMinutes: 10, expectedOpIds: ['op-3'], ops: [{ opNo: 3, minutes: 5.5, setupMinutes: 10 }] });
  });
  it('keeps a cleared operation unit as a draft instead of resetting the saved row', async () => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    render(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: 'KEEP' })]} values={[{ resourceCd: '021', fhincd: 'KEEP', setupMinutes: 5, perUnitMinutes: 15, ops: [{ id: 'op-1', opNo: 1, minutes: 10, setupMinutes: 5 }, { id: 'op-2', opNo: 2, minutes: 5, setupMinutes: null }] }]} disabled={false} />);
    fireEvent.change(screen.getByLabelText('KEEP 2工程 1台'), { target: { value: '' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByLabelText('KEEP 2工程 1台')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('KEEP 1工程 1台')).toHaveValue(10);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'KEEP 2工程を外す' }));
    expect(confirm).toHaveBeenCalledWith('KEEP の 2工程を外します。全ての片でこの工程の完了記録が消えます');
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).not.toHaveBeenCalled();
  });
  it('only exposes removal on the selected row, confirms reset and respects cancellation', async () => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: 'RESET', fhinmei: '全文の長い品名' }), item({ fhincd: 'OTHER' })]} values={[{ resourceCd: '021', fhincd: 'RESET', setupMinutes: 5, perUnitMinutes: 10, ops: [{ id: 'op-2', opNo: 2, minutes: 10, setupMinutes: 5 }] }]} disabled={false} />);
    expect(screen.queryByRole('button', { name: 'RESET 2工程を外す' })).toBeNull();
    fireEvent.click(screen.getByText('RESET'));
    expect(screen.getAllByText('全文の長い品名')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    expect(confirm).toHaveBeenLastCalledWith('RESET の工程を外して元の値に戻します。全ての片で全工程の完了記録が消えます');
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledWith({ resourceCd: '021', fhincd: 'RESET', setupMinutes: 0, perUnitMinutes: null, expectedOpIds: ['op-2'], ops: [] });
  });
  it('shows a failed row error and retains the draft after rollback', async () => {
    vi.useFakeTimers(); save.mockRejectedValue(new Error('offline'));
    const props = { resourceCd: '305', items: [item({ fhincd: 'FAIL' })], values: [], disabled: false };
    const view = render(<PlanningBoardResourceMinutesSheet {...props} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'FAIL 1台' }), { target: { value: '12' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした。');
    view.rerender(<PlanningBoardResourceMinutesSheet {...props} />);
    expect(screen.getByRole('spinbutton', { name: 'FAIL 1台' })).toHaveValue(12);
    save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    fireEvent.click(screen.getByRole('button', { name: 'FAIL 1台を増やす' }));
    await act(async () => vi.advanceTimersByTime(400));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('preserves typed values, handles missing originals and enforces operation total limits and maximum count', async () => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    render(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: 'LIMIT', originalRequiredMinutes: null })]} values={[{ resourceCd: '021', fhincd: 'LIMIT', setupMinutes: 0, perUnitMinutes: 20, ops: Array.from({ length: 20 }, (_, i) => ({ opNo: i + 1, minutes: 1, setupMinutes: 0 })) }]} disabled={false} />);
    expect(screen.getByRole('button', { name: '＋工程' })).toBeDisabled();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'LIMIT 1工程 1台' }), { target: { value: '100000' } });
    fireEvent.blur(screen.getByRole('spinbutton', { name: 'LIMIT 1工程 1台' }));
    expect(screen.getByRole('spinbutton', { name: 'LIMIT 1工程 1台' })).toHaveValue(1);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'LIMIT 1工程 段取り' }), { target: { value: '8' } });
    fireEvent.blur(screen.getByRole('spinbutton', { name: 'LIMIT 1工程 段取り' }));
    expect(screen.getByRole('spinbutton', { name: 'LIMIT 1工程 段取り' })).toHaveValue(8);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'LIMIT 1工程 1台' }), { target: { value: '1.3' } });
    fireEvent.blur(screen.getByRole('spinbutton', { name: 'LIMIT 1工程 1台' }));
    expect(screen.getByRole('spinbutton', { name: 'LIMIT 1工程 1台' })).toHaveValue(1.3);
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('keeps typed digits and clears values received after mounting', async () => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    const props = { resourceCd: '305', items: [item({ fhincd: 'LATE' })], values: [], disabled: false };
    const view = render(<PlanningBoardResourceMinutesSheet {...props} />);
    const setup = screen.getByRole('spinbutton', { name: 'LATE 段取り' });
    fireEvent.change(setup, { target: { value: '1' } });
    expect(setup).toHaveValue(1);
    fireEvent.change(setup, { target: { value: '15' } });
    fireEvent.blur(setup);
    expect(setup).toHaveValue(15);
    view.unmount();
    // Use another row so the retained setup draft does not mask the arriving saved value.
    const late = { ...props, items: [item({ fhincd: 'ARRIVED' })] };
    const received = render(<PlanningBoardResourceMinutesSheet {...late} disabled />);
    received.rerender(<PlanningBoardResourceMinutesSheet {...late} values={[{ resourceCd: '305', fhincd: 'ARRIVED', perUnitMinutes: 10, setupMinutes: 15 }]} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'ARRIVED 1台' }), { target: { value: '' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('spinbutton', { name: 'ARRIVED 段取り' })).toHaveValue(15);
  });
  it('does not save a cleared value after the first save finishes', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    save.mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve({ ownSourceResourceCds: [], values: [] }); })).mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    render(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item({ fhincd: 'INFLIGHT' })]} values={[]} disabled={false} />);
    const input = screen.getByRole('spinbutton', { name: 'INFLIGHT 1台' });
    fireEvent.change(input, { target: { value: '12' } });
    await act(async () => vi.advanceTimersByTime(400));
    fireEvent.change(input, { target: { value: '' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('keeps the explicit clear intent through another edit before debounce', async () => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: 'CLEAR-NEXT' })]} values={[{
      resourceCd: '021', fhincd: 'CLEAR-NEXT', perUnitMinutes: 10, setupMinutes: 5,
      ops: [{ id: 'op-3', opNo: 3, minutes: 10, setupMinutes: 5 }]
    }]} disabled={false} />);
    fireEvent.click(screen.getByText('CLEAR-NEXT'));
    fireEvent.click(screen.getByRole('button', { name: 'CLEAR-NEXT 3工程を外す' }));
    fireEvent.change(screen.getByLabelText('CLEAR-NEXT 1台'), { target: { value: '12' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledWith({ resourceCd: '021', fhincd: 'CLEAR-NEXT',
      perUnitMinutes: 12, setupMinutes: 5, ops: [], expectedOpIds: ['op-3'] });
  });
  it.each(['remove', 'reset', 'remove-empty'] as const)('retains an incomplete draft after %s and ordinary edits, including reopening', async (action) => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const part = `CLEAR-INCOMPLETE-${action}`;
    const props = { resourceCd: '021', items: [item({ fhincd: part })], values: [{
      resourceCd: '021', fhincd: part, perUnitMinutes: 10, setupMinutes: 5,
      ops: [{ id: 'op-1', opNo: 1, minutes: 10, setupMinutes: 5 }]
    }], disabled: false };
    const view = render(<PlanningBoardResourceMinutesSheet {...props} />);
    fireEvent.click(screen.getByText(part));
    if (action === 'remove-empty') fireEvent.change(screen.getByLabelText(`${part} 1工程 1台`), { target: { value: '' } });
    if (action === 'reset') fireEvent.click(screen.getByText('元に戻す'));
    else fireEvent.click(screen.getByLabelText(`${part} 1工程を外す`));
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(`${part} 段取り`), { target: { value: '8' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).not.toHaveBeenCalled();
    // Exercise close-time normalization as well as the restored-draft save check.
    fireEvent.change(screen.getByLabelText(`${part} 段取り`), { target: { value: '8.5' } });
    view.unmount();
    render(<PlanningBoardResourceMinutesSheet {...props} />);
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByLabelText(`${part} 段取り`)).toHaveValue(8);
    expect(screen.getByLabelText(`${part} 1台`)).toHaveValue(null);
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '12' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledExactlyOnceWith({ resourceCd: '021', fhincd: part,
      perUnitMinutes: 12, setupMinutes: 8, ops: [], expectedOpIds: ['op-1'] });
  });
  it('resets the saved row when its last operation has no unit value', async () => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const part = 'REMOVE-EMPTY-RESET';
    render(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: part })]} values={[{
      resourceCd: '021', fhincd: part, perUnitMinutes: 10, setupMinutes: 5,
      ops: [{ id: 'op-1', opNo: 1, minutes: 10, setupMinutes: 5 }]
    }]} disabled={false} />);
    fireEvent.change(screen.getByLabelText(`${part} 1工程 1台`), { target: { value: '' } });
    fireEvent.click(screen.getByLabelText(`${part} 1工程を外す`));
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledExactlyOnceWith({ resourceCd: '021', fhincd: part,
      perUnitMinutes: null, setupMinutes: 0, ops: [], expectedOpIds: ['op-1'] });
  });
  it.each([false, true])('retries a failed draft on remount including reset: %s', async (reset) => {
    vi.useFakeTimers(); save.mockRejectedValue(new Error('offline'));
    const part = reset ? 'RETRY-RESET' : 'RETRY';
    const props = { resourceCd: '305', items: [item({ fhincd: part })],
      values: [{ resourceCd: '305', fhincd: part, perUnitMinutes: 10, setupMinutes: 5 }], disabled: false };
    const view = render(<PlanningBoardResourceMinutesSheet {...props} />);
    fireEvent.click(screen.getByText(part));
    if (reset) fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    else fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '12' } });
    await act(async () => vi.advanceTimersByTime(400));
    view.unmount();
    render(<PlanningBoardResourceMinutesSheet {...props} />);
    await act(async () => {});
    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした。');
  });
  it('shares the queue across remounts and drops an older queued value immediately on edit', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    save.mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve({ ownSourceResourceCds: [], values: [] }); })).mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    const props = { resourceCd: '305', items: [item({ fhincd: 'REMOUNT-QUEUE' })], values: [], disabled: false };
    const view = render(<PlanningBoardResourceMinutesSheet {...props} />);
    fireEvent.change(screen.getByLabelText('REMOUNT-QUEUE 1台'), { target: { value: '10' } });
    await act(async () => vi.advanceTimersByTime(400));
    fireEvent.change(screen.getByLabelText('REMOUNT-QUEUE 1台'), { target: { value: '20' } });
    await act(async () => vi.advanceTimersByTime(400));
    view.unmount();
    render(<PlanningBoardResourceMinutesSheet {...props} />);
    fireEvent.change(screen.getByLabelText('REMOUNT-QUEUE 1台'), { target: { value: '30' } });
    await act(async () => finish());
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(400));
    expect(save.mock.calls.map(([payload]) => payload.perUnitMinutes)).toEqual([10, 30]);
  });
  it('discards a conflicting operation draft and displays the refreshed operation set', async () => {
    vi.useFakeTimers();
    save.mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { errorCode: 'OPERATION_SET_CHANGED' } } });
    const props = { resourceCd: '021', items: [item({ fhincd: 'CONFLICT' })], disabled: false };
    const view = render(<PlanningBoardResourceMinutesSheet {...props} values={[{
      resourceCd: '021', fhincd: 'CONFLICT', perUnitMinutes: 10, setupMinutes: 5,
      ops: [{ id: 'op-1', opNo: 1, minutes: 10, setupMinutes: 5 }]
    }]} />);
    fireEvent.change(screen.getByLabelText('CONFLICT 1工程 1台'), { target: { value: '12' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ expectedOpIds: ['op-1'] }));
    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした。');
    view.rerender(<PlanningBoardResourceMinutesSheet {...props} values={[{
      resourceCd: '021', fhincd: 'CONFLICT', perUnitMinutes: 20, setupMinutes: 5,
      ops: [{ id: 'op-3', opNo: 3, minutes: 20, setupMinutes: 5 }]
    }]} />);
    expect(screen.queryByLabelText('CONFLICT 1工程 1台')).toBeNull();
    expect(screen.getByLabelText('CONFLICT 3工程 1台')).toHaveValue(20);
    view.unmount();
    render(<PlanningBoardResourceMinutesSheet {...props} values={[{
      resourceCd: '021', fhincd: 'CONFLICT', perUnitMinutes: 20, setupMinutes: 5,
      ops: [{ id: 'op-3', opNo: 3, minutes: 20, setupMinutes: 5 }]
    }]} />);
    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした。');
  });
  it('drops newer queued edits too when their operation definitions conflict', async () => {
    vi.useFakeTimers();
    let reject!: (error: unknown) => void;
    save.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    render(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: 'QUEUED-CONFLICT' })]} disabled={false} values={[{
      resourceCd: '021', fhincd: 'QUEUED-CONFLICT', perUnitMinutes: 10, setupMinutes: 5,
      ops: [{ id: 'op-1', opNo: 1, minutes: 10, setupMinutes: 5 }]
    }]} />);
    fireEvent.change(screen.getByLabelText('QUEUED-CONFLICT 1工程 1台'), { target: { value: '12' } });
    await act(async () => vi.advanceTimersByTime(400));
    fireEvent.change(screen.getByLabelText('QUEUED-CONFLICT 1工程 1台'), { target: { value: '15' } });
    await act(async () => vi.advanceTimersByTime(400));
    await act(async () => reject({ isAxiosError: true, response: { status: 409, data: { errorCode: 'OPERATION_SET_CHANGED' } } }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした。');
  });
  it('shows refreshed cache values after the latest draft succeeds', async () => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    const props = { resourceCd: '305', items: [item({ fhincd: 'REFRESH' })], disabled: false };
    const view = render(<PlanningBoardResourceMinutesSheet {...props} values={[]} />);
    fireEvent.change(screen.getByLabelText('REFRESH 1台'), { target: { value: '12' } });
    await act(async () => vi.advanceTimersByTime(400));
    fireEvent.blur(screen.getByLabelText('REFRESH 1台'));
    view.rerender(<PlanningBoardResourceMinutesSheet {...props} values={[{ resourceCd: '305', fhincd: 'REFRESH', perUnitMinutes: 25, setupMinutes: 10 }]} />);
    expect(screen.getByLabelText('REFRESH 1台')).toHaveValue(25);
  });
  it.each([3, 20])('avoids removed saved numbers before debounce, maximum %s', async (max) => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const part = `NUMBER-${max}`;
    const ops = [1, 2, max].map((opNo) => ({ opNo, minutes: 1, setupMinutes: 0 }));
    render(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: part })]} values={[{ resourceCd: '021', fhincd: part, perUnitMinutes: 3, setupMinutes: 0, ops }]} disabled={false} />);
    fireEvent.click(screen.getByText(part));
    fireEvent.click(screen.getByLabelText(`${part} 2工程を外す`));
    fireEvent.click(screen.getByText('＋工程'));
    const no = max === 20 ? 3 : 4;
    expect(screen.queryByLabelText(`${part} 2工程 1台`)).toBeNull();
    fireEvent.change(screen.getByLabelText(`${part} ${no}工程 1台`), { target: { value: '0.1' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ ops: expect.arrayContaining([{ opNo: no, minutes: 0.1, setupMinutes: null }]) }));
  });
  it('allocates initial operations around saved numbers and stops when all are reserved', async () => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: 'RESERVED' })]} values={[{ resourceCd: '021', fhincd: 'RESERVED', perUnitMinutes: 20, setupMinutes: 0,
      ops: Array.from({ length: 20 }, (_, i) => ({ opNo: i + 1, minutes: 1, setupMinutes: 0 })) }]} disabled={false} />);
    fireEvent.click(screen.getByText('RESERVED'));
    fireEvent.click(screen.getByText('元に戻す'));
    fireEvent.click(screen.getByText('＋工程'));
    expect(screen.queryByLabelText('RESERVED 1工程 1台')).toBeNull();
    await act(async () => vi.advanceTimersByTime(400));
  });
  it('stops adding after all operation numbers have been used by the draft', async () => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    const part = 'USED-NUMBERS';
    render(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: part })]} values={[{
      resourceCd: '021', fhincd: part, perUnitMinutes: 1, setupMinutes: 0,
      ops: [{ id: 'op-1', opNo: 1, minutes: 1, setupMinutes: 0 }]
    }]} disabled={false} />);
    for (let no = 2; no <= 20; no++) {
      fireEvent.click(screen.getByText('＋工程'));
      expect(screen.getByLabelText(`${part} ${no}工程 1台`)).toHaveValue(null);
      fireEvent.click(screen.getByLabelText(`${part} ${no}工程を外す`));
    }
    fireEvent.click(screen.getByText('＋工程'));
    expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
    expect(screen.getByLabelText(`${part} 1工程 1台`)).toHaveValue(1);
    expect(save).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledExactlyOnceWith({ resourceCd: '021', fhincd: part,
      perUnitMinutes: 1, setupMinutes: 0, expectedOpIds: ['op-1'], ops: [{ opNo: 1, minutes: 1, setupMinutes: 0 }] });
  });
  it('starts new initial operations after saved numbers when reset is still pending', async () => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: 'INITIAL-RESERVED' })]} values={[{ resourceCd: '021', fhincd: 'INITIAL-RESERVED', perUnitMinutes: 1, setupMinutes: 0, ops: [{ id: 'op-3', opNo: 3, minutes: 1, setupMinutes: 0 }] }]} disabled={false} />);
    fireEvent.click(screen.getByText('INITIAL-RESERVED'));
    fireEvent.click(screen.getByText('元に戻す'));
    fireEvent.click(screen.getByText('＋工程'));
    expect(screen.getByLabelText('INITIAL-RESERVED 4工程 1台')).toHaveValue(null);
    expect(screen.getByLabelText('INITIAL-RESERVED 5工程 1台')).toHaveValue(null);
    expect(screen.queryByLabelText('INITIAL-RESERVED 3工程 1台')).toBeNull();
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).not.toHaveBeenCalled();
  });
  it.each([null, 7])('inherits only the actual unit value when adding initial operations: %s', (minutes) => {
    const part = `INITIAL-${minutes}`;
    render(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: part })]} values={minutes === null ? [] : [{ resourceCd: '021', fhincd: part, perUnitMinutes: minutes, setupMinutes: 0 }]} disabled={false} />);
    fireEvent.click(screen.getByText('＋工程'));
    expect(screen.getByLabelText(`${part} 1工程 1台`)).toHaveValue(minutes);
    expect(screen.getByLabelText(`${part} 2工程 1台`)).toHaveValue(null);
  });
  it.each([
    ['段取り', '8', true], ['段取り', '1.3', false], ['段取り', '-1', false], ['段取り', '100001', false],
    ['1台', '0', true], ['1台', '1.3', true], ['1台', '-1', false], ['1台', '100001', false], ['1台', '100000', true]
  ] as const)('validates typed %s %s without rounding', async (field, raw, valid) => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    const part = `TYPED-${field}-${raw}`;
    render(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item({ fhincd: part })]} values={[{ resourceCd: '305', fhincd: part, perUnitMinutes: 5, setupMinutes: 10 }]} disabled={false} />);
    const input = screen.getByLabelText(`${part} ${field}`);
    fireEvent.change(input, { target: { value: raw } });
    expect(input).toHaveValue(Number(raw));
    if (valid) expect(input).not.toHaveAttribute('aria-invalid', 'true');
    else expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.blur(input);
    expect(input).toHaveValue(valid ? Number(raw) : field === '段取り' ? 10 : 5);
    await act(async () => vi.advanceTimersByTime(400));
    if (valid) expect(save).toHaveBeenCalledWith(expect.objectContaining({ [field === '段取り' ? 'setupMinutes' : 'perUnitMinutes']: Number(raw) }));
    else expect(save).toHaveBeenCalledWith(expect.objectContaining({ setupMinutes: 10, perUnitMinutes: 5 }));
  });
  it('saves setup edits for sub-half-minute operations and rejects zero or out-of-range units', async () => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    render(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: 'SMALL' })]} values={[{ resourceCd: '021', fhincd: 'SMALL', perUnitMinutes: 0.1, setupMinutes: 0, ops: [{ id: 'op-1', opNo: 1, minutes: 0.1, setupMinutes: 0 }] }]} disabled={false} />);
    const input = screen.getByLabelText('SMALL 1工程 1台');
    for (const raw of ['0', '-1', '100001']) {
      fireEvent.change(input, { target: { value: raw } });
      expect(input).toHaveAttribute('aria-invalid', 'true');
      await act(async () => vi.advanceTimersByTime(400));
      expect(save).not.toHaveBeenCalled();
      fireEvent.blur(input);
      expect(input).toHaveValue(0.1);
    }
    fireEvent.change(screen.getByLabelText('SMALL 1工程 段取り'), { target: { value: '8' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ setupMinutes: 8, ops: [{ opNo: 1, minutes: 0.1, setupMinutes: 8 }] }));
  });
  it.each([400, 'offline'])('retains failure on reopen with an incomplete draft: %s', async (failure) => {
    vi.useFakeTimers(); save.mockRejectedValue(failure === 400 ? { isAxiosError: true, response: { status: 400 } } : new Error('offline'));
    const part = `INCOMPLETE-${failure}`;
    const props = { resourceCd: '021', items: [item({ fhincd: part })], values: [{ resourceCd: '021', fhincd: part, perUnitMinutes: 1, setupMinutes: 0, ops: [{ opNo: 1, minutes: 1, setupMinutes: 0 }] }], disabled: false };
    const view = render(<PlanningBoardResourceMinutesSheet {...props} />);
    fireEvent.change(screen.getByLabelText(`${part} 1工程 1台`), { target: { value: '2' } });
    await act(async () => vi.advanceTimersByTime(400));
    fireEvent.change(screen.getByLabelText(`${part} 1工程 1台`), { target: { value: '' } });
    view.unmount();
    render(<PlanningBoardResourceMinutesSheet {...props} />);
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした。');
    save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    fireEvent.change(screen.getByLabelText(`${part} 1工程 1台`), { target: { value: '3' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('keeps failure visible while reopening and retrying, then clears it on success', async () => {
    vi.useFakeTimers(); save.mockRejectedValueOnce(new Error('offline'));
    const props = { resourceCd: '305', items: [item({ fhincd: 'RETRY-VISIBLE' })], values: [], disabled: false };
    let view = render(<PlanningBoardResourceMinutesSheet {...props} />);
    fireEvent.change(screen.getByLabelText('RETRY-VISIBLE 1台'), { target: { value: '12' } });
    await act(async () => vi.advanceTimersByTime(400));
    view.unmount();
    let finish!: () => void;
    save.mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve({ ownSourceResourceCds: [], values: [] }); }));
    view = render(<PlanningBoardResourceMinutesSheet {...props} />);
    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした。');
    await act(async () => finish());
    expect(screen.queryByRole('alert')).toBeNull();
    view.unmount();
    render(<PlanningBoardResourceMinutesSheet {...props} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(save).toHaveBeenCalledTimes(2);
  });
  it('retains an in-flight failure even if the newer draft is incomplete', async () => {
    vi.useFakeTimers();
    let fail!: (error: Error) => void;
    save.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
    const props = { resourceCd: '021', items: [item({ fhincd: 'LATE-FAILURE' })], values: [{ resourceCd: '021', fhincd: 'LATE-FAILURE', perUnitMinutes: 1, setupMinutes: 0, ops: [{ opNo: 1, minutes: 1, setupMinutes: 0 }] }], disabled: false };
    const view = render(<PlanningBoardResourceMinutesSheet {...props} />);
    fireEvent.change(screen.getByLabelText('LATE-FAILURE 1工程 1台'), { target: { value: '2' } });
    await act(async () => vi.advanceTimersByTime(400));
    fireEvent.change(screen.getByLabelText('LATE-FAILURE 1工程 1台'), { target: { value: '' } });
    await act(async () => fail(new Error('offline')));
    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした。');
    view.unmount();
    render(<PlanningBoardResourceMinutesSheet {...props} />);
    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした。');
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('cancels a valid pending value while invalid input remains visible', async () => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    const part = 'INVALID-PENDING-open';
    const props = { resourceCd: '305', items: [item({ fhincd: part })], values: [{ resourceCd: '305', fhincd: part, perUnitMinutes: 5, setupMinutes: 10 }], disabled: false };
    render(<PlanningBoardResourceMinutesSheet {...props} />);
    fireEvent.change(screen.getByLabelText(`${part} 段取り`), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(`${part} 段取り`), { target: { value: '1.3' } });
    // Another valid field must not release a row with an invalid setup.
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '6' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(`${part} 段取り`), { target: { value: '2' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ setupMinutes: 2, perUnitMinutes: 6 }));
  });
  it('keeps invalid single-value input visible when another part changes the operation columns', async () => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    const part = 'COLUMN-INVALID';
    const other = { resourceCd: '305', fhincd: 'COLUMN-OTHER', perUnitMinutes: 2, setupMinutes: 0 };
    const props = { resourceCd: '305', items: [item({ fhincd: part }), item({ itemId: 'b', fhincd: other.fhincd })], disabled: false };
    const single = { resourceCd: '305', fhincd: part, perUnitMinutes: 5, setupMinutes: 10 };
    const view = render(<PlanningBoardResourceMinutesSheet {...props} values={[single, { ...other, ops: [{ opNo: 2, minutes: 2, setupMinutes: 0 }] }]} />);
    const setup = screen.getByLabelText(`${part} 段取り`);
    fireEvent.change(setup, { target: { value: '1.3' } });
    view.rerender(<PlanningBoardResourceMinutesSheet {...props} values={[single, { ...other, ops: [{ opNo: 1, minutes: 2, setupMinutes: 0 }, { opNo: 2, minutes: 2, setupMinutes: 0 }] }]} />);
    expect(screen.getByLabelText(`${part} 段取り`)).toBe(setup);
    expect(setup).toHaveValue(1.3);
    expect(setup).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '6' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).not.toHaveBeenCalled();
    fireEvent.blur(setup);
    expect(setup).toHaveValue(10);
    expect(setup).not.toHaveAttribute('aria-invalid', 'true');
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledExactlyOnceWith({ resourceCd: '305', fhincd: part, perUnitMinutes: 6, setupMinutes: 10, expectedOpIds: [] });
  });
  it.each([false, true])('discards invalid setup on close and saves another field after reopening, in flight: %s', async (inFlight) => {
    vi.useFakeTimers();
    let finish!: () => void;
    save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    if (inFlight) save.mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve({ ownSourceResourceCds: [], values: [] }); }));
    const part = `CLOSE-INVALID-${inFlight}`;
    const props = { resourceCd: '305', items: [item({ fhincd: part })], values: [{ resourceCd: '305', fhincd: part, perUnitMinutes: 5, setupMinutes: 10 }], disabled: false };
    const view = render(<PlanningBoardResourceMinutesSheet {...props} />);
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '6' } });
    if (inFlight) {
      await act(async () => vi.advanceTimersByTime(400));
      fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '6.5' } });
    }
    const setup = screen.getByLabelText(`${part} 段取り`);
    fireEvent.focus(setup);
    fireEvent.change(setup, { target: { value: '1.3' } });
    view.unmount();
    if (inFlight) await act(async () => finish());
    else await act(async () => undefined);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ setupMinutes: 10, perUnitMinutes: inFlight ? 6.5 : 6 }));
    expect(save).toHaveBeenCalledTimes(inFlight ? 2 : 1);
    render(<PlanningBoardResourceMinutesSheet {...props} values={[{ ...props.values[0], perUnitMinutes: inFlight ? 6.5 : 6 }]} />);
    expect(screen.getByLabelText(`${part} 段取り`)).toHaveValue(10);
    expect(screen.getByLabelText(`${part} 1台`)).toHaveValue(inFlight ? 6.5 : 6);
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '7' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ setupMinutes: 10, perUnitMinutes: 7 }));
    expect(save).toHaveBeenCalledTimes(inFlight ? 3 : 2);
  });
  it.each([false, true])('reschedules a valid edit after discarding invalid setup on blur, close: %s', async (close) => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    const part = `BLUR-RESAVE-${close}`;
    const props = { resourceCd: '305', items: [item({ fhincd: part })], values: [{ resourceCd: '305', fhincd: part, perUnitMinutes: 5, setupMinutes: 10 }], disabled: false };
    const view = render(<PlanningBoardResourceMinutesSheet {...props} />);
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '6' } });
    await act(async () => vi.advanceTimersByTime(200));
    const setup = screen.getByLabelText(`${part} 段取り`);
    fireEvent.change(setup, { target: { value: '1.3' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).not.toHaveBeenCalled();
    fireEvent.blur(setup);
    expect(setup).toHaveValue(10);
    expect(setup).not.toHaveAttribute('aria-invalid', 'true');
    if (close) view.unmount();
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledExactlyOnceWith({ resourceCd: '305', fhincd: part, perUnitMinutes: 6, setupMinutes: 10, expectedOpIds: [] });
    if (close) {
      render(<PlanningBoardResourceMinutesSheet {...props} values={[{ ...props.values[0], perUnitMinutes: 6 }]} />);
      expect(screen.getByLabelText(`${part} 1台`)).toHaveValue(6);
      expect(save).toHaveBeenCalledTimes(1);
    }
  });
  it.each(['段取り', '1台'])('blocks an over-limit operation total without blur and restores %s on blur or close', async (field) => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    const part = `TOTAL-PENDING-${field}`;
    const props = { resourceCd: '021', items: [item({ fhincd: part })], values: [{ resourceCd: '021', fhincd: part, perUnitMinutes: 2, setupMinutes: 2, ops: [{ opNo: 1, minutes: 1, setupMinutes: 1 }, { opNo: 2, minutes: 1, setupMinutes: 1 }] }], disabled: false };
    const view = render(<PlanningBoardResourceMinutesSheet {...props} />);
    const input = screen.getByLabelText(`${part} 1工程 ${field}`);
    act(() => input.focus());
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.change(input, { target: { value: '100000' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(input).toHaveFocus();
    expect(input).toHaveValue(100000);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(save).not.toHaveBeenCalled();
    const otherField = field === '段取り' ? '1台' : '段取り';
    fireEvent.change(screen.getByLabelText(`${part} 2工程 ${otherField}`), { target: { value: '3' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).not.toHaveBeenCalled();
    if (field === '段取り') {
      fireEvent.blur(input);
      expect(input).toHaveValue(2);
      expect(input).not.toHaveAttribute('aria-invalid', 'true');
    } else view.unmount();
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      perUnitMinutes: field === '1台' ? 3 : 4,
      setupMinutes: field === '段取り' ? 3 : 4,
      ops: [
        { opNo: 1, minutes: field === '1台' ? 2 : 1, setupMinutes: field === '段取り' ? 2 : 1 },
        { opNo: 2, minutes: field === '段取り' ? 3 : 1, setupMinutes: field === '1台' ? 3 : 1 }
      ]
    }));
  });
  it('cancels a queued operation value when its total becomes invalid during a save', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    save.mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve({ ownSourceResourceCds: [], values: [] }); })).mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    const part = 'TOTAL-QUEUED';
    const view = render(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: part })]} values={[{ resourceCd: '021', fhincd: part, perUnitMinutes: 2, setupMinutes: 0, ops: [{ opNo: 1, minutes: 1, setupMinutes: 0 }, { opNo: 2, minutes: 1, setupMinutes: 0 }] }]} disabled={false} />);
    const input = screen.getByLabelText(`${part} 1工程 1台`);
    fireEvent.change(input, { target: { value: '2' } });
    await act(async () => vi.advanceTimersByTime(400));
    fireEvent.change(input, { target: { value: '3' } });
    await act(async () => vi.advanceTimersByTime(400));
    fireEvent.change(input, { target: { value: '100000' } });
    await act(async () => finish());
    expect(save).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue(100000);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    view.unmount();
    await act(async () => undefined);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ perUnitMinutes: 4 }));
  });
  it('cancels an unsent queued value when input becomes invalid during a save', async () => {
    vi.useFakeTimers();
    save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    let finish!: () => void;
    save.mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve({ ownSourceResourceCds: [], values: [] }); }));
    const view = render(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item({ fhincd: 'INVALID-QUEUED' })]} values={[{ resourceCd: '305', fhincd: 'INVALID-QUEUED', perUnitMinutes: 5, setupMinutes: 10 }]} disabled={false} />);
    const input = screen.getByLabelText('INVALID-QUEUED 段取り');
    fireEvent.change(input, { target: { value: '1' } });
    await act(async () => vi.advanceTimersByTime(400));
    fireEvent.change(input, { target: { value: '2' } });
    await act(async () => vi.advanceTimersByTime(400));
    fireEvent.change(input, { target: { value: '2.3' } });
    await act(async () => finish());
    expect(save).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => undefined);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ setupMinutes: 2, perUnitMinutes: 5 }));
  });
  it('retains a conflict from a close-time save until the next success', async () => {
    vi.useFakeTimers();
    let reject!: (error: unknown) => void;
    save.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    const props = { resourceCd: '305', items: [item({ fhincd: 'CLOSED-CONFLICT' })], values: [], disabled: false };
    const view = render(<PlanningBoardResourceMinutesSheet {...props} />);
    fireEvent.change(screen.getByLabelText('CLOSED-CONFLICT 1台'), { target: { value: '12' } });
    view.unmount();
    await act(async () => reject({ isAxiosError: true, response: { status: 409, data: { errorCode: 'OPERATION_SET_CHANGED' } } }));
    render(<PlanningBoardResourceMinutesSheet {...props} />);
    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした。');
    expect(screen.getByLabelText('CLOSED-CONFLICT 1台')).toHaveValue(null);
    save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    fireEvent.change(screen.getByLabelText('CLOSED-CONFLICT 1台'), { target: { value: '13' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it.each([0.1, 0.6])('does not decrease an operation below the stepper minimum: %s', async (minutes) => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    render(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: `DECREMENT-${minutes}` })]} values={[{ resourceCd: '021', fhincd: `DECREMENT-${minutes}`, perUnitMinutes: minutes, setupMinutes: 0, ops: [{ id: 'op-1', opNo: 1, minutes, setupMinutes: 0 }] }]} disabled={false} />);
    fireEvent.click(screen.getByLabelText(`DECREMENT-${minutes} 1工程 1台を減らす`));
    expect(screen.getByLabelText(`DECREMENT-${minutes} 1工程 1台`)).toHaveValue(minutes);
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).not.toHaveBeenCalled();
  });
  it('does not render unrelated rows on selection or repeated typing', async () => {
    vi.useFakeTimers(); save.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    render(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item({ fhincd: 'EDIT' }), item({ fhincd: 'IDLE' })]} values={[]} disabled={false} />);
    const count = () => rowRender.mock.calls.filter(([, part]) => part === 'IDLE').length;
    const initial = count();
    fireEvent.change(screen.getByLabelText('EDIT 1台'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('EDIT 1台'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('EDIT 段取り'), { target: { value: '8' } });
    expect(count()).toBe(initial);
    await act(async () => vi.advanceTimersByTime(400));
  });
  it.each(['forward', 'backward'] as const)('marks only own-source lanes in the normal %s view', (mode) => {
    const layout = buildPlanningBoardGanttLayout({ items: [item()], allocation: 'alternate', view: 'resource', seibanOrder: [], resources: ['305', '584'], dailyHoursByResource: {}, today: '2026-11-09', scale: 1, mode });
    render(<PlanningBoardGanttView layout={layout} scale={1} dailyHoursByResource={{}} resourceNameMap={{}} capacityPending={false} capacityError={false} onCapacityChange={vi.fn()}
      focusedSeiban={null} onFocusedSeibanChange={vi.fn()} onToggleItem={vi.fn()} onDueDrop={vi.fn()} selectedItemIds={new Set()} disabled={false} dragDisabled={false} resourceView
      resourceMinutes={{ ownSourceResourceCds: ['305'], values: [] }} />);
    expect(screen.getAllByText('独自')).toHaveLength(1);
  });
});
