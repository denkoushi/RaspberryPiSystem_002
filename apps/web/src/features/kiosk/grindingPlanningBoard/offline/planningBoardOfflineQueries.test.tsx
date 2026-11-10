import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG } from './planningBoardOfflineConfig';
import { PlanningBoardOfflineProvider, usePlanningBoardOffline } from './PlanningBoardOfflineProvider';
import { useOfflineBoard } from './planningBoardOfflineQueries';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../../api/client', () => ({ api: { get: mocks.get }, getResolvedClientKey: () => 'test-device' }));
vi.mock('../../../../api/hooks', () => ({}));
let query: ReturnType<typeof useOfflineBoard>;
function Harness({ refetchIntervalMs }: { refetchIntervalMs?: number | false }) {
  query = useOfflineBoard({ category: 'grinding', view: 'seiban' }, { refetchIntervalMs });
  const offline = usePlanningBoardOffline();
  return <span>{offline.snapshot.phase}:{query.data?.sourceRevision}:{String(query.isError)}:{String(offline.gate.canWrite())}</span>;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  mocks.get.mockReset().mockResolvedValue({ status: 200, headers: {}, data: {
    items: [], sourceRevision: 'original', siteKey: 'test', nextCursor: null,
    dailyHoursByResource: {}, runsThroughBreaksResources: []
  } });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('retains published data, error state and the open gate during a failed read shorter than fifteen seconds', async () => {
  render(<PlanningBoardOfflineProvider config={{ ...DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG, enabled: true }}><Harness /></PlanningBoardOfflineProvider>);
  await act(async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByText('online:original:false:true')).toBeInTheDocument();
  mocks.get.mockRejectedValue(new Error('temporary loss'));
  await act(async () => { await query.refetch(); await vi.advanceTimersByTimeAsync(14900); });
  expect(screen.getByText('online:original:false:true')).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(screen.getByText('offline:original:false:false')).toBeInTheDocument();
});


it('pauses board polling while refetchIntervalMs is false and resumes when cleared', async () => {
  const config = { ...DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG, enabled: true };
  const view = render(<PlanningBoardOfflineProvider config={config}><Harness /></PlanningBoardOfflineProvider>);
  await act(async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); });
  const boardCalls = () => mocks.get.mock.calls.filter(([path]) => path.endsWith('/grinding-planning-board')).length;
  const initialCalls = boardCalls();
  await act(async () => { await vi.advanceTimersByTimeAsync(300000); });
  expect(boardCalls()).toBe(initialCalls + 1);
  view.rerender(<PlanningBoardOfflineProvider config={config}><Harness refetchIntervalMs={false} /></PlanningBoardOfflineProvider>);
  await act(async () => { await vi.advanceTimersByTimeAsync(600000); });
  expect(boardCalls()).toBe(initialCalls + 1);
  await act(async () => { await query.refetch(); });
  expect(boardCalls()).toBe(initialCalls + 2);
  view.rerender(<PlanningBoardOfflineProvider config={config}><Harness /></PlanningBoardOfflineProvider>);
  await act(async () => { await vi.advanceTimersByTimeAsync(299999); });
  expect(boardCalls()).toBe(initialCalls + 2);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(boardCalls()).toBe(initialCalls + 3);
});

it('loads the board initially even when periodic polling is paused', async () => {
  render(<PlanningBoardOfflineProvider config={{ ...DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG, enabled: true }}><Harness refetchIntervalMs={false} /></PlanningBoardOfflineProvider>);
  await act(async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); });
  expect(screen.getByText('online:original:false:true')).toBeInTheDocument();
  const calls = mocks.get.mock.calls.filter(([path]) => path.endsWith('/grinding-planning-board')).length;
  await act(async () => { await vi.advanceTimersByTimeAsync(300000); });
  expect(mocks.get.mock.calls.filter(([path]) => path.endsWith('/grinding-planning-board'))).toHaveLength(calls);
});
