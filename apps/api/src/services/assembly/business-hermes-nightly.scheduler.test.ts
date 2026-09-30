import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn(), schedule: vi.fn(), env: {
  BUSINESS_HERMES_NIGHTLY_ENABLED: 'true', BUSINESS_HERMES_BACKGROUND_ENABLED: 'true',
  BUSINESS_HERMES_NIGHTLY_DATA_DIR: '/tmp/test', BUSINESS_HERMES_ANSWER_CACHE_URL: 'http://test',
  BUSINESS_HERMES_ANSWER_CACHE_TOKEN: 'test'
} }));
vi.mock('node-cron', () => ({ default: { schedule: mocks.schedule } }));
vi.mock('../../config/env.js', () => ({ env: mocks.env }));
vi.mock('../../lib/logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('./business-hermes-nightly.service.js', () => ({ BusinessHermesNightlyService: class { run = mocks.run; } }));
import { BusinessHermesNightlyScheduler, failureBackoffMinutes } from './business-hermes-nightly.scheduler.js';

afterEach(() => { vi.clearAllMocks(); mocks.run.mockReset(); });
describe('Spare-capacity preparation scheduling', () => {
  it('continues the next document batch immediately then backs off when empty', async () => {
    mocks.schedule.mockReturnValue({ stop: vi.fn() });
    mocks.run.mockResolvedValueOnce({ status: 'awaiting_holdout', preparedDocuments: 4 })
      .mockResolvedValue({ status: 'no_work' });
    const scheduler = new BusinessHermesNightlyScheduler(); scheduler.start();
    expect(mocks.schedule.mock.calls[0]![0]).toBe('* * * * *');
    const tick = mocks.schedule.mock.calls[0]![1]; tick();
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(2));
    await Promise.resolve(); tick();
    expect(mocks.run).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });
  it('does not spin on deferred work or repeat an unchanged conversation batch', async () => {
    for (const status of ['deferred', 'awaiting_holdout']) {
      mocks.schedule.mockClear(); mocks.run.mockReset().mockResolvedValue({ status, preparedDocuments: 0 });
      const scheduler = new BusinessHermesNightlyScheduler(); scheduler.start();
      mocks.schedule.mock.calls[0]![1]();
      await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
      await scheduler.stop();
    }
  });
  it('backs off after repeated failures instead of retrying every minute', async () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(failureBackoffMinutes)).toEqual([15, 30, 60, 120, 240, 360, 360]);
    vi.useFakeTimers();
    try {
      mocks.schedule.mockClear(); mocks.run.mockReset().mockResolvedValue({ status: 'failed' });
      const scheduler = new BusinessHermesNightlyScheduler(); scheduler.start();
      const tick = mocks.schedule.mock.calls[0]![1];
      tick();
      await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(14 * 60_000); tick(); await Promise.resolve();
      expect(mocks.run).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2 * 60_000); tick();
      await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(2));
      // The second failure waits 30 minutes.
      await vi.advanceTimersByTimeAsync(20 * 60_000); tick(); await Promise.resolve();
      expect(mocks.run).toHaveBeenCalledTimes(2);
      await scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });
  it('backs off when a batch throws', async () => {
    vi.useFakeTimers();
    try {
      mocks.schedule.mockClear(); mocks.run.mockReset().mockRejectedValue(new Error('boom'));
      const scheduler = new BusinessHermesNightlyScheduler(); scheduler.start();
      const tick = mocks.schedule.mock.calls[0]![1];
      tick();
      await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(5 * 60_000); tick(); await Promise.resolve();
      expect(mocks.run).toHaveBeenCalledTimes(1);
      await scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
