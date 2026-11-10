import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useKioskGrindingPlanningBoardResourceMinutes } from '../../../../api/hooks/production-schedule/grinding-planning-board-resource-minutes';
import { productionScheduleQueryKeys } from '../../../../api/queryKeys/productionSchedule';

import { PlanningBoardResourceMinutesSheet } from './PlanningBoardResourceMinutesSheet';

import type { GrindingPlanningBoardItem, GrindingPlanningBoardResourceMinutesResponse as Settings } from '@raspi-system/shared-types';

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('../../../../api/client', async (original) => ({ ...await original<typeof import('../../../../api/client')>(),
  getKioskGrindingPlanningBoardResourceMinutes: mocks.get,
  updateKioskGrindingPlanningBoardResourcePartMinutes: mocks.save
}));
const item = (overrides: Partial<GrindingPlanningBoardItem> = {}): GrindingPlanningBoardItem => ({
  itemId: 'a', kind: 'row', itemRevision: 'r', version: 1, sourceRowId: 'a', fseiban: '26-1', fhincd: ' P1 ', fhinmei: '部品', machineName: null,
  productNo: '1', processOrder: '10', originalResourceCd: '584', effectiveResourceCd: '305', originalDueDate: '2026-11-10', effectiveDueDate: null,
  originalRank: null, alternateRank: null, plannedQuantity: 4, originalRequiredMinutes: 60, ownRequiredMinutes: 70,
  requiredMinutesSource: 'own', requiredMinutes: 70, requiredMinutesKnown: true, isCompleted: false, lslhSurface: false,
  progress: { completed: 0, total: 1, quantityKnown: true }, ...overrides
});

