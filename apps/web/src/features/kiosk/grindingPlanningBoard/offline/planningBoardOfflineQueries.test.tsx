import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG } from './planningBoardOfflineConfig';
import { usePlanningBoardOffline } from './planningBoardOfflineContext';
import { PlanningBoardOfflineProvider } from './PlanningBoardOfflineProvider';
import { useOfflineBoard, usePlanningBoardPageQueries } from './planningBoardOfflineQueries';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
const boardCalls = () => mocks.get.mock.calls.filter(([path]) => path.endsWith('/grinding-planning-board')).length;
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
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
  const calls = boardCalls();
  await advance(300000);
  expect(boardCalls()).toBe(calls);
});

it('refreshes the board only on an arrival revision change and waits for the refresh to finish', async () => {
  function PageQueries({ paused = false }: { paused?: boolean }) {
    usePlanningBoardPageQueries({ category: 'grinding', view: 'seiban' }, {
      refetchIntervalMs: paused ? false : undefined, drawerOpen: false, showCompletedCandidates: false, dueDetailFseiban: null
    });
    return null;
  }
  const config = { ...DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG, enabled: true };
  const board = { status: 200, headers: {}, data: {
    items: [], sourceRevision: 'source', siteKey: 'test', nextCursor: null,
    dailyHoursByResource: {}, runsThroughBreaksResources: []
  } };
  let revision = 'initial';
  let releaseBoard: (() => void) | undefined;
  let holdBoard = false;
  mocks.get.mockImplementation(async (path: string) => {
    if (path.endsWith('/arrival-revision')) return { status: 200, headers: {}, data: { revision } };
    if (path.endsWith('/load')) return { status: 200, headers: {}, data: { load: [] } };
    if (path.endsWith('/resources')) return { status: 200, headers: {}, data: { resources: [] } };
    if (path.endsWith('/grinding-planning-board') && holdBoard) await new Promise<void>((resolve) => { releaseBoard = resolve; });
    return board;
  });
  const revisionCalls = () => mocks.get.mock.calls.filter(([path]) => path.endsWith('/arrival-revision')).length;
  const view = render(<PlanningBoardOfflineProvider config={config}><PageQueries /></PlanningBoardOfflineProvider>);
  await act(async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); });
  await advance(15_000);
  // The startup revision is dropped when the probe moves the gate to a new generation,
  // so the next revision cannot be trusted as a baseline and the board is read once more.
  const initialBoardCalls = boardCalls();
  expect(initialBoardCalls).toBe(2);
  expect(revisionCalls()).toBe(2);
  revision = 'changed';
  holdBoard = true;
  await advance(15_000);
  expect(boardCalls()).toBe(initialBoardCalls + 1);
  await advance(15_000);
  expect(boardCalls()).toBe(initialBoardCalls + 1);
  holdBoard = false;
  await act(async () => { releaseBoard?.(); });
  await advance(15_000);
  expect(boardCalls()).toBe(initialBoardCalls + 1);
  const beforePause = revisionCalls();
  view.rerender(<PlanningBoardOfflineProvider config={config}><PageQueries paused /></PlanningBoardOfflineProvider>);
  revision = 'changed while paused';
  await advance(15_000);
  expect(revisionCalls()).toBe(beforePause);
  view.rerender(<PlanningBoardOfflineProvider config={config}><PageQueries /></PlanningBoardOfflineProvider>);
  await advance(0);
  expect(boardCalls()).toBe(initialBoardCalls + 2);
});
