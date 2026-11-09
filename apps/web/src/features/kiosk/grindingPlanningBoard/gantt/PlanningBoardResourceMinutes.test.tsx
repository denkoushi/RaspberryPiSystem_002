import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildPlanningBoardGanttLayout } from './planningBoardGanttLayout';
import { PlanningBoardGanttView } from './PlanningBoardGanttView';
import { PlanningBoardResourceMinutesSheet } from './PlanningBoardResourceMinutesSheet';
import { PlanningBoardSingleResourceHead } from './PlanningBoardSingleResourceHead';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const save = vi.hoisted(() => vi.fn());
vi.mock('../../../../api/hooks/production-schedule', () => ({ useUpdateKioskGrindingPlanningBoardResourcePartMinutes: () => ({ mutateAsync: save, isError: false }) }));
vi.mock('../../../../api/hooks/machine-signal', () => ({ useMachineSignalResourceUptime: () => ({ data: undefined }) }));
const item = (overrides: Partial<GrindingPlanningBoardItem> = {}): GrindingPlanningBoardItem => ({
  itemId: 'a', kind: 'row', itemRevision: 'r', version: 1, sourceRowId: 'a', fseiban: '26-1', fhincd: ' P1 ', fhinmei: '部品', machineName: null,
  productNo: '1', processOrder: '10', originalResourceCd: '584', effectiveResourceCd: '305', originalDueDate: '2026-11-10', effectiveDueDate: null,
  originalRank: null, alternateRank: null, plannedQuantity: 4, originalRequiredMinutes: 60, ownRequiredMinutes: 70,
  requiredMinutesSource: 'own', requiredMinutes: 70, requiredMinutesKnown: true, isCompleted: false, lslhSurface: false,
  progress: { completed: 0, total: 1, quantityKnown: true }, ...overrides
});
afterEach(() => { vi.useRealTimers(); save.mockReset(); vi.restoreAllMocks(); });
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
    vi.useFakeTimers(); save.mockResolvedValue(undefined);
    render(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item(), item({ itemId: 'b', fhincd: 'P1', quantity: 2 })]} values={[]} disabled={false} />);
    expect(screen.getAllByRole('row')).toHaveLength(2);
    const row = screen.getAllByRole('row')[1]!;
    expect(within(row).getByText('120分')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'P1 1台を増やす' }));
    fireEvent.click(screen.getByRole('button', { name: 'P1 段取りを増やす' }));
    expect(screen.getByRole('spinbutton', { name: 'P1 1台' })).toHaveValue(20);
    expect(within(row).getByText('130分')).toBeInTheDocument(); expect(save).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledTimes(1); expect(save).toHaveBeenLastCalledWith({ resourceCd: '305', fhincd: 'P1', perUnitMinutes: 20, setupMinutes: 5, ops: [] });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'P1 1台' }), { target: { value: '' } });
    expect(within(row).queryByText('130分')).toBeNull();
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenLastCalledWith({ resourceCd: '305', fhincd: 'P1', perUnitMinutes: null, setupMinutes: 0, ops: [] });
  });
  it('flushes a pending edit when the sheet closes', () => {
    vi.useFakeTimers(); save.mockResolvedValue(undefined); const view = render(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item()]} values={[]} disabled={false} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'P1 1台' }), { target: { value: '10' } }); view.unmount();
    expect(save).toHaveBeenCalledWith({ resourceCd: '305', fhincd: 'P1', perUnitMinutes: 10, setupMinutes: 0, ops: [] });
  });
  it('keeps later edits visible and saves each row sequentially while a request is pending', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    save.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
    render(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item()]} values={[{ resourceCd: '305', fhincd: 'P1', perUnitMinutes: 10, setupMinutes: 30 }]} disabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'P1 1台を減らす' }));
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'P1 段取りを減らす' }));
    await act(async () => vi.advanceTimersByTime(400));
    expect(screen.getByRole('spinbutton', { name: 'P1 1台' })).toHaveValue(9.5);
    expect(screen.getByRole('spinbutton', { name: 'P1 段取り' })).toHaveValue(25);
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ resourceCd: '305', fhincd: 'P1', perUnitMinutes: 9.5, setupMinutes: 25, ops: [] });
  });
  it('counts parent lots, sums quantity/original and retains setup-only drafts after reopening', async () => {
    vi.useFakeTimers(); save.mockResolvedValue(undefined);
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
    expect(save).toHaveBeenCalledWith({ resourceCd: '305', fhincd: 'DRAFT', setupMinutes: 5, perUnitMinutes: 19, ops: [] });
  });
  it('adds horizontal operations, waits for every unit value, and saves operation setup totals', async () => {
    vi.useFakeTimers(); save.mockResolvedValue(undefined);
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
    expect(save).toHaveBeenCalledWith({ resourceCd: '021', fhincd: 'OPS', perUnitMinutes: 14, setupMinutes: 5, ops: [{ opNo: 1, minutes: 10, setupMinutes: 0 }, { opNo: 2, minutes: 4, setupMinutes: 5 }] });
  });
  it('keeps a single remaining operation, fixed numbers, and reuses the smallest available number', async () => {
    vi.useFakeTimers(); save.mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: 'FIXED' })]} values={[{ resourceCd: '021', fhincd: 'FIXED', setupMinutes: 15, perUnitMinutes: 15, ops: [{ opNo: 1, minutes: 10, setupMinutes: 5 }, { opNo: 3, minutes: 5, setupMinutes: 10 }] }]} disabled={false} />);
    expect(screen.queryByText('2工程')).toBeNull();
    fireEvent.click(screen.getByText('FIXED'));
    fireEvent.click(screen.getByRole('button', { name: 'FIXED 1工程を外す' }));
    expect(confirm).toHaveBeenCalledWith('FIXED の 1工程を外します。全ての片でこの工程の完了記録が消えます');
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenLastCalledWith({ resourceCd: '021', fhincd: 'FIXED', perUnitMinutes: 5, setupMinutes: 10, ops: [{ opNo: 3, minutes: 5, setupMinutes: 10 }] });
    expect(screen.queryByText('1工程')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '＋工程' }));
    expect(screen.getByText('1工程')).toBeInTheDocument();
    expect(screen.queryByText('2工程')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'FIXED 1工程を外す' }));
    fireEvent.click(screen.getByRole('button', { name: 'FIXED 3工程を外す' }));
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenLastCalledWith({ resourceCd: '021', fhincd: 'FIXED', perUnitMinutes: 5, setupMinutes: 10, ops: [] });
  });
  it('keeps a cleared operation unit as a draft instead of resetting the saved row', async () => {
    vi.useFakeTimers(); save.mockResolvedValue(undefined);
    render(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: 'KEEP' })]} values={[{ resourceCd: '021', fhincd: 'KEEP', setupMinutes: 5, perUnitMinutes: 15, ops: [{ opNo: 1, minutes: 10, setupMinutes: 5 }, { opNo: 2, minutes: 5, setupMinutes: null }] }]} disabled={false} />);
    fireEvent.change(screen.getByLabelText('KEEP 2工程 1台'), { target: { value: '' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByLabelText('KEEP 2工程 1台')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('KEEP 1工程 1台')).toHaveValue(10);
  });
  it('only exposes removal on the selected row, confirms reset and respects cancellation', async () => {
    vi.useFakeTimers(); save.mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: 'RESET', fhinmei: '全文の長い品名' }), item({ fhincd: 'OTHER' })]} values={[{ resourceCd: '021', fhincd: 'RESET', setupMinutes: 5, perUnitMinutes: 10, ops: [{ opNo: 2, minutes: 10, setupMinutes: 5 }] }]} disabled={false} />);
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
    expect(save).toHaveBeenCalledWith({ resourceCd: '021', fhincd: 'RESET', setupMinutes: 0, perUnitMinutes: null, ops: [] });
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
    save.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'FAIL 1台を増やす' }));
    await act(async () => vi.advanceTimersByTime(400));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('rounds inputs, handles missing originals and enforces operation total limits and maximum count', async () => {
    vi.useFakeTimers(); save.mockResolvedValue(undefined);
    render(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: 'LIMIT', originalRequiredMinutes: null })]} values={[{ resourceCd: '021', fhincd: 'LIMIT', setupMinutes: 0, perUnitMinutes: 20, ops: Array.from({ length: 20 }, (_, i) => ({ opNo: i + 1, minutes: 1, setupMinutes: 0 })) }]} disabled={false} />);
    expect(screen.getByRole('button', { name: '＋工程' })).toBeDisabled();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'LIMIT 1工程 1台' }), { target: { value: '100000' } });
    fireEvent.blur(screen.getByRole('spinbutton', { name: 'LIMIT 1工程 1台' }));
    expect(screen.getByRole('spinbutton', { name: 'LIMIT 1工程 1台' })).toHaveValue(1);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'LIMIT 1工程 段取り' }), { target: { value: '8' } });
    fireEvent.blur(screen.getByRole('spinbutton', { name: 'LIMIT 1工程 段取り' }));
    expect(screen.getByRole('spinbutton', { name: 'LIMIT 1工程 段取り' })).toHaveValue(10);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'LIMIT 1工程 1台' }), { target: { value: '1.3' } });
    fireEvent.blur(screen.getByRole('spinbutton', { name: 'LIMIT 1工程 1台' }));
    expect(screen.getByRole('spinbutton', { name: 'LIMIT 1工程 1台' })).toHaveValue(1.5);
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('keeps typed digits while rounding and clears values received after mounting', async () => {
    vi.useFakeTimers(); save.mockResolvedValue(undefined);
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
    expect(save).toHaveBeenCalledWith({ resourceCd: '305', fhincd: 'ARRIVED', perUnitMinutes: null, setupMinutes: 0, ops: [] });
  });
  it('queues a reset when a new value is cleared during its first save', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    save.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
    render(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item({ fhincd: 'INFLIGHT' })]} values={[]} disabled={false} />);
    const input = screen.getByRole('spinbutton', { name: 'INFLIGHT 1台' });
    fireEvent.change(input, { target: { value: '12' } });
    await act(async () => vi.advanceTimersByTime(400));
    fireEvent.change(input, { target: { value: '' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(save).toHaveBeenLastCalledWith({ resourceCd: '305', fhincd: 'INFLIGHT', perUnitMinutes: null, setupMinutes: 0, ops: [] });
  });
  it.each(['forward', 'backward'] as const)('marks only own-source lanes in the normal %s view', (mode) => {
    const layout = buildPlanningBoardGanttLayout({ items: [item()], allocation: 'alternate', view: 'resource', seibanOrder: [], resources: ['305', '584'], dailyHoursByResource: {}, today: '2026-11-09', scale: 1, mode });
    render(<PlanningBoardGanttView layout={layout} scale={1} dailyHoursByResource={{}} resourceNameMap={{}} capacityPending={false} capacityError={false} onCapacityChange={vi.fn()}
      focusedSeiban={null} onFocusedSeibanChange={vi.fn()} onToggleItem={vi.fn()} onDueDrop={vi.fn()} selectedItemIds={new Set()} disabled={false} dragDisabled={false} resourceView
      resourceMinutes={{ ownSourceResourceCds: ['305'], values: [] }} />);
    expect(screen.getAllByText('独自')).toHaveLength(1);
  });
});
