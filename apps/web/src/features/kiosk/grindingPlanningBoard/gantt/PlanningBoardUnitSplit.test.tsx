import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { productionFixture } from '../__perf__/fixture';

import { PlanningBoardSingleResourceHead } from './PlanningBoardSingleResourceHead';
import { PlanningBoardUnitSplitButton } from './PlanningBoardUnitSplitButton';
import { usePlanningBoardGantt } from './usePlanningBoardGantt';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue(undefined), pending: false, frozen: false, offline: false,
  attempt: vi.fn().mockReturnValue(true), run: vi.fn((save: () => Promise<unknown>) => save()), refresh: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('../../../../api/hooks', () => ({
  useKioskGrindingPlanningBoardResourceMinutes: () => ({ data: undefined }),
  useKioskGrindingPlanningBoardResourceCapacity: () => ({ data: undefined }),
  useUpdateKioskGrindingPlanningBoardResourceMinutesSource: () => ({ isPending: false, isError: false }),
  useUpdateKioskGrindingPlanningBoardResourceCapacity: () => ({ mutate: mocks.mutate, mutateAsync: mocks.mutateAsync, isPending: mocks.pending, isError: false })
}));
vi.mock('../offline/planningBoardOfflineQueries', () => ({
  useOfflineResourceMinutes: () => ({ data: undefined }), useOfflineResourceCapacity: () => ({ data: undefined })
}));
vi.mock('../offline/PlanningBoardOfflineProvider', async original => ({
  ...await original<typeof import('../offline/PlanningBoardOfflineProvider')>(),
  usePlanningBoardOffline: () => ({ frozen: mocks.frozen, enabled: mocks.offline,
    gate: { attempt: mocks.attempt, run: mocks.run }, refreshRead: mocks.refresh })
}));
afterEach(() => {
  vi.clearAllMocks(); mocks.pending = false; mocks.frozen = false; mocks.offline = false; mocks.attempt.mockReturnValue(true); localStorage.clear();
});

it.each([
  ['021', undefined, true], ['022', undefined, true], ['305', undefined, false],
  ['021', { '021': false }, false], ['305', { '305': true }, true]
] as const)('renders %s with flags %j as %s and toggles', (resourceCd, flags, enabled) => {
  const change = vi.fn();
  render(<PlanningBoardUnitSplitButton resourceCd={resourceCd} flags={flags} disabled={false} onChange={change} />);
  const button = screen.getByRole('button', { name: '1台ずつ' });
  expect(button).toHaveAttribute('aria-pressed', String(enabled));
  fireEvent.click(button); expect(change).toHaveBeenCalledWith(resourceCd, !enabled);
});

const headProps = { resourceCd: '305', names: [], hours: 8 as const, pausesForBreaks: true, averageSeconds: 3600,
  disabled: false, pickerOpen: false, onCapacityChange: vi.fn(), unitSplitAvailable: true };
it('places the toggle immediately after the working-hours group containing breaks', () => {
  const change = vi.fn();
  render(<PlanningBoardSingleResourceHead {...headProps} onUnitSplitChange={change} unitSplitEnabledByResource={{ '305': true }} />);
  const button = screen.getByRole('button', { name: '1台ずつ' });
  expect(screen.getByRole('button', { name: '休憩' }).parentElement?.nextElementSibling).toBe(button);
  expect(button).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(button); expect(change).toHaveBeenCalledWith('305', false);
});
it.each(['grinding', 'excluded', 'unset'])('hides the toggle for %s', condition => {
  render(<PlanningBoardSingleResourceHead {...headProps} resourceCd={condition === 'unset' ? '未設定' : '305'} unitSplitAvailable={condition === 'unset'} />);
  expect(screen.queryByRole('button', { name: '1台ずつ' })).not.toBeInTheDocument();
});
it.each(['two', 'disabled', 'frozen'])('blocks the toggle when %s', condition => {
  mocks.frozen = condition === 'frozen';
  const change = vi.fn();
  render(<PlanningBoardSingleResourceHead {...headProps} machineMode={condition === 'two' ? 2 : 1}
    disabled={condition === 'disabled'} onUnitSplitChange={change} />);
  const button = screen.getByRole('button', { name: '1台ずつ' });
  expect(button).toBeDisabled();
  if (condition === 'two') expect(button).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(button); expect(change).not.toHaveBeenCalled();
});

function useGantt() {
  return usePlanningBoardGantt({ ...productionFixture(1, 1).options, enabled: false, preferenceScope: 'unit-split' });
}
it.each([true, false])('saves unitSplitEnabled=%s from the Gantt hook', enabled => {
  const { result } = renderHook(useGantt);
  act(() => result.current.changeUnitSplit('305', enabled));
  expect(mocks.attempt).toHaveBeenCalledOnce();
  expect(mocks.mutate).toHaveBeenCalledWith({ resourceCd: '305', unitSplitEnabled: enabled });
});
it.each(['pending', 'blocked'])('ignores saves when %s', condition => {
  mocks.pending = condition === 'pending'; mocks.attempt.mockReturnValue(condition !== 'blocked');
  const { result } = renderHook(useGantt);
  act(() => result.current.changeUnitSplit('305', true));
  expect(mocks.mutate).not.toHaveBeenCalled(); expect(mocks.mutateAsync).not.toHaveBeenCalled();
});
it('uses the offline gate and refreshes board, load and capacity after saving', async () => {
  mocks.offline = true;
  const { result } = renderHook(useGantt);
  act(() => result.current.changeUnitSplit('305', true));
  await waitFor(() => expect(mocks.refresh.mock.calls.map(([key]) => key)).toEqual(['board', 'load', 'resource-capacity']));
  expect(mocks.run).toHaveBeenCalledOnce();
  expect(mocks.mutateAsync).toHaveBeenCalledWith({ resourceCd: '305', unitSplitEnabled: true });
  expect(mocks.mutate).not.toHaveBeenCalled();
});
