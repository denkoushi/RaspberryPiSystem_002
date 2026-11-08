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
afterEach(() => { vi.useRealTimers(); save.mockReset(); });
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
    fireEvent.click(screen.getByRole('button', { name: 'P1 1個を増やす' }));
    fireEvent.click(screen.getByRole('button', { name: 'P1 段取りを増やす' }));
    expect(screen.getByRole('spinbutton', { name: 'P1 1個' })).toHaveValue(0.5);
    expect(within(row).getByText('13分')).toBeInTheDocument(); expect(save).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledTimes(1); expect(save).toHaveBeenLastCalledWith({ resourceCd: '305', fhincd: 'P1', perUnitMinutes: 0.5, setupMinutes: 5 });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'P1 1個' }), { target: { value: '' } });
    expect(within(row).queryByText('13分')).toBeNull();
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenLastCalledWith({ resourceCd: '305', fhincd: 'P1', perUnitMinutes: null, setupMinutes: 5 });
  });
  it('flushes a pending edit when the sheet closes', () => {
    vi.useFakeTimers(); save.mockResolvedValue(undefined); const view = render(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item()]} values={[]} disabled={false} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'P1 1個' }), { target: { value: '10' } }); view.unmount();
    expect(save).toHaveBeenCalledWith({ resourceCd: '305', fhincd: 'P1', perUnitMinutes: 10, setupMinutes: 0 });
  });
  it('keeps later edits visible and saves each row sequentially while a request is pending', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    save.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
    render(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item()]} values={[{ resourceCd: '305', fhincd: 'P1', perUnitMinutes: 10, setupMinutes: 30 }]} disabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'P1 1個を減らす' }));
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'P1 段取りを減らす' }));
    await act(async () => vi.advanceTimersByTime(400));
    expect(screen.getByRole('spinbutton', { name: 'P1 1個' })).toHaveValue(9.5);
    expect(screen.getByRole('spinbutton', { name: 'P1 段取り' })).toHaveValue(25);
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ resourceCd: '305', fhincd: 'P1', perUnitMinutes: 9.5, setupMinutes: 25 });
  });
  it.each(['forward', 'backward'] as const)('marks only own-source lanes in the normal %s view', (mode) => {
    const layout = buildPlanningBoardGanttLayout({ items: [item()], allocation: 'alternate', view: 'resource', seibanOrder: [], resources: ['305', '584'], dailyHoursByResource: {}, today: '2026-11-09', scale: 1, mode });
    render(<PlanningBoardGanttView layout={layout} scale={1} dailyHoursByResource={{}} resourceNameMap={{}} capacityPending={false} capacityError={false} onCapacityChange={vi.fn()}
      focusedSeiban={null} onFocusedSeibanChange={vi.fn()} onToggleItem={vi.fn()} onDueDrop={vi.fn()} selectedItemIds={new Set()} disabled={false} dragDisabled={false} resourceView
      resourceMinutes={{ ownSourceResourceCds: ['305'], values: [] }} />);
    expect(screen.getAllByText('独自')).toHaveLength(1);
  });
});
