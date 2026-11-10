import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPlanningBoardSeibanActions } from '../createPlanningBoardSeibanActions';
import { PlanningBoardResourceMinutesSheet } from '../gantt/PlanningBoardResourceMinutesSheet';
import { usePlanningBoardDueActions } from '../usePlanningBoardDueActions';
import { usePlanningBoardPageGantt } from '../usePlanningBoardPageGantt';
import { usePlanningBoardPaneOrder } from '../usePlanningBoardPaneOrder';

import { createPlanningBoardWriteGate } from './planningBoardWriteGate';

import type { PlanningBoardWriteGate } from './planningBoardWriteGate';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const state = vi.hoisted(() => ({ offline: {} as { gate: PlanningBoardWriteGate; frozen: boolean }, save: vi.fn() }));
vi.mock('./PlanningBoardOfflineProvider', () => ({ usePlanningBoardOffline: () => state.offline }));
vi.mock('../gantt/usePlanningBoardGantt', () => ({ usePlanningBoardGantt: () => ({ scale: 1, layout: null, capacityPending: false, mode: 'forward' }) }));
vi.mock('../../../../api/hooks/production-schedule', () => ({
  useUpdateKioskGrindingPlanningBoardResourcePartMinutes: () => ({ mutateAsync: state.save })
}));
const item = (part: string) => ({ itemId: part, fhincd: part, fhinmei: part, quantity: 4, plannedQuantity: 4, originalRequiredMinutes: 60 } as GrindingPlanningBoardItem);
let generation: number;
let online: boolean;
let rejected: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); generation = 0; online = true; rejected = vi.fn();
  state.offline = { gate: createPlanningBoardWriteGate(() => online, () => generation, rejected), frozen: false };
  state.save.mockReset().mockResolvedValue({ ownSourceResourceCds: [], values: [] });
});
afterEach(() => { vi.useRealTimers(); localStorage.clear(); });
function goOffline() { online = false; generation++; state.offline.frozen = true; state.offline.gate.close(); }
function sheet(part: string) { return <PlanningBoardResourceMinutesSheet resourceCd="305" items={[item(part)]} values={[]} disabled={false} />; }

describe('offline write entrypoints', () => {
  it('blocks resource-minute buttons and raw input before their local draft changes', () => {
    goOffline(); render(sheet('BLOCK'));
    fireEvent.click(screen.getByRole('button', { name: 'BLOCK 1台を増やす' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'BLOCK 1台' }), { target: { value: '12' } });
    expect(screen.getByRole('spinbutton', { name: 'BLOCK 1台' })).toHaveValue(null);
    expect(rejected).toHaveBeenCalledTimes(2);
    expect(state.save).not.toHaveBeenCalled();
  });
  it('discards a debounced unsent resource-minute edit synchronously on entering read-only', async () => {
    const view = render(sheet('DEBOUNCE'));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'DEBOUNCE 1台' }), { target: { value: '12' } });
    act(goOffline);
    expect(screen.getByRole('spinbutton', { name: 'DEBOUNCE 1台' })).toHaveValue(12);
    await act(async () => vi.advanceTimersByTime(400));
    view.unmount();
    expect(state.save).not.toHaveBeenCalled();
    online = true; state.offline.frozen = false;
    render(sheet('DEBOUNCE'));
    expect(screen.getByRole('spinbutton', { name: 'DEBOUNCE 1台' })).toHaveValue(null);
    expect(state.save).not.toHaveBeenCalled();
  });
  it.each(['resolve', 'reject'] as const)('ignores an old-generation %s and never sends the next minute edit', async (outcome) => {
    let finish!: () => void;
    state.save.mockReturnValueOnce(new Promise((resolve, reject) => { finish = () => outcome === 'resolve' ? resolve({ ownSourceResourceCds: [], values: [] }) : reject(new Error('network')); }));
    render(sheet(`LATE-${outcome}`));
    const name = `LATE-${outcome} 1台`;
    fireEvent.change(screen.getByRole('spinbutton', { name }), { target: { value: '10' } });
    await act(async () => vi.advanceTimersByTime(400));
    fireEvent.change(screen.getByRole('spinbutton', { name }), { target: { value: '12' } });
    await act(async () => vi.advanceTimersByTime(400));
    act(goOffline);
    await act(async () => finish());
    expect(state.save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('spinbutton', { name })).toHaveValue(12);
    expect(screen.queryByText('保存できませんでした。')).toBeNull();
  });
  it('blocks keyboard pane ordering and leaves local storage unchanged', () => {
    goOffline();
    const { result } = renderHook(() => usePlanningBoardPaneOrder(['305', '306'], 'offline-test', () => null, false));
    act(() => result.current.onKeyDown({ key: 'ArrowDown', altKey: true, preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLButtonElement>, '305'));
    expect(result.current.order).toEqual(['305', '306']);
    expect(localStorage.getItem('kiosk.planning-board.resource-panes:offline-test')).toBeNull();
    expect(rejected).toHaveBeenCalledOnce();
  });
  it('blocks all gantt order actions before changing proposals, pins or local order history', () => {
    goOffline(); const changed = vi.fn();
    const options = { focusedFseiban: null, sortedItemsBySeiban: new Map(), view: 'resource', visibleItems: [], ganttItems: [],
      nowMs: Date.now(), resourceOrderHistory: [], registeredFseibans: [], writeQueue: { pending: false }, orderPreview: null,
      setOrderPreview: changed, setPinMode: changed, setResourceOrderHistory: changed, enqueueWrite: changed,
      enqueueOverrides: changed, updatePinsAsync: changed, updateResourceOrderBulkAsync: changed
    } as unknown as Parameters<typeof usePlanningBoardPageGantt>[0];
    const { result } = renderHook(() => usePlanningBoardPageGantt(options));
    const fake = item('GANTT');
    act(() => {
      result.current.moveResourceInGantt(fake, '306', null, 'after');
      result.current.sortResourceOrdersByDue(); result.current.proposeResourceOrder(); result.current.applyResourceOrder();
      result.current.togglePin(fake); result.current.undoResourceOrder();
    });
    expect(rejected).toHaveBeenCalledTimes(6); expect(changed).not.toHaveBeenCalled();
  });
  it('blocks registration and seiban order changes before optimistic publication', async () => {
    goOffline(); const changed = vi.fn();
    const actions = createPlanningBoardSeibanActions({ gate: state.offline.gate, registeredFseibans: ['26-1', '26-2'],
      enqueueWrite: changed, setOpenFseibans: changed, setOrderRegistrationError: changed
    } as unknown as Parameters<typeof createPlanningBoardSeibanActions>[0]);
    await expect(actions.addSeiban('26-3')).resolves.toBe(false);
    actions.moveSeiban('26-2', 'up');
    expect(rejected).toHaveBeenCalledTimes(2); expect(changed).not.toHaveBeenCalled();
  });
  it('blocks opening and committing due edits before changing an existing edit snapshot', () => {
    goOffline(); const changed = vi.fn();
    const { result } = renderHook(() => usePlanningBoardDueActions({ dueDetailQuery: {}, duePickerState: {},
      setDuePickerState: changed, setDueError: changed, setDueConflict: changed, setPendingDueScope: changed, enqueueWrite: changed
    } as unknown as Parameters<typeof usePlanningBoardDueActions>[0]));
    act(() => { result.current.openDuePicker({ kind: 'seiban' }, null); result.current.commitDueDate('2026-11-12'); });
    expect(rejected).toHaveBeenCalledTimes(2); expect(changed).not.toHaveBeenCalled();
  });

});