const key = productionScheduleQueryKeys.planningBoardResourceMinutesAll;
const settings = (part: string, ops: Array<{ id: string; opNo: number; minutes: number }>): Settings => ({
  ownSourceResourceCds: [], values: [{ resourceCd: '021', fhincd: part, perUnitMinutes: ops.reduce((sum, op) => sum + op.minutes, 0), setupMinutes: 0, ops }]
});
function setup(part: string, initial: Settings) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(key, initial);
  function Sheet() {
    const query = useKioskGrindingPlanningBoardResourceMinutes(true);
    return <PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: part })]} values={query.data?.values ?? []} disabled={false} />;
  }
  return { client, element: <QueryClientProvider client={client}><Sheet /></QueryClientProvider> };
}
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); vi.restoreAllMocks(); });
describe('resource minutes sheet with real save hook', () => {
  it('retries a lost operation addition before saving a later edit with returned IDs', async () => {
    vi.useFakeTimers();
    const part = 'LOST-ADDITION';
    const initial = settings(part, [{ id: 'old-1', opNo: 1, minutes: 1 }]);
    const added = { ...settings(part, [{ id: 'old-1', opNo: 1, minutes: 1 }, { id: 'created-2', opNo: 2, minutes: 2 }]),
      savedOpIds: ['old-1', 'created-2'], savedOpNos: [1, 2],
      savedMinutes: { perUnitMinutes: 3, setupMinutes: 0, ops: [
        { opNo: 1, minutes: 1, setupMinutes: null }, { opNo: 2, minutes: 2, setupMinutes: null }
      ] } };
    mocks.save.mockRejectedValueOnce(new Error('response lost')).mockResolvedValue(added);
    const { element } = setup(part, initial);
    render(element);
    fireEvent.click(screen.getByText('＋工程'));
    fireEvent.change(screen.getByLabelText(`${part} 2工程 1台`), { target: { value: '2' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(`${part} 2工程 1台`), { target: { value: '3' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(mocks.save).toHaveBeenCalledTimes(3);
    expect(mocks.save.mock.calls[1][0]).toEqual(mocks.save.mock.calls[0][0]);
    expect(mocks.save.mock.calls[2][0]).toMatchObject({ expectedOpIds: added.savedOpIds,
      expectedMinutes: added.savedMinutes, ops: [{ opNo: 1, minutes: 1 }, { opNo: 2, minutes: 3 }] });
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('follows an external cache update after saving without blur and sends the displayed value next', async () => {
    vi.useFakeTimers();
    const part = 'FOCUSED-CACHE';
    const initial: Settings = { ownSourceResourceCds: [], values: [{ resourceCd: '021', fhincd: part, perUnitMinutes: 10, setupMinutes: 0 }] };
    const saved: Settings = { ...initial, values: [{ ...initial.values[0]!, perUnitMinutes: 12 }] };
    mocks.save.mockResolvedValue(saved);
    const { client, element } = setup(part, initial);
    render(element);
    const input = screen.getByLabelText(`${part} 1台`);
    act(() => input.focus());
    fireEvent.change(input, { target: { value: '12' } });
    await act(async () => vi.advanceTimersByTime(400));
    await act(async () => vi.advanceTimersByTime(1));
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue(12);
    act(() => client.setQueryData(key, { ...initial, values: [{ ...initial.values[0]!, perUnitMinutes: 25 }] }));
    await act(async () => vi.advanceTimersByTime(1));
    expect(input).toHaveFocus();
    expect(input).toHaveValue(25);
    fireEvent.change(screen.getByLabelText(`${part} 段取り`), { target: { value: '5' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.lastCall?.[0]).toEqual(expect.objectContaining({ perUnitMinutes: 25, setupMinutes: 5, expectedMinutes: { perUnitMinutes: 25, setupMinutes: 0, ops: [] } }));
  });
  it.each(['OPERATION_SET_CHANGED', 'RESOURCE_MINUTES_CHANGED'])('discards queued edits and refreshes after conflict: %s', async (errorCode) => {
    vi.useFakeTimers();
    const part = `NO-OPS-CONFLICT-${errorCode}`;
    const initial = settings(part, []);
    const remote = settings(part, [{ id: 'remote-1', opNo: 1, minutes: 4 }, { id: 'remote-2', opNo: 2, minutes: 6 }]);
    let reject!: (error: unknown) => void;
    mocks.save.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    mocks.get.mockResolvedValue(remote);
    const { client, element } = setup(part, initial);
    render(element);
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '10' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0]).toEqual({
      resourceCd: '021', fhincd: part, perUnitMinutes: 10, setupMinutes: 0, expectedOpIds: [],
      expectedMinutes: { perUnitMinutes: 0, setupMinutes: 0, ops: [] }
    });
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '11' } });
    await act(async () => vi.advanceTimersByTime(400));
    await act(async () => reject({ isAxiosError: true, response: { status: 409, data: { errorCode } } }));
    await act(async () => vi.advanceTimersByTime(1));
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(key)).toEqual(remote);
    expect(screen.getByLabelText(`${part} 2工程 1台`)).toHaveValue(6);
    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした。');
  });
  it.each([false, true])('uses only transaction metadata for a queued draft, legacy response: %s', async (legacy) => {
    vi.useFakeTimers();
    const part = `TRANSACTION-IDS-${legacy}`;
    const initial = settings(part, [{ id: 'old-1', opNo: 1, minutes: 1 }]);
    const remote = settings(part, [{ id: 'remote-1', opNo: 1, minutes: 9 }]);
    const response = { ...remote, ...(!legacy ? { savedOpIds: ['own-1'], savedOpNos: [1], savedMinutes: { perUnitMinutes: 2, setupMinutes: 0, ops: [{ opNo: 1, minutes: 2, setupMinutes: null }] } } : {}) };
    let finish!: (value: Settings) => void;
    mocks.save.mockReturnValueOnce(new Promise<Settings>((resolve) => { finish = resolve; })).mockResolvedValue(response);
    const { element } = setup(part, initial);
    render(element);
    fireEvent.change(screen.getByLabelText(`${part} 1工程 1台`), { target: { value: '2' } });
    await act(async () => vi.advanceTimersByTime(400));
    fireEvent.change(screen.getByLabelText(`${part} 1工程 1台`), { target: { value: '3' } });
    await act(async () => vi.advanceTimersByTime(400));
    await act(async () => finish(response));
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.lastCall?.[0]).toEqual(expect.objectContaining({ expectedOpIds: [legacy ? 'old-1' : 'own-1'],
      expectedMinutes: { perUnitMinutes: legacy ? 1 : 2, setupMinutes: 0, ops: [{ opNo: 1, minutes: legacy ? 1 : 2, setupMinutes: null }] } }));
  });
  it.each([false, true])('never reuses a pending operation number and advances the baseline, reopen: %s', async (reopen) => {
    vi.useFakeTimers();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const part = `PENDING-ADDITION-${reopen}`;
    const initial = settings(part, [{ id: 'old-1', opNo: 1, minutes: 1 }]);
    const first = { ...settings(part, [{ id: 'old-1', opNo: 1, minutes: 1 }, { id: 'created-2', opNo: 2, minutes: 2 }]),
      savedOpIds: ['old-1', 'created-2'], savedOpNos: [1, 2],
      savedMinutes: { perUnitMinutes: 3, setupMinutes: 0, ops: [{ opNo: 1, minutes: 1, setupMinutes: null }, { opNo: 2, minutes: 2, setupMinutes: null }] } };
    const second = { ...settings(part, [{ id: 'old-1', opNo: 1, minutes: 1 }, { id: 'created-3', opNo: 3, minutes: 3 }]),
      savedOpIds: ['old-1', 'created-3'], savedOpNos: [1, 3],
      savedMinutes: { perUnitMinutes: 4, setupMinutes: 0, ops: [{ opNo: 1, minutes: 1, setupMinutes: null }, { opNo: 3, minutes: 3, setupMinutes: null }] } };
    let finish!: (value: Settings) => void;
    mocks.save.mockReturnValueOnce(new Promise<Settings>((resolve) => { finish = resolve; })).mockResolvedValue(second);
    const { element } = setup(part, initial);
    const view = render(element);
    fireEvent.click(screen.getByText('＋工程'));
    fireEvent.change(screen.getByLabelText(`${part} 2工程 1台`), { target: { value: '2' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(mocks.save).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText(`${part} 2工程を外す`));
    if (reopen) {
      view.unmount();
      render(element);
    }
    fireEvent.click(screen.getByText('＋工程'));
    expect(screen.queryByLabelText(`${part} 2工程 1台`)).toBeNull();
    fireEvent.change(screen.getByLabelText(`${part} 3工程 1台`), { target: { value: '3' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(mocks.save).toHaveBeenCalledTimes(1);
    await act(async () => finish(first));
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.lastCall?.[0]).toEqual({
      resourceCd: '021', fhincd: part, perUnitMinutes: 4, setupMinutes: 0, expectedOpIds: ['old-1', 'created-2'],
      expectedMinutes: first.savedMinutes,
      ops: [{ opNo: 1, minutes: 1, setupMinutes: null }, { opNo: 3, minutes: 3, setupMinutes: null }]
    });
  });
  it.each([2, 20])('reserves base operation numbers during optimistic deletion and failure, maximum %s', async (max) => {
    vi.useFakeTimers();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const part = `OPTIMISTIC-NUMBERS-${max}`;
    const numbers = max === 20 ? [1, 2, 20] : [1, 2];
    const initial = settings(part, numbers.map((opNo) => ({ id: `old-${opNo}`, opNo, minutes: 1 })));
    let reject!: (error: unknown) => void;
    mocks.save.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValue(initial);
    const { client, element } = setup(part, initial);
    render(element);
    fireEvent.click(screen.getByText(part));
    fireEvent.click(screen.getByLabelText(`${part} 2工程を外す`));
    await act(async () => vi.advanceTimersByTime(400));
    await act(async () => vi.advanceTimersByTime(1));
    expect(client.getQueryData<Settings>(key)?.values[0].ops?.map((op) => op.opNo)).not.toContain(2);
    fireEvent.click(screen.getByText('＋工程'));
    expect(screen.getByLabelText(`${part} 3工程 1台`)).toHaveValue(null);
    fireEvent.change(screen.getByLabelText(`${part} 3工程 1台`), { target: { value: '4' } });
    await act(async () => vi.advanceTimersByTime(400));
    await act(async () => reject(new Error('offline')));
    expect(mocks.save).toHaveBeenCalledTimes(3);
    expect(mocks.save.mock.calls[1][0]).toEqual(mocks.save.mock.calls[0][0]);
    expect(mocks.save.mock.lastCall?.[0]).toEqual(expect.objectContaining({
      expectedOpIds: numbers.map((no) => `old-${no}`),
      ops: expect.arrayContaining([{ opNo: 3, minutes: 4, setupMinutes: null }])
    }));
    expect(mocks.save.mock.lastCall?.[0].ops.map((op: { opNo: number }) => op.opNo)).not.toContain(2);
  });
  it.each([false, true])('retains used numbers when saved operation metadata changes, legacy response: %s', async (legacy) => {
    vi.useFakeTimers();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const part = `SAVED-NUMBERS-${legacy}`;
    const initial = settings(part, [{ id: 'old-1', opNo: 1, minutes: 1 }, { id: 'old-2', opNo: 2, minutes: 2 }]);
    const remote = settings(part, [{ id: 'remote-1', opNo: 1, minutes: 9 }, { id: 'remote-20', opNo: 20, minutes: 9 }]);
    const response = { ...remote, ...(!legacy ? { savedOpIds: ['old-1'], savedOpNos: [1] } : {}) };
    let finish!: (value: Settings) => void;
    mocks.save.mockReturnValueOnce(new Promise<Settings>((resolve) => { finish = resolve; }));
    const { element } = setup(part, initial);
    render(element);
    fireEvent.click(screen.getByText(part));
    fireEvent.click(screen.getByLabelText(`${part} 2工程を外す`));
    await act(async () => vi.advanceTimersByTime(400));
    fireEvent.change(screen.getByLabelText(`${part} 1工程 1台`), { target: { value: '4' } });
    await act(async () => finish(response));
    await act(async () => vi.advanceTimersByTime(1));
    fireEvent.click(screen.getByText('＋工程'));
    expect(screen.getByLabelText(`${part} 3工程 1台`)).toHaveValue(null);
  });
  it.each([false, true])('keeps draft IDs across close and cache replacement, reused numbers: %s', async (reused) => {
    vi.useFakeTimers();
    const part = `BASE-IDS-${reused}`;
    const initial = settings(part, [{ id: 'old-1', opNo: 1, minutes: 1 }, { id: 'old-2', opNo: 2, minutes: 2 }]);
    const latest = settings(part, [{ id: 'old-1', opNo: 1, minutes: 1 }, { id: 'new-op', opNo: reused ? 2 : 3, minutes: 9 }]);
    const { client, element } = setup(part, initial);
    const view = render(element);
    fireEvent.change(screen.getByLabelText(`${part} 2工程 1台`), { target: { value: '' } });
    view.unmount();
    client.setQueryData(key, latest);
    mocks.get.mockResolvedValue(latest);
    mocks.save.mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { errorCode: 'OPERATION_SET_CHANGED' } } });
    render(element);
    fireEvent.change(screen.getByLabelText(`${part} 2工程 1台`), { target: { value: '3' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(mocks.save.mock.calls[0][0]).toEqual(expect.objectContaining({ expectedOpIds: ['old-1', 'old-2'] }));
    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.getByLabelText(`${part} ${reused ? 2 : 3}工程 1台`)).toHaveValue(9);
    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした。');
    expect(client.getQueryData(key)).toEqual(latest);
  });
  it('updates a newer draft from the save response, then uses refreshed IDs after reopening', async () => {
    vi.useFakeTimers();
    const part = 'RESPONSE-IDS';
    const initial = settings(part, []);
    const first = { ...settings(part, [{ id: 'created-1', opNo: 1, minutes: 1 }, { id: 'created-2', opNo: 2, minutes: 2 }]), savedOpIds: ['created-1', 'created-2'], savedOpNos: [1, 2] };
    let finish!: (value: Settings) => void;
    mocks.save.mockReturnValueOnce(new Promise<Settings>((resolve) => { finish = resolve; })).mockResolvedValue(first);
    const { client, element } = setup(part, initial);
    const view = render(element);
    fireEvent.click(screen.getByText('＋工程'));
    fireEvent.change(screen.getByLabelText(`${part} 1工程 1台`), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(`${part} 2工程 1台`), { target: { value: '2' } });
    await act(async () => vi.advanceTimersByTime(400));
    fireEvent.change(screen.getByLabelText(`${part} 2工程 1台`), { target: { value: '3' } });
    await act(async () => vi.advanceTimersByTime(400));
    await act(async () => finish(first));
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.lastCall?.[0]).toEqual(expect.objectContaining({ expectedOpIds: ['created-1', 'created-2'] }));
    view.unmount();
    const latest = settings(part, [{ id: 'remote-1', opNo: 1, minutes: 7 }]);
    client.setQueryData(key, latest);
    mocks.save.mockResolvedValue(latest);
    render(element);
    fireEvent.change(screen.getByLabelText(`${part} 1工程 1台`), { target: { value: '8' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(mocks.save.mock.lastCall?.[0]).toEqual(expect.objectContaining({ expectedOpIds: ['remote-1'] }));
  });
});
