import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG } from './planningBoardOfflineConfig';
import { PlanningBoardOfflineProvider, usePlanningBoardOffline } from './PlanningBoardOfflineProvider';
import { useOfflineBoard } from './planningBoardOfflineQueries';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../../api/client', () => ({ api: { get: mocks.get }, getResolvedClientKey: () => 'test-device' }));
vi.mock('../../../../api/hooks', () => ({}));
let query: ReturnType<typeof useOfflineBoard>;
function Harness() {
  query = useOfflineBoard({ category: 'grinding', view: 'seiban' });
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
