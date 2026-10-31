import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ enabled: 'true', tick: vi.fn(), stop: vi.fn(), callback: undefined as undefined | (() => void) }));
vi.mock('../../config/env.js', () => ({ env: { get ADVISORY_CHECK_ENABLED() { return state.enabled; },
  LOG_LEVEL: 'silent', ADVISORY_CHECK_DIR: '/test/advisories', ADVISORY_CHECK_CRON: '*/5 * * * *' } }));
vi.mock('node-cron', () => ({ default: { schedule: vi.fn((_cron, callback) => {
  state.callback = callback; return { stop: state.stop };
}) } }));
vi.mock('./advisory-check.service.js', () => ({ AdvisoryCheckService: class { tick = state.tick; } }));
vi.mock('../inference/inference-runtime.js', () => ({ getInferenceRuntime: () => ({ createTextCompletionPort: () => ({}) }) }));
import cron from 'node-cron';
import { AdvisoryCheckScheduler } from './advisory-check.scheduler.js';

beforeEach(() => { vi.clearAllMocks(); state.enabled = 'true'; state.callback = undefined; });
it('does not schedule when disabled', async () => {
  state.enabled = 'false'; const scheduler = new AdvisoryCheckScheduler(); scheduler.start();
  expect(cron.schedule).not.toHaveBeenCalled(); await scheduler.stop();
});
it('uses Tokyo cron, prevents overlapping ticks and aborts an active run on stop', async () => {
  let activeSignal: AbortSignal | undefined;
  state.tick.mockImplementation((signal: AbortSignal) => {
    activeSignal = signal;
    return new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
  });
  const scheduler = new AdvisoryCheckScheduler(); scheduler.start(); scheduler.start();
  expect(cron.schedule).toHaveBeenCalledOnce();
  expect(cron.schedule).toHaveBeenCalledWith('*/5 * * * *', expect.any(Function), { timezone: 'Asia/Tokyo' });
  state.callback!();
  await vi.waitFor(() => expect(state.tick).toHaveBeenCalledOnce());
  state.callback!(); expect(state.tick).toHaveBeenCalledOnce();
  await scheduler.stop();
  expect(activeSignal?.aborted).toBe(true); expect(state.stop).toHaveBeenCalledOnce();
});
