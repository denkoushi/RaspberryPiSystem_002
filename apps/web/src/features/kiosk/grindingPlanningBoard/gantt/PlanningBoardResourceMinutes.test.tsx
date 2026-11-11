import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildPlanningBoardGanttLayout } from './planningBoardGanttLayout';
import { PlanningBoardGanttView } from './PlanningBoardGanttView';
import { PlanningBoardResourceMinutesSheet } from './PlanningBoardResourceMinutesSheet';
import { PlanningBoardSingleResourceHead } from './PlanningBoardSingleResourceHead';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const { save, rowRender, offline } = vi.hoisted(() => ({ save: vi.fn(), rowRender: vi.fn(), offline: { enabled: false, refreshRead: vi.fn() } }));
vi.mock('../offline/PlanningBoardOfflineProvider', async (original) => {
  const actual = await original<typeof import('../offline/PlanningBoardOfflineProvider')>();
  return { ...actual, usePlanningBoardOffline: () => ({ ...actual.usePlanningBoardOffline(), ...offline }) };
});
vi.mock('../../../../api/hooks/production-schedule', () => ({ useUpdateKioskGrindingPlanningBoardResourcePartMinutes: (resource: string, part: string) => { rowRender(resource, part); return { mutateAsync: save, isError: false }; } }));
vi.mock('../../../../api/hooks/machine-signal', () => ({ useMachineSignalResourceUptime: () => ({ data: undefined }) }));
const item = (overrides: Partial<GrindingPlanningBoardItem> = {}): GrindingPlanningBoardItem => ({
  itemId: 'a', kind: 'row', itemRevision: 'r', version: 1, sourceRowId: 'a', fseiban: '26-1', fhincd: ' P1 ', fhinmei: '部品', machineName: null,
  productNo: '1', processOrder: '10', originalResourceCd: '584', effectiveResourceCd: '305', originalDueDate: '2026-11-10', effectiveDueDate: null,
  originalRank: null, alternateRank: null, plannedQuantity: 4, originalRequiredMinutes: 60, ownRequiredMinutes: 70,
  requiredMinutesSource: 'own', requiredMinutes: 70, requiredMinutesKnown: true, isCompleted: false, lslhSurface: false,
  progress: { completed: 0, total: 1, quantityKnown: true }, ...overrides
});
afterEach(() => { vi.useRealTimers(); save.mockReset(); rowRender.mockClear(); offline.enabled = false; offline.refreshRead.mockReset(); vi.restoreAllMocks(); });
describe('resource minutes UI', () => {
  it.each([400, 401, 403, 422])('sends corrected values directly after a confirmed %s failure', async (status) => {
    vi.useFakeTimers();
    const part = `CONFIRMED-${status}`;
    save.mockRejectedValueOnce({ isAxiosError: true, response: { status } }).mockResolvedValue({ values: [] });
    render(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item({ fhincd: part })]} values={[]} disabled={false} />);
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '5' } });
    await act(async () => vi.advanceTimersByTime(400));
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '6' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toMatchObject({ perUnitMinutes: 6 });
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('clears an uncertain retry after a confirmed failure of that retry', async () => {
    vi.useFakeTimers();
    const part = 'CONFIRMED-RETRY';
    save.mockRejectedValueOnce(new Error('response lost'))
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 400 } }).mockResolvedValue({ values: [] });
    render(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item({ fhincd: part })]} values={[]} disabled={false} />);
    for (const value of ['5', '6', '7']) {
      fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value } });
      await act(async () => vi.advanceTimersByTime(400));
    }
    expect(save).toHaveBeenCalledTimes(3);
    expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0]);
    expect(save.mock.calls[2][0]).toMatchObject({ perUnitMinutes: 7 });
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it.each(['caught-up', 'external'] as const)('ignores earlier own reads across consecutive saves until %s', async (mode) => {
    vi.useFakeTimers();
    offline.enabled = true;
    offline.refreshRead.mockResolvedValue(undefined);
    const part = `CONSECUTIVE-READ-${mode}`;
    const initial = { resourceCd: '305', fhincd: part, perUnitMinutes: 10, setupMinutes: 0 };
    const first = { perUnitMinutes: 12, setupMinutes: 0, ops: [] };
    const second = { ...first, perUnitMinutes: 14 };
    let finish!: (response: unknown) => void;
    save.mockResolvedValueOnce({ savedMinutes: first, savedOpIds: [] })
      .mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ values: [] });
    const props = { resourceCd: '305', items: [item({ fhincd: part })], values: [initial], disabled: false };
    const view = render(<PlanningBoardResourceMinutesSheet {...props} />);
    for (const value of ['12', '14']) {
      fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value } });
      await act(async () => vi.advanceTimersByTime(400));
    }
    await act(async () => finish({ savedMinutes: second, savedOpIds: [] }));
    view.rerender(<PlanningBoardResourceMinutesSheet {...props} values={[{ ...initial, perUnitMinutes: 12.0000005 }]} />);
    expect(screen.getByLabelText(`${part} 1台`)).toHaveValue(14);
    view.unmount();
    const reopened = render(<PlanningBoardResourceMinutesSheet {...props} />);
    expect(screen.getByLabelText(`${part} 1台`)).toHaveValue(14);
    const readValue = mode === 'caught-up' ? 14.0000005 : 20;
    reopened.rerender(<PlanningBoardResourceMinutesSheet {...props} values={[{ ...initial, perUnitMinutes: readValue }]} />);
    expect(screen.getByLabelText(`${part} 1台`)).toHaveValue(readValue);
    fireEvent.change(screen.getByLabelText(`${part} 段取り`), { target: { value: '5' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save.mock.calls[2][0]).toMatchObject({ expectedMinutes: { ...first, perUnitMinutes: readValue } });
  });
  it.each([
    { committed: true, closed: false }, { committed: true, closed: true },
    { committed: false, closed: false }, { committed: false, closed: true }
  ])('releases only a committed post-save read returning the pre-save value: %j', async ({ committed, closed }) => {
    vi.useFakeTimers();
    offline.enabled = true;
    let finishRead!: (committed: boolean) => void;
    const reading = new Promise<boolean>((resolve) => { finishRead = resolve; });
    offline.refreshRead.mockImplementation((key) => key === 'resource-minutes' ? reading : Promise.resolve(false));
    const part = `RETURNED-READ-${committed}-${closed}`;
    const initial = { resourceCd: '305', fhincd: part, perUnitMinutes: 10, setupMinutes: 0 };
    const savedMinutes = { perUnitMinutes: 12, setupMinutes: 0, ops: [] };
    save.mockResolvedValue({ savedMinutes, savedOpIds: [], savedOpNos: [] });
    const props = { resourceCd: '305', items: [item({ fhincd: part })], values: [initial], disabled: false };
    const view = render(<PlanningBoardResourceMinutesSheet {...props} />);
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '12' } });
    await act(async () => vi.advanceTimersByTime(400));
    // An older in-flight read must remain ignored until the post-save read commits.
    view.rerender(<PlanningBoardResourceMinutesSheet {...props} values={[{ ...initial }]} />);
    expect(screen.getByLabelText(`${part} 1台`)).toHaveValue(12);
    if (closed) view.unmount();
    await act(async () => finishRead(committed));
    if (!closed) expect(screen.getByLabelText(`${part} 1台`)).toHaveValue(committed ? 10 : 12);
    if (!closed) view.unmount();
    render(<PlanningBoardResourceMinutesSheet {...props} />);
    expect(screen.getByLabelText(`${part} 1台`)).toHaveValue(committed ? 10 : 12);
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText(`${part} 段取り`), { target: { value: '5' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save.mock.calls[1][0]).toMatchObject({ expectedMinutes: committed ? { ...savedMinutes, perUnitMinutes: 10 } : savedMinutes });
  });
  it('keeps a newer edit when the post-save read commits', async () => {
    vi.useFakeTimers();
    offline.enabled = true;
    let finishRead!: (committed: boolean) => void;
    const reading = new Promise<boolean>((resolve) => { finishRead = resolve; });
    offline.refreshRead.mockImplementation((key) => key === 'resource-minutes' ? reading : Promise.resolve(false));
    const part = 'EDIT-AFTER-ACK';
    const props = { resourceCd: '305', items: [item({ fhincd: part })],
      values: [{ resourceCd: '305', fhincd: part, perUnitMinutes: 10, setupMinutes: 0 }], disabled: false };
    save.mockResolvedValue({ savedMinutes: { perUnitMinutes: 12, setupMinutes: 0, ops: [] }, savedOpIds: [] });
    const view = render(<PlanningBoardResourceMinutesSheet {...props} />);
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '12' } });
    await act(async () => vi.advanceTimersByTime(400));
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '14' } });
    await act(async () => finishRead(true));
    expect(screen.getByLabelText(`${part} 1台`)).toHaveValue(14);
    view.unmount();
    render(<PlanningBoardResourceMinutesSheet {...props} />);
    expect(screen.getByLabelText(`${part} 1台`)).toHaveValue(14);
  });
  it('saves sequentially after StrictMode effect replay and reopening', async () => {
    vi.useFakeTimers();
    const part = 'STRICT-QUEUE';
    let finish!: (value: unknown) => void;
    save.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ values: [] });
    const element = <StrictMode><PlanningBoardResourceMinutesSheet resourceCd="305" items={[item({ fhincd: part })]} values={[]} disabled={false} /></StrictMode>;
    const view = render(element);
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '5' } });
    await act(async () => vi.advanceTimersByTime(400));
    view.unmount();
    render(element);
    expect(screen.getByLabelText(`${part} 1台`)).toHaveValue(5);
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '6' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => finish({ values: [], savedMinutes: { perUnitMinutes: 5, setupMinutes: 0, ops: [] } }));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toMatchObject({ perUnitMinutes: 6, expectedMinutes: { perUnitMinutes: 5, setupMinutes: 0, ops: [] } });
  });
  it.each(['pending', 'failed', 'resolved-stale', 'caught-up'])('keeps an offline save visible and uses its baseline after reopening, refresh: %s', async (refresh) => {
    vi.useFakeTimers();
    offline.enabled = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let finishRead!: () => void;
    const reading = new Promise<void>((resolve) => { finishRead = resolve; });
    offline.refreshRead.mockImplementation(() => refresh === 'failed' ? Promise.reject(new Error('offline')) : reading);
    const part = `OFFLINE-ACK-${refresh}`;
    const initial = { resourceCd: '305', fhincd: part, perUnitMinutes: 10, setupMinutes: 0 };
    const savedMinutes = { perUnitMinutes: 12, setupMinutes: 0, ops: [] };
    save.mockResolvedValue({ values: [], savedMinutes, savedOpIds: [], savedOpNos: [] });
    const props = { resourceCd: '305', items: [item({ fhincd: part })], values: [initial], disabled: false };
    const view = render(<PlanningBoardResourceMinutesSheet {...props} />);
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '12' } });
    await act(async () => vi.advanceTimersByTime(400));
    fireEvent.blur(screen.getByLabelText(`${part} 1台`));
    expect(screen.getByLabelText(`${part} 1台`)).toHaveValue(12);
    view.unmount();
    const reopened = render(<PlanningBoardResourceMinutesSheet {...props} />);
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(`${part} 1台`)).toHaveValue(12);
    expect(screen.queryByRole('alert')).toBeNull();
    if (refresh === 'resolved-stale') {
      await act(async () => finishRead());
      expect(screen.getByLabelText(`${part} 1台`)).toHaveValue(12);
    }
    if (refresh === 'caught-up') {
      await act(async () => finishRead());
      reopened.rerender(<PlanningBoardResourceMinutesSheet {...props} values={[{ ...initial, perUnitMinutes: 12 }]} />);
      // Once the read catches up, later remote reads must be visible again.
      reopened.rerender(<PlanningBoardResourceMinutesSheet {...props} values={[{ ...initial, perUnitMinutes: 15 }]} />);
      expect(screen.getByLabelText(`${part} 1台`)).toHaveValue(15);
    }
    fireEvent.change(screen.getByLabelText(`${part} 段取り`), { target: { value: '5' } });
    await act(async () => vi.advanceTimersByTime(400));
    if (refresh === 'pending') await act(async () => finishRead());
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toMatchObject({ expectedMinutes: refresh === 'caught-up' ? { ...savedMinutes, perUnitMinutes: 15 } : savedMinutes });
    expect(screen.queryByRole('alert')).toBeNull();
    if (refresh === 'failed') expect(warn).toHaveBeenCalled();
  });
  it.each([
    { failed: false, closed: false }, { failed: false, closed: true },
    { failed: true, closed: false }, { failed: true, closed: true }
  ])('follows a different post-save read and advances the baseline: %j', async ({ failed, closed }) => {
    vi.useFakeTimers();
    offline.enabled = true;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let finishRead!: () => void;
    const reading = new Promise<void>((resolve) => { finishRead = resolve; });
    offline.refreshRead.mockImplementation((readKey) => readKey === 'resource-minutes'
      ? failed ? Promise.reject(new Error('offline')) : reading
      : Promise.resolve());
    const part = `DIFFERENT-READ-${failed}-${closed}`;
    const initial = { resourceCd: '305', fhincd: part, perUnitMinutes: 10, setupMinutes: 0 };
    const savedMinutes = { perUnitMinutes: 12, setupMinutes: 0, ops: [] };
    save.mockResolvedValue({ values: [], savedMinutes, savedOpIds: [], savedOpNos: [] });
    const props = { resourceCd: '305', items: [item({ fhincd: part })], values: [initial], disabled: false };
    const view = render(<PlanningBoardResourceMinutesSheet {...props} />);
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '12' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(screen.getByLabelText(`${part} 1台`)).toHaveValue(12);
    if (closed) view.unmount();
    const remoteProps = { ...props, values: [{ ...initial, perUnitMinutes: 25 }] };
    if (!closed) view.rerender(<PlanningBoardResourceMinutesSheet {...remoteProps} />);
    if (!failed) await act(async () => finishRead());
    if (closed) render(<PlanningBoardResourceMinutesSheet {...remoteProps} />);
    expect(screen.getByLabelText(`${part} 1台`)).toHaveValue(25);
    fireEvent.change(screen.getByLabelText(`${part} 段取り`), { target: { value: '5' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toMatchObject({ perUnitMinutes: 25,
      expectedMinutes: { perUnitMinutes: 25, setupMinutes: 0, ops: [] } });
  });
  it('retains the acknowledged draft after a successful stale read while closed', async () => {
    vi.useFakeTimers();
    offline.enabled = true;
    let finishRead!: () => void;
    offline.refreshRead.mockReturnValue(new Promise<void>((resolve) => { finishRead = resolve; }));
    const part = 'UNCHANGED-POST-SAVE-READ';
    const props = { resourceCd: '305', items: [item({ fhincd: part })],
      values: [{ resourceCd: '305', fhincd: part, perUnitMinutes: 10, setupMinutes: 0 }], disabled: false };
    save.mockResolvedValue({ savedMinutes: { perUnitMinutes: 12, setupMinutes: 0, ops: [] }, savedOpIds: [], savedOpNos: [] });
    const view = render(<PlanningBoardResourceMinutesSheet {...props} />);
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '12' } });
    await act(async () => vi.advanceTimersByTime(400));
    view.unmount();
    await act(async () => finishRead());
    const reopened = render(<PlanningBoardResourceMinutesSheet {...props} />);
    expect(screen.getByLabelText(`${part} 1台`)).toHaveValue(12);
    fireEvent.change(screen.getByLabelText(`${part} 段取り`), { target: { value: '5' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save.mock.calls[1][0]).toMatchObject({ expectedMinutes: { perUnitMinutes: 12, setupMinutes: 0, ops: [] } });
    reopened.rerender(<PlanningBoardResourceMinutesSheet {...props} values={[{ ...props.values[0], perUnitMinutes: 15 }]} />);
    expect(screen.getByLabelText(`${part} 1台`)).toHaveValue(15);
    reopened.rerender(<PlanningBoardResourceMinutesSheet {...props} values={[{ ...props.values[0], perUnitMinutes: 18 }]} />);
    expect(screen.getByLabelText(`${part} 1台`)).toHaveValue(18);
  });
  it.each([500, 503])('sends later edits after an uncertain retry returns %s without retrying again', async (status) => {
    vi.useFakeTimers();
    const part = `UNCERTAIN-SERVER-ERROR-${status}`;
    const initial = { resourceCd: '305', fhincd: part, perUnitMinutes: 10, setupMinutes: 0 };
    const savedMinutes = { perUnitMinutes: 14, setupMinutes: 0, ops: [] };
    const serverError = { isAxiosError: true, response: { status } };
    save.mockRejectedValueOnce(serverError).mockRejectedValueOnce(serverError)
      .mockResolvedValue({ values: [], savedMinutes, savedOpIds: [], savedOpNos: [] });
    const props = { resourceCd: '305', items: [item({ fhincd: part })], values: [initial], disabled: false };
    const view = render(<PlanningBoardResourceMinutesSheet {...props} />);
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '12' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '14' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledTimes(3);
    expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0]);
    expect(save.mock.calls[2][0]).toEqual({ resourceCd: '305', fhincd: part,
      perUnitMinutes: 14, setupMinutes: 0, expectedOpIds: [],
      expectedMinutes: { perUnitMinutes: 10, setupMinutes: 0, ops: [] } });
    expect(screen.queryByRole('alert')).toBeNull();
    view.rerender(<PlanningBoardResourceMinutesSheet {...props} values={[{ ...initial, perUnitMinutes: 14 }]} />);
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '16' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledTimes(4);
    expect(save.mock.calls[3][0]).toMatchObject({ perUnitMinutes: 16, expectedMinutes: savedMinutes });
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it.each(['edited', 'queued', 'closed-queued', 'retry-conflict', 'retry-failed'] as const)(
    'reconciles an uncertain save before sending later edits: %s', async (mode) => {
      vi.useFakeTimers();
      const part = `UNCERTAIN-${mode}`;
      const initial = { resourceCd: '305', fhincd: part, perUnitMinutes: 10, setupMinutes: 0 };
      const savedMinutes = { perUnitMinutes: 12, setupMinutes: 0, ops: [] };
      let reject!: (error: unknown) => void;
      save.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
      if (mode === 'retry-conflict') save.mockRejectedValueOnce({ isAxiosError: true, response: { status: 409, data: { errorCode: 'RESOURCE_MINUTES_CHANGED' } } });
      else if (mode === 'retry-failed') save.mockRejectedValueOnce(new Error('offline again'));
      else save.mockResolvedValueOnce({ values: [], savedMinutes, savedOpIds: [], savedOpNos: [] });
      save.mockResolvedValue({ values: [], savedMinutes: { ...savedMinutes, perUnitMinutes: 14 } });
      const props = { resourceCd: '305', items: [item({ fhincd: part })], values: [initial], disabled: false };
      const view = render(<PlanningBoardResourceMinutesSheet {...props} />);
      fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '12' } });
      await act(async () => vi.advanceTimersByTime(400));
      if (mode === 'edited') {
        await act(async () => reject(new Error('response lost')));
        expect(screen.getByRole('alert')).toBeInTheDocument();
      }
      fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '14' } });
      await act(async () => vi.advanceTimersByTime(400));
      if (mode === 'closed-queued') view.unmount();
      if (mode !== 'edited') await act(async () => reject(new Error('response lost')));
      expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0]);
      if (mode === 'closed-queued') render(<PlanningBoardResourceMinutesSheet {...props} values={[{ ...initial, perUnitMinutes: 14 }]} />);
      if (mode === 'retry-conflict' || mode === 'retry-failed') {
        expect(save).toHaveBeenCalledTimes(2);
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByLabelText(`${part} 1台`)).toHaveValue(mode === 'retry-conflict' ? 10 : 14);
        if (mode === 'retry-failed') {
          fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '16' } });
          await act(async () => vi.advanceTimersByTime(400));
          expect(save.mock.calls[2][0]).toEqual(save.mock.calls[0][0]);
          expect(save.mock.calls[3][0]).toMatchObject({ perUnitMinutes: 16, expectedMinutes: { ...savedMinutes, perUnitMinutes: 14 } });
        }
      } else {
        expect(save).toHaveBeenCalledTimes(3);
        expect(save.mock.calls[2][0]).toMatchObject({ perUnitMinutes: 14, expectedMinutes: savedMinutes });
        expect(screen.queryByRole('alert')).toBeNull();
      }
    }
  );
  it.each([false, true])('retains offline operation metadata or deletion across reopening, reset: %s', async (reset) => {
    vi.useFakeTimers();
    offline.enabled = true;
    offline.refreshRead.mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const part = `OFFLINE-METADATA-${reset}`;
    const savedMinutes = reset ? null : { perUnitMinutes: 4, setupMinutes: 5, ops: [{ opNo: 1, minutes: 4, setupMinutes: 5 }] };
    save.mockResolvedValue({ values: [], savedMinutes, savedOpIds: reset ? [] : ['new-1'], savedOpNos: reset ? [] : [1] });
    const props = { resourceCd: '021', items: [item({ fhincd: part })], values: [{ resourceCd: '021', fhincd: part, perUnitMinutes: 3, setupMinutes: 5, ops: [{ id: 'old-1', opNo: 1, minutes: 3, setupMinutes: 5 }] }], disabled: false };
    const view = render(<PlanningBoardResourceMinutesSheet {...props} />);
    if (reset) {
      fireEvent.click(screen.getByText(part));
      fireEvent.click(screen.getByText('元に戻す'));
    } else fireEvent.change(screen.getByLabelText(`${part} 1工程 1台`), { target: { value: '4' } });
    await act(async () => vi.advanceTimersByTime(400));
    view.unmount();
    render(<PlanningBoardResourceMinutesSheet {...props} />);
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledTimes(1);
    const label = `${part} ${reset ? '' : '1工程 '}1台`;
    expect(screen.getByLabelText(label)).toHaveValue(reset ? null : 4);
    fireEvent.change(screen.getByLabelText(label), { target: { value: '6' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toMatchObject({ expectedMinutes: savedMinutes, expectedOpIds: reset ? [] : ['new-1'] });
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it.each(['queued', 'closed-queued', 'closed-draft'])('keeps the edit baseline and advances it from transaction values: %s', async (mode) => {
    vi.useFakeTimers();
    offline.enabled = true;
    offline.refreshRead.mockRejectedValue(new Error('refresh offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const part = `MINUTES-BASELINE-${mode}`;
    const initial = { resourceCd: '305', fhincd: part, perUnitMinutes: 10, setupMinutes: 0 };
    let finish!: (value: unknown) => void;
    save.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ values: [] });
    const view = render(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item({ fhincd: part })]} values={[initial]} disabled={false} />);
    fireEvent.change(screen.getByLabelText(`${part} 段取り`), { target: { value: '5' } });
    view.rerender(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item({ fhincd: part })]} values={[{ ...initial, perUnitMinutes: 20 }]} disabled={false} />);
    await act(async () => vi.advanceTimersByTime(400));
    expect(save.mock.calls[0][0].expectedMinutes).toEqual({ perUnitMinutes: 10, setupMinutes: 0, ops: [] });
    fireEvent.change(screen.getByLabelText(`${part} 段取り`), { target: { value: '10' } });
    await act(async () => vi.advanceTimersByTime(400));
    if (mode === 'closed-draft') fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '' } });
    if (mode !== 'queued') view.unmount();
    await act(async () => finish({ values: [{ ...initial, perUnitMinutes: 20 }], savedMinutes: { perUnitMinutes: 10, setupMinutes: 5, ops: [] } }));
    if (mode === 'closed-draft') {
      expect(save).toHaveBeenCalledTimes(1);
      render(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item({ fhincd: part })]} values={[{ ...initial, perUnitMinutes: 20 }]} disabled={false} />);
      fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '11' } });
      await act(async () => vi.advanceTimersByTime(400));
    }
    expect(save.mock.calls[1][0].expectedMinutes).toEqual({ perUnitMinutes: 10, setupMinutes: 5, ops: [] });
    expect(offline.refreshRead).toHaveBeenCalledWith('resource-minutes');
    expect(warn).toHaveBeenCalledWith('Planning board refresh after saving minutes failed', expect.any(Error));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it.each(['OPERATION_SET_CHANGED', 'RESOURCE_MINUTES_CHANGED'])('refreshes offline values after %s and retains the error after reopening', async (errorCode) => {
    vi.useFakeTimers();
    offline.enabled = true;
    const refreshError = new Error('refresh offline');
    offline.refreshRead.mockRejectedValue(refreshError);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const part = `OFFLINE-CONFLICT-${errorCode}`;
    let reject!: (error: unknown) => void;
    save.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    const view = render(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item({ fhincd: part })]} values={[]} disabled={false} />);
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '10' } });
    await act(async () => vi.advanceTimersByTime(400));
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '11' } });
    await act(async () => vi.advanceTimersByTime(400));
    await act(async () => reject({ isAxiosError: true, response: { status: 409, data: { errorCode } } }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(offline.refreshRead).toHaveBeenCalledExactlyOnceWith('resource-minutes');
    expect(warn).toHaveBeenCalledWith('Planning board refresh after minutes conflict failed', refreshError);
    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした。');
    view.unmount();
    render(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item({ fhincd: part })]} values={[]} disabled={false} />);
    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした。');
  });
  it('sends a null baseline when registering again after a queued deletion', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const part = 'DELETE-REGISTER';
    let finish!: (response: unknown) => void;
    save.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ values: [] });
    render(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item({ fhincd: part })]} values={[{ resourceCd: '305', fhincd: part, perUnitMinutes: 10, setupMinutes: 5 }]} disabled={false} />);
    fireEvent.click(screen.getByText(part));
    fireEvent.click(screen.getByText('元に戻す'));
    await act(async () => vi.advanceTimersByTime(400));
    fireEvent.change(screen.getByLabelText(`${part} 1台`), { target: { value: '12' } });
    await act(async () => vi.advanceTimersByTime(400));
    await act(async () => finish({ values: [], savedMinutes: null, savedOpIds: [], savedOpNos: [] }));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toEqual({ resourceCd: '305', fhincd: part, perUnitMinutes: 12, setupMinutes: 0, ops: [], expectedOpIds: [], expectedMinutes: null });
  });
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
    expect(save).toHaveBeenCalledTimes(1); expect(save).toHaveBeenLastCalledWith({ resourceCd: '305', fhincd: 'P1', perUnitMinutes: 20, setupMinutes: 5, expectedOpIds: [], expectedMinutes: null });
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
    expect(save).toHaveBeenCalledWith({ resourceCd: '305', fhincd: 'FLUSH', perUnitMinutes: 10, setupMinutes: 0, expectedOpIds: [], expectedMinutes: null });
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
    expect(save).toHaveBeenLastCalledWith({ resourceCd: '305', fhincd: 'SEQ', perUnitMinutes: 9.5, setupMinutes: 25, expectedOpIds: [], expectedMinutes: { perUnitMinutes: 10, setupMinutes: 30, ops: [] } });
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
    expect(save).toHaveBeenCalledWith({ resourceCd: '305', fhincd: 'DRAFT', setupMinutes: 5, perUnitMinutes: 19, expectedOpIds: [], expectedMinutes: null });
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
    expect(save).toHaveBeenCalledWith({ resourceCd: '021', fhincd: 'OPS', perUnitMinutes: 14, setupMinutes: 5, expectedOpIds: [], ops: [{ opNo: 1, minutes: 10, setupMinutes: 0 }, { opNo: 2, minutes: 4, setupMinutes: 5 }], expectedMinutes: null });
  });
  it('shows operations by the unit split setting instead of the resource number', () => {
    const view = render(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item({ fhincd: 'ON' })]} values={[]} disabled={false} />);
    expect(screen.queryByRole('button', { name: '＋工程' })).not.toBeInTheDocument();
    view.rerender(<PlanningBoardResourceMinutesSheet resourceCd="305" items={[item({ fhincd: 'ON' })]} values={[]} disabled={false} unitSplitEnabledByResource={{ '305': true }} />);
    expect(screen.getByRole('button', { name: '＋工程' })).toBeInTheDocument();
    expect(screen.getByText('1工程')).toBeInTheDocument();
  });
  it('keeps 021 operations by default, hides them when its unit split is off, and keeps saved operations visible', () => {
    const saved = [{ resourceCd: '021', fhincd: 'OFF', setupMinutes: 5, perUnitMinutes: 10, ops: [{ id: 'op-2', opNo: 2, minutes: 10, setupMinutes: 5 }] }];
    const view = render(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: 'OFF' })]} values={[]} disabled={false} />);
    expect(screen.getByRole('button', { name: '＋工程' })).toBeInTheDocument();
    view.rerender(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: 'OFF' })]} values={[]} disabled={false} unitSplitEnabledByResource={{ '021': false }} />);
    expect(screen.queryByRole('button', { name: '＋工程' })).not.toBeInTheDocument();
    view.rerender(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: 'OFF' })]} values={saved} disabled={false} unitSplitEnabledByResource={{ '021': false }} />);
    expect(screen.getByText('2工程')).toBeInTheDocument();
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
    expect(save).toHaveBeenLastCalledWith({ resourceCd: '021', fhincd: 'FIXED', perUnitMinutes: 5, setupMinutes: 10, expectedOpIds: ['op-1', 'op-3'], ops: [{ opNo: 3, minutes: 5, setupMinutes: 10 }], expectedMinutes: { perUnitMinutes: 15, setupMinutes: 15, ops: [{ opNo: 1, minutes: 10, setupMinutes: 5 }, { opNo: 3, minutes: 5, setupMinutes: 10 }] } });
    view.rerender(<PlanningBoardResourceMinutesSheet resourceCd="021" items={[item({ fhincd: 'FIXED' })]} values={[{ resourceCd: '021', fhincd: 'FIXED', setupMinutes: 10, perUnitMinutes: 5, ops: [{ id: 'op-3', opNo: 3, minutes: 5, setupMinutes: 10 }] }]} disabled={false} />);
    expect(screen.queryByText('1工程')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '＋工程' }));
    expect(screen.getByText('4工程')).toBeInTheDocument();
    expect(screen.queryByText('2工程')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'FIXED 4工程を外す' }));
    fireEvent.click(screen.getByRole('button', { name: 'FIXED 3工程を外す' }));
    await act(async () => vi.advanceTimersByTime(400));
    expect(save).toHaveBeenLastCalledWith({ resourceCd: '021', fhincd: 'FIXED', perUnitMinutes: 5, setupMinutes: 10, expectedOpIds: ['op-3'], ops: [], expectedMinutes: { perUnitMinutes: 5, setupMinutes: 10, ops: [{ opNo: 3, minutes: 5, setupMinutes: 10 }] } });
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
    expect(save).toHaveBeenLastCalledWith({ resourceCd: '021', fhincd: 'CHAIN', perUnitMinutes: 5.5, setupMinutes: 10, expectedOpIds: ['op-3'], ops: [{ opNo: 3, minutes: 5.5, setupMinutes: 10 }], expectedMinutes: { perUnitMinutes: 15, setupMinutes: 15, ops: [{ opNo: 1, minutes: 10, setupMinutes: 5 }, { opNo: 3, minutes: 5, setupMinutes: 10 }] } });
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
    expect(save).toHaveBeenCalledWith({ resourceCd: '021', fhincd: 'RESET', setupMinutes: 0, perUnitMinutes: null, expectedOpIds: ['op-2'], ops: [], expectedMinutes: { perUnitMinutes: 10, setupMinutes: 5, ops: [{ opNo: 2, minutes: 10, setupMinutes: 5 }] } });
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
      perUnitMinutes: 12, setupMinutes: 5, ops: [], expectedOpIds: ['op-3'], expectedMinutes: { perUnitMinutes: 10, setupMinutes: 5, ops: [{ opNo: 3, minutes: 10, setupMinutes: 5 }] } });
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
      perUnitMinutes: 12, setupMinutes: 8, ops: [], expectedOpIds: ['op-1'], expectedMinutes: { perUnitMinutes: 10, setupMinutes: 5, ops: [{ opNo: 1, minutes: 10, setupMinutes: 5 }] } });
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
      perUnitMinutes: null, setupMinutes: 0, ops: [], expectedOpIds: ['op-1'], expectedMinutes: { perUnitMinutes: 10, setupMinutes: 5, ops: [{ opNo: 1, minutes: 10, setupMinutes: 5 }] } });
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
      perUnitMinutes: 1, setupMinutes: 0, expectedOpIds: ['op-1'], ops: [{ opNo: 1, minutes: 1, setupMinutes: 0 }], expectedMinutes: { perUnitMinutes: 1, setupMinutes: 0, ops: [{ opNo: 1, minutes: 1, setupMinutes: 0 }] } });
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
    expect(save).toHaveBeenCalledExactlyOnceWith({ resourceCd: '305', fhincd: part, perUnitMinutes: 6, setupMinutes: 10, expectedOpIds: [], expectedMinutes: { perUnitMinutes: 5, setupMinutes: 10, ops: [] } });
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
    expect(save).toHaveBeenCalledExactlyOnceWith({ resourceCd: '305', fhincd: part, perUnitMinutes: 6, setupMinutes: 10, expectedOpIds: [], expectedMinutes: { perUnitMinutes: 5, setupMinutes: 10, ops: [] } });
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
